import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBughouseDrop,
  applyBughouseMove,
  applyBughouseTimeout,
  type BughouseBoardState,
  type BughouseMatchState,
  bughouseClockRemainingMs,
  bughouseLegalActions,
  buildBughousePartnerRequest,
  createBughouseClock,
  createInitialBughouseMatch,
  replayBughouseEvents,
  startBughouseClocks,
} from './bughouse.js';
import { validateBughousePartnerRequest } from './bughouse-engine-protocol.js';
import type { Board, GameState } from './types.js';

test('initial bughouse match starts two standard boards with opposite-color partners', () => {
  const match = createInitialBughouseMatch('bughouse-test');

  assert.equal(match.status.type, 'playing');
  assert.equal(match.boards.A.state.status.type, 'playing');
  assert.equal(match.boards.B.state.status.type, 'playing');
  assert.equal(match.boards.A.state.board.e1?.role, 'king');
  assert.equal(match.boards.B.state.board.e8?.color, 'black');

  const actions = bughouseLegalActions(match, 'A:white');
  assert.ok(actions.some((action) => action.kind === 'move' && action.move.from === 'e2'));
  assert.equal(bughouseLegalActions(match, 'B:black').length, 0);
});

test('bughouse clocks run independently on both boards', () => {
  let match = createInitialBughouseMatch('bughouse-clock');
  match = {
    ...match,
    clock: startBughouseClocks(match, createBughouseClock(1_000, 60_000, 2_000), 1_000),
  };

  assert.equal(match.clock!.boards.A.activeSeat, 'A:white');
  assert.equal(match.clock!.boards.B.activeSeat, 'B:white');

  match = applyBughouseMove(match, 'A:white', { from: 'e2', to: 'e4' }, 2_500);

  assert.equal(match.clock?.boards.A.activeSeat, 'A:black');
  assert.equal(match.clock?.boards.A.runningSince, 2_500);
  assert.equal(match.clock?.boards.A.remainingMs.white, 60_500);
  assert.equal(match.clock?.boards.B.activeSeat, 'B:white');
  assert.equal(match.clock?.boards.B.remainingMs.white, 60_000);
  assert.equal(bughouseClockRemainingMs(match.clock!, 'B:white', 2_500), 58_500);

  const request = buildBughousePartnerRequest({
    match,
    seat: 'B:white',
    engineId: 'clock-aware-bot',
    engineSeed: 77,
    serverNowEpochMs: 2_750,
  });

  assert.equal(request.clocks.boards.A.activeSeat, 'A:black');
  assert.equal(request.clocks.boards.B.activeSeat, 'B:white');
  assert.equal(request.clocks.boards.A.remainingMs.white, 60_500);
  assert.equal(request.clocks.boards.B.runningSinceEpochMs, 1_000);
  assert.deepEqual(validateBughousePartnerRequest(request), { ok: true, value: request });
});

test('bughouse timeout freezes both board clocks and awards the opposing team', () => {
  let match = createInitialBughouseMatch('bughouse-timeout');
  match = {
    ...match,
    clock: startBughouseClocks(match, createBughouseClock(0, 1_000, 0), 0),
  };

  const next = applyBughouseTimeout(match, 'A:white', 1_250);

  assert.deepEqual(next.status, {
    type: 'finished',
    board: 'A',
    winnerTeam: 'team-1',
    reason: 'timeout',
  });
  assert.deepEqual(next.boards.A.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'timeout',
  });
  assert.equal(next.clock?.boards.A.activeSeat, null);
  assert.equal(next.clock?.boards.A.remainingMs.white, 0);
  assert.equal(next.clock?.boards.B.activeSeat, null);
  assert.equal(next.clock?.boards.B.remainingMs.white, 0);
});

test('a capture transfers a demoted reserve piece to the partner seat', () => {
  let match = createInitialBughouseMatch('bughouse-capture');

  match = applyBughouseMove(match, 'A:white', { from: 'e2', to: 'e4' });
  match = applyBughouseMove(match, 'A:black', { from: 'd7', to: 'd5' });
  match = applyBughouseMove(match, 'A:white', { from: 'e4', to: 'd5' });

  assert.equal(match.reserves['B:black'].pawn, 1);
  assert.equal(match.boards.A.state.board.d5?.color, 'white');
  assert.equal(match.boards.A.state.status.type, 'playing');
  assert.equal(
    match.boards.A.state.status.type === 'playing' && match.boards.A.state.status.turn,
    'black',
  );
});

