import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { buildMistboardReadout } from './mistboard-readout.js';
import type { HttpApiContext } from './routes/lib.js';
import { readoutGenerateForApi, tryHandle } from './routes/readouts.js';

type ResponseCapture = { body: string; headers: Record<string, string>; status: number | null };

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}

const ctx = {
  databaseRequired: true,
  activeGameCount: () => 2,
  persistenceHealth: () => ({ count1m: 0, lastAt: null }),
} as unknown as HttpApiContext;

test('readout route rejects missing OIDC bearer before touching persistence', async () => {
  const response = captureResponse();
  const request = { method: 'POST', headers: {} } as IncomingMessage;
  const handled = await tryHandle(
    ctx,
    request,
    response,
    '/api/admin/readouts/generate',
    new URL('http://localhost/api/admin/readouts/generate'),
  );
  assert.equal(handled, true);
  assert.equal(response.status, 401);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body), { error: 'unauthorized' });
});

test('readout route rejects the wrong method with explicit no-store headers', async () => {
  const response = captureResponse();
  const request = { method: 'GET', headers: {} } as IncomingMessage;
  const handled = await tryHandle(
    ctx,
    request,
    response,
    '/api/admin/readouts/generate',
    new URL('http://localhost/api/admin/readouts/generate'),
  );
  assert.equal(handled, true);
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'POST');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('readout generation parses auto cadence and returns rendered aggregate data', async () => {
  const now = new Date('2026-07-20T17:23:00Z');
  const report = buildMistboardReadout({
    snapshotId: 'readout_route',
    trigger: 'weekly',
    now,
    runtime: {
      revision: null,
      activeGames: 2,
      databaseRequired: true,
      persistence: 'disabled',
      persistenceErrors: { count1m: 0, lastAt: null },
    },
    facts: {
      product: null,
      puzzles: null,
      mining: null,
      engines: null,
      collectorErrors: [{ section: 'product', code: 'collector_failed' }],
    },
  });
  const result = await readoutGenerateForApi(
    ctx,
    { trigger: 'auto', dryRun: true },
    {
      now: () => now,
      verifyToken: async () => ({}),
      generate: async (input) => {
        assert.equal(input.trigger, 'weekly');
        assert.equal(input.dryRun, true);
        // The broadcast viewer census is read off the context; this one has
        // none, so the runtime carries no fabricated peak.
        assert.equal(Object.hasOwn(input.runtime, 'broadcastViewersPeak'), false);
        return { report, reused: false, previousAlertKey: null };
      },
      latest: async () => report,
      list: async () => [],
      email: async () => ({ send: false as const, reason: 'dry-run' as const }),
    },
  );
  assert.equal(result.status, 200);
  assert.equal((result.payload.report as { snapshotId: string }).snapshotId, 'readout_route');
  assert.match(result.payload.markdown as string, /Mistboard Readout/);
});

test('readout generation rejects network-supplied targets and malformed dry-run values', async () => {
  const deps = {
    now: () => new Date('2026-07-22T17:23:00Z'),
    verifyToken: async () => ({}),
    generate: async () => {
      throw new Error('must not generate');
    },
    latest: async () => null,
    list: async () => [],
    email: async () => ({ send: false as const, reason: 'disabled' as const }),
  };
  assert.deepEqual(await readoutGenerateForApi(ctx, { trigger: 'pilot-run-override' }, deps), {
    status: 400,
    payload: { error: 'invalid_trigger' },
  });
  assert.deepEqual(await readoutGenerateForApi(ctx, { dryRun: 'yes' }, deps), {
    status: 400,
    payload: { error: 'invalid_dry_run' },
  });
});

test('readout generation fills the broadcast viewer peak from the context census', async () => {
  const now = new Date('2026-07-20T17:23:00Z');
  const withCensus = {
    ...ctx,
    broadcastViewers: () => ({ current: 1, peakToday: 7, peakSinceBoot: 12 }),
  } as unknown as HttpApiContext;
  let seen: number | undefined;
  await readoutGenerateForApi(
    withCensus,
    { trigger: 'daily', dryRun: true },
    {
      now: () => now,
      verifyToken: async () => ({}),
      generate: async (input) => {
        seen = input.runtime.broadcastViewersPeak;
        return {
          report: buildMistboardReadout({
            snapshotId: 'readout_census',
            trigger: 'daily',
            now,
            runtime: input.runtime,
            facts: { product: null, puzzles: null, mining: null, engines: null },
          }),
          reused: false,
          previousAlertKey: null,
        };
      },
      latest: async () => null,
      list: async () => [],
      email: async () => ({ send: false as const, reason: 'dry-run' as const }),
    },
  );
  assert.equal(seen, 7);
});
