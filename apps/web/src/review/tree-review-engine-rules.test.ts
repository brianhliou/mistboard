import {
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPlayerView,
  jieqiStateToPikafishFen,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnginePanel } from './engine/engine-panel.js';
import { makeJieqiTreeAdapter } from './jieqi-tree-adapter.js';
import { mountTreeReview, type TreePresentation } from './tree-review.js';

const { setPosition } = vi.hoisted(() => ({ setPosition: vi.fn<EnginePanel['setPosition']>() }));
vi.mock('./engine/engine-panel.js', () => ({
  createEnginePanel: () => ({
    el: document.createElement('section'),
    supported: true,
    setPosition,
    setShowArrows: vi.fn(),
    setOn: vi.fn(),
    dispose: vi.fn(),
  }),
}));

afterEach(() => {
  setPosition.mockClear();
  document.body.replaceChildren();
});

describe('tree review forwards engine rules from the displayed truth', () => {
  it.each(['fen', 'moves'] as const)(
    'carries the rule in %s mode at mount and navigation',
    (mode) => {
      const adapter = makeJieqiTreeAdapter('engine-rule-test', STANDARD_JIEQI_DEAL);
      const rootTruth = adapter.initialTruth();
      const move: JieqiMove = { from: 'a4', to: 'a5' };
      const fen = (truth: JieqiGameState) => jieqiStateToPikafishFen(truth, { public: true });
      const jieqiRule = vi.fn((truth: JieqiGameState) =>
        truth.lastMove ? ('jqe-v1' as const) : ('legacy' as const),
      );
      const presentation: TreePresentation<
        JieqiMove,
        JieqiGameState,
        JieqiPlayerView,
        JieqiColor,
        unknown,
        unknown
      > = {
        adapter,
        engine: {
          panelVariant: 'jieqi',
          positionMode: mode,
          fen,
          jieqiRule,
          formatPvMove: (uci) => uci,
        },
        boardHostClassName: 'test-board',
        boardWrapClassName: 'test-wrap',
        defaultBoardAriaLabel: 'Jieqi board',
        boardAspect: 1,
        boardCols: 9,
        perspective: (flipped) => (flipped ? 'black' : 'red'),
        seatFor: () => null,
        createBoard: () => ({ render: vi.fn(), setArrows: vi.fn(), setMarkers: vi.fn() }),
        animateMove: vi.fn(),
        shapeToArrow: (shape) => shape,
        shapeToMarker: (shape) => shape,
      };
      const root = document.createElement('div');
      document.body.append(root);
      const handle = mountTreeReview(root, presentation, {
        ariaLabel: 'Jieqi review',
        title: 'Rule forwarding',
        summary: '',
        moves: [move],
        initialPosition: 'start',
        analysis: null,
      });
      try {
        expect(jieqiRule.mock.lastCall?.[0]).toEqual(rootTruth);
        expect(setPosition.mock.lastCall).toEqual([
          [],
          mode === 'fen' ? fen(rootTruth) : undefined,
          true,
          undefined,
          'legacy',
        ]);

        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        );
        const nextTruth = adapter.applyMove(rootTruth, move);
        expect(jieqiRule.mock.lastCall?.[0]).toEqual(nextTruth);
        expect(setPosition.mock.lastCall).toEqual([
          mode === 'fen' ? [] : [adapter.toEngineUci(move)],
          mode === 'fen' ? fen(nextTruth) : undefined,
          true,
          undefined,
          'jqe-v1',
        ]);
      } finally {
        handle.destroy();
      }
    },
  );
});
