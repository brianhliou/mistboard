/**
 * Golden wire-parity suite for the dark-chess (flagship) live-room runtime —
 * recorded BEFORE its P2 VariantTenant migration, same harness as the DMX /
 * Dark Xiangqi / Crossroads suites. Pins the per-seat snapshot payloads and
 * per-seat event-appended deltas for scripted games, plus fixture-independent
 * hidden-info invariants.
 *
 * Dark-chess wire behaviors this suite intentionally pins (the chess stack is
 * the richest tenant): Model A fog redaction (a seat sees only its own
 * move-played events at EVERY status including finished; spectators get the
 * empty fog view), hidden-Draft960 redaction (own offer/selection only;
 * draft-start-resolved never reaches clients pre-finish), the devViews admin
 * debug reveal, pause/resume payload fields, PvE mode derivation +
 * pveEngineId/Name, and the rematch/deadline/seatDisplayNames pass-throughs.
 *
 * Regenerate ONLY for an intentional wire change:
 * MISTBOARD_GOLDEN_RECORD=1 npx tsx --test <this file>.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type ClockState,
  type Color,
  type GameEvent,
  type GameProjection,
  type Move,
  pickDraft960Offer,
  replayGameEvents,
  variantForId,
} from '@mistboard/game';
import { eventAppendedPayload, type SnapshotRoom, snapshotPayload } from './payloads.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Anchor on the package dir so the fixture resolves whether this file runs
// from src/ (tsx, test:unit) or compiled into dist/ (test:persistent).
const FIXTURE_PATH = join(HERE, '..', 'src', 'fixtures', 'dark-chess-wire-golden.json');

type SeatRecord = Record<string, unknown>;

type GoldenStep = {
  label: string;
  deltaForSeat?: Record<string, unknown>;
  snapshots: Record<string, SeatRecord>;
};

type GoldenScript = { id: string; steps: GoldenStep[] };

// Probes: both seats and the defense-in-depth spectator at every step. The
// admin devViews reveal (a white-seated debug client) is probed once per
// script on the final position — it triples payload size, so pinning every
// step would bloat the fixture without adding coverage.
const PROBES = [
  { key: 'white', client: { devViews: false, id: 'client-white', seat: 'white', solo: false } },
  { key: 'black', client: { devViews: false, id: 'client-black', seat: 'black', solo: false } },
  {
    key: 'spectator',
    client: { devViews: false, id: 'client-spec', seat: 'spectator', solo: false },
  },
] as const;

const DEVVIEWS_PROBE = {
  key: 'devViews',
  client: { devViews: true, id: 'client-admin', seat: 'white', solo: false },
} as const;

type GoldenRoom = SnapshotRoom & { events: GameEvent[]; projection: GameProjection };

function goldenRoom(
  events: GameEvent[],
  extras: Partial<Pick<SnapshotRoom, 'pveEngineId' | 'abortDeadline' | 'forfeitDeadline'>> = {},
): GoldenRoom {
  const projection = replayGameEvents(events);
  return {
    id: projection.roomId,
    // Fixed connected-client roster: both seats present, no spectators.
    clients: {
      size: 2,
      [Symbol.iterator]: () =>
        [
          { seat: 'white' as const, displaced: false },
          { seat: 'black' as const, displaced: false },
        ][Symbol.iterator](),
    },
    events,
    projection,
    rated: false,
    region: 'global',
    rematch: { offers: {}, finalizedRoomId: undefined },
    seatDisplayNames: { white: 'White guest', black: 'Black guest' },
    abortDeadline: extras.abortDeadline ?? null,
    forfeitDeadline: extras.forfeitDeadline ?? null,
    pveEngineId: extras.pveEngineId ?? null,
  };
}

function snapshotFor(
  room: GoldenRoom,
  probe: (typeof PROBES)[number] | typeof DEVVIEWS_PROBE,
): SeatRecord {
  return { ...snapshotPayload(room, probe.client), serverAt: 0 };
}

function recordStep(
  script: GoldenScript,
  room: GoldenRoom,
  label: string,
  appended?: { event: GameEvent; seq: number },
): void {
  const step: GoldenStep = { label, snapshots: {} };
  if (appended) {
    step.deltaForSeat = {};
    for (const probe of PROBES) {
      step.deltaForSeat[probe.key] = {
        ...eventAppendedPayload(room, probe.client, appended.event, appended.seq),
        serverAt: 0,
      };
    }
  }
  for (const probe of PROBES) {
    step.snapshots[probe.key] = snapshotFor(room, probe);
  }
  script.steps.push(step);
}

function append(script: GoldenScript, room: GoldenRoom, label: string, event: GameEvent): void {
  room.events.push(event);
  room.projection = replayGameEvents(room.events);
  recordStep(script, room, label, { event, seq: room.events.length - 1 });
}

function recordAdminProbe(script: GoldenScript, room: GoldenRoom): void {
  script.steps.push({
    label: 'admin-probe',
    snapshots: { devViews: snapshotFor(room, DEVVIEWS_PROBE) },
  });
}

function firstLegalMove(projection: GameProjection): Move {
  const status = projection.state.status;
  assert.equal(status.type, 'playing');
  const turn = (status as { turn: Color }).turn;
  const variant = variantForId(projection.variant);
  const moves = [...variant.getLegalMoves(projection.state, turn)].sort((a, b) =>
    `${a.from}${a.to}${a.promotion ?? ''}`.localeCompare(`${b.from}${b.to}${b.promotion ?? ''}`),
  );
  assert.ok(moves[0], 'scripted position must have a legal move');
  return moves[0];
}

function playingTurn(projection: GameProjection): Color {
  const status = projection.state.status;
  assert.equal(status.type, 'playing');
  return (status as { turn: Color }).turn;
}

function fixedClock(remainingMs: { white: number; black: number }, at: number | null): ClockState {
  return {
    activeColor: null,
    incrementMs: 2_000,
    initialMs: 180_000,
    remainingMs,
    runningSince: at,
  };
}

// ── Script A: standard PvP dark-chess — seats, six moves, resign. ───────────
function runScriptA(): GoldenScript {
  const script: GoldenScript = { id: 'pvp-standard', steps: [] };
  const roomId = 'golden-dark-a';
  const room = goldenRoom(
    [
      {
        type: 'room-created',
        at: 1_000,
        roomId,
        variant: 'dark-chess',
        gameSpecId: 'dark-chess',
        offer: [],
        region: 'global',
      },
    ],
    { abortDeadline: 99_000 },
  );
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
    const color = playingTurn(room.projection);
    append(script, room, `move-${i + 1}-${color}`, {
      type: 'move-played',
      at: 10_000 + i * 5_000,
      roomId,
      color,
      move: firstLegalMove(room.projection),
    });
  }

  append(script, room, 'resign', {
    type: 'seat-resigned',
    at: 60_000,
    roomId,
    color: playingTurn(room.projection),
  });
  recordAdminProbe(script, room);
  return script;
}

// ── Script B: hidden Draft960 — per-seat offers, selections, resolution. ────
function runScriptB(): GoldenScript {
  const script: GoldenScript = { id: 'hidden-draft960', steps: [] };
  const roomId = 'golden-dark-b';
  // Seeded offers: deterministic, and DIFFERENT per color so cross-seat leaks
  // would change the fixture.
  const whiteOffer = pickDraft960Offer(7);
  const blackOffer = pickDraft960Offer(11);
  const room = goldenRoom([
    {
      type: 'room-created',
      at: 1_000,
      roomId,
      variant: 'dark-chess',
      gameSpecId: 'dark-draft960',
      offer: whiteOffer,
      offers: { white: whiteOffer, black: blackOffer },
      region: 'global',
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
  append(script, room, 'white-selects', {
    type: 'draft-start-selected',
    at: 4_000,
    roomId,
    color: 'white',
    startId: whiteOffer[0]!.id,
  });
  append(script, room, 'black-selects', {
    type: 'draft-start-selected',
    at: 5_000,
    roomId,
    color: 'black',
    startId: blackOffer[1]!.id,
  });
  append(script, room, 'resolved', {
    type: 'draft-start-resolved',
    at: 6_000,
    roomId,
    startIds: { white: whiteOffer[0]!.id, black: blackOffer[1]!.id },
  });

  for (let i = 0; i < 2; i += 1) {
    const color = playingTurn(room.projection);
    append(script, room, `move-${i + 1}-${color}`, {
      type: 'move-played',
      at: 10_000 + i * 5_000,
      roomId,
      color,
      move: firstLegalMove(room.projection),
    });
  }
  recordAdminProbe(script, room);
  return script;
}

// ── Script C: pause/resume cycle ending in a leaver forfeit. ────────────────
function runScriptC(): GoldenScript {
  const script: GoldenScript = { id: 'pause-resume-forfeit', steps: [] };
  const roomId = 'golden-dark-c';
  const room = goldenRoom(
    [
      {
        type: 'room-created',
        at: 1_000,
        roomId,
        variant: 'dark-chess',
        gameSpecId: 'dark-chess',
        offer: [],
        region: 'global',
      },
      { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-white', seat: 'white' },
      { type: 'seat-assigned', at: 3_000, roomId, clientId: 'client-black', seat: 'black' },
    ],
    { forfeitDeadline: 123_000 },
  );
  recordStep(script, room, 'hydrated');

  for (let i = 0; i < 2; i += 1) {
    const color = playingTurn(room.projection);
    append(script, room, `move-${i + 1}-${color}`, {
      type: 'move-played',
      at: 10_000 + i * 5_000,
      roomId,
      color,
      move: firstLegalMove(room.projection),
    });
  }

  append(script, room, 'pause', {
    type: 'pause',
    at: 20_000,
    roomId,
    reason: 'shutdown',
    clock: fixedClock({ white: 170_000, black: 165_000 }, null),
  });
  append(script, room, 'resume', {
    type: 'resume',
    at: 30_000,
    roomId,
    reason: 'both-present',
    clock: fixedClock({ white: 170_000, black: 165_000 }, 30_000),
  });
  append(script, room, 'move-after-resume', {
    type: 'move-played',
    at: 31_000,
    roomId,
    color: playingTurn(room.projection),
    move: firstLegalMove(room.projection),
  });
  append(script, room, 'forfeit', {
    type: 'seat-forfeited',
    at: 40_000,
    roomId,
    color: playingTurn(room.projection),
  });
  recordAdminProbe(script, room);
  return script;
}

// ── Script D: PvE — engine seat, mode derivation, clock expiry. ─────────────
function runScriptD(): GoldenScript {
  const script: GoldenScript = { id: 'pve-clock-expiry', steps: [] };
  const roomId = 'golden-dark-d';
  const room = goldenRoom(
    [
      {
        type: 'room-created',
        at: 1_000,
        roomId,
        variant: 'dark-chess',
        gameSpecId: 'dark-chess',
        offer: [],
        region: 'global',
        timeControl: { initialMs: 180_000, incrementMs: 2_000 },
      },
      { type: 'seat-assigned', at: 2_000, roomId, clientId: 'client-white', seat: 'white' },
      { type: 'seat-assigned', at: 3_000, roomId, clientId: 'python-v2-v1.0', seat: 'black' },
    ],
    { pveEngineId: 'python-v2-v1.0' },
  );
  recordStep(script, room, 'hydrated');

  for (let i = 0; i < 2; i += 1) {
    const color = playingTurn(room.projection);
    append(script, room, `move-${i + 1}-${color}`, {
      type: 'move-played',
      at: 10_000 + i * 5_000,
      roomId,
      color,
      move: firstLegalMove(room.projection),
    });
  }

  append(script, room, 'clock-expired', {
    type: 'clock-expired',
    at: 200_000,
    roomId,
    color: playingTurn(room.projection),
    clock: fixedClock({ white: 0, black: 120_000 }, null),
  });
  recordAdminProbe(script, room);
  return script;
}

function runAllScripts(): GoldenScript[] {
  return [runScriptA(), runScriptB(), runScriptC(), runScriptD()];
}

// Round-trip through JSON so undefined-valued keys drop out exactly as they do
// on the wire.
function asWireJson(scripts: GoldenScript[]): unknown {
  return JSON.parse(JSON.stringify({ scripts }));
}

test('dark chess golden wire: per-seat payloads match the recorded fixture', () => {
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
  devViews: unknown;
  offer: unknown[];
  offers: Record<string, unknown[]>;
  selections: Record<string, unknown>;
  resolvedStartId: number | null;
  resolvedStartIds: Record<string, unknown>;
  state: {
    board: Record<string, { color: string }>;
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
  const state = wireSnapshots(step).white?.state as { status?: { type?: string } } | undefined;
  return state?.status?.type === 'finished';
}

test('dark chess golden wire: move events never cross seats while the game is live', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      if (step.label === 'admin-probe') continue;
      // Fog is a LIVE invariant. A finished room hands everyone the whole log,
      // asserted by 'a finished room opens fully to a spectator' below.
      if (isFinishedStep(step)) continue;
      const snapshots = wireSnapshots(step);
      for (const seat of ['white', 'black', 'spectator'] as const) {
        const others =
          seat === 'white' ? ['black'] : seat === 'black' ? ['white'] : ['white', 'black'];
        for (const event of snapshots[seat]!.events) {
          if (event.type !== 'move-played') continue;
          assert.ok(
            !others.includes(event.color ?? ''),
            `${script.id}/${step.label}: ${seat} received a foreign move event`,
          );
        }
      }
      const deltas = step.deltaForSeat as
        | Record<string, { event?: { type?: string; color?: string } }>
        | undefined;
      if (deltas) {
        for (const seat of ['white', 'black'] as const) {
          const seatDelta: { type?: string; color?: string } | undefined = deltas[seat]?.event;
          if (seatDelta?.type !== 'move-played') continue;
          assert.equal(seatDelta.color, seat, `${script.id}/${step.label}: foreign move delta`);
        }
        if (deltas.spectator?.event?.type === 'move-played') {
          assert.fail(`${script.id}/${step.label}: spectator received a move delta`);
        }
      }
    }
  }
});

test('dark chess golden wire: spectators get the empty fog view while live', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      if (step.label === 'admin-probe') continue;
      if (isFinishedStep(step)) continue;
      const view = wireSnapshots(step).spectator!.state;
      assert.deepStrictEqual(view.board, {}, `${script.id}/${step.label}`);
      assert.deepStrictEqual(view.visibleSquares, []);
      assert.deepStrictEqual(view.legalMoves, []);
      assert.equal(view.lastMove, undefined);
    }
  }
});

test('dark chess golden wire: seated fog views never show hidden opponent pieces', () => {
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      if (step.label === 'admin-probe') continue;
      const snapshots = wireSnapshots(step);
      for (const seat of ['white', 'black'] as const) {
        const view = snapshots[seat]!.state;
        const visible = new Set(view.visibleSquares);
        for (const [square, piece] of Object.entries(view.board)) {
          if (piece.color === seat) continue;
          assert.ok(
            visible.has(square),
            `${script.id}/${step.label}: ${seat} sees hidden opponent piece on ${square}`,
          );
        }
      }
    }
  }
});

test('dark chess golden wire: hidden-draft offers and selections stay per-seat', () => {
  const script = runScriptB();
  // Every pre-finish step: a seat sees only its own offer/selection, the
  // spectator sees none, and draft-start-resolved never reaches anyone.
  for (const step of script.steps) {
    if (step.label === 'admin-probe') continue;
    const snapshots = wireSnapshots(step);
    for (const seat of ['white', 'black'] as const) {
      const other = seat === 'white' ? 'black' : 'white';
      const snapshot = snapshots[seat]!;
      assert.equal(snapshot.offers[other], undefined, `${script.id}/${step.label}: foreign offer`);
      assert.equal(
        snapshot.selections[other],
        undefined,
        `${script.id}/${step.label}: foreign selection`,
      );
      assert.deepStrictEqual(snapshot.resolvedStartIds[other] ?? undefined, undefined);
      assert.equal(snapshot.resolvedStartId, null);
      for (const event of snapshot.events) {
        assert.notEqual(event.type, 'draft-start-resolved');
        if (event.type === 'draft-start-selected') {
          assert.equal((event as { color?: string }).color, seat);
        }
      }
    }
    const spectator = snapshots.spectator!;
    assert.deepStrictEqual(spectator.offer, []);
    assert.deepStrictEqual(spectator.offers, {});
    assert.deepStrictEqual(spectator.selections, {});
  }
});

test('dark chess golden wire: devViews reveal is admin-probe-only', () => {
  for (const script of runAllScripts()) {
    let sawAdminProbe = false;
    for (const step of script.steps) {
      const snapshots = wireSnapshots(step);
      if (step.label === 'admin-probe') {
        sawAdminProbe = true;
        assert.notEqual(snapshots.devViews!.devViews, null, script.id);
        continue;
      }
      for (const seat of ['white', 'black', 'spectator'] as const) {
        assert.equal(snapshots[seat]!.devViews, null, `${script.id}/${step.label}`);
      }
    }
    assert.ok(sawAdminProbe, `${script.id}: missing admin probe step`);
  }
});

test('dark chess golden wire: a finished room opens fully to a spectator', () => {
  // The other half of the two live invariants above. Split so neither can be
  // silently widened: weakening one leaves the other failing.
  let finishedSteps = 0;
  for (const script of runAllScripts()) {
    for (const step of script.steps) {
      if (step.label === 'admin-probe') continue;
      if (!isFinishedStep(step)) continue;
      finishedSteps += 1;
      const spectator = wireSnapshots(step).spectator!;
      assert.ok(
        Object.keys(spectator.state.board).length > 0,
        `${script.id}/${step.label}: finished board must not be empty`,
      );
      assert.ok(spectator.events.length > 0, `${script.id}/${step.label}: log must be delivered`);
      // Both seats' moves are present, which is exactly what the live invariant
      // forbids and the finished state allows. Same content /game/:id already
      // serves to any signed-out stranger.
      const colors = new Set(
        spectator.events.filter((e) => e.type === 'move-played').map((e) => e.color),
      );
      assert.ok(colors.size === 2, `${script.id}/${step.label}: expected both colors' moves`);
    }
  }
  assert.ok(finishedSteps > 0, 'no finished step in the scripts: this test asserted nothing');
});
