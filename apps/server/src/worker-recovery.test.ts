import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { EngineGameTask, EngineWorkerRun } from './engine-experiments.js';
import { isWorkerDbConnectionError } from './worker-db.js';

// Execute the entry point with isolated process state and database/service
// boundaries. This exercises its real retry, cleanup, shutdown and claim loop
// without a database, sockets, engine binaries or changes to process.env.
const workerSource = stripTypeScriptTypes(
  readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8'),
).replace(
  /^import ([\s\S]*?) from '([^']+)';/gm,
  (_statement, bindings: string, specifier: string) => {
    // Adapt the entry point's named/default imports to the isolated boundaries.
    const destructuring = bindings.startsWith('{') ? bindings : `{ default: ${bindings} }`;
    return `const ${destructuring} = require('${specifier}');`;
  },
);

async function runRecoveryScenario(kind: 'ambiguous-claim' | 'expired-heartbeat') {
  let now = 0;
  let heartbeatAttempts = 0;
  let claimAttempts = 0;
  let orphan: { workerRunId: string; expiresAt: number } | null = null;
  let orphanCleaned = false;
  let serviceOpen = false;
  let serviceCloses = 0;
  const registrations: EngineWorkerRun[] = [];
  const claimedRunIds: string[] = [];
  const executedRunIds: string[] = [];
  const stoppedRunIds: string[] = [];
  const logs: { kind: string; workerRunId?: string; error?: string }[] = [];
  const registrationInputs: unknown[] = [];
  const fakeProcess = {
    env: {
      DATABASE_URL: 'postgres://worker-test.invalid/worker-test',
      WORKER_PROVIDER: 'test-provider',
      WORKER_PROVIDER_RUN_ID: 'test-provider-run',
      WORKER_MAX_TASKS: '1',
      WORKER_IDLE_SLEEP_MS: '60000',
      MISTBOARD_ENGINE_WARMUP_DISABLED: '1',
    },
    argv: ['node', 'worker.ts', '--execute', '--loop'],
    pid: 123,
    exitCode: 0,
    on: () => undefined,
    exit: () => assert.fail('unexpected process.exit'),
  };
  const modules: Record<string, unknown> = {
    'node:http': { createServer: () => assert.fail('unexpected health listener') },
    'node:os': { hostname: () => 'test-worker' },
    pg: {
      default: {
        Client: class {
          async connect() {}
          async end() {}
        },
      },
    },
    './worker-db.js': {
      createWorkerPool: () => ({ end: async () => undefined }),
      isWorkerDbConnectionError,
    },
    './engine-experiments.js': {
      registerWorkerRun: async (_pool: unknown, input: unknown) => {
        registrationInputs.push(input);
        const run = { id: `run-${registrations.length + 1}`, status: 'running' } as EngineWorkerRun;
        registrations.push(run);
        return { ...run };
      },
      heartbeatWorkerRun: async (_pool: unknown, id: string) => {
        const run = registrations.find((candidate) => candidate.id === id)!;
        heartbeatAttempts += 1;
        assert.ok(heartbeatAttempts < 20, 'the worker must recover within a bounded poll count');
        if (kind === 'expired-heartbeat' && now < 180_000) {
          // A peer resumes first after the outage and expires this worker's
          // two-minute heartbeat before our next retry reaches Postgres.
          if (now >= 120_000) run.status = 'failed';
          throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
        }
        if (run.status !== 'running') throw new Error(`worker run ${id} is not active`);
        return { ...run };
      },
      cleanupStaleEngineGameTasks: async () => {
        const result = {
          retried: 0,
          failed: 0,
          aborted: 0,
          failedWorkerRuns: 0,
          staleWorkerRuns: 0,
        };
        if (orphan && now >= orphan.expiresAt) {
          registrations.find((run) => run.id === orphan!.workerRunId)!.status = 'failed';
          orphan = null;
          orphanCleaned = true;
          result.retried = 1;
          result.failedWorkerRuns = 1;
          // Another worker takes the requeued orphan. Our queue is empty
          // until a new task arrives on the next poll.
        }
        return result;
      },
      claimNextEngineGameTask: async (_pool: unknown, input: { workerRunId: string }) => {
        claimedRunIds.push(input.workerRunId);
        claimAttempts += 1;
        if (kind === 'ambiguous-claim') {
          if (claimAttempts === 1) {
            // COMMIT succeeded but its acknowledgement was lost: the local
            // task stays unknown while the database owns a five-minute lease.
            orphan = { workerRunId: input.workerRunId, expiresAt: now + 300_000 };
            throw Object.assign(new Error('connection reset after COMMIT'), { code: 'ECONNRESET' });
          }
          if (now <= 300_000) return null;
        }
        return { id: 'next-task', workerRunId: input.workerRunId, claimToken: 'claim' };
      },
      stopWorkerRun: async (_pool: unknown, id: string) => {
        stoppedRunIds.push(id);
      },
    },
    './engine-registry.js': {},
    './engine-runner.js': {
      runRandomLegalEngineGame: async (_pool: unknown, task: EngineGameTask) => {
        assert.equal(serviceOpen, true, 'live moves remain available through recovery');
        assert.equal(registrations.find((run) => run.id === task.workerRunId)?.status, 'running');
        executedRunIds.push(task.workerRunId!);
        return { gameId: 'next-game', status: 'completed', plyCount: 1 };
      },
    },
    './engine-service.js': {
      startEngineHttpService: async () => {
        serviceOpen = true;
        return {
          close: async () => {
            serviceOpen = false;
            serviceCloses += 1;
          },
        };
      },
    },
    './migrate.js': { runMigrations: async () => [] },
    './obs.js': { startObservability: () => () => undefined },
    './python-pool.js': { disposeAllPythonPools: () => undefined },
    './variant-eve-registry.js': { eveWorkerCapabilities: () => ({ eve_test: true }) },
  };
  await runInNewContext(`(async () => { ${workerSource}\n })()`, {
    exports: {},
    require: (name: string) => {
      assert.ok(Object.hasOwn(modules, name), `unexpected dependency: ${name}`);
      return modules[name];
    },
    process: fakeProcess,
    console: { log: (line: string) => logs.push(JSON.parse(line)) },
    Error,
    Date: class extends Date {
      static override now() {
        return now;
      }
    },
    setTimeout: (callback: () => void, ms: number) => {
      now += ms;
      callback();
    },
  });
  return {
    exitCode: fakeProcess.exitCode,
    registrations,
    registrationInputs,
    claimedRunIds,
    executedRunIds,
    stoppedRunIds,
    logs,
    orphanCleaned,
    serviceCloses,
  };
}

