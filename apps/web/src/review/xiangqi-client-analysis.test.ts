import { createInitialXiangqiState } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redPovScore } from '../../../server/src/xiangqi-pikafish-engine.js';
import { createCeval } from './engine/ceval.js';
import { buildXiangqiClientAnalysisSource } from './xiangqi-client-analysis.js';
import { buildXiangqiReplayFromMoves } from './xiangqi-review-model.js';

vi.mock('./engine/ceval.js', () => ({ createCeval: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe('client/server score normalization parity', () => {
  for (const firstMover of ['red', 'black'] as const) {
    for (const score of [
      { cp: 0, mate: null },
      { cp: 123, mate: null },
      { cp: -123, mate: null },
      { cp: null, mate: 3 },
      { cp: null, mate: -3 },
      { cp: null, mate: 0 },
      { cp: null, mate: null },
    ]) {
      it(`${firstMover} starts, score ${JSON.stringify(score)}`, async () => {
        const state = createInitialXiangqiState('parity');
        state.status = { type: 'playing', turn: firstMover };
        const move =
          firstMover === 'red'
            ? ({ from: 'b3', to: 'e3' } as const)
            : ({ from: 'h8', to: 'e8' } as const);
        const replay = buildXiangqiReplayFromMoves([move], state);
        const dispose = vi.fn();
        const evaluate = vi.fn().mockResolvedValue({
          lines: [{ scoreCp: score.cp, mate: score.mate, pvUci: [] }],
        });
        vi.mocked(createCeval).mockReturnValue({
          variant: 'xiangqi',
          preload: vi.fn(),
          stop: vi.fn(),
          evaluate,
          dispose,
        });
        const source = buildXiangqiClientAnalysisSource(replay);
        const analysis = await source!.run(() => {});
        expect(analysis.evals).toHaveLength(2);
        for (const [ply, row] of analysis.evals.entries()) {
          const sign = (ply % 2 === 0) === (firstMover === 'red') ? 1 : -1;
          expect({ cp: row.cp, mate: row.mate }).toEqual(redPovScore(score.cp, score.mate, sign));
        }
        if (score.mate === 0) {
          expect(analysis.evals[1]).toMatchObject({
            cp: firstMover === 'red' ? 30000 : -30000,
            mate: null,
          });
        }
        expect(dispose).toHaveBeenCalledOnce();
      });
    }
  }
});
