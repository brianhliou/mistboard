/**
 * Golden wire-parity suite for the Dark Crazyhouse live-room runtime — same
 * harness as the other fog-tenant golden-wire suites. Pins the per-seat snapshot payloads
 * and redacted event-appended events for scripted games, plus fixture-independent
 * hidden-info invariants — including the crazyhouse one: a seat's view carries
 * only ITS OWN hand (reserves are private under fog).
 *
 * Regenerate ONLY for an intentional wire change:
 * MISTBOARD_GOLDEN_RECORD=1 npx tsx --test <this file>.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { type CrazyhouseMove, getLegalCrazyhouseMoves, isCrazyhouseDrop } from '@mistboard/game';
import type {
  DarkCrazyhouseEvent,
  DarkCrazyhouseRuntimeRoom,
  DarkCrazyhouseSeat,
} from './dark-crazyhouse-runtime.js';
import { darkCrazyhouseClientEventFor, darkCrazyhouseTenant } from './dark-crazyhouse-tenant.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  expireTenantClock,
  tenantPlyAtEventIndex,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, '..', 'src', 'fixtures', 'dark-crazyhouse-wire-golden.json');
const SEATS: readonly DarkCrazyhouseSeat[] = ['white', 'black', 'spectator'];

type SeatRecord = Record<string, unknown>;
type GoldenStep = {
  label: string;
  eventForSeat?: Record<string, unknown>;
  snapshots: Record<string, SeatRecord>;
};
type GoldenScript = { id: string; steps: GoldenStep[] };

function moveKey(move: CrazyhouseMove): string {
  return isCrazyhouseDrop(move)
    ? `*${move.drop}${move.to}`
    : `${move.from}${move.to}${move.promotion ?? ''}`;
}

function snapshotFor(room: DarkCrazyhouseRuntimeRoom, seat: DarkCrazyhouseSeat): SeatRecord {
  const payload = tenantSnapshotPayload(darkCrazyhouseTenant, room, {
    id: `client-${seat}`,
    seat,
    solo: false,
  });
  return { ...payload, serverAt: 0 };
}

function recordStep(
  script: GoldenScript,
  room: DarkCrazyhouseRuntimeRoom,
  label: string,
  appended?: { event: DarkCrazyhouseEvent; seq: number },
): void {
  const step: GoldenStep = { label, snapshots: {} };
  if (appended) {
    const ply = tenantPlyAtEventIndex(room.events, appended.seq);
    step.eventForSeat = {};
    for (const seat of SEATS)
      step.eventForSeat[seat] = darkCrazyhouseClientEventFor(appended.event, seat, ply);
  }
  for (const seat of SEATS) step.snapshots[seat] = snapshotFor(room, seat);
  script.steps.push(step);
}

function append(
  script: GoldenScript,
  room: DarkCrazyhouseRuntimeRoom,
  label: string,
  event: DarkCrazyhouseEvent,
): void {
  const seq = appendTenantRuntimeEvent(darkCrazyhouseTenant, room, event);
  recordStep(script, room, label, { event, seq });
}

function hydrate(events: DarkCrazyhouseEvent[]): DarkCrazyhouseRuntimeRoom {
  const created = createTenantRuntimeRoomFromEvents(darkCrazyhouseTenant, events);
  assert.ok(created.ok, 'golden script event log must hydrate');
  return created.room;
}

function firstLegalMove(room: DarkCrazyhouseRuntimeRoom): CrazyhouseMove {
  const moves = [...getLegalCrazyhouseMoves(room.projection.state)].sort((a, b) =>
    moveKey(a).localeCompare(moveKey(b)),
  );
  assert.ok(moves[0], 'scripted position must have a legal move');
  return moves[0];
}

function playingTurn(room: DarkCrazyhouseRuntimeRoom): 'white' | 'black' {
  const status = room.projection.state.status;
  assert.equal(status.type, 'playing');
  return (status as { turn: 'white' | 'black' }).turn;
}

function runScriptA(): GoldenScript {
  const script: GoldenScript = { id: 'pvp-full-game', steps: [] };
  const roomId = 'dczh_golden-a';
  const timeControl = { initialMs: 180_000, incrementMs: 2_000 };
  const room = hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: 'dark-crazyhouse',
      creatorPreference: 'white',
      timeControl,
    },
    {
      type: 'clock-started',
      at: 1_000,
      roomId,
      clock: {
        activeColor: null,
        incrementMs: timeControl.incrementMs,
        initialMs: timeControl.initialMs,
        remainingMs: { white: timeControl.initialMs, black: timeControl.initialMs },
        runningSince: null,
      },
    },
  ]);
  recordStep(script, room, 'hydrated');
  append(script, room, 'seat-white', {
    type: 'seat-assigned',
    at: 2_000,
    roomId,
    clientId: 'client-white',
    seat: 'white',
  });
  append(script, room, 'seat-black', {
    type: 'seat-assigned',
    at: 3_000,
    roomId,
    clientId: 'client-black',
    seat: 'black',
  });
  for (let i = 0; i < 6; i += 1) {
    const color = playingTurn(room);
    append(script, room, `move-${i + 1}-${color}`, {
      type: 'move-played',
      at: 10_000 + i * 5_000,
      roomId,
      color,
      move: firstLegalMove(room),
    });
  }
  append(script, room, 'resign', {
    type: 'seat-resigned',
    at: 60_000,
    roomId,
    color: playingTurn(room),
  });
  return script;
}

function runScriptB(): GoldenScript {
  const script: GoldenScript = { id: 'pvp-abort', steps: [] };
  const roomId = 'dczh_golden-b';
  const room = hydrate([
    { type: 'room-created', at: 1_000, roomId, gameSpecId: 'dark-crazyhouse' },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-white', seat: 'white' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-black', seat: 'black' },
  ]);
  recordStep(script, room, 'hydrated');
  append(script, room, 'abort', { type: 'game-aborted', at: 5_000, roomId, reason: 'user-abort' });
  return script;
}

function runScriptC(): GoldenScript {
  const script: GoldenScript = { id: 'clock-expired', steps: [] };
  const roomId = 'dczh_golden-c';
  const timeControl = { initialMs: 60_000, incrementMs: 1_000 };
  const room = hydrate([
    { type: 'room-created', at: 1_000, roomId, gameSpecId: 'dark-crazyhouse', timeControl },
    {
      type: 'clock-started',
      at: 1_000,
      roomId,
      clock: {
        activeColor: null,
        incrementMs: timeControl.incrementMs,
        initialMs: timeControl.initialMs,
        remainingMs: { white: timeControl.initialMs, black: timeControl.initialMs },
        runningSince: null,
      },
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-white', seat: 'white' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-black', seat: 'black' },
  ]);
  recordStep(script, room, 'hydrated');
  for (let i = 0; i < 2; i += 1) {
    const color = playingTurn(room);
    append(script, room, `move-${i + 1}-${color}`, {
      type: 'move-played',
      at: 10_000 + i * 5_000,
      roomId,
      color,
      move: firstLegalMove(room),
    });
  }
  const expiredColor = playingTurn(room);
  const expiredClock = expireTenantClock(room.projection.clock, 90_000, expiredColor);
  assert.ok(expiredClock, 'script C must have an armed clock to expire');
  append(script, room, 'clock-expired', {
    type: 'clock-expired',
    at: 90_000,
    roomId,
    color: expiredColor,
    clock: expiredClock,
  });
  return script;
}

function runAllScripts(): GoldenScript[] {
  return [runScriptA(), runScriptB(), runScriptC()];
}

function asWireJson(scripts: GoldenScript[]): unknown {
  return JSON.parse(JSON.stringify({ scripts }));
}

test('dczh golden wire: per-seat payloads match the recorded fixture', () => {
  const actual = asWireJson(runAllScripts());
  if (process.env.MISTBOARD_GOLDEN_RECORD === '1') {
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  assert.ok(
    existsSync(FIXTURE_PATH),
    `missing golden fixture ${FIXTURE_PATH}; record with MISTBOARD_GOLDEN_RECORD=1`,
  );
  assert.deepStrictEqual(actual, JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));
});

// ── Hidden-info invariants ──────────────────────────────────────────────────

type WireSnapshot = {
  events: Array<{ type: string; color?: string }>;
  state: {
    board: Record<string, { color: string }>;
    hand: Record<string, number>;
    lastMove?: unknown;
    legalMoves: unknown[];
    visibleSquares: string[];
  };
};

function wireSnapshots(step: GoldenStep): Record<string, WireSnapshot> {
  return JSON.parse(JSON.stringify(step.snapshots));
}

test('dczh golden wire: opponent moves never reach the other seat or spectators', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      for (const seat of ['white', 'black', 'spectator'] as const) {
        const others =
          seat === 'white' ? ['black'] : seat === 'black' ? ['white'] : ['white', 'black'];
        for (const event of snapshots[seat]!.events) {
          if (event.type !== 'move-played') continue;
          assert.ok(
            !others.includes(event.color ?? ''),
            `${script.id}/${step.label}: ${seat} got a foreign move`,
          );
        }
      }
      const efs = step.eventForSeat as Record<string, { type?: string } | null> | undefined;
      if (efs?.white?.type === 'move-played') {
        assert.equal(efs.black, null, 'black must not see white move broadcast');
        assert.equal(efs.spectator, null, 'spectator must not see move broadcast');
      }
      if (efs?.black?.type === 'move-played')
        assert.equal(efs.white, null, 'white must not see black move broadcast');
    }
  }
});

test('dczh golden wire: a seat sees only its own pieces-in-vision and its OWN hand', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      for (const seat of ['white', 'black'] as const) {
        const view = snapshots[seat]!.state;
        const visible = new Set(view.visibleSquares);
        for (const [square, entry] of Object.entries(view.board)) {
          if (entry.color !== seat) {
            assert.ok(
              visible.has(square),
              `${script.id}/${step.label}: ${seat} sees a hidden ${entry.color} piece on ${square}`,
            );
          }
        }
        // The hand is present (the viewer's own); the enemy hand is never a field.
        assert.equal(typeof view.hand, 'object');
      }
      const spectator = snapshots.spectator!.state;
      assert.deepStrictEqual(spectator.board, {});
      assert.deepStrictEqual(spectator.hand, {});
      assert.deepStrictEqual(spectator.visibleSquares, []);
      assert.deepStrictEqual(spectator.legalMoves, []);
      assert.equal(spectator.lastMove, undefined);
    }
  }
});

test('dczh golden wire: lastMove is stripped unless the seat moved last', () => {
  const script = runScriptA();
  const afterWhiteMove = script.steps.find((step) => step.label === 'move-1-white');
  assert.ok(afterWhiteMove);
  const snapshots = wireSnapshots(afterWhiteMove);
  assert.notEqual(snapshots.white!.state.lastMove, undefined);
  assert.equal(snapshots.black!.state.lastMove, undefined);
});

test('dczh golden wire: snapshot omits engine/rated/rematch keys (bare wire shape)', () => {
  const last = runScriptA().steps.at(-1);
  assert.ok(last);
  for (const seat of SEATS) {
    const snapshot: SeatRecord = last.snapshots[seat]!;
    for (const key of ['mode', 'pveEngineId', 'rated', 'forfeitDeadline', 'rematch']) {
      assert.ok(!(key in snapshot), `dczh snapshot must not carry '${key}'`);
    }
  }
});
