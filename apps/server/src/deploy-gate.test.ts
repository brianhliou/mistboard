import assert from 'node:assert/strict';
import test from 'node:test';
import {
  censusDeployGate,
  countDeployGatingRooms,
  DEPLOY_GATE_IDLE_MS,
  type DeployGateRoom,
  deployGateReasonFor,
  mergeDeployGateCensus,
} from './deploy-gate.js';

const NOW = 1_700_000_000_000;

function room(overrides: {
  status?: string;
  paused?: boolean;
  daysPerMove?: number;
  lastEventAgoMs?: number;
  events?: readonly { at?: number }[];
}): DeployGateRoom {
  const { status = 'playing', paused = false, daysPerMove, lastEventAgoMs = 0 } = overrides;
  return {
    // Newest entry last, and the whole log ages with lastEventAgoMs: a room is
    // idle only when NOTHING in it is recent.
    events: overrides.events ?? [
      { at: NOW - lastEventAgoMs - 60_000 },
      { at: NOW - lastEventAgoMs },
    ],
    projection: {
      paused,
      state: { status: { type: status } },
      timeControl: daysPerMove ? { daysPerMove } : {},
    },
  };
}

test('only a live game somebody is still playing gates a deploy', () => {
  assert.equal(deployGateReasonFor(room({}), NOW), 'gating');
  assert.equal(deployGateReasonFor(room({ status: 'finished' }), NOW), 'not-playing');
  assert.equal(deployGateReasonFor(room({ paused: true }), NOW), 'paused');
  assert.equal(deployGateReasonFor(room({ daysPerMove: 3 }), NOW), 'correspondence');
});

// The failure this whole module exists for: an abandoned tab held activeGames
// at 4 for over an hour, and because safe-deploy BLOCKS rather than proceeds
// when its window expires with games active, no release could run at all.
test('a room nobody has touched stops gating once it goes quiet', () => {
  assert.equal(
    deployGateReasonFor(room({ lastEventAgoMs: DEPLOY_GATE_IDLE_MS - 1 }), NOW),
    'gating',
  );
  assert.equal(deployGateReasonFor(room({ lastEventAgoMs: DEPLOY_GATE_IDLE_MS }), NOW), 'idle');
  assert.equal(deployGateReasonFor(room({ lastEventAgoMs: 6 * 60 * 60_000 }), NOW), 'idle');
});

// Fail safe: no readable activity is not evidence that nobody is playing, so
// the room keeps gating rather than being silently written off.
test('a log with no usable timestamps still gates', () => {
  assert.equal(deployGateReasonFor(room({ events: [] }), NOW), 'gating');
  assert.equal(deployGateReasonFor({ projection: room({}).projection }, NOW), 'gating');
  assert.equal(deployGateReasonFor(room({ events: [{ at: Number.NaN }, {}] }), NOW), 'gating');
});

// Events are appended in arrival order, so the tail is not necessarily the
// newest stamp. Taking the max keeps one late-arriving entry from aging a room
// out of the gate while it is being played.
test('staleness reads the newest timestamp, not the last entry', () => {
  const outOfOrder = room({
    events: [{ at: NOW - 1_000 }, { at: NOW - 5 * 60 * 60_000 }],
  });
  assert.equal(deployGateReasonFor(outOfOrder, NOW), 'gating');
});

test('census keeps the discarded rooms so a blocked deploy can say why', () => {
  const rooms = [
    room({}),
    room({}),
    room({ lastEventAgoMs: 90 * 60_000 }),
    room({ daysPerMove: 2 }),
    room({ paused: true }),
    room({ status: 'finished' }),
  ];
  assert.equal(countDeployGatingRooms(rooms, NOW), 2);
  assert.deepEqual(censusDeployGate(rooms, NOW), {
    gating: 2,
    idle: 1,
    correspondence: 1,
    paused: 1,
    'not-playing': 1,
    pve: 0,
  });
});

test('censuses from the chess map and the tenants add up', () => {
  const merged = mergeDeployGateCensus(
    censusDeployGate([room({}), room({ paused: true })], NOW),
    censusDeployGate([room({}), room({ lastEventAgoMs: 60 * 60_000 })], NOW),
  );
  assert.deepEqual(merged, {
    gating: 2,
    idle: 1,
    correspondence: 0,
    paused: 1,
    'not-playing': 0,
    pve: 0,
  });
});
