import assert from 'node:assert/strict';
import test from 'node:test';
import {
  jieqiMoveToPikafishUci,
  jieqiStateToDealtFen,
  jieqiStateToPikafishFen,
  parseJieqiFen,
  pikafishUciToJieqiMove,
} from './jieqi-fen.js';
import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  type JieqiColor,
  type JieqiGameState,
  STANDARD_JIEQI_DEAL,
} from './variants-jieqi.js';

// The exact FEN the Pikafish jieqi/jieqi_old binary prints for `position startpos`
// (verified by running the engine). Our encoder must reproduce it byte-for-byte —
// this is the ground-truth check on the whole encoding.
const START_FEN =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';

test('start position matches the Pikafish-jieqi reference FEN exactly', () => {
  assert.equal(jieqiStateToPikafishFen(createInitialJieqiState('t')), START_FEN);
});

test('the board field leaks no dark-piece identity (only X/x, generals, digits)', () => {
  const board = jieqiStateToPikafishFen(createInitialJieqiState('t')).split(' ')[0];
  assert.match(board, /^[0-9XxKk/]+$/);
});

test('different hidden identities with the same public dark board encode the same board field', () => {
  const left = createInitialJieqiState('left');
  const right = createInitialJieqiState('right', {
    red: [...STANDARD_JIEQI_DEAL.red].reverse(),
    black: [...STANDARD_JIEQI_DEAL.black].reverse(),
  });
  const leftBoard = jieqiStateToPikafishFen(left).split(' ')[0];
  const rightBoard = jieqiStateToPikafishFen(right).split(' ')[0];
  assert.equal(leftBoard, rightBoard);
});

test('revealing a piece sets its role char and decrements the hidden pool', () => {
  // Standard deal: a1 is a corner chariot. Red moves it a1->a2, revealing it.
  let state = createInitialJieqiState('t');
  state = applyJieqiMove(state, { from: 'a1', to: 'a2' });
  const [board, stm, rest, clock, full] = jieqiStateToPikafishFen(state).split(' ');
  assert.ok(board.includes('R'), `expected a revealed red chariot in: ${board}`);
  assert.ok(rest.startsWith('R1A2C2P5N2B2'), `red hidden pool not decremented: ${rest}`);
  assert.equal(stm, 'b'); // black to move
  assert.equal(clock, '1'); // one ply since the last capture
  assert.equal(full, '1'); // still move 1 (full move increments after black)
});

test('move <-> Pikafish UCI round-trips with the rank-1 <-> rank-0 offset', () => {
  assert.equal(jieqiMoveToPikafishUci({ from: 'a1', to: 'a2' }), 'a0a1');
  assert.equal(jieqiMoveToPikafishUci({ from: 'e10', to: 'e9' }), 'e9e8');
  assert.deepEqual(pikafishUciToJieqiMove('a0a1'), { from: 'a1', to: 'a2' });
  assert.deepEqual(pikafishUciToJieqiMove('e9e8'), { from: 'e10', to: 'e9' });
  assert.equal(pikafishUciToJieqiMove('nope'), null);
});

test('the viewer never learns which of its own dark pieces were captured', () => {
  // Black takes red's face-down b1 piece. Truth and black (the capturer) drop
  // that identity from red's pool; red's own FEN keeps it, because under
  // capturer-only reveal red was never told what it lost.
  const state = createInitialJieqiState('t');
  const victim = state.board.b1;
  assert.ok(victim?.faceDown && victim.color === 'red');
  const board = { ...state.board };
  delete board.b1;
  const captured = {
    ...state,
    board,
    captures: [{ owner: 'red' as const, role: victim.role, revealedAtCapture: false }],
  };
  const pool = (fen: string): string => fen.split(' ')[2]!;
  const before = pool(jieqiStateToPikafishFen(state));
  assert.equal(before, pool(jieqiStateToPikafishFen(state, { viewer: 'red' })));
  assert.equal(before, pool(jieqiStateToPikafishFen(state, { viewer: 'black' })));

  const truth = pool(jieqiStateToPikafishFen(captured));
  assert.equal(truth, pool(jieqiStateToPikafishFen(captured, { viewer: 'black' })));
  assert.notEqual(truth, before);
  assert.equal(pool(jieqiStateToPikafishFen(captured, { viewer: 'red' })), before);
});

