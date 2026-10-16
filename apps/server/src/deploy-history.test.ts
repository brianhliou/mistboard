import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeployHistory } from './deploy-history.js';
import type { RoomLifecycleAuditRecord } from './persistence.js';

let nextId = 1;
function row(
  kind: string,
  atMs: number,
  payload: Record<string, unknown> = {},
  roomId: string | null = null,
): RoomLifecycleAuditRecord {
  return {
    id: nextId++,
    roomId,
    kind,
    occurredAt: new Date(atMs),
    atMs,
    eventSeq: null,
    buildRevision: 'old-build',
    payload,
    createdAt: new Date(atMs),
  };
}

const T = Date.parse('2026-09-25T20:00:00Z');

test('a restart joins its drain summary, the rooms it paused and how they resumed', () => {
  const entries = buildDeployHistory([
    row('drain_summary', T - 5, { outcome: 'shutdown', refusedCreates: 4, committed: true }),
    row('server_shutdown_requested', T, { activeGames: 2 }),
    row('pause_on_shutdown', T + 10, {}, 'a'),
    row('pause_on_shutdown', T + 11, {}, 'b'),
    row('resume', T + 60_000, { reason: 'both-present', pauseReason: 'shutdown' }, 'a'),
    row('resume', T + 95_000, { reason: 'grace-elapsed', pauseReason: 'shutdown' }, 'b'),
    // A resume of an unrelated pause is not a restart outcome.
    row('resume', T + 96_000, { reason: 'both-present', pauseReason: 'disconnect' }, 'c'),
  ]);

  assert.equal(entries.length, 1);
  const [restart] = entries;
  assert.equal(restart?.kind, 'restart');
  assert.equal(restart?.drain?.refusedCreates, 4);
  assert.equal(restart?.withoutDrain, false);
  assert.equal(restart?.activeGamesAtShutdown, 2);
  assert.equal(restart?.pausedOnShutdown, 2);
  assert.equal(restart?.resumedPlayersBack, 1);
  assert.equal(restart?.resumedAfterGrace, 1);
});

test('a shutdown with no drain, and drains that ended without a restart, each get a row', () => {
  const entries = buildDeployHistory([
    row('drain_summary', T - 3_600_000, { outcome: 'cancelled' }),
    row('drain_summary', T - 1_800_000, { outcome: 'lapsed' }),
    row('shutdown_without_drain', T - 2, { activeGames: 1 }),
    row('server_shutdown_requested', T, { activeGames: 1 }),
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ['restart', 'drain-lapsed', 'drain-cancelled'],
  );
  assert.equal(entries[0]?.withoutDrain, true);
  assert.equal(entries[0]?.drain, null);
});
