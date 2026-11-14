// Railway deploy settings that only show their worth on a restart, so nothing
// else would catch them drifting (#477). The engine-worker holds live games'
// seats in memory: a deploy that SIGKILLs it mid-turn, or swaps traffic before
// the replacement has warmed its engines, forfeits bot games.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readRailwayServiceConfig } from './lib/railway-config.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// .railway/<service>.json (#980); railway-config-sync.test.mjs keeps the
// legacy Config as Code files equal to them until the cutover.
const readService = (service) => readRailwayServiceConfig(repoRoot, service);
const engineService = readFileSync(resolve(repoRoot, 'apps/server/src/engine-service.ts'), 'utf8');

function maxWorkerWatchdogMs() {
  const match = engineService.match(/const MAX_ENGINE_SERVICE_TIMEOUT_MS = ([\d_]+);/);
  assert.ok(match, 'engine-service.ts declares MAX_ENGINE_SERVICE_TIMEOUT_MS');
  return Number(match[1].replaceAll('_', ''));
}

test('engine-worker starts node directly, so SIGTERM reaches the worker', () => {
  const { deploy } = readService('engine-worker');
  // The default `npm start` runs node under `sh -c`, which drops SIGTERM: the
  // same failure web had until 2026-09-26 (runbook § Graceful shutdown).
  assert.equal(deploy?.startCommand, readService('web').deploy.startCommand);
  assert.equal(deploy.startCommand, 'node scripts/start.mjs');
});

test('engine-worker drains longer than the longest turn the worker will run', () => {
  const { deploy } = readService('engine-worker');
  const watchdogS = maxWorkerWatchdogMs() / 1000;
  assert.ok(
    deploy?.drainingSeconds > watchdogS,
    `drainingSeconds (${deploy?.drainingSeconds}) must exceed the ${watchdogS}s turn cap`,
  );
});

test('engine-worker is healthy only once its engines are warm', () => {
  const { deploy } = readService('engine-worker');
  assert.equal(deploy?.healthcheckPath, '/health');
  assert.ok(deploy.healthcheckTimeout >= 60, 'warmup self-tests every engine before binding');
  assert.match(engineService, /const HEALTH_PATH = '\/health';/);
  const worker = readFileSync(resolve(repoRoot, 'apps/server/src/worker.ts'), 'utf8');
  assert.ok(
    worker.indexOf('await warmupLiveEnginePools()') <
      worker.indexOf('engineHttpService = await startEngineHttpService('),
    'the port binds only after warmup, so /health means "can serve a move"',
  );
});
