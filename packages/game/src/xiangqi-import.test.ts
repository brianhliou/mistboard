import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialXiangqiBoard,
  createInitialXiangqiState,
  squareOf,
  type XiangqiBoard,
  type XiangqiMove,
} from './variants-xiangqi.js';
import { applyStandardXiangqiMove } from './variants-xiangqi-standard.js';
import { importXiangqiGame, xiangqiBoardFromDhtmlxqBinit } from './xiangqi-import.js';
import { formatXiangqiMoves } from './xiangqi-notation-format.js';

test('importXiangqiGame reads native coordinate notation', () => {
  const result = importXiangqiGame('h3e3 h8e8 h1g3');
  assert.equal(result.error, undefined);
  assert.equal(result.format, 'coordinate');
  assert.deepEqual(result.moves, [
    { from: 'h3', to: 'e3' },
    { from: 'h8', to: 'e8' },
    { from: 'h1', to: 'g3' },
  ]);
});

test('importXiangqiGame reads Chinese relative notation', () => {
  const result = importXiangqiGame('炮二平五 炮8平5 马二进三');
  assert.equal(result.error, undefined);
  assert.equal(result.format, 'chinese');
  assert.deepEqual(result.moves, [
    { from: 'h3', to: 'e3' },
    { from: 'h8', to: 'e8' },
    { from: 'h1', to: 'g3' },
  ]);
});

test('importXiangqiGame rejects an illegal game', () => {
  const result = importXiangqiGame('b1b2');
  assert.equal(result.format, null);
  assert.match(result.error ?? '', /not legal/);
});

test('importXiangqiGame resolves red front/rear tandem selectors', () => {
  // 炮八平五 stacks red cannons on the e-file (e7 + e3); 前 picks the one
  // nearest the enemy (e7), 后 the rear (e3).
  const base = '炮二平五 马8进7 炮五进四 马2进3 炮八平五 车9平8';
  const front = importXiangqiGame(`${base} 前炮退一`);
  assert.equal(front.error, undefined);
  assert.deepEqual(front.moves.at(-1), { from: 'e7', to: 'e6' });
  const rear = importXiangqiGame(`${base} 后炮平四`);
  assert.equal(rear.error, undefined);
  assert.deepEqual(rear.moves.at(-1), { from: 'e3', to: 'f3' });
});

test('importXiangqiGame orders black tandem front toward red', () => {
  // Black cannons stacked at e4 + e8: front for black is the LOWER rank (e4),
  // and black's 退 moves toward higher ranks.
  const result = importXiangqiGame(
    '炮二平五 炮8平5 马二进三 炮5进4 仕四进五 炮2平5 马八进七 前炮退二',
  );
  assert.equal(result.error, undefined);
  assert.deepEqual(result.moves.at(-1), { from: 'e4', to: 'e6' });
});

test('importXiangqiGame resolves the WXF tandem token', () => {
  const result = importXiangqiGame('C2.5 H8+7 C5+4 H2+3 C8.5 R9.8 +C-1');
  assert.equal(result.error, undefined);
  assert.equal(result.format, 'wxf');
  assert.deepEqual(result.moves.at(-1), { from: 'e7', to: 'e6' });
});

test('importXiangqiGame reads woodblock-style records (包, 。, capture glosses)', () => {
  // Classical manuals write the black cannon 包, separate moves with 。, and
  // interleave capture glosses (卒去) with the move text.
  const woodblock = importXiangqiGame('炮二平五。包8平5。马二进三。');
  assert.equal(woodblock.error, undefined);
  assert.deepEqual(woodblock.moves, [
    { from: 'h3', to: 'e3' },
    { from: 'h8', to: 'e8' },
    { from: 'h1', to: 'g3' },
  ]);
  const glossed = importXiangqiGame('炮二平五。马8进7。炮五进四卒去。马2进3。');
  assert.equal(glossed.error, undefined);
  assert.equal(glossed.moves.length, 4);
  assert.deepEqual(glossed.moves[2], { from: 'e3', to: 'e7' });
});

