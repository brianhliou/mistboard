import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { lobbyDrainNotice } from './lobby-chat-notice.js';
import { createDrainController } from './server-drain.js';

function post(body: object = {}): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    headers: {},
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  } as unknown as IncomingMessage;
}

function sink(): ServerResponse {
  return {
    writeHead() {
      return this;
    },
    end() {
      return this;
    },
  } as unknown as ServerResponse;
}

function drainController() {
  return createDrainController({
    drainWindowDefaultMs: 60_000,
    drainWindowMaxMs: 120_000,
    rooms: new Map(),
  });
}

test('no drain, no lobby notice', () => {
  assert.equal(lobbyDrainNotice(drainController()), null);
  assert.equal(lobbyDrainNotice({}), null);
});

test('an open drain puts one restart notice on the lobby read', async () => {
  const drain = drainController();
  await drain.handleRequest(post({ owner: 'release-a' }), sink(), '/admin/drain');
  const notice = lobbyDrainNotice(drain);
  assert.ok(notice);
  assert.equal(notice.kind, 'server_restart');
  assert.equal(notice.phase, 'pending');
  assert.equal(notice.restartAt, drain.drainDeadlineMs());
  assert.equal(notice.id, `drain-${drain.drainDeadlineMs()}`);
});

test('a repeated activation and a commit keep the same notice, not a second one', async () => {
  const drain = drainController();
  await drain.handleRequest(post(), sink(), '/admin/drain');
  const first = lobbyDrainNotice(drain);
  await drain.handleRequest(post(), sink(), '/admin/drain');
  assert.deepEqual(lobbyDrainNotice(drain), first);

  await drain.handleRequest(post({ phase: 'restarting' }), sink(), '/admin/drain');
  const committed = lobbyDrainNotice(drain);
  assert.equal(committed?.id, first?.id);
  assert.equal(committed?.phase, 'restarting');
});

test('cancelling the drain takes the notice away', async () => {
  const drain = drainController();
  await drain.handleRequest(post(), sink(), '/admin/drain');
  assert.ok(lobbyDrainNotice(drain));
  await drain.handleRequest(post(), sink(), '/admin/drain/cancel');
  assert.equal(lobbyDrainNotice(drain), null);
});

test('a drain whose deadline passed shows no notice', () => {
  // isDraining reads the clock, so a lapsed window reads null even before the
  // lapse timer has fired.
  assert.equal(
    lobbyDrainNotice({ drainDeadlineMs: () => null, restartPhase: () => 'pending' }),
    null,
  );
});
