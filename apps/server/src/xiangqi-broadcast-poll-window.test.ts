import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isXiangqiBroadcastPollMode,
  normalizeXiangqiBroadcastPollMode,
  xiangqiBroadcastPollState,
} from './xiangqi-broadcast-poll-window.js';

// The 2026 Asian individual championship as prod holds it.
const ASIAN = {
  sourceUrl: 'mistboard-discover://dpxq-tour?tour=12526&tourSlug=2026-asian-individual-men',
  startsAt: '2026-10-02T00:00:00+08:00',
  endsAt: '2026-10-08T23:59:59+08:00',
};
const at = (iso: string) => Date.parse(iso);

test('auto polls from 12 h before the start to 7 days after the end', () => {
  const state = (now: string) =>
    xiangqiBroadcastPollState({ ...ASIAN, pollMode: 'auto', now: at(now) });

  const before = state('2026-10-01T11:59:59+08:00');
  assert.equal(before.polling, false);
  assert.equal(before.reason, 'auto-before');
  // The window reads on the event's own clock.
  assert.equal(before.opensAt, '2026-10-01T12:00:00+08:00');
  assert.equal(before.closesAt, '2026-10-15T23:59:59+08:00');

  assert.equal(state('2026-10-01T12:00:00+08:00').polling, true);
  assert.equal(state('2026-10-05T15:00:00+08:00').reason, 'auto-open');
  assert.equal(state('2026-10-05T15:00:00+08:00').afterEvent, false);

  const tail = state('2026-10-09T20:00:00+08:00');
  assert.equal(tail.polling, true, 'records land the evening after the last round');
  assert.equal(tail.afterEvent, true);

  assert.equal(state('2026-10-15T23:59:59+08:00').polling, true);
  const after = state('2026-10-16T00:00:00+08:00');
  assert.equal(after.polling, false);
  assert.equal(after.reason, 'auto-closed');
});

test('auto with no dates never polls; one missing date reads as a one-day event', () => {
  const undated = xiangqiBroadcastPollState({
    pollMode: 'auto',
    sourceUrl: ASIAN.sourceUrl,
    startsAt: null,
    endsAt: undefined,
    now: at('2026-10-05T00:00:00Z'),
  });
  assert.equal(undated.polling, false);
  assert.equal(undated.reason, 'auto-undated');
  assert.equal(undated.opensAt, null);
  assert.equal(undated.closesAt, null);

  const garbage = xiangqiBroadcastPollState({
    pollMode: 'auto',
    sourceUrl: ASIAN.sourceUrl,
    startsAt: 'not a date',
    endsAt: 'nor this',
    now: at('2026-10-05T00:00:00Z'),
  });
  assert.equal(garbage.reason, 'auto-undated');

  const startOnly = (now: string) =>
    xiangqiBroadcastPollState({
      pollMode: 'auto',
      sourceUrl: ASIAN.sourceUrl,
      startsAt: '2026-10-02T09:00:00+08:00',
      endsAt: null,
      now: at(now),
    });
  assert.equal(startOnly('2026-10-01T20:59:59+08:00').polling, false);
  assert.equal(startOnly('2026-10-01T21:00:00+08:00').polling, true);
  assert.equal(startOnly('2026-10-09T09:00:00+08:00').polling, true);
  assert.equal(startOnly('2026-10-09T09:00:01+08:00').polling, false);
});

test('on always polls, off never does, and a tour with no source never polls', () => {
  const now = at('2027-06-01T00:00:00Z');
  const on = xiangqiBroadcastPollState({ ...ASIAN, pollMode: 'on', now });
  assert.equal(on.polling, true);
  assert.equal(on.reason, 'on');
  assert.equal(on.afterEvent, true, 'past the end, so the scheduler slows it down');
  assert.equal(
    xiangqiBroadcastPollState({ pollMode: 'on', sourceUrl: 'x', startsAt: null, endsAt: null, now })
      .polling,
    true,
  );

  const off = xiangqiBroadcastPollState({
    ...ASIAN,
    pollMode: 'off',
    now: at('2026-10-05T00:00:00+08:00'),
  });
  assert.equal(off.polling, false);
  assert.equal(off.reason, 'off');

  const sourceless = xiangqiBroadcastPollState({
    ...ASIAN,
    sourceUrl: null,
    pollMode: 'on',
    now: at('2026-10-05T00:00:00+08:00'),
  });
  assert.equal(sourceless.polling, false);
  assert.equal(sourceless.reason, 'no-source');
});

test('a UTC date keeps its window in UTC', () => {
  const state = xiangqiBroadcastPollState({
    pollMode: 'auto',
    sourceUrl: 'x',
    startsAt: '2025-09-21T00:00:00.000Z',
    endsAt: '2025-09-27T00:00:00.000Z',
    now: 0,
  });
  assert.equal(state.opensAt, '2025-09-20T12:00:00.000Z');
  assert.equal(state.closesAt, '2025-10-04T00:00:00.000Z');
});

test('poll modes parse strictly and a stored unknown reads as auto', () => {
  assert.equal(isXiangqiBroadcastPollMode('auto'), true);
  assert.equal(isXiangqiBroadcastPollMode('on'), true);
  assert.equal(isXiangqiBroadcastPollMode('off'), true);
  assert.equal(isXiangqiBroadcastPollMode('ON'), false);
  assert.equal(isXiangqiBroadcastPollMode(true), false);
  assert.equal(normalizeXiangqiBroadcastPollMode('bogus'), 'auto');
  assert.equal(normalizeXiangqiBroadcastPollMode('off'), 'off');
});
