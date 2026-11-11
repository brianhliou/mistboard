// Verify the frozen manifest and exact Pikafish artifacts before creating a
// durable ElephantChess mining run. --verify-only performs every provenance
// check without touching the database.

import { parseArgs } from 'node:util';
import {
  probePikafishUciIdentity,
  readPinnedArtifact,
  readPinnedElephantChessPilotManifest,
} from './elephantchess-pilot-run-provenance.js';
import { close, init } from './persistence-db.js';
import { initializeXiangqiPuzzleMiningRun } from './persistence-xiangqi-puzzle-mining.js';

function required(value: string | undefined, flag: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${flag} is required`);
  return normalized;
}

function positiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

const { values } = parseArgs({
  options: {
    manifest: { type: 'string' },
    'manifest-file-sha256': { type: 'string' },
    'manifest-content-sha256': { type: 'string' },
    binary: { type: 'string' },
    'binary-sha256': { type: 'string' },
    net: { type: 'string' },
    'net-sha256': { type: 'string' },
    'engine-id': { type: 'string' },
    'profile-version': { type: 'string', default: 'elephantchess-pilot-2026-07-v1' },
    'shard-size': { type: 'string', default: '25' },
    'scan-nodes': { type: 'string', default: '60000' },
    'verify-nodes': { type: 'string', default: '600000' },
    'verify-depth': { type: 'string', default: '20' },
    'audit-depth': { type: 'string', default: '22' },
    'verify-only': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(`Usage: npm run pilot:elephantchess-run:init --workspace @mistboard/server -- \\
  --manifest PATH --manifest-file-sha256 SHA256 --manifest-content-sha256 SHA256 \\
  --binary PATH --binary-sha256 SHA256 --net PATH --net-sha256 SHA256 \\
  --engine-id "Pikafish YYYY-MM-DD" [--verify-only]\n+
DATABASE_URL is required unless --verify-only is set. All four expected hashes
are mandatory, so an ambient file or later artifact cannot silently redefine
the frozen run.\n`);
  process.exit(0);
}

const manifest = await readPinnedElephantChessPilotManifest({
  path: required(values.manifest, '--manifest'),
  expectedFileSha256: required(values['manifest-file-sha256'], '--manifest-file-sha256'),
  expectedContentSha256: required(values['manifest-content-sha256'], '--manifest-content-sha256'),
});
const binary = await readPinnedArtifact({
  path: required(values.binary, '--binary'),
  expectedSha256: required(values['binary-sha256'], '--binary-sha256'),
  label: 'Pikafish binary',
});
const net = await readPinnedArtifact({
  path: required(values.net, '--net'),
  expectedSha256: required(values['net-sha256'], '--net-sha256'),
  label: 'Pikafish network',
});
const expectedEngineId = required(values['engine-id'], '--engine-id');
const identity = await probePikafishUciIdentity(binary.path);
if (identity.name !== expectedEngineId) {
  throw new Error(`Pikafish identity mismatch: expected ${expectedEngineId}, got ${identity.name}`);
}

const profileVersion = required(values['profile-version'], '--profile-version');
const shardSize = positiveInteger(values['shard-size'], '--shard-size');
const scanNodes = positiveInteger(values['scan-nodes'], '--scan-nodes');
const verifyNodes = positiveInteger(values['verify-nodes'], '--verify-nodes');
const verifyDepth = positiveInteger(values['verify-depth'], '--verify-depth');
const auditDepth = positiveInteger(values['audit-depth'], '--audit-depth');
const engineProfile = {
  profileVersion,
  protocol: 'uci',
  identity,
  binary: { name: binary.name, sha256: binary.sha256 },
  network: { name: net.name, sha256: net.sha256 },
  options: { threads: 1, hashMb: 16, multiPv: 2 },
};
const scanProfile = {
  profileVersion,
  scanNodes,
  verifyNodes,
  verifyDepth,
  swingCp: 250,
  winCp: 250,
  decidedCp: 800,
  initialUniqueGapCp: 150,
  minPly: 8,
  solutionPlies: { min: 3, max: 7 },
  perGame: 3,
  clearHashBeforeStandaloneSearch: true,
};
const auditProfile = {
  profileVersion,
  depth: auditDepth,
  multiPv: 2,
  winHi: 0.8,
  winLo: 0.6,
  minGapCp: 200,
  clearHashBeforeStandaloneSearch: true,
};

if (values['verify-only']) {
  process.stdout.write(
    `${JSON.stringify({
      kind: 'elephantchess-pilot-run-provenance',
      verified: true,
      manifestSha256: manifest.manifest.manifestSha256,
      serializedSha256: manifest.fileSha256,
      selectedGames: manifest.manifest.games.length,
      engine: identity.name,
      binarySha256: binary.sha256,
      netSha256: net.sha256,
      profileVersion,
      shardSize,
    })}\n`,
  );
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required unless --verify-only is set');
init(databaseUrl);
try {
  const run = await initializeXiangqiPuzzleMiningRun({
    manifest: manifest.manifest,
    serializedSha256: manifest.fileSha256,
    shardSize,
    engineProfile,
    scanProfile,
    auditProfile,
  });
  process.stdout.write(
    `${JSON.stringify({
      kind: 'elephantchess-pilot-mining-run',
      runId: run.id,
      status: run.status,
      selectedGames: run.selectedGames,
      shards: run.shards,
      manifestSha256: run.manifestSha256,
      executionSha256: run.executionSha256,
      engine: identity.name,
      profileVersion,
    })}\n`,
  );
} finally {
  await close();
}
