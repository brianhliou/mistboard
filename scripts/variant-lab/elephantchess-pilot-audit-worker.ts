// Independently re-search verified ElephantChess candidates at the frozen
// audit depth. Candidate leases are separate from scan shards so parallel
// auditors can stop and resume without repeating resolved evidence.

import { parseArgs } from 'node:util';
import {
  probePikafishUciIdentity,
  readPinnedArtifact,
} from '../../apps/server/src/elephantchess-pilot-run-provenance.ts';
import { close, getPool, init } from '../../apps/server/src/persistence-db.ts';
import { getXiangqiPuzzleMiningRun } from '../../apps/server/src/persistence-xiangqi-puzzle-mining.ts';
import { processNextXiangqiPuzzleAuditCandidate } from '../../apps/server/src/xiangqi-puzzle-audit-worker.ts';
import {
  validateStandardXiangqiPuzzle,
  type XiangqiPuzzle,
} from '../../packages/game/src/index.ts';
import { PikafishEngine } from './xiangqi-pikafish-uci.ts';
import {
  auditXiangqiPuzzle,
  type XiangqiPuzzleAuditOptions,
} from './xiangqi-puzzle-uniqueness-audit.ts';

function required(value: string | undefined, flag: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${flag} is required`);
  return normalized;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is missing from the mining run`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is missing`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is missing`);
  return value;
}

const { values } = parseArgs({
  options: {
    'run-id': { type: 'string' },
    'worker-id': { type: 'string' },
    binary: { type: 'string' },
    net: { type: 'string' },
    'lease-ms': { type: 'string', default: String(30 * 60_000) },
    'max-candidates': { type: 'string', default: '1' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(`Usage: npm run pilot:elephantchess-audit -- \\
  --run-id RUN_ID --worker-id WORKER_ID --binary PATH --net PATH \\
  [--lease-ms 1800000] [--max-candidates 1]\n
The worker reads the depth and uniqueness gate from the immutable run, and
re-verifies both Pikafish artifacts before claiming candidates.\n`);
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const runId = required(values['run-id'], '--run-id');
const workerId = required(values['worker-id'], '--worker-id');
const leaseMs = Number(values['lease-ms']);
const maxCandidates = Number(values['max-candidates']);
if (!Number.isSafeInteger(leaseMs) || leaseMs < 3_000) {
  throw new Error('--lease-ms must be an integer of at least 3000');
}
if (!Number.isSafeInteger(maxCandidates) || maxCandidates <= 0) {
  throw new Error('--max-candidates must be a positive integer');
}

// Blast radius for a worker fleet. A mining worker only ever runs small,
// indexed queries plus its own engine work, so a query still running after five
// minutes is a bug, not slow progress, and 2GB of temp files is far more than
// any healthy query here needs. On 2026-08-22 the absence of both let eight
// workers fill the production volume with 45GB of spill.
const MINING_SESSION_GUARDS = {
  statementTimeoutMs: 5 * 60_000,
  tempFileLimitKb: 2 * 1024 * 1024,
  // One worker drains its unit sequentially, so two connections is generous.
  // The default of ten is sized for a single long-lived server; multiplied by a
  // 32-worker fleet it would reserve 320 of production's 500 max_connections,
  // starving the live site to no benefit.
  maxPoolConnections: 2,
};

init(databaseUrl, MINING_SESSION_GUARDS);
let engine: PikafishEngine | null = null;
try {
  const run = await getXiangqiPuzzleMiningRun(getPool(), runId);
  const engineProfile = record(run.engineProfile, 'engineProfile');
  const binaryProfile = record(engineProfile.binary, 'engineProfile.binary');
  const networkProfile = record(engineProfile.network, 'engineProfile.network');
  const expectedIdentity = record(engineProfile.identity, 'engineProfile.identity');
  const binary = await readPinnedArtifact({
    path: required(values.binary, '--binary'),
    expectedSha256: text(binaryProfile.sha256, 'engineProfile.binary.sha256'),
    label: 'Pikafish binary',
  });
  const net = await readPinnedArtifact({
    path: required(values.net, '--net'),
    expectedSha256: text(networkProfile.sha256, 'engineProfile.network.sha256'),
    label: 'Pikafish network',
  });
  const identity = await probePikafishUciIdentity(binary.path);
  if (identity.name !== text(expectedIdentity.name, 'engineProfile.identity.name')) {
    throw new Error(
      `Pikafish identity mismatch: expected ${expectedIdentity.name}, got ${identity.name}`,
    );
  }
  const auditProfile = record(run.auditProfile, 'auditProfile');
  const profileVersion = text(auditProfile.profileVersion, 'auditProfile.profileVersion');
  if (profileVersion !== text(engineProfile.profileVersion, 'engineProfile.profileVersion')) {
    throw new Error('engine and audit profile versions do not match');
  }
  const options: XiangqiPuzzleAuditOptions = {
    depth: number(auditProfile.depth, 'auditProfile.depth'),
    nodes: null,
    winHi: number(auditProfile.winHi, 'auditProfile.winHi'),
    winLo: number(auditProfile.winLo, 'auditProfile.winLo'),
    minGapCp: number(auditProfile.minGapCp, 'auditProfile.minGapCp'),
    limit: 0,
    ids: null,
    out: null,
  };
  engine = new PikafishEngine(binary.path, net.path);
  await engine.init();

  let processedCandidates = 0;
  const verdicts = { pass: 0, reject: 0 };
  while (processedCandidates < maxCandidates) {
    const result = await processNextXiangqiPuzzleAuditCandidate({
      runId,
      workerId,
      leaseMs,
      profileVersion,
      engineProfile,
      auditCandidate: async (candidate) => {
        if (!candidate.puzzleData || typeof candidate.puzzleData !== 'object') {
          throw new Error(`candidate ${candidate.id} has no verified puzzle data`);
        }
        const puzzle = candidate.puzzleData as XiangqiPuzzle;
        const validation = validateStandardXiangqiPuzzle(puzzle);
        if (!validation.ok) {
          return {
            verdict: 'reject',
            reason: 'correctness-defect',
            evidence: { phase: 'pre-audit-validation', validation },
          };
        }
        const report = await auditXiangqiPuzzle(engine as PikafishEngine, puzzle, options);
        return {
          verdict: report.verdict === 'clean' ? 'pass' : 'reject',
          reason: report.verdict === 'clean' ? null : report.verdict,
          evidence: report,
        };
      },
    });
    if (!result) break;
    processedCandidates += 1;
    verdicts[result.verdict] += 1;
  }
  process.stdout.write(
    `${JSON.stringify({
      kind: 'elephantchess-pilot-audit-worker',
      runId,
      workerId,
      processedCandidates,
      verdicts,
      depth: options.depth,
      profileVersion,
    })}\n`,
  );
} finally {
  engine?.quit();
  await close();
}
