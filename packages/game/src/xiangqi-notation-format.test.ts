import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialXiangqiState, type XiangqiMove } from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
} from './variants-xiangqi-standard.js';
import { importXiangqiGame, resolveXiangqiMoveInFormat } from './xiangqi-import.js';
import {
  describeXiangqiRelativeMove,
  formatXiangqiAlgebraicMove,
  formatXiangqiMove,
  formatXiangqiMoves,
  formatXiangqiRelativeMove,
  type XiangqiRelativeStyle,
} from './xiangqi-notation-format.js';
import { parseStandardXiangqiFen } from './xiangqi-position.js';
import {
  parseChineseToken,
  parseWxfToken,
  resolveRelativeMove,
} from './xiangqi-relative-notation.js';

function stateFromFen(fen: string) {
  const parsed = parseStandardXiangqiFen(fen);
  assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
  if (!parsed.ok) throw new Error('unreachable');
  return parsed.state;
}

// Anchors from the documented opening (h3e3 = C2.5, h1g3 = H2+3).
test('formats the classic opening moves in every style', () => {
  const initial = createInitialXiangqiState('t');
  const cannon: XiangqiMove = { from: 'h3', to: 'e3' };

  assert.equal(formatXiangqiMove(initial, cannon, 'coordinate'), 'h3-e3');
  assert.equal(formatXiangqiMove(initial, cannon, 'iccs'), 'h2e2');
  // Both cannons can reach e3 from the opening, so chess-style origin file.
  assert.equal(formatXiangqiMove(initial, cannon, 'algebraic'), 'Che3');
  assert.equal(formatXiangqiMove(initial, cannon, 'wxf'), 'C2.5');
  assert.equal(formatXiangqiMove(initial, cannon, 'chinese-simplified'), '炮二平五');
  assert.equal(formatXiangqiMove(initial, cannon, 'chinese-traditional'), '炮二平五');

  const horse: XiangqiMove = { from: 'h1', to: 'g3' };
  assert.equal(formatXiangqiMove(initial, horse, 'algebraic'), 'Hg3');
  assert.equal(formatXiangqiMove(initial, horse, 'wxf'), 'H2+3');
  assert.equal(formatXiangqiMove(initial, horse, 'chinese-simplified'), '马二进三');
  assert.equal(formatXiangqiMove(initial, horse, 'chinese-traditional'), '馬二進三');
});

test('black moves use Arabic numerals and black glyphs', () => {
  const afterCannon = applyStandardXiangqiMove(createInitialXiangqiState('t'), {
    from: 'h3',
    to: 'e3',
  });
  // Black counts files 1-9 from its own right: h10 is black file 8, g8 file 7.
  const reply: XiangqiMove = { from: 'h10', to: 'g8' };
  assert.equal(formatXiangqiMove(afterCannon, reply, 'wxf'), 'H8+7');
  assert.equal(formatXiangqiMove(afterCannon, reply, 'chinese-simplified'), '马8进7');
  assert.equal(formatXiangqiMove(afterCannon, reply, 'chinese-traditional'), '馬8進7');
});

test('formats a whole line, alternating colors', () => {
  const moves: XiangqiMove[] = [
    { from: 'h3', to: 'e3' },
    { from: 'h10', to: 'g8' },
    { from: 'h1', to: 'g3' },
  ];
  assert.deepEqual(formatXiangqiMoves(moves, 'chinese-simplified'), [
    '炮二平五',
    '马8进7',
    '马二进三',
  ]);
  assert.deepEqual(formatXiangqiMoves(moves, 'wxf'), ['C2.5', 'H8+7', 'H2+3']);
  assert.deepEqual(formatXiangqiMoves(moves, 'iccs'), ['h2e2', 'h9g7', 'h0g2']);
});

// Two red chariots stacked on file h (red file 2): front/rear selectors.
const TANDEM_CHARIOTS = '3k5/9/9/9/9/7R1/9/7R1/9/4K4 r';

