import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  DUCK_XIANGQI_SPEC_ID,
  type DuckXiangqiGameState,
  type DuckXiangqiTurn,
  getDuckXiangqiLegalTurns,
} from '@mistboard/game';
import type { DuckXiangqiEvent } from '../duck-xiangqi-tenant.js';
import type { RecentEveGameRecord } from '../persistence.js';
import {
  type DuckXiangqiPostgamePersistence,
  duckXiangqiPostgameForApi,
} from './duck-xiangqi-games.js';

const ROOM_ID = 'dkx_postgame';
const MOVE_COUNT = 4;

function turnKey(turn: DuckXiangqiTurn): string {
  return `${turn.from}${turn.to}${turn.duckTo ?? ''}`;
}

// A deterministic scripted line: each side plays its first legal TURN (stable
// sort), then Red resigns -> Black wins. Turns come from the kernel, so the
// event log only ever holds legal ones and every ply after the first carries a
// duck square.
function finishedGameEvents(): DuckXiangqiEvent[] {
  const events: DuckXiangqiEvent[] = [
    { type: 'room-created', at: 1, roomId: ROOM_ID, gameSpecId: DUCK_XIANGQI_SPEC_ID },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'b', seat: 'black' },
  ];
  let state: DuckXiangqiGameState = createInitialDuckXiangqiState(ROOM_ID);
  let at = 4;
  for (let i = 0; i < MOVE_COUNT; i += 1) {
    if (state.status.type !== 'playing') break;
    const color = state.status.turn;
    const first = [...getDuckXiangqiLegalTurns(state)].sort((a, b) =>
      turnKey(a).localeCompare(turnKey(b)),
    )[0]!;
    events.push({ type: 'move-played', at: at++, roomId: ROOM_ID, color, move: first });
    state = applyDuckXiangqiTurn(state, first);
  }
  events.push({ type: 'seat-resigned', at, roomId: ROOM_ID, color: 'red' });
  return events;
}

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: DUCK_XIANGQI_SPEC_ID,
    mode: 'pvp',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: MOVE_COUNT,
    startedAt: new Date(1),
    endedAt: new Date(100),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'private',
    participants: [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: null,
    incrementMs: null,
    ...overrides,
  };
}

function deps(
  record: RecentEveGameRecord | null,
  events: DuckXiangqiEvent[] | null,
): DuckXiangqiPostgamePersistence {
  return {
    getGameSummary: async () => record,
    loadRoomEvents: async () => events,
  };
}

// ── Happy path ──────────────────────────────────────────────────────────────
test('Duck Xiangqi postgame returns the finished-game envelope with a truth view', async () => {
  const payload = await duckXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedGameEvents()),
  );
  assert.ok(payload);
  assert.equal(payload.game.roomId, ROOM_ID);
  assert.equal(payload.game.variant, DUCK_XIANGQI_SPEC_ID);
  assert.equal(payload.game.result, 'black-wins');
  assert.deepEqual(payload.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'resignation',
  });
  assert.equal(payload.timeline.filter((entry) => entry.type === 'move-played').length, MOVE_COUNT);
  // Open information: one view, from Red's perspective, and it IS `views.truth`.
  assert.equal(payload.view.perspective, 'red');
  assert.deepEqual(payload.views.truth, payload.view);
});

test('Duck Xiangqi postgame timeline carries the whole turn, duck square included', async () => {
  const payload = await duckXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedGameEvents()),
  );
  assert.ok(payload);
  const moves = payload.timeline.filter(
    (entry): entry is typeof entry & { move: DuckXiangqiTurn } => entry.type === 'move-played',
  );
  for (const entry of moves) {
    assert.ok(entry.move.from && entry.move.to, 'a turn needs its piece move');
    // None of these scripted turns captures a general, so every one places the
    // duck. A `duckTo: null` here would mean the payload dropped the third
    // field of the turn, which is the whole variant.
    assert.notEqual(entry.move.duckTo, null);
  }
  // The terminal event is projected with a winner, not left raw.
  const resign = payload.timeline.find((entry) => entry.type === 'seat-resigned');
  assert.ok(resign);
  assert.equal(resign.winner, 'black');
});

test('Duck Xiangqi postgame history snapshots every ply, and ply 0 has no duck', async () => {
  const payload = await duckXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedGameEvents()),
  );
  assert.ok(payload);
  const truth = payload.history.truth;
  assert.deepEqual(
    truth.map((snapshot) => snapshot.ply),
    Array.from({ length: MOVE_COUNT + 1 }, (_, i) => i),
  );
  // The duck is not on the board before Red's first turn. Every later snapshot
  // must carry it, or the replay board draws a game with no blocker in it.
  assert.equal(truth[0]?.view.duck, undefined);
  for (const snapshot of truth.slice(1)) {
    assert.ok(snapshot.view.duck, `ply ${snapshot.ply} lost the duck`);
  }
});

// ── Not-found paths ─────────────────────────────────────────────────────────
test('Duck Xiangqi postgame returns null for an unfinished game', async () => {
  const events = finishedGameEvents().slice(0, -1); // drop the resignation
  assert.equal(await duckXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), events)), null);
});

test('Duck Xiangqi postgame rejects a record from another variant', async () => {
  const payload = await duckXiangqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord({ variant: 'fortress-xiangqi' }), finishedGameEvents()),
  );
  assert.equal(payload, null);
});

test('Duck Xiangqi postgame returns null when there is no game or event log', async () => {
  assert.equal(await duckXiangqiPostgameForApi(ROOM_ID, deps(null, finishedGameEvents())), null);
  assert.equal(await duckXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), null)), null);
});

test('Duck Xiangqi postgame rejects an event log belonging to another room', async () => {
  const foreign = finishedGameEvents().map((event) => ({ ...event, roomId: 'dkx_other' }));
  assert.equal(
    await duckXiangqiPostgameForApi(ROOM_ID, deps(gameRecord(), foreign as DuckXiangqiEvent[])),
    null,
  );
});

test('Duck Xiangqi postgame does not require the launch env flag', async () => {
  const previous = process.env.MISTBOARD_DUCK_XIANGQI_ENABLED;
  delete process.env.MISTBOARD_DUCK_XIANGQI_ENABLED;
  try {
    const payload = await duckXiangqiPostgameForApi(
      ROOM_ID,
      deps(gameRecord(), finishedGameEvents()),
    );
    assert.ok(payload);
    assert.equal(payload.game.variant, DUCK_XIANGQI_SPEC_ID);
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_DUCK_XIANGQI_ENABLED;
    else process.env.MISTBOARD_DUCK_XIANGQI_ENABLED = previous;
  }
});
