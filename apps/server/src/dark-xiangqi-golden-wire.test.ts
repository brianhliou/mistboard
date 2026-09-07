/**
 * Golden wire-parity suite for the Dark Xiangqi (9x10) live-room runtime —
 * recorded BEFORE its VariantTenant migration, same harness as
 * dark-mini-xiangqi-golden-wire.parkedtest.ts. Pins the per-seat snapshot payloads
 * and redacted event-appended events for scripted games, plus
 * fixture-independent hidden-info invariants.
 *
 * Dark Xiangqi wire quirks this suite intentionally pins (they differ from
 * DMX): the snapshot has NO mode/pveEngineId/rated/forfeitDeadline/rematch
 * keys; spectators and the other seat DO receive non-move events (only
 * move-played is redacted); the board re-encodes shrouded entries as
 * {color, shrouded: true}; the event log accepts seat-vacated.
 *
 * Regenerate ONLY for an intentional wire change:
 * MISTBOARD_GOLDEN_RECORD=1 npx tsx --test <this file>.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getLegalMoves, type XiangqiMove } from '@mistboard/game';
import type {
  DarkXiangqiEvent,
  DarkXiangqiRuntimeRoom,
  DarkXiangqiSeat,
} from './dark-xiangqi-runtime.js';
import { darkXiangqiClientEventFor, darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  expireTenantClock,
  tenantPlyAtEventIndex,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Anchor on the package dir so the fixture resolves whether this file runs
// from src/ (tsx, test:unit) or compiled into dist/ (test:persistent).
const FIXTURE_PATH = join(HERE, '..', 'src', 'fixtures', 'dark-xiangqi-wire-golden.json');
const SEATS: readonly DarkXiangqiSeat[] = ['red', 'black', 'spectator'];

type SeatRecord = Record<string, unknown>;

type GoldenStep = {
  label: string;
  eventForSeat?: Record<string, unknown>;
  snapshots: Record<string, SeatRecord>;
};

type GoldenScript = { id: string; steps: GoldenStep[] };

function snapshotFor(room: DarkXiangqiRuntimeRoom, seat: DarkXiangqiSeat): SeatRecord {
  const payload = tenantSnapshotPayload(darkXiangqiTenant, room, {
    id: `client-${seat}`,
    seat,
    solo: false,
  });
  return { ...payload, serverAt: 0 };
}

function recordStep(
  script: GoldenScript,
  room: DarkXiangqiRuntimeRoom,
  label: string,
  appended?: { event: DarkXiangqiEvent; seq: number },
): void {
  const step: GoldenStep = { label, snapshots: {} };
  if (appended) {
    const ply = tenantPlyAtEventIndex(room.events, appended.seq);
    step.eventForSeat = {};
    for (const seat of SEATS) {
      step.eventForSeat[seat] = darkXiangqiClientEventFor(appended.event, seat, ply);
    }
  }
  for (const seat of SEATS) {
    step.snapshots[seat] = snapshotFor(room, seat);
  }
  script.steps.push(step);
}

function append(
  script: GoldenScript,
  room: DarkXiangqiRuntimeRoom,
  label: string,
  event: DarkXiangqiEvent,
): void {
  const seq = appendTenantRuntimeEvent(darkXiangqiTenant, room, event);
  recordStep(script, room, label, { event, seq });
}

function hydrate(events: DarkXiangqiEvent[]): DarkXiangqiRuntimeRoom {
  const created = createTenantRuntimeRoomFromEvents(darkXiangqiTenant, events);
  assert.ok(created.ok, 'golden script event log must hydrate');
  return created.room;
}

function firstLegalMove(room: DarkXiangqiRuntimeRoom): XiangqiMove {
  const moves = [...getLegalMoves(room.projection.state)].sort((a, b) =>
    `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
  );
  assert.ok(moves[0], 'scripted position must have a legal move');
  return { from: moves[0].from, to: moves[0].to };
}

function playingTurn(room: DarkXiangqiRuntimeRoom): 'red' | 'black' {
  const status = room.projection.state.status;
  assert.equal(status.type, 'playing');
  return (status as { turn: 'red' | 'black' }).turn;
}

// ── Script A: PvP game — seats, a vacate/re-seat probe, six moves, resign. ──
function runScriptA(): GoldenScript {
  const script: GoldenScript = { id: 'pvp-full-game', steps: [] };
  const roomId = 'dxq_golden-a';
  const timeControl = { initialMs: 180_000, incrementMs: 2_000 };
  const room = hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: 'dark-xiangqi',
      creatorPreference: 'red',
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
        remainingMs: { black: timeControl.initialMs, red: timeControl.initialMs },
        runningSince: null,
      },
    },
  ]);
  recordStep(script, room, 'hydrated');

  append(script, room, 'seat-red', {
    type: 'seat-assigned',
    at: 2_000,
    roomId,
    clientId: 'client-red-1',
    seat: 'red',
  });
  // Pregame vacate + re-seat: pins the seat-vacated wire passthrough and the
  // projection seat removal (only when the clientId still holds the seat).
  append(script, room, 'vacate-red', {
    type: 'seat-vacated',
    at: 2_500,
    roomId,
    clientId: 'client-red-1',
    seat: 'red',
  });
  append(script, room, 'reseat-red', {
    type: 'seat-assigned',
    at: 2_800,
    roomId,
    clientId: 'client-red',
    seat: 'red',
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

// ── Script B: untimed room aborted pregame. ─────────────────────────────────
function runScriptB(): GoldenScript {
  const script: GoldenScript = { id: 'pvp-abort', steps: [] };
  const roomId = 'dxq_golden-b';
  const room = hydrate([
    { type: 'room-created', at: 1_000, roomId, gameSpecId: 'dark-xiangqi' },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-red', seat: 'red' },
    { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-black', seat: 'black' },
  ]);
  recordStep(script, room, 'hydrated');
  append(script, room, 'abort', {
    type: 'game-aborted',
    at: 5_000,
    roomId,
    reason: 'user-abort',
  });
  return script;
}

// ── Script C: timed game ending by clock expiry after the clock arms. ───────
function runScriptC(): GoldenScript {
  const script: GoldenScript = { id: 'clock-expired', steps: [] };
  const roomId = 'dxq_golden-c';
  const timeControl = { initialMs: 60_000, incrementMs: 1_000 };
  const room = hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: 'dark-xiangqi',
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
        remainingMs: { black: timeControl.initialMs, red: timeControl.initialMs },
        runningSince: null,
      },
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-red', seat: 'red' },
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

// Round-trip through JSON so undefined-valued keys drop out exactly as they do
// on the wire.
function asWireJson(scripts: GoldenScript[]): unknown {
  return JSON.parse(JSON.stringify({ scripts }));
}

test('dxq golden wire: per-seat payloads match the recorded fixture', () => {
  const actual = asWireJson(runAllScripts());
  if (process.env.MISTBOARD_GOLDEN_RECORD === '1') {
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  assert.ok(
    existsSync(FIXTURE_PATH),
    `missing golden fixture ${FIXTURE_PATH}; record once with MISTBOARD_GOLDEN_RECORD=1`,
  );
  const expected = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  assert.deepStrictEqual(actual, expected);
});

// ── Hidden-info invariants, independent of the fixture ──────────────────────

type WireSnapshot = {
  events: Array<{ type: string; color?: string }>;
  state: {
    board: Record<
      string,
      { shrouded: false; piece: { color: string } } | { shrouded: true; color: string }
    >;
    lastMove?: unknown;
    legalMoves: unknown[];
    visibleSquares: string[];
  };
};

function wireSnapshots(step: GoldenStep): Record<string, WireSnapshot> {
  return JSON.parse(JSON.stringify(step.snapshots));
}

// A step whose recorded status is finished. Read from the payload rather than
// matched on the label, so a new terminal script step is classified correctly
// without anyone remembering to add its name here.
function isFinishedStep(step: GoldenStep): boolean {
  // The recorded snapshot type does not declare `status` (the fixtures only
  // model the fields each test reads), so read it through a narrow cast rather
  // than widening a shared fixture type for one predicate.
  const state = wireSnapshots(step).red?.state as { status?: { type?: string } } | undefined;
  return state?.status?.type === 'finished';
}

test('dxq golden wire: opponent moves never cross seats while the game is live', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      // Fog is a LIVE invariant. A finished room hands everyone the whole log,
      // asserted by 'a finished room opens fully to a spectator' below.
      if (isFinishedStep(step)) continue;
      const snapshots = wireSnapshots(step);
      for (const seat of ['red', 'black', 'spectator'] as const) {
        const others = seat === 'red' ? ['black'] : seat === 'black' ? ['red'] : ['red', 'black'];
        for (const event of snapshots[seat]!.events) {
          if (event.type !== 'move-played') continue;
          assert.ok(
            !others.includes(event.color ?? ''),
            `${script.id}/${step.label}: ${seat} received a foreign move event`,
          );
        }
      }
      const eventForSeat = step.eventForSeat as
        | Record<string, { type?: string } | null>
        | undefined;
      if (eventForSeat?.red?.type === 'move-played') {
        assert.equal(eventForSeat.black, null, 'black must not see red move broadcast');
        assert.equal(eventForSeat.spectator, null, 'spectator must not see move broadcast');
      }
      if (eventForSeat?.black?.type === 'move-played') {
        assert.equal(eventForSeat.red, null, 'red must not see black move broadcast');
      }
    }
  }
});

test('dxq golden wire: shrouded entries never carry piece identity while live', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      if (isFinishedStep(step)) continue;
      const snapshots = wireSnapshots(step);
      for (const seat of ['red', 'black'] as const) {
        const view = snapshots[seat]!.state;
        const visible = new Set(view.visibleSquares);
        for (const [square, entry] of Object.entries(view.board)) {
          if (entry.shrouded) {
            assert.ok(
              !('piece' in entry),
              `${script.id}/${step.label}: shrouded entry on ${square} leaks a piece`,
            );
          } else if (entry.piece.color !== seat) {
            assert.ok(
              visible.has(square),
              `${script.id}/${step.label}: ${seat} sees hidden opponent piece on ${square}`,
            );
          }
        }
      }
      const spectatorView = snapshots.spectator!.state;
      assert.deepStrictEqual(spectatorView.board, {});
      assert.deepStrictEqual(spectatorView.visibleSquares, []);
      assert.deepStrictEqual(spectatorView.legalMoves, []);
      assert.equal(spectatorView.lastMove, undefined);
    }
  }
});

test('dxq golden wire: lastMove is stripped unless the seat moved last', () => {
  const script = runScriptA();
  const afterRedMove = script.steps.find((step) => step.label === 'move-1-red');
  assert.ok(afterRedMove);
  const snapshots = wireSnapshots(afterRedMove);
  assert.notEqual(snapshots.red!.state.lastMove, undefined);
  assert.equal(snapshots.black!.state.lastMove, undefined);
});

test('dxq golden wire: snapshot omits engine/rated/rematch keys (dxq wire shape)', () => {
  const script = runScriptA();
  const last = script.steps.at(-1);
  assert.ok(last);
  for (const seat of SEATS) {
    const snapshot: SeatRecord = last.snapshots[seat]!;
    for (const key of ['mode', 'pveEngineId', 'rated', 'forfeitDeadline', 'rematch']) {
      assert.ok(!(key in snapshot), `dxq snapshot must not carry '${key}'`);
    }
  }
});

test('dxq golden wire: a finished room opens fully to a spectator', () => {
  // The other half of the two live invariants above. Split so neither can be
  // silently widened: weakening one leaves the other failing.
  let finishedSteps = 0;
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      if (!isFinishedStep(step)) continue;
      finishedSteps += 1;
      const spectator = wireSnapshots(step).spectator!;
      assert.ok(
        Object.keys(spectator.state.board).length > 0,
        `${script.id}/${step.label}: finished board must not be empty`,
      );
      assert.ok(spectator.events.length > 0, `${script.id}/${step.label}: log must be delivered`);
      // Nothing is shrouded once the game is over: that is what truth means,
      // and it is the same content /api/dark-xiangqi/games/:id already serves
      // to any signed-out stranger.
      for (const [square, entry] of Object.entries(spectator.state.board)) {
        assert.equal(entry.shrouded, false, `${script.id}/${step.label}: ${square} still shrouded`);
      }
      // Both seats' moves are present, which is precisely what the live
      // invariant forbids and the finished state allows.
      const colors = new Set(
        spectator.events.filter((e) => e.type === 'move-played').map((e) => e.color),
      );
      assert.ok(colors.size === 2, `${script.id}/${step.label}: expected both colors' moves`);
    }
  }
  assert.ok(finishedSteps > 0, 'no finished step in the scripts: this test asserted nothing');
});
