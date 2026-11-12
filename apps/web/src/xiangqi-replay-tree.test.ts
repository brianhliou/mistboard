import {
  applyXiangqiRecordMove,
  createInitialXiangqiState,
  standardXiangqiFen,
  type XiangqiSquare,
} from '@mistboard/game';
import { afterEach, expect, test } from 'vitest';
import { mengFanruiArticle } from './articles/content/meng-fanrui.js';
import {
  mountXiangqiReplay,
  type XiangqiReplayBranch,
  type XiangqiReplaySpec,
} from './xiangqi-replay.js';

const spec: XiangqiReplaySpec = {
  iccs: 'h2e2 h9g7 h0g2 g6g5',
  red: 'Red',
  black: 'Black',
  event: 'Tree',
  resultText: '*',
  annotations: {
    byPly: {
      3: {
        branches: [
          {
            label: 'Horse',
            line: 'b0c2 c9e7 a0b0',
            lineEval: '⩲',
            replies: {
              2: [{ label: 'Other reply', line: 'b9c7 a0b0', lineEval: '=' }],
            },
          },
          { line: 'g3g4 c9e7', lineEval: '=' },
        ],
      },
    },
  },
};
const controllers: { destroy(): void }[] = [];
const originalWidth = window.innerWidth;
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.replaceChildren();
  window.innerWidth = originalWidth;
});
function mount(value = spec) {
  const host = document.createElement('div');
  document.body.append(host);
  controllers.push(mountXiangqiReplay(host, value));
  return host;
}
function click(host: HTMLElement, selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  button?.click();
}
const pieces = (host: HTMLElement) =>
  [...host.querySelectorAll('[data-piece-square]')]
    .map((piece) => [piece.getAttribute('data-piece-square'), piece.innerHTML])
    .sort();
function expectFen(host: HTMLElement, fen: string) {
  const reference = mount({ ...spec, iccs: '', startFen: fen, annotations: undefined });
  // Compare every piece's square and identity with a board rendered directly
  // from the expected FEN, independently of the variation cursor.
  expect(pieces(host)).toEqual(pieces(reference));
}
function fenOf(iccs: string) {
  let state = createInitialXiangqiState('expected');
  for (const token of iccs.split(' ')) {
    const sq = (s: string) => `${s[0]}${Number(s[1]) + 1}` as XiangqiSquare;
    const next = applyXiangqiRecordMove(state, {
      from: sq(token.slice(0, 2)),
      to: sq(token.slice(2)),
    });
    expect(next).not.toBe(state);
    state = next;
  }
  return standardXiangqiFen(state);
}

test('renders siblings and replies under the replaced move; nested clicks and arrows follow the correct FEN', () => {
  window.innerWidth = 1000;
  const host = mount();
  expect(host.querySelectorAll('.xq-replay-tree-depth-1')).toHaveLength(2);
  expect(host.querySelectorAll('.xq-replay-tree-depth-2')).toHaveLength(1);
  const child = '[data-branch-id="3-0-2-0"]';
  click(host, `${child} .xq-replay-move-button`);
  expectFen(host, fenOf('h2e2 h9g7 b0c2 b9c7'));
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expectFen(host, fenOf('h2e2 h9g7 b0c2 b9c7 a0b0'));
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expectFen(host, fenOf('h2e2 h9g7 b0c2'));
  expect(host.querySelector('[data-branch-id="3-0"] > .is-current')).not.toBeNull();
  click(host, '[data-branch-id="3-1"] .xq-replay-move-button');
  expectFen(host, fenOf('h2e2 h9g7 g3g4'));
  click(host, '.xq-replay-row .xq-replay-move-button');
  expectFen(host, fenOf('h2e2'));
});

test('390px collapses replies behind +N, remembers expansion through steps, and follows resize', () => {
  window.innerWidth = 390;
  const host = mount();
  const reply = () => host.querySelector<HTMLElement>('.xq-replay-tree-depth-2');
  expect(reply()?.hidden).toBe(true);
  expect(host.querySelector('.xq-replay-replies-toggle')?.textContent).toBe('+1');
  click(host, '.xq-replay-replies-toggle');
  expect(reply()?.hidden).toBe(false);
  expect(host.querySelector('.xq-replay-replies-toggle')?.getAttribute('aria-expanded')).toBe(
    'true',
  );
  click(host, '[data-branch-id="3-0-2-0"] .xq-replay-move-button');
  expect(reply()?.hidden).toBe(false);
  click(host, '.xq-replay-replies-toggle');
  expect(reply()?.hidden).toBe(true);
  window.innerWidth = 1000;
  window.dispatchEvent(new Event('resize'));
  expect(reply()?.hidden).toBe(false);
  expect(host.querySelector('.xq-replay-replies-toggle')).toBeNull();
});

test('black-first trees number their branches from the starting side and cap rendering depth', () => {
  const host = mount({
    ...spec,
    startFen: fenOf('h2e2'),
    iccs: 'h9g7',
    annotations: {
      byPly: {
        1: {
          branches: [
            {
              line: 'b9c7 h0g2',
              replies: { 2: [{ line: 'b0c2', replies: { 1: [{ line: 'g3g4' }] } }] },
            },
          ],
        },
      },
    },
  });
  expect(host.querySelector('.xq-replay-tree-depth-1 > .xq-replay-move-n')?.textContent).toBe('1…');
  expect(host.querySelectorAll('.xq-replay-tree-branch')).toHaveLength(2);
});

test('all baked Meng trees replay legally, have eight-ply lines, and exclude the played move', () => {
  let roots = 0;
  const blocks = mengFanruiArticle.sections.flatMap((section) => section.blocks);
  for (const block of blocks) {
    if (block?.kind !== 'xq-replay') continue;
    const mainline = block.spec.iccs.split(' ');
    for (const [key, annotation] of Object.entries(block.spec.annotations?.byPly ?? {})) {
      if (!annotation.line) continue;
      roots += 1;
      expect(annotation.branches?.length).toBeGreaterThan(0);
      expect(annotation.branches?.length).toBeLessThanOrEqual(3);
      const prefix = mainline.slice(0, Number(key) - 1);
      const check = (branches: XiangqiReplayBranch[], path: string[]) => {
        for (const branch of branches) {
          const tokens = branch.line.split(' ');
          expect(tokens).toHaveLength(8);
          fenOf([...path, ...tokens].join(' '));
          expect(branch.lineEval).toMatch(/^(=|⩲|⩱|±|∓|\+−|−\+)$/);
          for (const [ply, replies] of Object.entries(branch.replies ?? {})) {
            check(replies, [...path, ...tokens.slice(0, Number(ply) - 1)]);
          }
        }
      };
      check(annotation.branches ?? [], prefix);
      for (const branch of annotation.branches ?? [])
        expect(branch.line.split(' ')[0]).not.toBe(mainline[Number(key) - 1]);
    }
  }
  expect(roots).toBe(20);
});