function assertRecovered(result: Awaited<ReturnType<typeof runRecoveryScenario>>) {
  assert.equal(result.exitCode, 0, JSON.stringify(result.logs));
  assert.equal(result.registrations.length, 2, 'an expired run gets a fresh registration');
  assert.equal(result.registrations[0]!.status, 'failed', 'the expired run stays fenced');
  assert.deepEqual(result.registrationInputs[1], result.registrationInputs[0]);
  assert.deepEqual(result.executedRunIds, ['run-2']);
  assert.deepEqual(result.stoppedRunIds, ['run-2'], 'shutdown records the replacement run');
  const replacementClaim = result.claimedRunIds.indexOf('run-2');
  assert.ok(replacementClaim >= 0);
  assert.ok(result.claimedRunIds.slice(replacementClaim).every((id) => id === 'run-2'));
  assert.equal(result.serviceCloses, 1, 'the service closes only at normal worker shutdown');
  assert.equal(
    result.logs.some((entry) => entry.kind === 'worker_failed'),
    false,
  );
}

test('worker survives cleanup expiring an ambiguously committed claim', async () => {
  const result = await runRecoveryScenario('ambiguous-claim');
  assert.equal(result.orphanCleaned, true, 'the five-minute orphan lease was cleaned up');
  assertRecovered(result);
});

test('worker re-registers when a peer expires its heartbeat during a database outage', async () => {
  assertRecovered(await runRecoveryScenario('expired-heartbeat'));
});
