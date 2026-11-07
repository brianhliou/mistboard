import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialXiangqiState, initialStartFen, standardXiangqiFen } from '@mistboard/game';
import { STUDY_PREVIEW_PLIES, studyPreviewBoard } from './study-preview-board.js';

const START_FEN = standardXiangqiFen(createInitialXiangqiState('t'));

/** The grid's rows, top rank first, for readable assertions. */
function rows(board: ReturnType<typeof studyPreviewBoard>): string[] {
  const grid = board?.grid;
  assert.ok(grid, 'a grid was derived');
  assert.equal(grid.cells.length, grid.files * grid.ranks);
  const out: string[] = [];
  for (let r = 0; r < grid.ranks; r += 1)
    out.push(grid.cells.slice(r * grid.files, (r + 1) * grid.files));
  return out;
}

test('a composition draws its own rootFen, untouched by the mainline', () => {
  const board = studyPreviewBoard({
    variant: 'xiangqi',
    rootFen: '3k5/4a4/3a5/9/9/9/9/3A1K3/9/3C5 r - - 0 1',
    mainline: ['d1d2'],
  });
  assert.equal(board?.fen, '3k5/4a4/3a5/9/9/9/9/3A1K3/9/3C5 r - - 0 1');
  assert.deepEqual(rows(board), [
    '...b.....',
    '....b....',
    '...b.....',
    '.........',
    '.........',
    '.........',
    '.........',
    '...r.r...',
    '.........',
    '...r.....',
  ]);
});

test('a game from the standard start draws the position after the preview plies', () => {
  // Central cannon vs screen horse, eight plies in; every collection then shows
  // its own opening rather than the shared start array.
  const mainline = ['h3e3', 'h10g8', 'h1g3', 'b10c8', 'i1h1', 'i10h10', 'c4c5', 'g7g6', 'b3b5'];
  const board = studyPreviewBoard({ variant: 'xiangqi', rootFen: null, mainline });
  assert.ok(board?.fen);
  assert.notEqual(board.fen, START_FEN);
  assert.equal(
    board.fen.split(' ')[0],
    'r1bakabr1/9/1cn3nc1/p1p1p3p/6p2/2P6/P3P1P1P/1C2C1N2/9/RNBAKABR1',
  );
  assert.equal(rows(board)[0], 'b.bbbbbb.');
  assert.equal(mainline.length, STUDY_PREVIEW_PLIES + 1, 'fixture covers the cut-off');
});

test('replay stops at the first illegal ply and keeps the board reached', () => {
  const board = studyPreviewBoard({
    variant: 'xiangqi',
    rootFen: null,
    mainline: ['h3e3', 'a1a9', 'h10g8'],
  });
  assert.equal(
    board?.fen?.split(' ')[0],
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR',
  );
});

test('an empty mainline from the standard start is the standard start', () => {
  assert.equal(
    studyPreviewBoard({ variant: 'xiangqi', rootFen: null, mainline: [] })?.fen,
    START_FEN,
  );
});

test('an unparseable rootFen is a failure, not a fall-through to the start', () => {
  assert.deepEqual(studyPreviewBoard({ variant: 'xiangqi', rootFen: 'not a fen', mainline: [] }), {
    variant: 'xiangqi',
    fen: null,
    grid: null,
  });
  for (const variant of [
    'jieqi',
    'banqi',
    'jungle',
    'chess',
    'duck-xiangqi',
    'three-kingdoms-banqi',
  ]) {
    assert.equal(
      studyPreviewBoard({ variant, rootFen: 'not a fen', mainline: [] })?.grid,
      null,
      variant,
    );
  }
});

