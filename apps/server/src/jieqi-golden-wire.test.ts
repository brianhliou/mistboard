/**
 * Golden wire-parity suite for the Jieqi (揭棋, full-board xiangqi with hidden
 * piece identities) live-room runtime — same harness as the DMX/Dark Shogi
 * suites, but Jieqi is an IDENTITY-hidden tenant, not a fog tenant. Every
 * occupied square is public, so a move reaches BOTH seats unchanged; what is
 * hidden is identity, and this suite pins the three places the tenant guards it:
 *
 *   1. Fixture parity — every recorded per-seat payload deep-equals
 *      fixtures/jieqi-wire-golden.json. Regenerate ONLY for an intentional wire
 *      change: MISTBOARD_GOLDEN_RECORD=1 npx tsx --test <this file>, then review
 *      the fixture diff like a protocol change.
 *   2. Hidden-info invariants — asserted inline (fixture-independent) so they
 *      hold even when the fixture is regenerated:
 *        - the server-secret DEAL never appears in any client event (any seat);
 *        - a face-down board entry carries a COLOUR but never a ROLE;
 *        - CAPTURER-ONLY reveal: a hidden capture's role goes to the capturer,
 *          never the victim or spectators;
 *        - the position is public (both seats receive every move; both share the
 *          same lastMove) while spectators get an empty view and no events.
 *
 * The scripted game deliberately captures still-face-down pieces (a cannon and
 * a horse in the opening) so the capturer-only asymmetry is exercised, not just
 * asserted vacuously.
 *
 * Deterministic by construction: rooms hydrate from a fixed deal + fixed
 * timestamps, and moves prefer the lexicographically-first face-down capture
 * (else the first legal move). The only wall-clock field, snapshot serverAt, is
 * normalized to 0.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  getJieqiLegalMoves,
  JIEQI_SPEC_ID,
  type JieqiMove,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { JIEQI_DEFAULT_ENGINE_ID } from './jieqi-engine.js';
import type { JieqiEvent, JieqiRuntimeRoom, JieqiSeat } from './jieqi-runtime.js';
import { jieqiClientEventFor, jieqiTenant } from './jieqi-tenant.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  expireTenantClock,
  tenantPlyAtEventIndex,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

process.env.MISTBOARD_JIEQI_ENABLED = 'true';

const HERE = dirname(fileURLToPath(import.meta.url));
// Anchor on the package dir so the fixture resolves whether this file runs from
// src/ (tsx, test:unit) or compiled into dist/ (test:persistent).
const FIXTURE_PATH = join(HERE, '..', 'src', 'fixtures', 'jieqi-wire-golden.json');
const SEATS: readonly JieqiSeat[] = ['red', 'black', 'spectator'];

type SeatRecord = Record<string, unknown>;
type GoldenStep = {
  label: string;
  eventForSeat?: Record<string, unknown>;
  snapshots: Record<string, SeatRecord>;
};
type GoldenScript = { id: string; steps: GoldenStep[] };

function snapshotFor(room: JieqiRuntimeRoom, seat: JieqiSeat): SeatRecord {
  const payload = tenantSnapshotPayload(jieqiTenant, room, {
    id: `client-${seat}`,
    seat,
    solo: false,
  });
  // serverAt is the one wall-clock field on the snapshot; pin it for the golden.
  return { ...payload, serverAt: 0 };
}

function recordStep(
  script: GoldenScript,
  room: JieqiRuntimeRoom,
  label: string,
  appended?: { event: JieqiEvent; seq: number },
): void {
  const step: GoldenStep = { label, snapshots: {} };
  if (appended) {
    const ply = tenantPlyAtEventIndex(room.events, appended.seq);
    step.eventForSeat = {};
    for (const seat of SEATS) {
      step.eventForSeat[seat] = jieqiClientEventFor(appended.event, seat, ply);
    }
  }
  for (const seat of SEATS) step.snapshots[seat] = snapshotFor(room, seat);
  script.steps.push(step);
}

function append(
  script: GoldenScript,
  room: JieqiRuntimeRoom,
  label: string,
  event: JieqiEvent,
): void {
  const seq = appendTenantRuntimeEvent(jieqiTenant, room, event);
  recordStep(script, room, label, { event, seq });
}

function hydrate(events: JieqiEvent[]): JieqiRuntimeRoom {
  const created = createTenantRuntimeRoomFromEvents(jieqiTenant, events);
  assert.ok(created.ok, 'golden script event log must hydrate');
  return created.room;
}

function playingTurn(room: JieqiRuntimeRoom): 'red' | 'black' {
  const status = room.projection.state.status;
  assert.equal(status.type, 'playing');
  return (status as { turn: 'red' | 'black' }).turn;
}

// Prefer the lexicographically-first move that captures a still-face-down enemy
// piece (so the capturer-only reveal is actually exercised); else the first
// legal move. Deterministic, and reads only the room's canonical state.
function pickMove(room: JieqiRuntimeRoom): JieqiMove {
  const state = room.projection.state;
  const mover = playingTurn(room);
  const moves = [...getJieqiLegalMoves(state)].sort((a, b) =>
    `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
  );
  assert.ok(moves[0], 'scripted position must have a legal move');
  const faceDownCapture = moves.find((m) => {
    const target = state.board[m.to];
    return target?.faceDown === true && target.color !== mover;
  });
  const chosen = faceDownCapture ?? moves[0];
  return { from: chosen.from, to: chosen.to };
}

// ── Script A: timed PvP game — seats, ten moves (opening captures a face-down
// cannon then horse, exercising capturer-only reveal), then resignation. The
// richest wire surface: clock arming, public move broadcast to both seats, and
// the asymmetric per-seat captured pool. ────────────────────────────────────
function runScriptA(): GoldenScript {
  const script: GoldenScript = { id: 'pvp-full-game', steps: [] };
  const roomId = 'jq_golden-a';
  const timeControl = { initialMs: 180_000, incrementMs: 2_000 };
  const room = hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: JIEQI_SPEC_ID,
      creatorPreference: 'red',
      timeControl,
      setup: STANDARD_JIEQI_DEAL,
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
      move: pickMove(room),
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

// ── Script B: PvE room (PikaJieQi seated at creation) aborted pregame. Covers
// roomMode/pveEngineId, engine seat shown connected, deal-stripping on the
// room-created event, and the aborted projection. ────────────────────────────
function runScriptB(): GoldenScript {
  const script: GoldenScript = { id: 'pve-abort', steps: [] };
  const roomId = 'jq_golden-b';
  const room = hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: JIEQI_SPEC_ID,
      setup: STANDARD_JIEQI_DEAL,
    },
    {
      type: 'seat-assigned',
      at: 1_000,
      roomId,
      clientId: JIEQI_DEFAULT_ENGINE_ID,
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
  const roomId = 'jq_golden-c';
  const timeControl = { initialMs: 60_000, incrementMs: 1_000 };
  const room = hydrate([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      gameSpecId: JIEQI_SPEC_ID,
      timeControl,
      setup: STANDARD_JIEQI_DEAL,
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
      move: pickMove(room),
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
// on the wire (JSON.stringify in the tenant's send path).
function asWireJson(scripts: GoldenScript[]): unknown {
  return JSON.parse(JSON.stringify({ scripts }));
}

test('jieqi golden wire: per-seat payloads match the recorded fixture', () => {
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

type WireEvent = { type: string; color?: string; seat?: string; setup?: unknown; move?: unknown };
type WireBoardEntry = { color?: string; role?: string; faceDown: boolean };
type WireCapture = { owner: 'red' | 'black'; role: string | null };
type WireSnapshot = {
  events: WireEvent[];
  roomMode?: string;
  pveEngineId?: string;
  state: {
    board: Record<string, WireBoardEntry>;
    captured: WireCapture[];
    legalMoves: unknown[];
    lastMove?: unknown;
  };
};

function wireSnapshots(step: GoldenStep): Record<string, WireSnapshot> {
  return JSON.parse(JSON.stringify(step.snapshots));
}

test('jieqi golden wire: the server-secret deal never reaches any client', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      // The deal stays off the wire at EVERY status, spectators included. A
      // finished room reveals the log and the true board, which tells a reader
      // the same identities; the raw `setup` field is server bookkeeping and
      // never ships. Deliberately NOT scoped to live steps: this is the one
      // assertion here that must survive the finished-game reveal untouched.
      for (const seat of [...SEATS, 'spectator'] as const) {
        for (const event of snapshots[seat]!.events) {
          assert.ok(
            !('setup' in event),
            `${script.id}/${step.label}: ${seat} received the deal in a ${event.type} event`,
          );
        }
      }
      // Both players always receive room-created (deal-stripped). Spectators get
      // no events while the game is live, and the whole log once it ends.
      const redCreated = snapshots.red!.events.filter((e) => e.type === 'room-created');
      assert.equal(redCreated.length, 1, `${script.id}/${step.label}: red must see room-created`);
      if (isFinishedStep(step)) {
        assert.ok(
          snapshots.spectator!.events.length > 0,
          `${script.id}/${step.label}: a finished room must hand the spectator its log`,
        );
      } else {
        assert.equal(snapshots.spectator!.events.length, 0);
      }
    }
  }
  // And directly at the redaction boundary: a room-created carrying a deal is
  // stripped for both players and withheld from spectators.
  const created: JieqiEvent = {
    type: 'room-created',
    at: 1,
    roomId: 'jq_probe',
    gameSpecId: JIEQI_SPEC_ID,
    setup: STANDARD_JIEQI_DEAL,
  };
  for (const seat of ['red', 'black'] as const) {
    const out = jieqiClientEventFor(created, seat, 0);
    assert.ok(out && out.type === 'room-created' && !('setup' in out));
  }
  assert.equal(jieqiClientEventFor(created, 'spectator', 0), null);
});

test('jieqi golden wire: a face-down board entry carries a colour but never a role', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      for (const seat of ['red', 'black'] as const) {
        for (const [square, entry] of Object.entries(snapshots[seat]!.state.board)) {
          if (entry.faceDown) {
            assert.ok(
              !('role' in entry),
              `${script.id}/${step.label}: ${seat} sees a role on face-down ${square}`,
            );
            assert.ok(
              'color' in entry,
              `${script.id}/${step.label}: jieqi face-down ${square} should keep its colour`,
            );
          }
        }
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

test('jieqi golden wire: capture reveal is capturer-only while the game is live', () => {
  let hiddenCaptureSeen = false;
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      // A finished room reveals every captured role to everyone, so the
      // capturer-only rule is a LIVE invariant. Asserted for finished steps by
      // 'a finished room opens fully to a spectator' below.
      if (isFinishedStep(step)) continue;
      const snapshots = wireSnapshots(step);
      const red = snapshots.red!.state.captured;
      const black = snapshots.black!.state.captured;
      assert.equal(red.length, black.length, `${script.id}/${step.label}: captured pool length`);
      for (let i = 0; i < red.length; i += 1) {
        const owner = red[i]!.owner;
        assert.equal(black[i]!.owner, owner, 'both seats agree on the captured piece owner');
        // The capturer is the side OPPOSITE the captured piece's owner.
        const capturerRole = owner === 'red' ? black[i]!.role : red[i]!.role;
        const victimRole = owner === 'red' ? red[i]!.role : black[i]!.role;
        assert.notEqual(
          capturerRole,
          null,
          `${script.id}/${step.label}: the capturer must know what it captured`,
        );
        // The victim (former owner) either learns nothing (hidden capture) or
        // the piece was already public when taken — never MORE than the capturer.
        assert.ok(
          victimRole === null || victimRole === capturerRole,
          `${script.id}/${step.label}: the victim learned a hidden capture (${victimRole})`,
        );
        if (victimRole === null) hiddenCaptureSeen = true;
      }
      // Spectators see no captured pieces (empty view).
      assert.deepStrictEqual(snapshots.spectator!.state.captured, []);
    }
  }
  assert.ok(
    hiddenCaptureSeen,
    'the scripted game must actually capture a face-down piece, or this test is vacuous',
  );
});

test('jieqi golden wire: the position is public — both seats share moves and lastMove', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      // Every move-played event reaches BOTH seats identically (position public).
      const redMoves = snapshots.red!.events.filter((e) => e.type === 'move-played');
      const blackMoves = snapshots.black!.events.filter((e) => e.type === 'move-played');
      assert.deepStrictEqual(
        redMoves,
        blackMoves,
        `${script.id}/${step.label}: both seats must receive the same public moves`,
      );
      // Both seats see the same lastMove (a public {from,to}); spectators none.
      assert.deepStrictEqual(
        snapshots.red!.state.lastMove,
        snapshots.black!.state.lastMove,
        `${script.id}/${step.label}: lastMove is public in jieqi`,
      );
      // A per-step broadcast of a move goes to BOTH seats, never a spectator.
      const efs = step.eventForSeat as Record<string, { type?: string } | null> | undefined;
      if (efs && (efs.red?.type === 'move-played' || efs.black?.type === 'move-played')) {
        assert.deepStrictEqual(efs.red, efs.black, 'both seats get the same move broadcast');
        assert.equal(efs.spectator, null, 'spectators never receive a move broadcast');
      }
    }
  }
});

test('jieqi golden wire: spectators get an empty view while the game is live', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      if (isFinishedStep(step)) continue;
      const spectator = wireSnapshots(step).spectator!;
      assert.deepStrictEqual(spectator.state.board, {});
      assert.deepStrictEqual(spectator.state.captured, []);
      assert.deepStrictEqual(spectator.state.legalMoves, []);
      assert.equal(spectator.state.lastMove, undefined);
      assert.deepStrictEqual(spectator.events, []);
    }
  }
});

test('jieqi golden wire: a finished room opens fully to a spectator', () => {
  // The other half of the matrix row above. Split so the live invariant cannot
  // be silently widened: weakening either test leaves the other failing.
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
      // Face-down identities open up, which is what truth means here and is
      // already public via the postgame truth history (see f2ad3e9).
      for (const [square, entry] of Object.entries(spectator.state.board)) {
        assert.equal(
          entry.faceDown,
          false,
          `${script.id}/${step.label}: ${square} still face-down`,
        );
      }
      // And every captured role is known, not just the capturer's.
      for (const captured of spectator.state.captured) {
        assert.notEqual(captured.role, null, `${script.id}/${step.label}: captured role withheld`);
      }
    }
  }
  assert.ok(finishedSteps > 0, 'no finished step in the scripts: this test asserted nothing');
});

test('jieqi golden wire: snapshot marks room mode and omits chess-only wire keys', () => {
  const pvp = runScriptA().steps.at(-1)!;
  for (const seat of SEATS) {
    const snapshot = pvp.snapshots[seat] as SeatRecord;
    assert.equal(snapshot.roomMode, 'pvp', 'a human-vs-human room is roomMode:pvp');
    assert.ok(!('pveEngineId' in snapshot), 'a PvP room carries no engine id');
    for (const key of ['mode', 'rated', 'forfeitDeadline', 'rematch']) {
      assert.ok(!(key in snapshot), `jieqi snapshot must not carry '${key}'`);
    }
  }
  const pve = runScriptB().steps.at(-1)!;
  for (const seat of SEATS) {
    const snapshot = pve.snapshots[seat] as SeatRecord;
    assert.equal(snapshot.roomMode, 'pve', 'an engine-seated room is roomMode:pve');
    assert.equal(snapshot.pveEngineId, JIEQI_DEFAULT_ENGINE_ID, 'and carries the engine id');
  }
});
