// Pins the jieqi kernel's legal-move output to a fingerprint of 150 seeded random
// games (38,012 plies): every full legal-move list, one per-square list and one
// legality probe per ply, and each game's final status. #476 rewrote move
// validation and mate detection for speed; this proves the output did not move.
// A deliberate rules change updates the fingerprint in the same commit.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  applyJieqiMove,
  createInitialJieqiState,
  createJieqiDeal,
  getJieqiLegalMoves,
  getJieqiLegalMovesFrom,
  isJieqiLegalMove,
  type JieqiSquare,
} from './variants-jieqi.js';

// mulberry32, as in the soak test.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('legal moves, legality and results match the pre-#476 kernel on 150 seeded games', () => {
  const hash = createHash('sha256');
  let plies = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const rng = makeRng(seed);
    let state = createInitialJieqiState(`g${seed}`, createJieqiDeal(rng));
    for (let ply = 0; ply < 300 && state.status.type === 'playing'; ply++) {
      const moves = getJieqiLegalMoves(state);
      hash.update(`${moves.map((m) => m.from + m.to).join(',')}|`);
      const froms = [...new Set(moves.map((m) => m.from))];
      const from = froms[Math.floor(rng() * froms.length)]!;
      hash.update(
        `${getJieqiLegalMovesFrom(state, from)
          .map((m) => m.to)
          .join(',')}|`,
      );
      const squares = Object.keys(state.board) as JieqiSquare[];
      const probe = { from: squares[Math.floor(rng() * squares.length)]!, to: moves[0]!.to };
      hash.update(String(isJieqiLegalMove(state, probe)));
      state = applyJieqiMove(state, moves[Math.floor(rng() * moves.length)]!);
      plies++;
    }
    hash.update(JSON.stringify(state.status));
  }
  assert.equal(plies, 38012);
  assert.equal(hash.digest('hex').slice(0, 16), '02a378f6570b117e');
});
