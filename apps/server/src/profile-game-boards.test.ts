import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATOMIC_XIANGQI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  type GomokuOpening,
  JIEQI_SPEC_ID,
  STANDARD_JIEQI_DEAL,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { resolvePositionOg, startPositionFen } from './og-position.js';
import {
  attachProfileBoards,
  type ProfileBoardDeps,
  resetProfileBoardCache,
  thumbOf,
} from './profile-game-boards.js';

const GOMOKU_SETUP: GomokuOpening = {
  stones: [
    { square: 'h8', color: 'white' },
    { square: 'i8', color: 'black' },
    { square: 'h9', color: 'white' },
    { square: 'i9', color: 'black' },
  ],
  turn: 'black',
};

function gomokuEvents(roomId: string, setup?: GomokuOpening): unknown[] {
  return [
    { type: 'room-created', at: 1, roomId, gameSpecId: 'gomoku', ...(setup ? { setup } : {}) },
    ...['a1', 'a15', 'b1', 'c15', 'c1', 'e15', 'd1', 'g15', 'e1'].map((to, index) => ({
      type: 'move-played',
      at: index + 2,
      roomId,
      color: index % 2 ? 'white' : 'black',
      move: { to },
    })),
  ];
}

test('Gomoku profile thumbnails include dealt stones and the deciding placement', async () => {
  const original = process.env.MISTBOARD_GOMOKU_ENABLED;
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  try {
    for (const setup of [undefined, GOMOKU_SETUP]) {
      resetProfileBoardCache();
      const roomId = `gmk_profile_${setup ? 'dealt' : 'legacy'}`;
      const [row] = await attachProfileBoards(
        [{ roomId, variant: 'gomoku' }],
        await deps({ [roomId]: gomokuEvents(roomId, setup) }),
      );
      const board = row?.finalBoard;
      assert.ok(board && board.shape === 'intersection');
      assert.deepEqual([board.files, board.ranks, board.river, board.palaces], [15, 15, null, []]);
      assert.equal(board.pieces.length, 9 + (setup?.stones.length ?? 0));
      assert.ok(board.pieces.some(([f, r, ink]) => f === 4 && r === 1 && ink === 'black'));
      assert.ok(board.pieces.some(([f, r, ink]) => f === 0 && r === 15 && ink === 'white'));
      if (setup)
        assert.ok(board.pieces.some(([f, r, ink]) => f === 7 && r === 8 && ink === 'white'));
      assert.deepEqual(
        Object.keys(board).sort(),
        ['shape', 'files', 'ranks', 'river', 'palaces', 'pieces'].sort(),
      );
    }
  } finally {
    if (original === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = original;
    resetProfileBoardCache();
  }
});

test('Gomoku thumbnails refuse live, aborted and illegal logs', async () => {
  const original = process.env.MISTBOARD_GOMOKU_ENABLED;
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  try {
    const roomId = 'gmk_profile_invalid';
    const full = gomokuEvents(roomId, GOMOKU_SETUP);
    for (const events of [
      full.slice(0, -1),
      [full[0], { type: 'game-aborted', at: 2, roomId, reason: 'no-start' }],
      full.map((event, index) =>
        index === 2
          ? { type: 'move-played', at: 3, roomId, color: 'white', move: { to: 'a1' } }
          : event,
      ),
    ]) {
      resetProfileBoardCache();
      const rows = await attachProfileBoards(
        [{ roomId, variant: 'gomoku' }],
        await deps({ [roomId]: events }),
      );
      assert.equal(rows[0]?.finalBoard, null);
    }
  } finally {
    if (original === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = original;
    resetProfileBoardCache();
  }
});

test('Gomoku profile boards respect the flag before and after the cache is warm', async () => {
  const original = process.env.MISTBOARD_GOMOKU_ENABLED;
  const roomId = 'gmk_profile_flag';
  const loads: string[][] = [];
  const boardDeps = await deps({ [roomId]: gomokuEvents(roomId, GOMOKU_SETUP) }, loads);
  const rows = [{ roomId, variant: 'gomoku' }];
  resetProfileBoardCache();
  try {
    delete process.env.MISTBOARD_GOMOKU_ENABLED;
    assert.equal((await attachProfileBoards(rows, boardDeps))[0]?.finalBoard, null);
    assert.deepEqual(loads, [], 'disabled thumbnail must not read its log');
    process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
    assert.ok((await attachProfileBoards(rows, boardDeps))[0]?.finalBoard);
    process.env.MISTBOARD_GOMOKU_ENABLED = 'false';
    assert.equal((await attachProfileBoards(rows, boardDeps))[0]?.finalBoard, null);
    process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
    assert.ok((await attachProfileBoards(rows, boardDeps))[0]?.finalBoard);
    assert.equal(loads.length, 1);
  } finally {
    if (original === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = original;
    resetProfileBoardCache();
  }
});

// Same fixture shapes as og-game-tenant.test.ts: real tenant logs replayed by
// the real registered cards.

function preamble(roomId: string, gameSpecId: string, setup?: unknown): unknown[] {
  return [
    { type: 'room-created', at: 1, roomId, gameSpecId, ...(setup ? { setup } : {}) },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];
}

const XQ_ROOM = 'xq_profile';
function xiangqiMoves(roomId: string): unknown[] {
  return [
    { type: 'move-played', at: 10, roomId, color: 'red', move: { from: 'h3', to: 'e3' } },
    { type: 'move-played', at: 11, roomId, color: 'black', move: { from: 'h10', to: 'g8' } },
    { type: 'move-played', at: 12, roomId, color: 'red', move: { from: 'b1', to: 'c3' } },
  ];
}
function finishedXiangqiEvents(roomId = XQ_ROOM): unknown[] {
  return [
    ...preamble(roomId, XIANGQI_SPEC_ID),
    ...xiangqiMoves(roomId),
    { type: 'seat-resigned', at: 13, roomId, color: 'black' },
  ];
}

const JQ_ROOM = 'jq_profile';
function finishedJieqiEvents(): unknown[] {
  return [
    ...preamble(JQ_ROOM, JIEQI_SPEC_ID, STANDARD_JIEQI_DEAL),
    { type: 'move-played', at: 4, roomId: JQ_ROOM, color: 'red', move: { from: 'b3', to: 'b10' } },
    { type: 'seat-resigned', at: 5, roomId: JQ_ROOM, color: 'black' },
  ];
}

async function liveCards(): Promise<ProfileBoardDeps['cardForRoomId']> {
  await import('./variant-tenant/register-tenants.js');
  const { variantTenantForRoomId } = await import('./variant-tenant/registry.js');
  return (roomId) => variantTenantForRoomId(roomId)?.card ?? null;
}

async function deps(
  logs: Record<string, unknown[]>,
  loads: string[][] = [],
): Promise<ProfileBoardDeps> {
  return {
    cardForRoomId: await liveCards(),
    loadRoomsEvents: async (roomIds) => {
      loads.push([...roomIds]);
      return new Map(roomIds.flatMap((id) => (logs[id] ? [[id, logs[id]] as const] : [])));
    },
  };
}

test('a finished xiangqi game carries its final position, pieces by ink only', async () => {
  resetProfileBoardCache();
  const [row] = await attachProfileBoards(
    [{ roomId: XQ_ROOM, variant: 'xiangqi' }],
    await deps({ [XQ_ROOM]: finishedXiangqiEvents() }),
  );
  const board = row?.finalBoard;
  assert.ok(board && board.shape === 'intersection');
  assert.equal(board.files, 9);
  assert.equal(board.ranks, 10);
  assert.deepEqual(board.river, [5, 6]);
  assert.equal(board.palaces.length, 2);
  assert.equal(board.pieces.length, 32);
  const at = (file: number, rank: number) =>
    board.pieces.find(([f, r]) => f === file && r === rank)?.[2] ?? null;
  // The final position, not the start: horse b1-c3, cannon h3-e3, horse h10-g8.
  assert.equal(at(1, 1), null);
  assert.equal(at(2, 3), 'red');
  assert.equal(at(4, 3), 'red');
  assert.equal(at(7, 3), null);
  assert.equal(at(6, 8), 'black');
});

test('a xiangqi game ending on a move keeps the deciding move in its final board', async () => {
  resetProfileBoardCache();
  const roomId = 'xq_profile_repetition';
  const cycle = [
    { from: 'a1', to: 'a2' },
    { from: 'a10', to: 'a9' },
    { from: 'a2', to: 'a1' },
    { from: 'a9', to: 'a10' },
  ];
  const plies = 8;
  const events = [
    ...preamble(roomId, XIANGQI_SPEC_ID),
    ...Array.from({ length: plies }, (_, i) => ({
      type: 'move-played',
      at: 10 + i,
      roomId,
      color: i % 2 === 0 ? 'red' : 'black',
      move: cycle[i % cycle.length],
    })),
  ];
  const boardDeps = await deps({ [roomId]: events });
  const card = boardDeps.cardForRoomId(roomId);
  assert.ok(card && card.layout !== 'match' && card.layout !== 'gomoku');
  const terminalFen = card.fenAtPly(events, roomId, plies);
  assert.ok(terminalFen);
  assert.equal(terminalFen.split(/\s+/)[1], '-');
  const precedingFen = card.fenAtPly(events, roomId, plies - 1);
  assert.ok(precedingFen);
  const preceding = resolvePositionOg(card.variant, precedingFen);
  assert.ok(preceding);

  const [row] = await attachProfileBoards([{ roomId, variant: 'xiangqi' }], boardDeps);
  const board = row?.finalBoard;
  assert.ok(board);
  assert.ok(board.pieces.some(([file, rank, ink]) => file === 0 && rank === 10 && ink === 'black'));
  assert.ok(!board.pieces.some(([file, rank]) => file === 0 && rank === 9));
  assert.notDeepEqual(board, thumbOf(preceding.board));
  const final = resolvePositionOg(card.variant, terminalFen);
  assert.ok(final);
  assert.deepEqual(board, thumbOf(final.board));
});

const generalCaptureMoves = [
  { from: 'h3', to: 'e3' },
  { from: 'e7', to: 'e6' },
  { from: 'e4', to: 'e5' },
  { from: 'e6', to: 'e5' },
  { from: 'e3', to: 'e10' },
];

for (const fixture of [
  { roomId: 'dxq_profile_capture', variant: DARK_XIANGQI_SPEC_ID, moves: generalCaptureMoves },
  {
    roomId: 'dkx_profile_capture',
    variant: DUCK_XIANGQI_SPEC_ID,
    moves: generalCaptureMoves.map((move, i) => ({
      ...move,
      duckTo: i === generalCaptureMoves.length - 1 ? null : i % 2 === 0 ? 'a5' : 'b5',
    })),
  },
  {
    roomId: 'axq_profile_capture',
    variant: ATOMIC_XIANGQI_SPEC_ID,
    moves: [
      // Clear file b, then take the advisor beside the general with a chariot.
      { from: 'b3', to: 'b10' },
      { from: 'b8', to: 'a8' },
      { from: 'a1', to: 'a2' },
      { from: 'a7', to: 'a6' },
      { from: 'a2', to: 'b2' },
      { from: 'a6', to: 'a5' },
      { from: 'b2', to: 'b9' },
      { from: 'c7', to: 'c6' },
      { from: 'b9', to: 'd9' },
      { from: 'c6', to: 'c5' },
      { from: 'd9', to: 'd10' },
    ],
  },
]) {
  test(`${fixture.variant}: a captured general falls back to the preceding board`, async () => {
    resetProfileBoardCache();
    const { roomId, variant, moves } = fixture;
    const events = [
      ...preamble(roomId, variant),
      ...moves.map((move, i) => ({
        type: 'move-played',
        at: 10 + i,
        roomId,
        color: i % 2 === 0 ? 'red' : 'black',
        move,
      })),
    ];
    const boardDeps = await deps({ [roomId]: events });
    const card = boardDeps.cardForRoomId(roomId);
    assert.ok(card && card.layout !== 'match' && card.layout !== 'gomoku');
    const terminalFen = card.fenAtPly(events, roomId, moves.length);
    assert.ok(terminalFen, 'the real tenant replay finishes on the capture');
    assert.ok(!terminalFen.split(' ')[0]?.includes('k'), 'the black general is gone');
    assert.equal(resolvePositionOg(card.variant, terminalFen), null);
    const precedingFen = card.fenAtPly(events, roomId, moves.length - 1);
    assert.ok(precedingFen);
    const preceding = resolvePositionOg(card.variant, precedingFen);
    assert.ok(preceding);

    const rows = await attachProfileBoards([{ roomId, variant }], boardDeps);
    assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
      { roomId, variant, finalBoard: thumbOf(preceding.board) },
    ]);
  });
}

test('a jieqi board says which side a face-down piece is, never what it is', async () => {
  resetProfileBoardCache();
  const rows = await attachProfileBoards(
    [{ roomId: JQ_ROOM, variant: 'jieqi' }],
    await deps({ [JQ_ROOM]: finishedJieqiEvents() }),
  );
  const board = rows[0]?.finalBoard;
  assert.ok(board);
  const marks = new Set(board.pieces.map(([, , mark]) => mark));
  assert.ok(marks.has('red-down') && marks.has('black-down'), 'unmoved pieces stay face-down');
  // The whole payload, serialized: no role, glyph or FEN rides along.
  const wire = JSON.stringify(rows);
  for (const word of [
    'general',
    'advisor',
    'elephant',
    'horse',
    'chariot',
    'cannon',
    'soldier',
    'role',
    'glyph',
    'fen',
  ]) {
    assert.ok(!wire.includes(word), `payload names "${word}"`);
  }
});

test('a game with no drawable position gets null: live log, no card, failed replay', async () => {
  resetProfileBoardCache();
  const loads: string[][] = [];
  const live = [...preamble('xq_live', XIANGQI_SPEC_ID), ...xiangqiMoves('xq_live')];
  const rows = await attachProfileBoards(
    [
      { roomId: 'xq_live', variant: 'xiangqi' },
      { roomId: 'xq_garbage', variant: 'xiangqi' },
      { roomId: 'nope_room', variant: 'xiangqi-mahjong' },
    ],
    await deps({ xq_live: live, xq_garbage: [{ type: 'room-created' }, null] }, loads),
  );
  assert.deepEqual(
    rows.map((row) => row.finalBoard),
    [null, null, null],
  );
  // A room no card or chess replay can draw is never loaded.
  assert.deepEqual(loads, [['xq_live', 'xq_garbage']]);
});

test('boards are cached per room; a failed load caches nothing', async () => {
  resetProfileBoardCache();
  const loads: string[][] = [];
  const good = await deps({ [XQ_ROOM]: finishedXiangqiEvents() }, loads);
  const failing: ProfileBoardDeps = {
    ...good,
    loadRoomsEvents: async () => {
      throw new Error('db down');
    },
  };
  const rows = [{ roomId: XQ_ROOM, variant: 'xiangqi' }];
  assert.equal((await attachProfileBoards(rows, failing))[0]?.finalBoard, null);
  assert.ok((await attachProfileBoards(rows, good))[0]?.finalBoard, 'retried after the failure');
  assert.ok((await attachProfileBoards(rows, good))[0]?.finalBoard);
  assert.equal(loads.length, 1, 'the second read came from the cache');
});

test('every board kind projects: banqi tiles hidden, jungle and chess by ink', () => {
  const banqi = resolvePositionOg('banqi', startPositionFen('banqi'));
  assert.ok(banqi);
  const banqiThumb = thumbOf(banqi.board);
  assert.equal(banqiThumb.shape, 'grid');
  assert.equal(banqiThumb.pieces.length, 32);
  assert.ok(banqiThumb.pieces.every(([, , mark]) => mark === 'hidden'));

  const jungle = resolvePositionOg('jungle', startPositionFen('jungle'));
  assert.ok(jungle);
  const jungleThumb = thumbOf(jungle.board);
  assert.deepEqual([jungleThumb.shape, jungleThumb.files, jungleThumb.ranks], ['jungle', 7, 9]);
  assert.equal(jungleThumb.pieces.length, 16);

  const chess = resolvePositionOg('dark-chess', startPositionFen('dark-chess'));
  assert.ok(chess);
  const chessThumb = thumbOf(chess.board);
  assert.equal(chessThumb.shape, 'chess');
  // Ranks count from 1, as on every other shape: White's back rank is rank 1.
  assert.ok(chessThumb.pieces.some(([f, r, mark]) => f === 4 && r === 1 && mark === 'white'));
  assert.ok(chessThumb.pieces.some(([f, r, mark]) => f === 4 && r === 8 && mark === 'black'));

  const duck = resolvePositionOg('duck-xiangqi', startPositionFen('duck-xiangqi'));
  assert.ok(duck);
  assert.ok(thumbOf(duck.board).pieces.every(([, , mark]) => mark === 'red' || mark === 'black'));
});