// One case per variant that derives a board beyond plain xiangqi (#710): its
// shape, its size, and a row that only that variant's position has. Only plain
// xiangqi carries a FEN; every other variant ships the disc grid alone.
const derived: {
  variant: string;
  rootFen: string | null;
  shape: string;
  size: [files: number, ranks: number];
  row: [index: number, cells: string];
  mainline?: string[];
}[] = [
  {
    // Fog xiangqi replays like xiangqi and tolerates an exposed general.
    variant: 'dark-xiangqi',
    rootFen: null,
    mainline: ['h3e3'],
    shape: 'xiangqi',
    size: [9, 10],
    row: [7, '.r..r....'],
  },
  {
    variant: 'atomic-xiangqi',
    rootFen: '3k5/9/9/9/9/9/9/9/9/4K3R r - - 0 1',
    shape: 'xiangqi',
    size: [9, 10],
    row: [9, '....r...r'],
  },
  {
    // The board only: crazyhouse xiangqi's hands are not drawn.
    variant: 'crazyhouse-xiangqi',
    rootFen: null,
    shape: 'xiangqi',
    size: [9, 10],
    row: [0, 'bb..b..bb'],
  },
  {
    // The duck is its own mark, on its own point.
    variant: 'duck-xiangqi',
    rootFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1 e5',
    shape: 'xiangqi',
    size: [9, 10],
    row: [5, '....d....'],
  },
  {
    // Face-down jieqi pieces keep their side, which the FEN shows; generals are up.
    variant: 'jieqi',
    rootFen: initialStartFen('jieqi', () => 0.3),
    shape: 'xiangqi',
    size: [9, 10],
    row: [9, 'RRRRrRRRR'],
  },
  {
    variant: 'fortress-xiangqi',
    rootFen: null,
    shape: 'fortress',
    size: [7, 8],
    row: [1, 'bb.b.bb'],
  },
  {
    variant: 'chess',
    rootFen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
    shape: 'chess',
    size: [8, 8],
    row: [6, '....r...'],
  },
  {
    variant: 'dark-chess',
    rootFen: null,
    shape: 'chess',
    size: [8, 8],
    row: [0, 'bbbbbbbb'],
  },
  { variant: 'jungle', rootFen: null, shape: 'jungle', size: [7, 9], row: [0, 'b.....b'] },
  {
    // Banqi tiles face down carry no colour; face-up ones do.
    variant: 'banqi',
    rootFen: '8/8/2X5/G4Xc1 r R1s1 0 1 Rs',
    shape: 'banqi',
    size: [8, 4],
    row: [3, 'r....?b.'],
  },
  {
    variant: 'jungle-flip',
    rootFen: initialStartFen('jungle-flip', () => 0.3),
    shape: 'jungle-flip',
    size: [4, 4],
    row: [0, '????'],
  },
  {
    // Three Kingdoms banqi (#628): a 9x5 point board; file e and rank 3 start
    // empty, every other point a face-down tile with no colour.
    variant: 'three-kingdoms-banqi',
    rootFen: initialStartFen('three-kingdoms-banqi', () => 0.3),
    shape: 'three-kingdoms-banqi',
    size: [9, 5],
    row: [0, '????.????'],
  },
  {
    variant: 'three-kingdoms-banqi',
    rootFen: '9/9/2X6/9/G4Xc2 r R1s1 0 1 Rs',
    shape: 'three-kingdoms-banqi',
    size: [9, 5],
    row: [4, 'r....?b..'],
  },
];

for (const c of derived) {
  test(`${c.variant} derives a ${c.shape} board`, () => {
    const board = studyPreviewBoard({
      variant: c.variant,
      rootFen: c.rootFen,
      mainline: c.mainline ?? [],
    });
    assert.equal(board?.variant, c.variant);
    assert.equal(board?.fen, null, 'only plain xiangqi ships a FEN');
    assert.equal(board?.grid?.shape, c.shape);
    assert.deepEqual([board?.grid?.files, board?.grid?.ranks], c.size);
    assert.equal(rows(board)[c.row[0]], c.row[1]);
  });
}

test('a face-down piece stays face down in the preview payload, whatever lies under it', () => {
  // A dealt root pins each hidden identity in its sixth field. Swapping two
  // hidden pieces must not change one byte of what the list API sends, and the
  // payload must never carry the deal or a role.
  const pairs: [variant: string, a: string, b: string][] = [
    ['jieqi', '4k4/9/9/9/9/9/9/9/9/2XXK4 w A1B1 0 1 AB', '4k4/9/9/9/9/9/9/9/9/2XXK4 w A1B1 0 1 BA'],
    // Banqi hides a face-down tile's colour too: a red under one tile and a
    // black under the other read the same as the reverse.
    ['banqi', '8/8/2X5/G4Xc1 r R1s1 0 1 Rs', '8/8/2X5/G4Xc1 r R1s1 0 1 sR'],
    [
      'jungle-flip',
      'XXXX/XXXX/XXXX/XXXX - R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 0 WlePDdwpTCErcLRt',
      'XXXX/XXXX/XXXX/XXXX - R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 0 lWePDdwpTCErcLRt',
    ],
    ['three-kingdoms-banqi', '9/9/2X6/9/G4Xc2 r R1s1 0 1 Rs', '9/9/2X6/9/G4Xc2 r R1s1 0 1 sR'],
  ];
  for (const [variant, a, b] of pairs) {
    const left = JSON.stringify(studyPreviewBoard({ variant, rootFen: a, mainline: [] }));
    const right = JSON.stringify(studyPreviewBoard({ variant, rootFen: b, mainline: [] }));
    assert.equal(left, right, `${variant}: the hidden assignment changed the payload`);
    const payload = JSON.parse(left) as { fen: unknown; grid: { cells: string } };
    assert.equal(payload.fen, null, `${variant}: no FEN, so no sixth field`);
    assert.match(payload.grid.cells, /^[.rbRB?d]+$/, `${variant}: discs only, no roles`);
    assert.doesNotMatch(left, new RegExp(a.split(' ')[5] ?? '^$'), `${variant}: deal leaked`);
  }
  // Every jieqi piece but the generals starts face down: no face-up disc on a
  // home square the deal fills.
  const start = studyPreviewBoard({
    variant: 'jieqi',
    rootFen: initialStartFen('jieqi', () => 0.7),
    mainline: [],
  });
  assert.equal(rows(start)[0], 'BBBBbBBBB');
});

test('dispatch is fail-closed: an unknown variant gets no board, never another variant', () => {
  for (const variant of ['mahjong', 'xiangqi-mahjong', 'not-a-variant', 'Xiangqi', '']) {
    assert.deepEqual(
      studyPreviewBoard({ variant, rootFen: null, mainline: ['h3e3'] }),
      { variant, fen: null, grid: null },
      variant,
    );
  }
  assert.equal(studyPreviewBoard(null), null);
  assert.equal(studyPreviewBoard({ rootFen: null }), null);
});
