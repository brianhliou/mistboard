// Manifest-bound ElephantChess scan/verify worker. It claims one durable shard
// at a time, loads only its frozen ordered game members, persists every scan
// candidate and versioned verification verdict, and checkpoints after a whole
// game. A crash after evidence writes but before checkpoint is safe: the next
// claim retries the game against idempotent candidate/judgment identities.

import { parseArgs } from 'node:util';
import {
  probePikafishUciIdentity,
  readPinnedArtifact,
} from '../../apps/server/src/elephantchess-pilot-run-provenance.ts';
import { close, getPool, init } from '../../apps/server/src/persistence-db.ts';
import {
  getHistoricalXiangqiGame,
  getHistoricalXiangqiSource,
} from '../../apps/server/src/persistence-historical-xiangqi.ts';
import {
  getXiangqiPuzzleMiningRun,
  recordXiangqiPuzzleMiningCandidate,
  recordXiangqiPuzzleMiningJudgment,
  xiangqiPuzzleMiningCandidateId,
} from '../../apps/server/src/persistence-xiangqi-puzzle-mining.ts';
import { processNextXiangqiPuzzleMiningShard } from '../../apps/server/src/xiangqi-puzzle-mining-worker.ts';
import { PikafishEngine } from './xiangqi-pikafish-uci.ts';
import {
  mineXiangqiPuzzleGame,
  type XiangqiPuzzleMinerMetrics,
  type XiangqiPuzzleMinerOptions,
} from './xiangqi-puzzle-miner.ts';

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
    'max-shards': { type: 'string', default: '1' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(`Usage: npm run pilot:elephantchess-worker -- \\
  --run-id RUN_ID --worker-id WORKER_ID --binary PATH --net PATH \\
  [--lease-ms 1800000] [--max-shards 1]\n
The worker reads all search settings and expected artifact hashes from the
immutable run. DATABASE_URL is required. Run multiple processes with distinct
worker ids for parallel shards.\n`);
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const runId = required(values['run-id'], '--run-id');
const workerId = required(values['worker-id'], '--worker-id');
const leaseMs = Number(values['lease-ms']);
const maxShards = Number(values['max-shards']);
if (!Number.isSafeInteger(leaseMs) || leaseMs < 3_000) {
  throw new Error('--lease-ms must be an integer of at least 3000');
}
if (!Number.isSafeInteger(maxShards) || maxShards <= 0) {
  throw new Error('--max-shards must be a positive integer');
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

const sourceSlugs = new Map<string, string | null>();
async function sourceSlugFor(sourceId: string): Promise<string | null> {
  if (!sourceSlugs.has(sourceId)) {
    sourceSlugs.set(sourceId, (await getHistoricalXiangqiSource(sourceId))?.slug ?? null);
  }
  return sourceSlugs.get(sourceId) ?? null;
}
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
  const scan = record(run.scanProfile, 'scanProfile');
  const solutionPlies = record(scan.solutionPlies, 'scanProfile.solutionPlies');
  const profileVersion = text(scan.profileVersion, 'scanProfile.profileVersion');
  if (profileVersion !== text(engineProfile.profileVersion, 'engineProfile.profileVersion')) {
    throw new Error('engine and scan profile versions do not match');
  }
  const options: XiangqiPuzzleMinerOptions = {
    source: 'db',
    dir: null,
    dbUrl: databaseUrl,
    plyMin: 0,
    limit: 0,
    offset: 0,
    seed: 0,
    concurrency: 1,
    scanNodes: number(scan.scanNodes, 'scanProfile.scanNodes'),
    verifyNodes: number(scan.verifyNodes, 'scanProfile.verifyNodes'),
    swingCp: number(scan.swingCp, 'scanProfile.swingCp'),
    winCp: number(scan.winCp, 'scanProfile.winCp'),
    decidedCp: number(scan.decidedCp, 'scanProfile.decidedCp'),
    uniqueGapCp: number(scan.initialUniqueGapCp, 'scanProfile.initialUniqueGapCp'),
    verifyDepth: number(scan.verifyDepth, 'scanProfile.verifyDepth'),
    winHi: number(run.auditProfile.winHi, 'auditProfile.winHi'),
    winLo: number(run.auditProfile.winLo, 'auditProfile.winLo'),
    minGapCp: number(run.auditProfile.minGapCp, 'auditProfile.minGapCp'),
    minPly: number(scan.minPly, 'scanProfile.minPly'),
    maxSolutionPlies: number(solutionPlies.max, 'scanProfile.solutionPlies.max'),
    minSolutionPlies: number(solutionPlies.min, 'scanProfile.solutionPlies.min'),
    perGame: number(scan.perGame, 'scanProfile.perGame'),
    emitSeed: null,
    insertDb: false,
    jsonl: '',
    binary: binary.path,
    net: net.path,
  };
  const metrics: XiangqiPuzzleMinerMetrics = {
    gamesRequested: 0,
    gamesLoaded: 0,
    gamesScanned: 0,
    gamesFailed: 0,
    gamesIllegalReplay: 0,
    positionsEvaluated: 0,
    verifyEvals: 0,
    candidates: 0,
    verified: 0,
    rejects: {},
    themes: {},
  };
  const seenPositions = new Set<string>();
  engine = new PikafishEngine(binary.path, net.path);
  await engine.init();
  let completedShards = 0;
  let processedGames = 0;
  while (completedShards < maxShards) {
    const result = await processNextXiangqiPuzzleMiningShard({
      runId,
      workerId,
      leaseMs,
      processGame: async (member) => {
        const game = await getHistoricalXiangqiGame(member.historicalGameId);
        if (!game) throw new Error(`historical game ${member.historicalGameId} not found`);
        // The source decides whether a puzzle must carry a credit link (#712).
        const sourceSlug = await sourceSlugFor(game.sourceId);
        metrics.gamesLoaded += 1;
        await mineXiangqiPuzzleGame(
          engine as PikafishEngine,
          {
            id: game.id,
            moves: game.moves,
            meta: {
              event: game.eventName ?? null,
              playedOn: game.playedOn ?? null,
              result: game.result,
              redName: game.redNameRaw ?? null,
              blackName: game.blackNameRaw ?? null,
              sourceSlug,
              sourceUrl: game.sourceUrl ?? null,
              sourceGameId: game.sourceGameId ?? null,
            },
          },
          options,
          metrics,
          seenPositions,
          {
            candidateScanned: async (candidate) => {
              await recordXiangqiPuzzleMiningCandidate({
                runId,
                historicalGameId: candidate.gameId,
                postBlunderPly: candidate.postBlunderPly,
                positionKey: candidate.positionKey,
                trigger: 'eval-swing',
                scanEvidence: {
                  ...candidate.scan,
                  scanNodes: options.scanNodes,
                  swingCpThreshold: options.swingCp,
                  winCpThreshold: options.winCp,
                  decidedCpThreshold: options.decidedCp,
                },
              });
            },
            candidateJudged: async (judgment) => {
              const candidateId = xiangqiPuzzleMiningCandidateId({
                runId,
                historicalGameId: judgment.gameId,
                postBlunderPly: judgment.postBlunderPly,
              });
              await recordXiangqiPuzzleMiningJudgment({
                candidateId,
                stage: 'verify',
                profileVersion,
                verdict: judgment.verdict,
                reason: judgment.reason,
                engineProfile,
                evidence: judgment.evidence,
                puzzleData: judgment.puzzle,
              });
            },
          },
        );
        metrics.gamesScanned += 1;
      },
    });
    if (!result) break;
    completedShards += 1;
    processedGames += result.processedGames;
  }
  process.stdout.write(
    `${JSON.stringify({
      kind: 'elephantchess-pilot-worker',
      runId,
      workerId,
      completedShards,
      processedGames,
      candidates: metrics.candidates,
      verified: metrics.verified,
      rejects: metrics.rejects,
    })}\n`,
  );
} finally {
  engine?.quit();
  await close();
}