test('stacked pieces take front/rear tandem selectors', () => {
  const state = stateFromFen(TANDEM_CHARIOTS);

  const front: XiangqiMove = { from: 'h5', to: 'h7' };
  assert.equal(formatXiangqiMove(state, front, 'wxf'), '+R+2');
  assert.equal(formatXiangqiMove(state, front, 'chinese-simplified'), '前车进二');
  assert.equal(formatXiangqiMove(state, front, 'chinese-traditional'), '前車進二');

  const rearRetreat: XiangqiMove = { from: 'h3', to: 'h1' };
  assert.equal(formatXiangqiMove(state, rearRetreat, 'wxf'), '-R-2');
  assert.equal(formatXiangqiMove(state, rearRetreat, 'chinese-simplified'), '后车退二');
  assert.equal(formatXiangqiMove(state, rearRetreat, 'chinese-traditional'), '後車退二');

  const frontTraverse: XiangqiMove = { from: 'h5', to: 'e5' };
  assert.equal(formatXiangqiMove(state, frontTraverse, 'wxf'), '+R.5');
  assert.equal(formatXiangqiMove(state, frontTraverse, 'chinese-simplified'), '前车平五');
});

test('middle of a three-stack falls back to coordinate (grammar has no 中)', () => {
  // Three red soldiers stacked on file h, all across the river (a red soldier
  // on its own half off a starting file is unreachable and the FEN parser
  // rejects it); the middle one moves sideways.
  const state = stateFromFen('3k5/9/7P1/7P1/7P1/9/9/9/9/4K4 r');

  const middle: XiangqiMove = { from: 'h7', to: 'g7' };
  assert.equal(describeXiangqiRelativeMove(state, middle), null);
  assert.equal(formatXiangqiMove(state, middle, 'chinese-simplified'), 'h7-g7');

  const front: XiangqiMove = { from: 'h8', to: 'g8' };
  assert.equal(formatXiangqiMove(state, front, 'wxf'), '+P.3');
  assert.equal(formatXiangqiMove(state, front, 'chinese-simplified'), '前兵平三');
});

test('two stacked files of the same role fall back to coordinate', () => {
  // Soldier pairs on files d and f: the fileless tandem form is ambiguous.
  const state = stateFromFen('3k5/9/9/3P1P3/3P1P3/9/9/9/9/4K4 r');
  const move: XiangqiMove = { from: 'd7', to: 'd8' };
  assert.equal(describeXiangqiRelativeMove(state, move), null);
  assert.equal(formatXiangqiMove(state, move, 'wxf'), 'd7-d8');
});

test('formatXiangqiMoves degrades to coordinate labels after an illegal move', () => {
  const labels = formatXiangqiMoves(
    [
      { from: 'h3', to: 'e3' },
      { from: 'a1', to: 'a9' }, // illegal: runs through pieces
      { from: 'h10', to: 'g8' },
    ],
    'chinese-simplified',
  );
  assert.deepEqual(labels, ['炮二平五', 'a1-a9', 'h10-g8']);
});

// --- round-trip properties ---------------------------------------------------

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomPlayout(seed: number, maxPlies: number): XiangqiMove[] {
  const rand = lcg(seed);
  let state = createInitialXiangqiState(`playout-${seed}`);
  const moves: XiangqiMove[] = [];
  for (let ply = 0; ply < maxPlies; ply += 1) {
    if (state.status.type !== 'playing') break;
    const legal = getStandardXiangqiLegalMoves(state);
    if (legal.length === 0) break;
    const move = legal[Math.floor(rand() * legal.length)]!;
    moves.push(move);
    state = applyStandardXiangqiMove(state, move);
  }
  return moves;
}

const COORDINATE_LABEL = /^[a-i](?:10|[1-9])-[a-i](?:10|[1-9])$/;

