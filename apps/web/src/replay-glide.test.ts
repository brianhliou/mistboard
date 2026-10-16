import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mountAtomicXiangqiReplayBoard } from './atomic-xiangqi-replay.js';
import { mountChessReplayBoard } from './chess-study-replay.js';
import { mountXiangqiReplay, mountXiangqiReplayBoard } from './xiangqi-replay.js';

// The article widget and the embed board draw their own SVG, and each step
// used to rebuild it with no per-piece element, so nothing could glide.
// ICCS h2e2 is the central cannon, b9c7 the horse reply.
const spec = {
  iccs: 'h2e2 b9c7',
  red: 'Red',
  black: 'Black',
  event: 'Glide',
  resultText: '*',
};

let animate: ReturnType<typeof vi.fn>;
let el: HTMLElement;
beforeEach(() => {
  // happy-dom has no WAAPI; glideSvgPiece feature-checks for it.
  animate = vi.fn();
  Object.assign(Element.prototype, { animate, getAnimations: () => [] });
  el = document.createElement('div');
  document.body.appendChild(el);
});
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
  el.remove();
});

/** The keyed slots the glide targets: one per piece on the board. */
const slots = (host: HTMLElement) => host.querySelectorAll('.xq-piece-slot').length;
/** Glide calls on piece slots, as the translate keyframe each started from. */
const glides = () =>
  animate.mock.contexts
    .map((ctx, i) => ({ ctx: ctx as Element, frames: animate.mock.calls[i]![0] }))
    .filter(({ ctx }) => ctx.hasAttribute('data-piece-square'))
    .map(({ ctx, frames }) => ({ square: ctx.getAttribute('data-piece-square'), from: frames[0] }));

describe('embed board (mountXiangqiReplayBoard)', () => {
  test('wraps every piece in a keyed slot', () => {
    mountXiangqiReplayBoard(el, spec);
    expect(slots(el)).toBe(32);
  });

  test('a one-ply step forward glides the piece in from its origin', () => {
    const board = mountXiangqiReplayBoard(el, spec);
    board.jumpToPly(1);
    // h3 -> e3 is three files left: the piece starts three cells right of rest.
    expect(glides()).toEqual([
      { square: 'e3', from: { transform: expect.stringMatching(/^translate\(\d/) } },
    ]);
  });

  test('a one-ply step back glides the piece home', () => {
    const board = mountXiangqiReplayBoard(el, spec);
    board.jumpToPly(1);
    animate.mockClear();
    board.jumpToPly(0);
    expect(glides()).toEqual([
      { square: 'h3', from: { transform: expect.stringMatching(/^translate\(-\d/) } },
    ]);
  });

  test('a jump of more than one ply repaints without a glide', () => {
    const board = mountXiangqiReplayBoard(el, spec);
    board.jumpToPly(2);
    expect(glides()).toEqual([]);
  });
});

describe('article widget (mountXiangqiReplay)', () => {
  test('arrow keys glide one step in either direction', () => {
    mountXiangqiReplay(el, spec);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(glides().map((g) => g.square)).toEqual(['e3']);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    // b10 -> c8: the horse reply, the black piece now on c8.
    expect(glides().map((g) => g.square)).toEqual(['e3', 'c8']);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(glides().map((g) => g.square)).toEqual(['e3', 'c8', 'b10']);
  });
});

// The other study-embed boards that used to repaint without a glide.
describe('chess study board (mountChessReplayBoard)', () => {
  test('one-ply steps glide both ways; a jump does not', () => {
    const board = mountChessReplayBoard(el, { moves: ['e2e4', 'e7e5', 'g1f3'] });
    board.jumpToPly(1);
    board.jumpToPly(2);
    board.jumpToPly(1);
    expect(glides().map((g) => g.square)).toEqual(['e4', 'e5', 'e7']);
    animate.mockClear();
    board.jumpToPly(3);
    expect(glides()).toEqual([]);
  });
});

describe('atomic xiangqi board (mountAtomicXiangqiReplayBoard)', () => {
  test('a quiet one-ply step glides', () => {
    const board = mountAtomicXiangqiReplayBoard(el, {
      moves: 'h3e3 b10c8',
      red: 'Red',
      black: 'Black',
      event: 'Glide',
      resultText: '*',
    });
    board.jumpToPly(1);
    board.jumpToPly(2);
    board.jumpToPly(1);
    expect(glides().map((g) => g.square)).toEqual(['e3', 'c8', 'b10']);
  });
});
