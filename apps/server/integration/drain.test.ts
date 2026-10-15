import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { startTestServer, type TestServer } from './harness.js';

// Phase 3a: drain endpoint + matchmaking guards. Boots a real server on an
// ephemeral port and hits HTTP routes directly. In dev runtime, the drain
// endpoint does not require a token, so these tests focus on behavior:
// idempotency, matchmaking gate, cancel.

let serverInstance: TestServer;
let httpBase: string;

before(async () => {
  serverInstance = await startTestServer();
  httpBase = `http://127.0.0.1:${serverInstance.port}`;
});

after(async () => {
  await serverInstance.close();
});

async function postJson(
  path: string,
  body: object = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${httpBase}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* leave empty */
    }
  }
  return { status: res.status, body: parsed };
}

test('drain: cleared baseline (server starts not draining)', async () => {
  const res = await fetch(`${httpBase}/api/server-status`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.restartAt, null);
  assert.equal(body.restartPhase, null);
  assert.equal(body.activeGames, 0);
});

test('drain: activation sets a deadline and is idempotent', async () => {
  const first = await postJson('/admin/drain', { windowMs: 60_000 });
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.draining, true);
  assert.equal(first.body.phase, 'pending');
  assert.equal(first.body.idempotent, false);
  const firstDeadline = first.body.restartAt as number;
  assert.ok(typeof firstDeadline === 'number' && firstDeadline > Date.now());

  // Second call must NOT extend the deadline — return the existing one as idempotent.
  const second = await postJson('/admin/drain', { windowMs: 600_000 });
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotent, true);
  assert.equal(second.body.restartAt, firstDeadline);
});

test('drain: restart commit is exposed through the status endpoint', async () => {
  const committed = await postJson('/admin/drain', { phase: 'restarting' });
  assert.equal(committed.status, 200);
  assert.equal(committed.body.phase, 'restarting');

  const status = await fetch(`${httpBase}/api/server-status`);
  assert.equal(status.status, 200);
  const body = (await status.json()) as Record<string, unknown>;
  assert.equal(body.restartPhase, 'restarting');
});

test('drain: matchmaking blocked while drain is active', async () => {
  // The test above committed the restart, and a committed drain lets creates
  // through (#559 step 1). Re-arm a pending drain, the phase that refuses them.
  await postJson('/admin/drain/cancel');
  const pending = await postJson('/admin/drain', { windowMs: 60_000 });
  assert.equal(pending.body.phase, 'pending');

  const rooms = await postJson('/api/rooms', { mode: 'pvp', variant: 'dark-chess' });
  assert.equal(rooms.status, 503);
  assert.equal(rooms.body.error, 'server_draining');
  assert.equal(typeof rooms.body.restartAt, 'number');

  const lobby = await postJson('/api/lobby', {});
  assert.equal(lobby.status, 503);
  assert.equal(lobby.body.error, 'server_draining');
});

test('drain: cancel clears state and unblocks matchmaking', async () => {
  const cancel = await postJson('/admin/drain/cancel');
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.draining, false);

  const rooms = await postJson('/api/rooms', { mode: 'pvp', variant: 'dark-chess' });
  assert.equal(rooms.status, 201, 'matchmaking must be unblocked after cancel');
});

test('drain: rejects invalid window', async () => {
  const res = await postJson('/admin/drain', { windowMs: -1 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_window');
});

test('drain: clamps an oversized window to the configured maximum', async () => {
  // Cancel any prior state from previous tests.
  await postJson('/admin/drain/cancel');
  // The default max is 1h (3_600_000 ms). Ask for 24h.
  const res = await postJson('/admin/drain', { windowMs: 24 * 60 * 60_000 });
  assert.equal(res.status, 200);
  const deadline = res.body.restartAt as number;
  // Deadline should be no further than ~1h from now (+ a generous slack).
  assert.ok(deadline - Date.now() <= 60 * 60_000 + 5_000, 'deadline must be clamped to max window');
  await postJson('/admin/drain/cancel');
});