test('random games round-trip through the importer in every relative style', () => {
  const styles: { style: XiangqiRelativeStyle; expectFormat: 'wxf' | 'chinese' }[] = [
    { style: 'wxf', expectFormat: 'wxf' },
    { style: 'chinese-simplified', expectFormat: 'chinese' },
    { style: 'chinese-traditional', expectFormat: 'chinese' },
  ];

  let roundTripped = 0;
  for (let seed = 1; seed <= 15; seed += 1) {
    const moves = randomPlayout(seed * 7919, 100);
    assert.ok(moves.length > 0);

    for (const { style, expectFormat } of styles) {
      const labels = formatXiangqiMoves(moves, style);
      // Fallbacks only happen for grammar-inexpressible soldier stacks; a
      // record containing one cannot re-import as a single notation, so skip
      // the whole-record assertion for that game/style.
      if (labels.some((label) => COORDINATE_LABEL.test(label))) continue;
      const imported = importXiangqiGame(labels.join(' '));
      assert.equal(imported.error, undefined, `${style} seed ${seed}: ${imported.error}`);
      assert.equal(imported.format, expectFormat);
      assert.deepEqual(imported.moves, moves, `${style} seed ${seed}`);
      roundTripped += 1;
    }
  }
  // The fallback escape hatch above must stay the exception, not the rule.
  assert.ok(roundTripped >= 40, `only ${roundTripped} of 45 game/style records round-tripped`);
});

// Algebraic is the chess reader's notation: piece letter + destination, `x` on
// capture, origin only when two pieces of the role can reach the square.
test('algebraic marks captures, checks and mate', () => {
  const initial = createInitialXiangqiState('t');
  // 1. Che3 Hc8 2. Cxe7: the central cannon jumps its own e4 soldier to take
  // the black centre soldier. No check: nothing screens e7 from e10 afterward.
  let state = applyStandardXiangqiMove(initial, { from: 'h3', to: 'e3' });
  state = applyStandardXiangqiMove(state, { from: 'b10', to: 'c8' });
  assert.ok(state.board.e7, 'black centre soldier stands on e7');
  assert.equal(formatXiangqiMove(state, { from: 'e3', to: 'e7' }, 'algebraic'), 'Cxe7');

  // Chariot to the back rank: check, with e9 still open to the general.
  const checkState = stateFromFen('4k4/9/9/9/9/9/9/9/9/R4K3 r');
  assert.equal(formatXiangqiAlgebraicMove(checkState, { from: 'a1', to: 'a10' }), 'Ra10+');
  // The same with a second chariot holding rank 9: mate.
  const mateState = stateFromFen('4k4/7R1/9/9/9/9/9/9/9/R4K3 r');
  assert.equal(formatXiangqiAlgebraicMove(mateState, { from: 'a1', to: 'a10' }), 'Ra10#');
});

test('algebraic disambiguates by file, then rank, then square, and parses back', () => {
  // Two red chariots on the second rank can both reach d2: name the file.
  const twoChariotsRank = stateFromFen('4k4/9/9/9/9/9/9/9/R7R/5K3 r');
  assert.equal(formatXiangqiAlgebraicMove(twoChariotsRank, { from: 'a2', to: 'd2' }), 'Rad2');
  // Two red chariots on one file: the rank settles it.
  const twoChariotsFile = stateFromFen('4k4/9/9/9/9/9/9/R8/9/R4K3 r');
  assert.equal(formatXiangqiAlgebraicMove(twoChariotsFile, { from: 'a1', to: 'a2' }), 'R1a2');
  // Every formatted token resolves back to its own move.
  for (const [state, move] of [
    [twoChariotsRank, { from: 'a2', to: 'd2' }],
    [twoChariotsFile, { from: 'a1', to: 'a2' }],
    [twoChariotsFile, { from: 'a3', to: 'a2' }],
  ] as const) {
    const token = formatXiangqiAlgebraicMove(state, move);
    assert.ok(token, 'formatted');
    assert.deepEqual(resolveXiangqiMoveInFormat(token!, state, 'algebraic'), move, token!);
  }
  // A token that names two moves is refused, never guessed.
  assert.equal(resolveXiangqiMoveInFormat('Rd2', twoChariotsRank, 'algebraic'), null);
});

