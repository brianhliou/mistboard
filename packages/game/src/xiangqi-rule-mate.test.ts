import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { XiangqiMove, XiangqiSquare } from './variants-xiangqi.js';
import { parseStandardXiangqiFen } from './xiangqi-position.js';
import { xiangqiRuleMate } from './xiangqi-rule-mate.js';

// 2026 Women's Xiangqi League, round 2: Liu Huan vs Yu Siyuan (dpxq.com), the
// first 59 moves. From move 25 Black checks with the horse on every move
// (f4-g2+, g2-f4+) while Red shuffles the general between e1 and f1. After
// 29... f4-g2+ (ply 58) Pikafish answers "mate 1, e1f1": Red's 30. Kf1 makes the
// third repetition of Black's perpetual check, which Black loses by rule. Over
// the board Black varied with 30... g2-h4.
const RECORD = (
  'h3-e3 h10-g8 h1-g3 c7-c6 i1-h1 i10-h10 g4-g5 b10-c8 b3-c3 d10-e9 a1-a2 c10-e8 ' +
  'b1-a3 c8-b6 a2-d2 a10-d10 d2-d10 e10-d10 h1-h7 h8-i8 h7-h10 g8-h10 e3-e7 h10-g8 ' +
  'e7-e6 b6-a4 c3-d3 g7-g6 g5-g6 e8-g6 g3-f5 g6-e8 f5-d4 d10-e10 d4-c6 g8-f6 d3-d4 ' +
  'b8-a8 e4-e5 f6-h5 f1-e2 h5-f4 c6-a7 a4-b6 a3-b5 b6-d7 d4-d6 f4-g2 e1-f1 i8-f8 ' +
  'e6-e7 g2-f4 f1-e1 f4-g2 e1-f1 g2-f4 f1-e1 f4-g2 e1-f1'
)
  .split(' ')
  .map((text): XiangqiMove => {
    const [from, to] = text.split('-') as [XiangqiSquare, XiangqiSquare];
    return { from, to };
  });

describe('xiangqiRuleMate', () => {
  it('tags the mate 1 after 29... Hg2+ as the perpetual-check rule', () => {
    // Ply 58: Red to move, the engine says Red mates in one with e1f1.
    assert.equal(
      xiangqiRuleMate({ history: RECORD.slice(0, 58), mate: 1, pv: ['e1f1'] }),
      'perpetual-check',
    );
  });

  it('tags the same verdict seen from the checker, one ply earlier', () => {
    // Ply 57: Black to move and losing; "mate 1" covers Black's check plus Red's reply.
    assert.equal(
      xiangqiRuleMate({ history: RECORD.slice(0, 57), mate: 1, pv: ['f4g2', 'e1f1'] }),
      'perpetual-check',
    );
  });

  it('leaves a mate score alone when the rule names the other side', () => {
    assert.equal(xiangqiRuleMate({ history: RECORD.slice(0, 58), mate: -1, pv: ['e1f1'] }), null);
  });

  it('never reads a long mate as a rule verdict', () => {
    assert.equal(xiangqiRuleMate({ history: RECORD.slice(0, 58), mate: 3, pv: ['e1f1'] }), null);
  });

  it('needs the full line the distance covers', () => {
    assert.equal(xiangqiRuleMate({ history: RECORD.slice(0, 57), mate: 1, pv: ['f4g2'] }), null);
  });

  it('keeps a real mate in one untagged', () => {
    // Red: chariots a9 and b1, general d1. Black: general e10 alone.
    // b1-b10 is checkmate: e9, d10 and f10 are all covered.
    const parsed = parseStandardXiangqiFen('4k4/R8/9/9/9/9/9/9/9/1R1K5 w');
    assert.ok(parsed.ok);
    assert.equal(
      xiangqiRuleMate({ history: [], mate: 1, pv: ['b1b10'], initialState: parsed.state }),
      null,
    );
  });

  it('ignores cp scores and unreadable lines', () => {
    assert.equal(xiangqiRuleMate({ history: RECORD.slice(0, 58), mate: null, pv: ['e1f1'] }), null);
    assert.equal(xiangqiRuleMate({ history: RECORD.slice(0, 58), mate: 1, pv: ['zz'] }), null);
  });
});
