import {
  applyXiangqiRecordMove,
  createInitialXiangqiState,
  standardXiangqiFen,
  type XiangqiSquare,
} from '@mistboard/game';
import { afterEach, expect, test } from 'vitest';
import { mountXiangqiReplay, type XiangqiReplaySpec } from './xiangqi-replay.js';

// Ply 3 (Red's h0g2) has two engine alternatives; the first has a reply that
// replaces its second move.
const spec: XiangqiReplaySpec = {
  iccs: 'h2e2 h9g7 h0g2 g6g5',
  red: 'Red',
  black: 'Black',
  event: 'Fork',
  resultText: '*',
  annotations: {
    byPly: {
      3: {
        branches: [
          {
            label: 'Horse',
            line: 'b0c2 c9e7 a0b0',
            replies: { 2: [{ label: 'Other reply', line: 'b9c7 a0b0' }] },
          },
          { line: 'g3g4 c9e7' },
        ],
      },
    },
  },
};

const controllers: { destroy(): void }[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.replaceChildren();
});
function mount(value = spec) {
  const host = document.createElement('div');
  document.body.append(host);
  controllers.push(mountXiangqiReplay(host, value));
  return host;
}
const pieces = (host: HTMLElement) =>
  [...host.querySelectorAll('.raw-svg-stepper-frame [data-piece-square]')]
    .map((piece) => [piece.getAttribute('data-piece-square'), piece.innerHTML])
    .sort();
function fenOf(iccs: string) {
  let state = createInitialXiangqiState('expected');
  for (const token of iccs.split(' ')) {
    const sq = (s: string) => `${s[0]}${Number(s[1]) + 1}` as XiangqiSquare;
    state = applyXiangqiRecordMove(state, { from: sq(token.slice(0, 2)), to: sq(token.slice(2)) });
  }
  return standardXiangqiFen(state);
}
function expectBoard(host: HTMLElement, iccs: string) {
  const reference = mount({ ...spec, iccs: '', startFen: fenOf(iccs), annotations: undefined });
  expect(pieces(host)).toEqual(pieces(reference));
}
const key = (target: Element, k: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const next = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('.stepper-button-next')!.click();
const options = (host: HTMLElement) =>
  [...host.querySelectorAll('.xq-replay-fork-option')].map((b) => ({
    move: b.querySelector('.xq-replay-fork-move')?.textContent,
    tag: b.querySelector('.xq-replay-fork-tag')?.textContent,
  }));

test('stepping onto a fork asks first: the game move, then each variation, and the board waits', () => {
  const host = mount();
  next(host);
  next(host);
  expect(host.querySelector('.xq-replay-fork')).toBeNull();
  next(host);
  const panel = host.querySelector('.raw-svg-stepper-frame .xq-replay-fork');
  expect(panel?.getAttribute('aria-label')).toBe('Choose a line');
  expect(options(host).map((o) => o.tag)).toEqual(['Main line', 'Horse', 'Variation']);
  expect(options(host).every((o) => o.move)).toBe(true);
  expectBoard(host, 'h2e2 h9g7');
});

test('picking a variation plays its first move; Next again takes the highlighted option', () => {
  const host = mount();
  next(host);
  next(host);
  next(host);
  host.querySelectorAll<HTMLButtonElement>('.xq-replay-fork-option')[1]!.click();
  expect(host.querySelector('.xq-replay-fork')).toBeNull();
  expectBoard(host, 'h2e2 h9g7 b0c2');

  // Inside the branch, its own reply is a second fork.
  next(host);
  expect(options(host).map((o) => o.tag)).toEqual(['Horse', 'Other reply']);
  key(document.activeElement!, 'ArrowDown');
  next(host);
  expectBoard(host, 'h2e2 h9g7 b0c2 b9c7');
});

test('the default pick is the game move, and the mainline carries on past the fork', () => {
  const host = mount();
  next(host);
  next(host);
  next(host);
  next(host);
  expect(host.querySelector('.xq-replay-fork')).toBeNull();
  expectBoard(host, 'h2e2 h9g7 h0g2');
  next(host);
  expectBoard(host, 'h2e2 h9g7 h0g2 g6g5');
});

test('Escape or ArrowLeft closes the chooser without moving; keys pick from it', () => {
  const host = mount();
  key(host, 'ArrowRight');
  key(host, 'ArrowRight');
  key(host, 'ArrowRight');
  expect(host.querySelector('.xq-replay-fork')).not.toBeNull();
  key(document.activeElement!, 'Escape');
  expect(host.querySelector('.xq-replay-fork')).toBeNull();
  expectBoard(host, 'h2e2 h9g7');

  key(host, 'ArrowRight');
  key(document.activeElement!, 'ArrowUp');
  key(document.activeElement!, 'ArrowRight');
  expectBoard(host, 'h2e2 h9g7 g3g4');
});

test('a legacy single line is a fork too, and clicking a move in the list never asks', () => {
  const host = mount({
    ...spec,
    annotations: { byPly: { 3: { glyph: '?', cp: -180, line: 'b0c2 c9e7 a0b0' } } },
  });
  next(host);
  next(host);
  next(host);
  expect(options(host)).toHaveLength(2);
  expect(options(host)[0]!.tag).toBe('Main line');
  host.querySelectorAll<HTMLButtonElement>('.xq-replay-fork-option')[1]!.click();
  expectBoard(host, 'h2e2 h9g7 b0c2');

  const plain = mount();
  plain.querySelectorAll<HTMLButtonElement>('.xq-replay-row .xq-replay-move-button')[3]!.click();
  expect(plain.querySelector('.xq-replay-fork')).toBeNull();
});

test('the chooser numbers the move and carries the same marks as the move list', () => {
  const host = mount({
    ...spec,
    annotations: {
      byPly: {
        3: {
          glyph: '?!',
          branches: [{ line: 'b0c2 c9e7', lineEval: '⩲' }],
        },
      },
    },
  });
  next(host);
  next(host);
  next(host);
  expect(host.querySelector('.xq-replay-fork-n')?.textContent).toBe('2.');
  const marks = [...host.querySelectorAll('.xq-replay-fork-option')].map(
    (b) => b.querySelector('.xq-replay-glyph, .xq-replay-fork-mark')?.textContent,
  );
  expect(marks).toEqual(['?!', '⩲']);
  expect(host.querySelector('.xq-replay-fork .xq-replay-glyph-inaccuracy')).not.toBeNull();
});

test('a play link is the card’s last row, inside the card', () => {
  const host = mount({
    ...spec,
    play: { label: 'Play from move 2', href: '/practice/position?fen=x' },
    annotations: { byPly: { 3: { glyph: '?' } } },
  });
  const link = host.querySelector<HTMLAnchorElement>('.xq-replay-grid > a.xq-replay-play');
  expect(link?.getAttribute('href')).toBe('/practice/position?fen=x');
  expect(link?.textContent).toContain('Play from move 2');
  expect(link?.parentElement?.lastElementChild).toBe(link);
});