test('random games round-trip through the importer in algebraic', () => {
  for (let seed = 1; seed <= 8; seed += 1) {
    const moves = randomPlayout(seed * 7919 + 13, 100);
    const labels = formatXiangqiMoves(moves, 'algebraic');
    assert.ok(
      labels.every((label) => !COORDINATE_LABEL.test(label)),
      `seed ${seed}: algebraic fell back to coordinate`,
    );
    const imported = importXiangqiGame(labels.join(' '));
    assert.equal(imported.error, undefined, `seed ${seed}: ${imported.error}`);
    assert.equal(imported.format, 'algebraic');
    assert.deepEqual(imported.moves, moves, `seed ${seed}`);
  }
});

test('random games round-trip through the importer in coordinate and ICCS', () => {
  for (let seed = 1; seed <= 5; seed += 1) {
    const moves = randomPlayout(seed * 104729, 80);
    for (const [style, expectFormat] of [
      ['coordinate', 'coordinate'],
      ['iccs', 'uci-0indexed'],
    ] as const) {
      const imported = importXiangqiGame(formatXiangqiMoves(moves, style).join(' '));
      assert.equal(imported.error, undefined, `${style} seed ${seed}: ${imported.error}`);
      assert.equal(imported.format, expectFormat);
      assert.deepEqual(imported.moves, moves);
    }
  }
});

test('every formatted token parses back to the same move at its own position', () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    const rand = lcg(seed * 31337);
    let state = createInitialXiangqiState(`grammar-${seed}`);
    for (let ply = 0; ply < 80; ply += 1) {
      if (state.status.type !== 'playing') break;
      const legal = getStandardXiangqiLegalMoves(state);
      if (legal.length === 0) break;
      // Check the grammar inverse for EVERY legal move at this position, not
      // just the played one — this is where tandem/stack edge cases live.
      for (const move of legal) {
        const wxf = formatXiangqiRelativeMove(state, move, 'wxf');
        if (wxf !== null) {
          const resolved = resolveRelativeMove(state, parseWxfToken(wxf)!);
          assert.deepEqual(resolved, move, `wxf ${wxf}`);
        }
        for (const style of ['chinese-simplified', 'chinese-traditional'] as const) {
          const label = formatXiangqiRelativeMove(state, move, style);
          if (label === null) continue;
          const spec = parseChineseToken(label);
          assert.ok(spec, `token ${label} did not parse`);
          assert.deepEqual(resolveRelativeMove(state, spec!), move, `${style} ${label}`);
        }
      }
      const move = legal[Math.floor(rand() * legal.length)]!;
      state = applyStandardXiangqiMove(state, move);
    }
  }
});

// A study chapter, an endgame, or a composed problem does not begin at the
// opening. Replaying its line from a board of 32 pieces makes move 1 illegal, so
// every label fell out to the coordinate branch below -- output that looks like
// working notation and carries none of the piece information notation is for.
const ENDGAME_FEN = '5c3/5k3/9/3n5/9/R8/9/9/9/4K4 r - - 0 1';

test('formatXiangqiMoves notates a line that starts away from the opening', () => {
  const moves: XiangqiMove[] = [
    { from: 'a5', to: 'a9' },
    { from: 'f9', to: 'f8' },
  ];
  const start = stateFromFen(ENDGAME_FEN);

  assert.deepEqual(formatXiangqiMoves(moves, 'wxf', start), ['R9+4', 'K6+1']);
  assert.deepEqual(formatXiangqiMoves(moves, 'chinese-traditional', start), ['車九進四', '將6進1']);

  // Without the start position the same line is illegal from ply 1.
  assert.deepEqual(formatXiangqiMoves(moves, 'wxf'), ['a5-a9', 'f9-f8']);
});

test('formatXiangqiMoves notates a line whose start position has Black to move', () => {
  const start = stateFromFen(ENDGAME_FEN.replace(' r ', ' b '));
  const labels = formatXiangqiMoves([{ from: 'f9', to: 'f8' }], 'wxf', start);
  assert.deepEqual(labels, ['K6+1']);
});
