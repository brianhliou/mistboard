/**
 * Banqi PvE and the 長捉 (perpetual chase) rule: the bot never plays a chase move
 * that repeats a position for the third time. The driver restricts the engine's root
 * with `searchmoves` when the rule takes a move away, and if the engine ignores that
 * (an older MistyBanqi), it plays a legal fallback instead of resigning.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBanqiMove,
  type BanqiGameState,
  type BanqiMove,
  getBanqiForbiddenChaseMoves,
  getBanqiLegalMoves,
} from '@mistboard/game';
import { buildBanqiGoCommand } from './banqi-engine.js';
import { banqiMoveToEngineUci } from './banqi-fen.js';
import {
  type BanqiEngineMoveProvider,
  banqiChaseFallbackMove,
  playBanqiEngineMoveIfReady,
} from './server-banqi-engine.js';

const ROOM_ID = 'banqi_chase_rule';
const ENGINE_ID = 'misty-banqi';

// The bot (red seat, red ink) shuttles its advisor c3/c2 after a black chariot that
// shuttles d2/d3, `loops` times; after two, its next c3-c2 would be a third repeat.
function botChasing(loops = 2): BanqiGameState {
  let s: BanqiGameState = {
    id: ROOM_ID,
    board: {
      c3: { color: 'red', role: 'advisor', faceDown: false },
      d2: { color: 'black', role: 'chariot', faceDown: false },
      h1: { color: 'red', role: 'soldier', faceDown: false },
      a4: { color: 'black', role: 'soldier', faceDown: false },
      f4: { color: 'black', role: 'horse', faceDown: true },
    },
    status: { type: 'playing', turn: 'red' },
    ply: 10,
    firstColor: 'red',
    moveNumber: 6,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
    lastMove: { from: 'e2', to: 'd2' },
  };
  const red: BanqiMove[] = [
    { from: 'c3', to: 'c2' },
    { from: 'c2', to: 'c3' },
  ];
  const black: BanqiMove[] = [
    { from: 'd2', to: 'd3' },
    { from: 'd3', to: 'd2' },
  ];
  for (let i = 0; i < loops * 2; i += 1) {
    s = applyBanqiMove(s, red[i % 2]!);
    s = applyBanqiMove(s, black[i % 2]!);
  }
  assert.equal(s.status.type, 'playing');
  assert.equal(s.ply, 10 + loops * 4);
  return s;
}

type Appended = { type: string; move?: BanqiMove };

function fixture(state: BanqiGameState) {
  const appended: Appended[] = [];
  const room = {
    id: ROOM_ID,
    events: [],
    projection: { state, seats: { red: ENGINE_ID, black: 'human-client' }, clock: null },
  };
  const ctx = {
    appendEvent: async (_room: unknown, event: Appended) => {
      appended.push(event);
      return appended.length;
    },
    broadcastEventAppended: () => {},
  };
  return { room, ctx, appended };
}

function search(best: string) {
  return { best, cp: 0, mate: null, depth: 10, nodes: 1000, timeMs: 10, pv: [best] };
}

const uciSet = (moves: BanqiMove[]) => new Set(moves.map(banqiMoveToEngineUci));

test('banqi bot whose chase would repeat a third time: searchmoves carries exactly the legal moves', async () => {
  const state = botChasing();
  const forbidden = uciSet(getBanqiForbiddenChaseMoves(state));
  assert.ok(forbidden.size > 0);
  const { room, ctx, appended } = fixture(state);
  const seen: Array<readonly string[] | undefined> = [];
  // A searchmoves-aware engine: its favourite is the forbidden chase, but it only
  // picks from the root list when given one.
  const favourite = [...forbidden][0]!;
  const provider: BanqiEngineMoveProvider = async (_id, _fen, opts) => {
    seen.push(opts.searchMoves);
    return search(opts.searchMoves ? opts.searchMoves[0]! : favourite);
  };

  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);

  assert.equal(seen.length, 1);
  assert.deepEqual(
    new Set(seen[0]),
    uciSet(getBanqiLegalMoves(state)),
    'the root list is the kernel legal moves',
  );
  for (const uci of forbidden) assert.ok(!seen[0]!.includes(uci), `${uci} excluded`);
  assert.deepEqual(
    appended.map((e) => e.type),
    ['move-played'],
  );
  assert.ok(!forbidden.has(banqiMoveToEngineUci(appended[0]!.move!)));
});

test('banqi bot whose chase would repeat a third time: an engine that ignores searchmoves gets a legal fallback, not a resignation', async () => {
  const state = botChasing();
  const forbidden = uciSet(getBanqiForbiddenChaseMoves(state));
  const { room, ctx, appended } = fixture(state);
  const favourite = [...forbidden][0]!;
  let calls = 0;
  const provider: BanqiEngineMoveProvider = async () => {
    calls += 1;
    return search(favourite); // old binary: always the forbidden repeat
  };

  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);

  assert.ok(calls >= 1);
  assert.deepEqual(
    appended.map((e) => e.type),
    ['move-played'],
    'no seat-resigned',
  );
  const played = banqiMoveToEngineUci(appended[0]!.move!);
  assert.ok(!forbidden.has(played), `played ${played}, a forbidden chase`);
  assert.ok(uciSet(getBanqiLegalMoves(state)).has(played));
});

test('banqi bot whose chase repeats only a second time: no searchmoves, the engine move is played', async () => {
  const s = botChasing(1);
  assert.deepEqual(getBanqiForbiddenChaseMoves(s), []);
  const chase: BanqiMove = { from: 'c3', to: 'c2' };
  const { room, ctx, appended } = fixture(s);
  const seen: Array<readonly string[] | undefined> = [];
  const provider: BanqiEngineMoveProvider = async (_id, _fen, opts) => {
    seen.push(opts.searchMoves);
    return search(banqiMoveToEngineUci(chase));
  };
  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);
  assert.deepEqual(seen, [undefined]);
  assert.deepEqual(appended[0]?.move, chase);
  assert.equal(applyBanqiMove(s, chase).chasedSquare, 'd2', 'it was a chase');
});

test('the chase fallback never picks a forbidden move and prefers a capture', () => {
  const state = botChasing();
  const forbidden = uciSet(getBanqiForbiddenChaseMoves(state));
  const move = banqiChaseFallbackMove(state)!;
  assert.ok(!forbidden.has(banqiMoveToEngineUci(move)));
  assert.notEqual(move.from, move.to, 'a board move over a blind flip');

  // With a black soldier beside the advisor, the fallback takes it.
  const advisor = 'c3';
  const prey = 'b3';
  assert.equal(state.board[advisor]?.role, 'advisor');
  const withPrey: BanqiGameState = {
    ...state,
    board: { ...state.board, [prey]: { color: 'black', role: 'soldier', faceDown: false } },
  };
  assert.deepEqual(banqiChaseFallbackMove(withPrey), { from: advisor, to: prey });
});

test('the go line puts searchmoves last', () => {
  assert.equal(buildBanqiGoCommand(100, 2000), 'go nodes 100 movetime 2000');
  assert.equal(
    buildBanqiGoCommand(100, 2000, ['a0b0', 'c1c1']),
    'go nodes 100 movetime 2000 searchmoves a0b0 c1c1',
  );
});