// Both records are real 適情雅趣 (Elegant Pastime Manual) compositions from
// xqinenglish.com, each paired with its own published solution.
const COMPOSITION_1 = {
  binit: '1171999949999999771247999999999902992041305042993822995899999999',
  movelist: '113130317150415077715041714131301210',
};
const COMPOSITION_2 = {
  binit: '5713999939999999736383999999999908379930404199993342524899999999',
  movelist: '73705250575041506360504160644150133233328343',
};
const STANDARD_BINIT = '0919293949596979891777062646668600102030405060708012720323436383';

test('xiangqiBoardFromDhtmlxqBinit decodes the standard start', () => {
  assert.deepEqual(xiangqiBoardFromDhtmlxqBinit(STANDARD_BINIT), createInitialXiangqiBoard());
});

test('xiangqiBoardFromDhtmlxqBinit accepts the tagged form', () => {
  assert.deepEqual(
    xiangqiBoardFromDhtmlxqBinit(`[DhtmlXQ_binit]${STANDARD_BINIT}[/DhtmlXQ_binit]`),
    createInitialXiangqiBoard(),
  );
});

test("xiangqiBoardFromDhtmlxqBinit treats '99' as off the board", () => {
  const board = xiangqiBoardFromDhtmlxqBinit(COMPOSITION_1.binit);
  assert.equal(Object.keys(board ?? {}).length, 15);
});

test('xiangqiBoardFromDhtmlxqBinit rejects a position missing a general', () => {
  const noRedKing = `${STANDARD_BINIT.slice(0, 8)}99${STANDARD_BINIT.slice(10)}`;
  assert.equal(xiangqiBoardFromDhtmlxqBinit(noRedKing), null);
});

test('xiangqiBoardFromDhtmlxqBinit rejects a malformed binit', () => {
  assert.equal(xiangqiBoardFromDhtmlxqBinit('123'), null);
  assert.equal(xiangqiBoardFromDhtmlxqBinit('x'.repeat(64)), null);
});

for (const [name, record] of [
  ['composition 1', COMPOSITION_1],
  ['composition 2', COMPOSITION_2],
] as const) {
  test(`importXiangqiGame replays ${name} from its own start`, () => {
    const result = importXiangqiGame(
      `[DhtmlXQ_binit]${record.binit}[/DhtmlXQ_binit][DhtmlXQ_movelist]${record.movelist}[/DhtmlXQ_movelist]`,
    );
    assert.equal(result.error, undefined);
    assert.equal(result.format, 'dhtmlxq');
    assert.equal(result.moves.length, record.movelist.length / 4);
    // The whole point: it starts from the composition, not the opening array.
    assert.notDeepEqual(result.initialState?.board, createInitialXiangqiBoard());
  });
}

test('importXiangqiGame keeps the standard start when a record has no binit', () => {
  const result = importXiangqiGame('[DhtmlXQ_movelist]7747724279677062[/DhtmlXQ_movelist]');
  assert.equal(result.format, 'dhtmlxq');
  assert.equal(result.initialState, undefined);
});

// Real dpxq records saved in 06ea99319 (the archive parser fix, refs #377).
// #624: our kernel draws at ply 45 / 173, but the players recorded 61 / 208.
const CONTINUED_RECORDS = [
  {
    id: '141150',
    reason: 'repetition',
    plies: 61,
    digits:
      '2625204217371031192700202735121535271512694770620919636427358081777823242524202478086254355424547967312359482335191535271517812189595459485921234645273517153527151727351715352715172735171535271517273517153527151727351715352715172735171535271517',
  },
  {
    id: '141140',
    reason: 'progress-clock',
    plies: 208,
    digits:
      '2625122277476042190710020919001017135041796763648979726269877051464523242524222919291013072642247971805026341317876920426746626671766665394817167673022147575070735321134544133446655172537334225727221465574344293916565736444527771406777206273937273536155686153486563757565748574152345345555332405032443041574864657271355473745462446350407473838449398485634424027363628171517073636173333949817361713343442541507172524151817352818042607270857580605260706055456064432325376555645475656987656654146656141656468769030416062303372504050616032325442343442502242504430316142442141041300425032325042324041224221204504110132224042342202331242948392922314322274331272131232122234422424463426269870515634462641343151644231617233164343112172759482728123328384373405073535040876920424959383933213431213339295949313233544260536360826323325254335262',
  },
] as const;