test('a drop consumes reserve, places the piece, and passes the board turn', () => {
  const match: BughouseMatchState = {
    ...createInitialBughouseMatch('bughouse-drop'),
    reserves: {
      'A:white': { knight: 1 },
      'A:black': {},
      'B:white': {},
      'B:black': {},
    },
  };

  const next = applyBughouseDrop(match, 'A:white', { role: 'knight', to: 'f3' });

  assert.equal(next.reserves['A:white'].knight, 0);
  assert.deepEqual(next.boards.A.state.board.f3, { color: 'white', role: 'knight' });
  assert.equal(next.boards.A.state.status.type, 'playing');
  assert.equal(
    next.boards.A.state.status.type === 'playing' && next.boards.A.state.status.turn,
    'black',
  );
});

test('a captured promoted pawn enters the partner reserve as a pawn', () => {
  const board: Board = {
    a7: { color: 'black', role: 'rook' },
    a8: { color: 'white', role: 'queen' },
    e1: { color: 'white', role: 'king' },
    e8: { color: 'black', role: 'king' },
  };
  const match = withBoard('promotion-demotion', {
    board: 'A',
    promoted: ['a8'],
    state: standardState('promotion-demotion:A', board, 'black'),
    lastAction: null,
  });

  const next = applyBughouseMove(match, 'A:black', { from: 'a7', to: 'a8' });

  assert.equal(next.reserves['B:white'].pawn, 1);
  assert.equal(next.reserves['B:white'].queen, undefined);
  assert.deepEqual(next.boards.A.promoted, []);
});

test('pawn drops cannot go on the back ranks but can go on the second rank', () => {
  const match: BughouseMatchState = {
    ...createInitialBughouseMatch('pawn-drop'),
    reserves: {
      'A:white': { pawn: 1 },
      'A:black': {},
      'B:white': {},
      'B:black': {},
    },
  };

  assert.ok(
    !bughouseLegalActions(match, 'A:white').some(
      (action) => action.kind === 'drop' && action.drop.to === 'a1',
    ),
  );
  assert.ok(
    bughouseLegalActions(match, 'A:white').some(
      (action) => action.kind === 'drop' && action.drop.to === 'a3',
    ),
  );
});

test('bughouse events replay into the same aggregate state', () => {
  const initial = createInitialBughouseMatch('bughouse-replay');
  const clock = startBughouseClocks(initial, createBughouseClock(1_000, 60_000, 2_000), 1_000);
  const events = [
    { type: 'match-created', at: 1, matchId: 'bughouse-replay' },
    { type: 'clock-started', at: 1_000, matchId: 'bughouse-replay', clock },
    {
      type: 'board-move',
      at: 2_500,
      matchId: 'bughouse-replay',
      seat: 'A:white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'board-move',
      at: 4_000,
      matchId: 'bughouse-replay',
      seat: 'A:black',
      move: { from: 'd7', to: 'd5' },
    },
    {
      type: 'board-move',
      at: 5_500,
      matchId: 'bughouse-replay',
      seat: 'A:white',
      move: { from: 'e4', to: 'd5' },
    },
    {
      type: 'board-move',
      at: 6_000,
      matchId: 'bughouse-replay',
      seat: 'B:white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'board-drop',
      at: 7_000,
      matchId: 'bughouse-replay',
      seat: 'B:black',
      drop: { role: 'pawn', to: 'e6' },
    },
  ] as const;

  let manual = createInitialBughouseMatch('bughouse-replay');
  manual = { ...manual, clock };
  manual = applyBughouseMove(manual, 'A:white', { from: 'e2', to: 'e4' }, 2_500);
  manual = applyBughouseMove(manual, 'A:black', { from: 'd7', to: 'd5' }, 4_000);
  manual = applyBughouseMove(manual, 'A:white', { from: 'e4', to: 'd5' }, 5_500);
  manual = applyBughouseMove(manual, 'B:white', { from: 'e2', to: 'e4' }, 6_000);
  manual = applyBughouseDrop(manual, 'B:black', { role: 'pawn', to: 'e6' }, 7_000);

  assert.deepEqual(replayBughouseEvents(events), manual);
  assert.deepEqual(manual.boards.B.state.board.e6, { color: 'black', role: 'pawn' });
  assert.equal(manual.boards.B.state.moveNumber, 2);
  assert.equal(manual.clock?.boards.A.activeSeat, 'A:black');
  assert.equal(manual.clock?.boards.B.activeSeat, 'B:white');
});