// Pool counts per side from a FEN's restPieces field, e.g. { red: { R: 2, ... }, black: { r: 2 } }.
function poolCounts(fen: string): Record<JieqiColor, Record<string, number>> {
  const out: Record<JieqiColor, Record<string, number>> = { red: {}, black: {} };
  for (const [, ch, n] of fen.split(' ')[2]!.matchAll(/([A-Za-z])(\d+)/g)) {
    out[ch === ch!.toUpperCase() ? 'red' : 'black'][ch!.toUpperCase()] = Number(n);
  }
  return out;
}

const POOL_CHAR: Record<string, string> = {
  chariot: 'R',
  advisor: 'A',
  cannon: 'C',
  soldier: 'P',
  horse: 'N',
  elephant: 'B',
};

test('a seat’s view differs from the all-knowing FEN by exactly its own dark pieces captured face-down', () => {
  // A real kernel game that keeps capturing face-down pieces on both sides (seeded, so
  // deterministic). At every ply, for each viewer: the opponent's pool is the truth (the viewer
  // captured those pieces and saw them), and its own pool is the truth plus each of its own
  // pieces the opponent took while still dark. Board, side to move and clocks never differ.
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let state: JieqiGameState = createInitialJieqiState('t', STANDARD_JIEQI_DEAL);
  const darkCaptures: Record<JieqiColor, number> = { red: 0, black: 0 };
  for (let ply = 0; ply < 160 && state.status.type === 'playing'; ply += 1) {
    const truth = jieqiStateToPikafishFen(state);
    for (const viewer of ['red', 'black'] as const) {
      const seen = jieqiStateToPikafishFen(state, { viewer });
      const opponent: JieqiColor = viewer === 'red' ? 'black' : 'red';
      assert.deepEqual(
        seen.split(' ').filter((_, i) => i !== 2),
        truth.split(' ').filter((_, i) => i !== 2),
      );
      const expected = poolCounts(truth);
      for (const c of state.captures) {
        if (c.owner === viewer && !c.revealedAtCapture) {
          const ch = POOL_CHAR[c.role]!;
          expected[viewer][ch] = (expected[viewer][ch] ?? 0) + 1;
        }
      }
      const got = poolCounts(seen);
      assert.deepEqual(got[opponent], poolCounts(truth)[opponent], `ply ${ply} ${viewer}`);
      assert.deepEqual(got[viewer], expected[viewer], `ply ${ply} ${viewer}`);
    }
    const legal = getJieqiLegalMoves(state);
    const darkTakes = legal.filter((m) => state.board[m.to]?.faceDown === true);
    const pick = darkTakes.length > 0 && rand() < 0.8 ? darkTakes : legal;
    const move = pick[Math.floor(rand() * pick.length)]!;
    const target = state.board[move.to];
    if (target?.faceDown) darkCaptures[target.color] += 1;
    state = applyJieqiMove(state, move);
  }
  // The walk exercised both directions, so the per-side assertions above were not vacuous.
  assert.ok(darkCaptures.red > 0 && darkCaptures.black > 0, JSON.stringify(darkCaptures));
});

// Imported games (apps/server/src/engine-match-import.ts) carry pieces whose
// identity the source never determined. The dealt FEN writes them as `?`, and
// parsing a `?` samples from what the pool has left while keeping the piece
// unknown, so a round trip never turns a draw into a stated identity.
test('dealt FEN writes never-determined pieces as ? and keeps them unknown on parse', () => {
  const deal = {
    ...STANDARD_JIEQI_DEAL,
    undetermined: { red: ['a1', 'b3'] as const, black: ['i10'] as const },
  };
  const state = createInitialJieqiState('fen-unknown', {
    red: deal.red,
    black: deal.black,
    undetermined: { red: [...deal.undetermined.red], black: [...deal.undetermined.black] },
  });
  const dealt = jieqiStateToDealtFen(state);
  const hidden = dealt.split(' ')[5]!;
  assert.equal([...hidden].filter((ch) => ch === '?').length, 3);
  // No role letter stands where an unknown piece sits: 30 dark pieces, 27 named.
  assert.equal(hidden.replace(/\?/g, '').length, 27);

  const parsed = parseJieqiFen(dealt, { rng: () => 0.5 });
  assert.ok(parsed.ok);
  assert.equal(parsed.sampled, true);
  assert.equal(parsed.state.board.a1?.unknown, true);
  assert.equal(parsed.state.board.i10?.unknown, true);
  assert.equal(parsed.state.board.c1?.unknown, undefined);
  assert.equal(jieqiStateToDealtFen(parsed.state), dealt);

  // A ? never unlocks more pieces than the pool holds.
  const tooMany = dealt.replace(/ [^ ]+$/, ` ${'?'.repeat(31)}`);
  assert.equal(parseJieqiFen(tooMany).ok, false);
});
