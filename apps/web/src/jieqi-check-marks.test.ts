import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiPlayerView,
  type JieqiGameState,
  type JieqiMove,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { jieqiFrameCheckMarks, jieqiLiveMoveLabels } from './live-jieqi.js';
import type { JieqiPostgameResponse } from './live-jieqi-postgame.js';
import { makeJieqiTreeAdapter } from './review/jieqi-tree-adapter.js';
import { movesFromParam } from './variant-analysis.js';
import { jieqiWatchMoveLabels } from './watch-jieqi-replay.js';

// Jieqi move labels are from-to plus + / #, like xiangqi's algebraic list.
// 3.b3-b10 takes the horse and lands the cannon behind the d10 advisor with
// the c10 elephant gone: check.
const LINE: JieqiMove[] = [
  { from: 'e1', to: 'e2' },
  { from: 'c10', to: 'e8' },
  { from: 'b3', to: 'b10' },
];

function states(): JieqiGameState[] {
  const out = [createInitialJieqiState('jq_marks', STANDARD_JIEQI_DEAL)];
  for (const move of LINE) out.push(applyJieqiMove(out[out.length - 1]!, move));
  return out;
}

describe('jieqi check marks in move labels', () => {
  it('review: the tree labels a checking move with +', () => {
    const adapter = makeJieqiTreeAdapter('jq_marks', STANDARD_JIEQI_DEAL);
    const positions = states();
    expect(LINE.map((move, i) => adapter.moveLabel(move, positions[i]!))).toEqual([
      'e1-e2',
      'c10-e8',
      'b3-b10+',
    ]);
  });

  it('analysis: a marked line pasted back into the import box still imports', () => {
    const adapter = makeJieqiTreeAdapter('jq_marks', STANDARD_JIEQI_DEAL);
    const moves = movesFromParam('e1-e2 c10-e8 b3-b10+', adapter, states()[0]!);
    expect(moves).toEqual(LINE);
  });

  it('live: the list carries the server marks, and ignores anything else', () => {
    expect(jieqiLiveMoveLabels(LINE, jieqiFrameCheckMarks(['', '', '+']))).toEqual([
      'e1-e2',
      'c10-e8',
      'b3-b10+',
    ]);
    expect(jieqiFrameCheckMarks(undefined)).toEqual([]);
    expect(jieqiFrameCheckMarks(['x', '#'])).toEqual(['', '#']);
  });

  it('watch replay: marks are read off the payload views for each ply', () => {
    const positions = states();
    const masked = positions.map((state, ply) => ({
      ply,
      view: getJieqiPlayerView(state, 'red'),
    }));
    const postgame = {
      timeline: LINE.map((move, i) => ({ type: 'move-played', at: i, move, ply: i + 1 })),
      history: { masked },
    } as unknown as JieqiPostgameResponse;
    expect(jieqiWatchMoveLabels(postgame)).toEqual(['e1-e2', 'c10-e8', 'b3-b10+']);
  });
});
