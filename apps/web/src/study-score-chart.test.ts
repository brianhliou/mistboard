import {
  banqiStateToDealtFen,
  createInitialBanqiState,
  createInitialJungleFlipState,
  jungleFlipStateToDealtFen,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerializedTree } from './review/tree-serialize.js';
import { mountStudy } from './study.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState({}, '', '/');
});

function flippedRoot(variant: string, ink: 'red' | 'black'): SerializedTree {
  if (variant === 'three-kingdoms-banqi') {
    return {
      version: 1,
      replay: 'three-kingdoms-banqi-public-v1',
      root: { children: [{ uci: `@f4:${ink === 'red' ? 'A' : 'a'}`, children: [] }] },
    };
  }
  const state =
    variant === 'banqi' ? createInitialBanqiState('chart') : createInitialJungleFlipState('chart');
  const square = Object.entries(state.board).find(([, piece]) => piece?.color === ink)![0];
  return {
    version: 1,
    rootFen:
      variant === 'banqi'
        ? banqiStateToDealtFen(state as ReturnType<typeof createInitialBanqiState>)
        : jungleFlipStateToDealtFen(state as ReturnType<typeof createInitialJungleFlipState>),
    root: { children: [{ uci: square.repeat(2), children: [] }] },
  };
}

describe('study score chart played ink', () => {
  for (const variant of ['banqi', 'three-kingdoms-banqi', 'jungle-flip', 'xiangqi']) {
    for (const ink of ['red', 'black'] as const) {
      for (const side of ['red', 'black'] as const) {
        it(`${variant}: names the ${side} seat's ink after a ${ink} opening flip`, async () => {
          const tree: SerializedTree =
            variant === 'xiangqi'
              ? { version: 1, root: { children: [{ uci: 'h3e3', children: [] }] } }
              : flippedRoot(variant, ink);
          vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
              const url = input.toString();
              if (url === '/api/chat/study/score')
                return new Response(JSON.stringify({ lines: [] }));
              if (url !== '/api/studies/score') throw new Error(`Unexpected request: ${url}`);
              return new Response(
                JSON.stringify({
                  study: { id: 'score', name: 'Scores', visibility: 'public', isOwner: false },
                  chapters: [
                    {
                      id: 'chapter',
                      name: 'Game',
                      variant,
                      root: tree,
                      version: 1,
                      orientation: 'red',
                      gamebook: false,
                      scoreSeries: {
                        side,
                        series: [{ name: 'Engine', color: 'a', values: [0.5, 0.6] }],
                      },
                    },
                  ],
                }),
              );
            }),
          );
          const root = document.createElement('div');
          document.body.append(root);
          await mountStudy(root, 'score', 'chapter');
          const expected =
            variant === 'xiangqi' || ink === 'red' ? side : side === 'red' ? 'black' : 'red';
          expect(root.querySelector('.embed-score-chart__legend')?.textContent).toContain(
            `Win chance for ${expected === 'red' ? 'Red' : 'Black'}`,
          );
          expect(root.querySelector('.embed-score-chart')?.getAttribute('aria-label')).toContain(
            `Win chance for ${expected === 'red' ? 'Red' : 'Black'}`,
          );
          expect(root.querySelector('.embed-score-chart__line')).not.toBeNull();
        });
      }
    }
  }
});
