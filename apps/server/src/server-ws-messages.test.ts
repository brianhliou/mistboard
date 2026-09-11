import assert from 'node:assert/strict';
import test from 'node:test';
import { isKnownClientMessageType, parseClientMessage } from './server-ws-messages.js';

test('parseClientMessage accepts typed object payloads', () => {
  assert.deepEqual(
    parseClientMessage(
      JSON.stringify({
        type: 'move',
        from: 'e2',
        to: 'e4',
        promotion: 'q',
      }),
    ),
    {
      type: 'move',
      from: 'e2',
      to: 'e4',
      promotion: 'q',
    },
  );
});

test('parseClientMessage rejects malformed or untyped payloads', () => {
  assert.equal(parseClientMessage('{'), null);
  assert.equal(parseClientMessage('[]'), null);
  assert.equal(parseClientMessage('"ping"'), null);
  assert.equal(parseClientMessage(JSON.stringify({ at: Date.now() })), null);
});

test('isKnownClientMessageType owns the websocket client allowlist', () => {
  assert.equal(isKnownClientMessageType('snapshot:request'), true);
  assert.equal(isKnownClientMessageType('latency-sample'), true);
  assert.equal(isKnownClientMessageType('move'), true);
  assert.equal(isKnownClientMessageType('unknown:new-message'), false);
});

test('a tile move survives the parse with its action and tiles intact', () => {
  // Mahjong moves carry no squares. The parser must pass them through
  // untouched; validating them is the tenant's job, not the wire's.
  const parsed = parseClientMessage(
    JSON.stringify({ type: 'move', action: 'chow', tiles: ['4p', '6p'] }),
  );
  assert.equal(parsed?.type, 'move');
  assert.equal(parsed?.action, 'chow');
  assert.deepEqual(parsed?.tiles, ['4p', '6p']);
});

test('the parser does not validate a tile move, and is not supposed to', () => {
  // parseClientMessage casts; it has never checked field shapes. A tenant's
  // moveFromMessage is the validation boundary, so nonsense has to arrive
  // intact rather than being silently dropped here.
  const parsed = parseClientMessage(
    JSON.stringify({ type: 'move', action: 42, tiles: 'not-an-array' }),
  );
  assert.equal(parsed?.type, 'move');
  assert.equal((parsed as { action?: unknown }).action, 42);
});
