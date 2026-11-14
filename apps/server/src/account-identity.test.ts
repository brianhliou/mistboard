import assert from 'node:assert/strict';
import test from 'node:test';
import {
  historicalEmailHandleStem,
  isHistoricalEmailHandle,
  normalizeDisplayName,
  normalizeEmail,
  normalizeProfileHandle,
  randomFallbackHandle,
} from './account-identity.js';

test('normalizeEmail trims and lowercases ASCII email addresses', () => {
  assert.equal(normalizeEmail(' Brian+Test@Gmail.COM '), 'brian+test@gmail.com');
});

test('normalizeEmail rejects unsupported email shapes', () => {
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail('user@example'), null);
  assert.equal(normalizeEmail('user@-example.com'), null);
  assert.equal(normalizeEmail('用户@example.com'), null);
});

test('historicalEmailHandleStem recognizes old handles with plus tags and punctuation', () => {
  assert.equal(historicalEmailHandleStem('brian+testing@gmail.com'), 'brian');
  assert.equal(historicalEmailHandleStem('first.last+tag@example.com'), 'first-last');
});

test('isHistoricalEmailHandle catches the bare stem and its collision suffix', () => {
  assert.equal(isHistoricalEmailHandle('first-last', 'first.last@example.com'), true);
  assert.equal(isHistoricalEmailHandle('first-last-48213', 'first.last@example.com'), true);
  // A long stem was cut to leave room for the suffix.
  const email = 'abcdefghijklmnopqrstuvwxyz@example.com';
  assert.equal(isHistoricalEmailHandle('abcdefghijklmnopqr-12345', email), true);
  assert.equal(isHistoricalEmailHandle('first-last-4821', 'first.last@example.com'), false);
  assert.equal(isHistoricalEmailHandle('first-last-pro', 'first.last@example.com'), false);
  assert.equal(isHistoricalEmailHandle('player-ab12c', 'first.last@example.com'), false);
  assert.equal(isHistoricalEmailHandle('ab-12345', 'ab@example.com'), false);
});

test('historicalEmailHandleStem is deterministic when the local part has no safe stem', () => {
  assert.equal(historicalEmailHandleStem('++@example.com'), null);
  assert.equal(historicalEmailHandleStem('ab@example.com'), null);
});

test('randomFallbackHandle yields a valid random player handle', () => {
  for (let i = 0; i < 20; i += 1) {
    const handle = randomFallbackHandle();
    assert.match(handle, /^player-[a-z0-9]{5}$/);
    assert.equal(normalizeProfileHandle(handle), handle);
  }
});

test('normalizeProfileHandle accepts public handle syntax', () => {
  assert.equal(normalizeProfileHandle(' Brian_H-Liou '), 'brian_h-liou');
  assert.equal(normalizeProfileHandle('a'.repeat(24)), 'a'.repeat(24));
});

test('normalizeProfileHandle rejects unsafe or reserved handles', () => {
  assert.equal(normalizeProfileHandle('ab'), null);
  assert.equal(normalizeProfileHandle('a'.repeat(25)), null);
  assert.equal(normalizeProfileHandle('-brian'), null);
  assert.equal(normalizeProfileHandle('brian-'), null);
  assert.equal(normalizeProfileHandle('api'), null);
  assert.equal(normalizeProfileHandle('brian.hliou'), null);
  // Inbox route literals share the /api/inbox/:handle namespace, so these
  // words can never become handles (routes/inbox.ts matches them first).
  assert.equal(normalizeProfileHandle('inbox'), null);
  assert.equal(normalizeProfileHandle('Reports'), null);
  assert.equal(normalizeProfileHandle('threads'), null);
  assert.equal(normalizeProfileHandle('unread-count'), null);
  assert.equal(normalizeProfileHandle('forum'), null);
});

test('historicalEmailHandleStem excludes reserved names that were never minted', () => {
  assert.equal(historicalEmailHandleStem('reports@example.com'), null);
  assert.equal(historicalEmailHandleStem('inbox+tag@example.com'), null);
  assert.equal(historicalEmailHandleStem('brian.hliou@example.com'), 'brian-hliou');
});

test('normalizeDisplayName trims and bounds public display names', () => {
  assert.equal(normalizeDisplayName('  Brian   Hliou  '), 'Brian Hliou');
  assert.equal(normalizeDisplayName(''), null);
  assert.equal(normalizeDisplayName('a'.repeat(41)), null);
});
