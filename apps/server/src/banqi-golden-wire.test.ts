/**
 * Golden wire-parity suite for the Banqi (半棋, 8×4 Chinese Dark Chess) live-room
 * runtime — same harness as the DMX/Dark Shogi suites. Banqi is
 * SYMMETRIC-information: every occupied square is public (face-down or revealed),
 * a face-down tile carries NO ink/identity to either seat, and the ONE hidden
 * thing is the DEAL. So the masked board is identical for both seats and moves
 * pass through unchanged. This suite pins:
 *
 *   1. Fixture parity — every recorded per-seat payload deep-equals
 *      fixtures/banqi-wire-golden.json. Regenerate ONLY for an intentional wire
 *      change: MISTBOARD_GOLDEN_RECORD=1 npx tsx --test <this file>, then review
 *      the fixture diff like a protocol change.
 *   2. Hidden-info invariants — asserted inline (fixture-independent):
 *        - the server-secret DEAL never appears in any client event (any seat);
 *        - a face-down tile carries NEITHER ink NOR role (pre-flip: no identity
 *          anywhere); a revealed tile carries both (post-flip: only flipped tiles
 *          reveal); seat→ink `firstColor` is null until the opening flip binds it;
 *        - symmetric info: both seats' board / captured / firstColor are
 *          byte-identical every step;
 *        - the position is public (both seats receive every move) while
 *          spectators get an empty view and no events.
 *
 * The scripted game flips tiles, captures a revealed enemy, and ends by
 * resignation / clock-expiry / abort across the three scripts.
 *
 * Deterministic by construction: a fixed seeded deal + fixed timestamps, moves
 * are the lexicographically-first legal move. The only wall-clock field,
 * snapshot serverAt, is normalized to 0.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BANQI_SPEC_ID,
  type BanqiDeal,
  type BanqiMove,
  createBanqiDeal,
  getBanqiLegalMoves,
} from '@mistboard/game';
import { BANQI_DEFAULT_ENGINE_ID } from './banqi-engine.js';
import type { BanqiEvent, BanqiRuntimeRoom, BanqiTenantSeat } from './banqi-runtime.js';
import { banqiClientEventFor, banqiTenant } from './banqi-tenant.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  expireTenantClock,
  tenantPlyAtEventIndex,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

process.env.MISTBOARD_BANQI_ENABLED = 'true';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, '..', 'src', 'fixtures', 'banqi-wire-golden.json');
const SEATS: readonly BanqiTenantSeat[] = ['red', 'black', 'spectator'];

// A tiny deterministic LCG so the deal (and thus the whole scripted line) is
// reproducible — mirrors banqi-tenant.test.ts.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const GOLDEN_DEAL: BanqiDeal = createBanqiDeal(seeded(7));

type SeatRecord = Record<string, unknown>;
type GoldenStep = {
  label: string;
  eventForSeat?: Record<string, unknown>;
  snapshots: Record<string, SeatRecord>;
};
type GoldenScript = { id: string; steps: GoldenStep[] };

function snapshotFor(room: BanqiRuntimeRoom, seat: BanqiTenantSeat): SeatRecord {
  const payload = tenantSnapshotPayload(banqiTenant, room, {
    id: `client-${seat}`,
    seat,
    solo: false,
  });
  return { ...payload, serverAt: 0 };
}

function recordStep(
  script: GoldenScript,
  room: BanqiRuntimeRoom,
  label: string,
  appended?: { event: BanqiEvent; seq: number },
): void {
  const step: GoldenStep = { label, snapshots: {} };
  if (appended) {
    const ply = tenantPlyAtEventIndex(room.events, appended.seq);
    step.eventForSeat = {};
    for (const seat of SEATS) {
      step.eventForSeat[seat] = banqiClientEventFor(appended.event, seat, ply);
    }
  }
  for (const seat of SEATS) step.snapshots[seat] = snapshotFor(room, seat);
  script.steps.push(step);
}

function append(
  script: GoldenScript,
  room: BanqiRuntimeRoom,
  label: string,
  event: BanqiEvent,
): void {
  const seq = appendTenantRuntimeEvent(banqiTenant, room, event);
  recordStep(script, room, label, { event, seq });
}

function hydrate(events: BanqiEvent[]): BanqiRuntimeRoom {
  const created = createTenantRuntimeRoomFromEvents(banqiTenant, events);
  assert.ok(created.ok, 'golden script event log must hydrate');
  return created.room;
}

function playingTurn(room: BanqiRuntimeRoom): 'red' | 'black' {
  const status = room.projection.state.status;
  assert.equal(status.type, 'playing');
  return (status as { turn: 'red' | 'black' }).turn;
}

// First legal move (lexicographic). A flip is the self-move from === to; the
// opening plies are all flips (only flips are legal before an ink binds).
function firstLegalMove(room: BanqiRuntimeRoom): BanqiMove {
  const moves = [...getBanqiLegalMoves(room.projection.state)].sort((a, b) =>
    `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
  );
  assert.ok(moves[0], 'scripted position must have a legal move');
  return { from: moves[0].from, to: moves[0].to };
}

// ── Script A: timed PvP game — seats, ten moves (opening flips then a revealed
// capture), then resignation. The richest wire surface: clock arming, public
// move broadcast to both seats, and the seat→ink firstColor binding. ─────────
function runScriptA(): GoldenScript {
  const script: GoldenScript = { id: 'pvp-full-game', steps: [] };
  const roomId = 'bq_golden-a';
  const timeControl = { initialMs: 180_000, incrementMs: 2_000 };
  const room = hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: BANQI_SPEC_ID,
      creatorPreference: 'red',
      timeControl,
      setup: GOLDEN_DEAL,
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

  for (let i = 0; i < 10; i += 1) {
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
    at: 100_000,
    roomId,
    color: playingTurn(room),
  });

  return script;
}

// ── Script B: PvE room (MistyBanqi seated at creation) aborted pregame. Covers
// roomMode/pveEngineId, engine seat shown connected, deal-stripping, and the
// aborted projection. ────────────────────────────────────────────────────────
function runScriptB(): GoldenScript {
  const script: GoldenScript = { id: 'pve-abort', steps: [] };
  const roomId = 'bq_golden-b';
  const room = hydrate([
    { type: 'room-created', at: 1_000, roomId, gameSpecId: BANQI_SPEC_ID, setup: GOLDEN_DEAL },
    {
      type: 'seat-assigned',
      at: 1_000,
      roomId,
      clientId: BANQI_DEFAULT_ENGINE_ID,
      seat: 'red',
    },
  ]);
  recordStep(script, room, 'hydrated');

  append(script, room, 'seat-black-human', {
    type: 'seat-assigned',
    at: 2_000,
    roomId,
    clientId: 'client-black',
    seat: 'black',
  });
  append(script, room, 'abort', {
    type: 'game-aborted',
    at: 5_000,
    roomId,
    reason: 'user-abort',
  });
  return script;
}

// ── Script C: timed game ending by clock expiry. Covers clock arming after the
// second player's first move and the clock-expired terminal projection. ──────
function runScriptC(): GoldenScript {
  const script: GoldenScript = { id: 'clock-expired', steps: [] };
  const roomId = 'bq_golden-c';
  const timeControl = { initialMs: 60_000, incrementMs: 1_000 };
  const room = hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: BANQI_SPEC_ID,
      timeControl,
      setup: GOLDEN_DEAL,
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

function asWireJson(scripts: GoldenScript[]): unknown {
  return JSON.parse(JSON.stringify({ scripts }));
}

test('banqi golden wire: per-seat payloads match the recorded fixture', () => {
  const actual = asWireJson(runAllScripts());
  if (process.env.MISTBOARD_GOLDEN_RECORD === '1') {
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  assert.ok(
    existsSync(FIXTURE_PATH),
    `missing golden fixture ${FIXTURE_PATH}; record once with MISTBOARD_GOLDEN_RECORD=1`,
  );
  assert.deepStrictEqual(actual, JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));
});

// ── Hidden-info invariants, independent of the fixture ──────────────────────

type WireEvent = { type: string; color?: string; seat?: string; setup?: unknown };
type WireBoardEntry = { color?: string; role?: string; faceDown: boolean };
type WireSnapshot = {
  events: WireEvent[];
  roomMode?: string;
  pveEngineId?: string;
  state: {
    board: Record<string, WireBoardEntry>;
    captured: Array<{ owner: string; role: string }>;
    legalMoves: unknown[];
    firstColor: string | null;
    lastMove?: unknown;
  };
};

function wireSnapshots(step: GoldenStep): Record<string, WireSnapshot> {
  return JSON.parse(JSON.stringify(step.snapshots));
}

function revealedCount(board: Record<string, WireBoardEntry>): number {
  return Object.values(board).filter((entry) => !entry.faceDown).length;
}

test('banqi golden wire: the server-secret deal never reaches any client', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      // The deal stays off the wire at EVERY status, spectators included. A
      // finished room reveals the move log and the true board, which tells a
      // reader the same identities; the raw `setup` field is server bookkeeping
      // and never ships. Deliberately not scoped to live steps: this is the one
      // assertion here that must survive the finished-game reveal untouched.
      for (const seat of [...SEATS, 'spectator'] as const) {
        for (const event of snapshots[seat]!.events) {
          assert.ok(
            !('setup' in event),
            `${script.id}/${step.label}: ${seat} received the deal in a ${event.type} event`,
          );
        }
      }
      const redCreated = snapshots.red!.events.filter((e) => e.type === 'room-created');
      assert.equal(redCreated.length, 1, `${script.id}/${step.label}: red must see room-created`);
      if (isFinishedStep(step)) {
        // Finished: the room opens, so the spectator now receives the log.
        assert.ok(
          snapshots.spectator!.events.length > 0,
          `${script.id}/${step.label}: a finished room must hand the spectator its log`,
        );
      } else {
        assert.equal(snapshots.spectator!.events.length, 0);
      }
    }
  }
  const created: BanqiEvent = {
    type: 'room-created',
    at: 1,
    roomId: 'bq_probe',
    gameSpecId: BANQI_SPEC_ID,
    setup: GOLDEN_DEAL,
  };
  for (const seat of ['red', 'black'] as const) {
    const out = banqiClientEventFor(created, seat, 0);
    assert.ok(out && out.type === 'room-created' && !('setup' in out));
  }
  assert.equal(banqiClientEventFor(created, 'spectator', 0), null);
});

test('banqi golden wire: face-down tiles carry no ink or role; revealed tiles carry both', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      for (const seat of ['red', 'black'] as const) {
        for (const [square, entry] of Object.entries(snapshots[seat]!.state.board)) {
          const keys = Object.keys(entry).sort();
          if (entry.faceDown) {
            assert.deepStrictEqual(
              keys,
              ['faceDown'],
              `${script.id}/${step.label}: face-down ${square} leaks ${keys.join(',')} to ${seat}`,
            );
          } else {
            assert.deepStrictEqual(
              keys,
              ['color', 'faceDown', 'role'],
              `${script.id}/${step.label}: revealed ${square} has an odd shape for ${seat}`,
            );
          }
        }
      }
    }
  }
});

test('banqi golden wire: symmetric information — both seats see an identical view', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      const red = snapshots.red!.state;
      const black = snapshots.black!.state;
      assert.deepStrictEqual(red.board, black.board, `${script.id}/${step.label}: board differs`);
      assert.deepStrictEqual(
        red.captured,
        black.captured,
        `${script.id}/${step.label}: captured differs`,
      );
      assert.equal(
        red.firstColor,
        black.firstColor,
        `${script.id}/${step.label}: firstColor differs`,
      );
    }
  }
});

test('banqi golden wire: pre-flip nothing is revealed and no ink is bound', () => {
  const hydrated = runScriptA().steps.find((s) => s.label === 'hydrated')!;
  const snapshots = wireSnapshots(hydrated);
  for (const seat of ['red', 'black'] as const) {
    const view = snapshots[seat]!.state;
    assert.equal(revealedCount(view.board), 0, `${seat}: no tile is face-up before the first flip`);
    assert.equal(Object.keys(view.board).length, 32, `${seat}: all 32 tiles present`);
    assert.equal(view.firstColor, null, `${seat}: ink is unbound pre-flip`);
    assert.deepStrictEqual(view.captured, []);
  }
});

test('banqi golden wire: the opening flip reveals exactly one tile and binds the ink', () => {
  const afterFlip = runScriptA().steps.find((s) => s.label === 'move-1-red')!;
  const snapshots = wireSnapshots(afterFlip);
  for (const seat of ['red', 'black'] as const) {
    const view = snapshots[seat]!.state;
    assert.equal(revealedCount(view.board), 1, `${seat}: exactly one tile revealed after the flip`);
    assert.notEqual(view.firstColor, null, `${seat}: the opening flip binds firstColor`);
  }
});

test('banqi golden wire: the position is public — both seats share moves and lastMove', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      const redMoves = snapshots.red!.events.filter((e) => e.type === 'move-played');
      const blackMoves = snapshots.black!.events.filter((e) => e.type === 'move-played');
      assert.deepStrictEqual(
        redMoves,
        blackMoves,
        `${script.id}/${step.label}: both seats must receive the same public moves`,
      );
      assert.deepStrictEqual(
        snapshots.red!.state.lastMove,
        snapshots.black!.state.lastMove,
        `${script.id}/${step.label}: lastMove is public in banqi`,
      );
      const efs = step.eventForSeat as Record<string, { type?: string } | null> | undefined;
      if (efs && (efs.red?.type === 'move-played' || efs.black?.type === 'move-played')) {
        assert.deepStrictEqual(efs.red, efs.black, 'both seats get the same move broadcast');
        assert.equal(efs.spectator, null, 'spectators never receive a move broadcast');
      }
    }
  }
});

// A step whose recorded status is finished. Read from the payload rather than
// matched on the label, so a new terminal script step is classified correctly
// without anyone remembering to add its name here.
function isFinishedStep(step: GoldenStep): boolean {
  // The recorded snapshot type does not declare `status` (the fixtures only
  // model the fields each test reads), so read it through a narrow cast rather
  // than widening a shared fixture type for one predicate.
  const state = wireSnapshots(step).spectator?.state as { status?: { type?: string } } | undefined;
  return state?.status?.type === 'finished';
}

test('banqi golden wire: spectators get an empty view while the game is live', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      if (isFinishedStep(step)) continue;
      const spectator = wireSnapshots(step).spectator!;
      assert.deepStrictEqual(spectator.state.board, {});
      assert.deepStrictEqual(spectator.state.captured, []);
      assert.deepStrictEqual(spectator.state.legalMoves, []);
      assert.equal(spectator.state.firstColor, null);
      assert.equal(spectator.state.lastMove, undefined);
      assert.deepStrictEqual(spectator.events, []);
    }
  }
});

test('banqi golden wire: a finished room opens fully to a spectator', () => {
  // The other half of the matrix row above. Split so that the live invariant
  // cannot be silently widened: weakening either test leaves the other failing.
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
      // Every tile is face-up, including ones never flipped in play: that is
      // what "truth" means here, and it is already public via the postgame
      // truth history (see f2ad3e9).
      for (const [square, entry] of Object.entries(spectator.state.board)) {
        assert.equal(
          entry.faceDown,
          false,
          `${script.id}/${step.label}: ${square} still face-down`,
        );
      }
    }
  }
  assert.ok(finishedSteps > 0, 'no finished step in the scripts: this test asserted nothing');
});

test('banqi golden wire: snapshot marks room mode and omits chess-only wire keys', () => {
  const pvp = runScriptA().steps.at(-1)!;
  for (const seat of SEATS) {
    const snapshot = pvp.snapshots[seat] as SeatRecord;
    assert.equal(snapshot.roomMode, 'pvp', 'a human-vs-human room is roomMode:pvp');
    assert.ok(!('pveEngineId' in snapshot), 'a PvP room carries no engine id');
    for (const key of ['mode', 'rated', 'forfeitDeadline', 'rematch']) {
      assert.ok(!(key in snapshot), `banqi snapshot must not carry '${key}'`);
    }
  }
  const pve = runScriptB().steps.at(-1)!;
  for (const seat of SEATS) {
    const snapshot = pve.snapshots[seat] as SeatRecord;
    assert.equal(snapshot.roomMode, 'pve', 'an engine-seated room is roomMode:pve');
    assert.equal(snapshot.pveEngineId, BANQI_DEFAULT_ENGINE_ID, 'and carries the engine id');
  }
});