for (const record of CONTINUED_RECORDS) {
  const moves: XiangqiMove[] = record.digits.match(/.{4}/g)!.map((token) => ({
    from: squareOf(Number(token[0]), 10 - Number(token[1])),
    to: squareOf(Number(token[2]), 10 - Number(token[3])),
  }));

  test(`importXiangqiGame replays all of dpxq ${record.id} past ${record.reason}`, () => {
    assert.equal(moves.length, record.plies);
    const result = importXiangqiGame(`[DhtmlXQ_movelist]${record.digits}[/DhtmlXQ_movelist]`);
    assert.equal(result.error, undefined);
    assert.equal(result.format, 'dhtmlxq');
    assert.deepEqual(result.moves, moves);
  });

  for (const style of ['coordinate', 'wxf', 'chinese-simplified'] as const) {
    test(`importXiangqiGame replays dpxq ${record.id} pasted as ${style}`, () => {
      const result = importXiangqiGame(formatXiangqiMoves(moves, style).join(' '));
      assert.equal(result.error, undefined);
      assert.deepEqual(result.moves, moves);
    });
  }

  test(`importXiangqiGame resumes dpxq ${record.id} from a Black-to-move start`, () => {
    const initialState = applyStandardXiangqiMove(createInitialXiangqiState('import'), moves[0]!);
    const saved = structuredClone(initialState);
    const result = importXiangqiGame(
      formatXiangqiMoves(moves.slice(1), 'wxf', initialState).join(' '),
      { initialState },
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.moves, moves.slice(1));
    assert.deepEqual(initialState, saved);
  });
}

for (const [reason, board, move] of [
  [
    'checkmate',
    {
      e1: { color: 'red', role: 'general' },
      i5: { color: 'red', role: 'chariot' },
      d8: { color: 'red', role: 'soldier' },
      d10: { color: 'black', role: 'general' },
    },
    { from: 'i5', to: 'i10' },
  ],
  [
    'stalemate',
    {
      e1: { color: 'red', role: 'general' },
      d1: { color: 'red', role: 'chariot' },
      f1: { color: 'red', role: 'chariot' },
      e7: { color: 'red', role: 'soldier' },
      e10: { color: 'black', role: 'general' },
    },
    { from: 'e7', to: 'e8' },
  ],
] as const satisfies readonly [string, XiangqiBoard, XiangqiMove][]) {
  test(`importXiangqiGame rejects moves after ${reason}`, () => {
    const initialState = { ...createInitialXiangqiState('import'), board };
    assert.equal(applyStandardXiangqiMove(initialState, move).status.type, 'finished');
    const line = `${move.from}${move.to}`;
    assert.equal(importXiangqiGame(line, { initialState }).error, undefined);
    const extra = importXiangqiGame(`${line} d10e10`, { initialState });
    assert.equal(extra.format, null);
    assert.match(extra.error ?? '', /^Move 2 /);
  });
}

test('importXiangqiGame still rejects an illegal move after an automatic draw', () => {
  const digits = `${CONTINUED_RECORDS[0].digits.slice(0, 45 * 4)}0000`;
  const result = importXiangqiGame(`[DhtmlXQ_movelist]${digits}[/DhtmlXQ_movelist]`);
  assert.equal(result.format, null);
  assert.match(result.error ?? '', /^Move 46 /);
});
