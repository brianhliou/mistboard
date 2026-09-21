import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { streamSnapshotEvents } from './routes/xiangqi-broadcasts.js';
import { createBroadcastViewerRegistry } from './xiangqi-broadcast-viewers.js';

test('viewer registry counts open streams and tracks the peaks', () => {
  let now = Date.parse('2026-09-20T10:00:00Z');
  const registry = createBroadcastViewerRegistry(() => now);
  assert.deepEqual(registry.stats(), { current: 0, peakToday: 0, peakSinceBoot: 0 });

  const a = registry.open('board:b1');
  const b = registry.open('board:b1');
  const c = registry.open('round:t/r1');
  assert.deepEqual(registry.stats(), { current: 3, peakToday: 3, peakSinceBoot: 3 });
  assert.deepEqual(
    [...registry.streams()],
    [
      ['board:b1', 2],
      ['round:t/r1', 1],
    ],
  );

  b();
  b(); // a second release of the same stream is a no-op
  assert.deepEqual(registry.stats(), { current: 2, peakToday: 3, peakSinceBoot: 3 });
  assert.equal(registry.streams().get('board:b1'), 1);

  a();
  c();
  assert.deepEqual(registry.stats(), { current: 0, peakToday: 3, peakSinceBoot: 3 });
  assert.equal(registry.streams().size, 0);

  // The UTC day turns: today's peak restarts from the live count; the boot
  // peak keeps the high-water mark.
  const d = registry.open('board:b2');
  now = Date.parse('2026-09-21T00:00:01Z');
  assert.deepEqual(registry.stats(), { current: 1, peakToday: 1, peakSinceBoot: 3 });
  registry.open('board:b2');
  assert.deepEqual(registry.stats(), { current: 2, peakToday: 2, peakSinceBoot: 3 });
  d();
});

type FakeResponse = ServerResponse & { chunks: string[] };

function fakeResponse(): FakeResponse {
  const emitter = new EventEmitter() as unknown as FakeResponse;
  emitter.chunks = [];
  Object.assign(emitter, {
    writeHead() {
      return emitter;
    },
    write(chunk: string) {
      emitter.chunks.push(chunk);
      return true;
    },
  });
  return emitter;
}

test('an SSE stream registers on open and releases once on close', () => {
  const registry = createBroadcastViewerRegistry(() => 0);
  const request = new EventEmitter() as unknown as IncomingMessage;
  const response = fakeResponse();
  streamSnapshotEvents(request, response, {
    event: 'board',
    streamKey: 'board:b1',
    pollMs: 60_000,
    initial: { version: 'v1', payload: { ok: true } },
    load: async () => null,
    viewers: registry,
  });
  assert.equal(registry.stats().current, 1);
  assert.equal(response.chunks[0], 'event: board\n');

  // Node emits close on both the request and the response; one viewer leaves.
  request.emit('close');
  response.emit('close');
  assert.deepEqual(registry.stats(), { current: 0, peakToday: 1, peakSinceBoot: 1 });
});