test('bughouse event replay ignores events for other matches', () => {
  const replayed = replayBughouseEvents([
    { type: 'match-created', at: 1, matchId: 'bughouse-replay-ignore' },
    {
      type: 'board-move',
      at: 2,
      matchId: 'other-match',
      seat: 'A:white',
      move: { from: 'e2', to: 'e4' },
    },
  ]);

  assert.equal(replayed.boards.A.state.board.e2?.role, 'pawn');
  assert.equal(replayed.boards.A.state.board.e4, undefined);
});

test('buildBughousePartnerRequest projects aggregate state into protocol shape', () => {
  let match = createInitialBughouseMatch('bughouse-request');
  match = applyBughouseMove(match, 'A:white', { from: 'e2', to: 'e4' });
  match = applyBughouseMove(match, 'A:black', { from: 'd7', to: 'd5' });
  match = applyBughouseMove(match, 'A:white', { from: 'e4', to: 'd5' });
  match = applyBughouseMove(match, 'B:white', { from: 'e2', to: 'e4' });

  const request = buildBughousePartnerRequest({
    match,
    seat: 'B:black',
    engineId: 'baseline-b2',
    engineSeed: 12345,
    serverNowEpochMs: 1_782_029_800_000,
    teamSignals: [
      {
        id: 'sig-need-pawn',
        kind: 'need-piece',
        from: 'A:white',
        to: 'B:black',
        createdAtPly: 3,
        urgency: 'high',
        role: 'pawn',
      },
      {
        id: 'sig-other-team',
        kind: 'danger',
        from: 'A:black',
        to: 'B:white',
        createdAtPly: 3,
        urgency: 'low',
      },
    ],
  });

  assert.equal(request.protocolVersion, '0');
  assert.equal(request.gameSpecId, 'chess-bughouse');
  assert.equal(request.matchId, 'bughouse-request');
  assert.equal(request.sessionId, 'bughouse-request:B:black:baseline-b2');
  assert.equal(request.seat, 'B:black');
  assert.equal(request.team, 'team-0');
  assert.equal(request.ply, 4);
  assert.equal(request.reserves['B:black'].pawn, 1);
  assert.equal(request.boards.A.enPassantSquare, null);
  assert.equal(request.boards.A.lastAction?.id, 'A:white:move:e4-d5');
  assert.equal(request.boards.B.lastAction?.id, 'B:white:move:e2-e4');
  assert.equal(request.clocks.boards.A.activeSeat, null);
  assert.equal(request.clocks.boards.B.remainingMs.black, null);
  assert.equal(request.teamSignals.length, 1);
  assert.ok(
    request.legalActions.some((action) => action.kind === 'drop' && action.drop.role === 'pawn'),
  );
  assert.deepEqual(validateBughousePartnerRequest(request), { ok: true, value: request });
});

function withBoard(matchId: string, board: BughouseBoardState): BughouseMatchState {
  return {
    ...createInitialBughouseMatch(matchId),
    boards: {
      ...createInitialBughouseMatch(matchId).boards,
      [board.board]: board,
    },
  };
}

function standardState(id: string, board: Board, turn: 'white' | 'black'): GameState {
  return {
    id,
    variant: 'chess',
    board,
    status: { type: 'playing', turn },
    moveNumber: 1,
    castlingRights: [],
    halfmoveClock: 0,
    positionCounts: {},
  };
}
