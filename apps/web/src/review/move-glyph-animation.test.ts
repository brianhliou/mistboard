// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drawMarkerOnArrival,
  PIECE_GLIDE_EASING,
  pieceAnimationDurationMs,
} from '../board-anim.js';
import { animateChessBoardMove } from '../dark-chess-render.js';
import { writeDisplayPreference } from '../display-preferences.js';
import { animateFortressXiangqiBoardMove } from '../fortress-xiangqi-render.js';
import { animateJungleFlipBoardMove } from '../jungle-flip-render.js';
import { animateJungleBoardMove } from '../jungle-render.js';
import { animateBanqiBoardMove, flipBanqiFamilyReveal } from '../live-banqi-render.js';
import {
  animateJieqiBoardMove,
  animateJieqiReveal,
  animateJieqiStepReveal,
} from '../live-jieqi-render.js';
import { animateThreeKingdomsBanqiBoardMove } from '../three-kingdoms-banqi-diagrams.js';
import { animateXiangqiBoardMove } from '../xiangqi-board.js';
import { animateMoveGlyphs, refreshMoveGlyphs } from './move-glyph.js';

type Effect = {
  frames: Keyframe[];
  timing: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
};
let effects: Map<Element, Effect[]>;
function board(square = 'a2'): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = `<svg><g data-piece-square="${square}"><circle r="20"/></g>
    <g class="xq-marker--glyph"><text>?!</text></g>
    <g class="luck-mark" data-luck-square="${square}"><rect width="10" height="10"/></g></svg>`;
  return host;
}
function fadeFor(host: HTMLElement, selector = '.xq-marker--glyph'): Effect {
  const fades = effects.get(host.querySelector(selector)!);
  expect(fades).toHaveLength(1);
  return fades![0]!;
}
/** Backwards fill makes the zero-opacity first frame apply throughout the
 * delay. Inspect the actual WAAPI request: happy-dom does not paint animations. */
function expectLandingFade(fade: Effect, duration: number, delay = duration): void {
  expect(fade.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  expect(fade.timing).toEqual({ duration, delay, fill: 'backwards', easing: PIECE_GLIDE_EASING });
}
/** A glided move's badge: a fade of at most 100ms that ends as the piece lands. */
function expectGlideLanding(fade: Effect): void {
  const glide = pieceAnimationDurationMs();
  const length = Math.min(100, glide);
  expectLandingFade(fade, length, glide - length);
}
beforeEach(() => {
  effects = new Map();
  vi.spyOn(window, 'localStorage', 'get').mockReturnValue({
    getItem: () => null,
    setItem: () => {},
  } as unknown as Storage);
  writeDisplayPreference('pieceAnimation', 'normal');
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
      const effect = { frames, timing, cancel: vi.fn() };
      effects.set(this, [...(effects.get(this) ?? []), effect]);
      return effect as unknown as Animation;
    }),
  });
});
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  vi.restoreAllMocks();
  window.dispatchEvent(new Event('mistboard:display-preferences-change'));
});
const movers: [string, (host: HTMLElement, reverse?: boolean) => void][] = [
  [
    'xiangqi',
    (host, reverse) => animateXiangqiBoardMove(host, { from: 'a1', to: 'a2' }, 'red', { reverse }),
  ],
  [
    'jieqi',
    (host, reverse) => animateJieqiBoardMove(host, { from: 'a1', to: 'a2' }, 'red', { reverse }),
  ],
  ['banqi', (host, reverse) => animateBanqiBoardMove(host, { from: 'a1', to: 'a2' }, { reverse })],
  [
    'jungle',
    (host, reverse) => animateJungleBoardMove(host, { from: 'a1', to: 'a2' }, 'red', { reverse }),
  ],
  [
    'flip jungle',
    (host, reverse) => animateJungleFlipBoardMove(host, { from: 'a1', to: 'a2' }, { reverse }),
  ],
  [
    'chess',
    (host, reverse) => animateChessBoardMove(host, { from: 'a1', to: 'a2' }, 'white', { reverse }),
  ],
  [
    'fortress',
    (host, reverse) =>
      animateFortressXiangqiBoardMove(host, { from: 'a1', to: 'a2' }, 'red', { reverse }),
  ],
  [
    'three kingdoms',
    (host, reverse) =>
      animateThreeKingdomsBanqiBoardMove(host, { from: 'a1', to: 'a2' }, { reverse }),
  ],
];
describe('board glyph arrival', () => {
  it.each(movers)('%s applies its badge arrival timing', (_name, move) => {
    const host = board();
    move(host);
    const glide = effects.get(host.querySelector('[data-piece-square]')!)![0]!;
    const duration = Number(glide.timing.duration);
    expect(duration).toBeGreaterThan(0);
    // Every board: a short fade that ends as the piece lands.
    const fadeDuration = Math.min(100, duration);
    const delay = duration - fadeDuration;
    expectLandingFade(fadeFor(host), fadeDuration, delay);
    expectLandingFade(fadeFor(host, '.luck-mark'), fadeDuration, delay);
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    drawMarkerOnArrival(marker, pieceAnimationDurationMs());
    const highlight = effects.get(marker)![0]!;
    expect(fadeFor(host).timing.easing).toBe(highlight.timing.easing);
  });
  it.each(['fast', 'normal', 'slow'] as const)(
    'jieqi badges finish within the %s glide instead of adding a second animation',
    (speed) => {
      const storage = new Map<string, string>();
      vi.spyOn(window, 'localStorage', 'get').mockReturnValue({
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      } as unknown as Storage);
      writeDisplayPreference('pieceAnimation', speed);
      window.dispatchEvent(new Event('mistboard:display-preferences-change'));
      const host = board();
      animateJieqiBoardMove(host, { from: 'a1', to: 'a2' }, 'red');
      const duration = pieceAnimationDurationMs();
      expect(duration).toBe({ fast: 120, normal: 250, slow: 500 }[speed]);
      for (const selector of ['.xq-marker--glyph', '.luck-mark']) {
        const fade = fadeFor(host, selector);
        expect(Number(fade.timing.delay) + Number(fade.timing.duration)).toBeLessThanOrEqual(
          duration,
        );
        expect(Number(fade.timing.duration)).toBeLessThanOrEqual(100);
      }
    },
  );
  it('also holds the prior move’s glyph during a reverse step', () => {
    const host = board('a1');
    movers[0]![1](host, true);
    expectGlideLanding(fadeFor(host));
  });
  it('cancels pending glyphs when a new move supersedes them', () => {
    const host = board();
    movers[0]![1](host);
    const oldGlyph = fadeFor(host);
    const oldLuck = fadeFor(host, '.luck-mark');
    host.innerHTML = board('a3').innerHTML;
    animateXiangqiBoardMove(host, { from: 'a2', to: 'a3' }, 'red');
    expect(oldGlyph.cancel).toHaveBeenCalledOnce();
    expect(oldLuck.cancel).toHaveBeenCalledOnce();
    expectGlideLanding(fadeFor(host));
  });
  it('keeps engine-patched badges on the same fade timeline and cancels on a board repaint', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const host = board();
    movers[0]![1](host);
    const old = fadeFor(host);
    host.querySelector('.xq-marker--glyph')!.outerHTML =
      '<g class="xq-marker--glyph"><text>?</text></g>';
    clock.mockReturnValue(1100);
    refreshMoveGlyphs(host);
    expect(old.cancel).toHaveBeenCalledOnce();
    expectGlideLanding(fadeFor(host));
    expect((fadeFor(host) as unknown as Animation).currentTime).toBe(100);
    const patched = fadeFor(host);
    host.innerHTML = board('a8').innerHTML;
    refreshMoveGlyphs(host);
    expect(patched.cancel).toHaveBeenCalledOnce();
    expect(effects.has(host.querySelector('.xq-marker--glyph')!)).toBe(false);
  });
  it('does not restart a completed fade when the engine patches a badge', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const host = board();
    movers[0]![1](host);
    host.querySelector('.xq-marker--glyph')!.outerHTML = '<g class="xq-marker--glyph"/>';
    clock.mockReturnValue(1500);
    refreshMoveGlyphs(host);
    expect(effects.has(host.querySelector('.xq-marker--glyph')!)).toBe(false);
  });
  it('leaves first renders and jumps immediately visible without a move animation', () => {
    const host = board();
    expect(host.querySelector('.xq-marker--glyph')).not.toBeNull();
    expect(effects.size).toBe(0);
    host.innerHTML = board('a8').innerHTML;
    expect(effects.size).toBe(0);
    expect(host.querySelector('.luck-mark')?.getAttribute('style')).toBeNull();
  });
  it.each(['off', 'reduced motion'])('shows badges at once with animation %s', (mode) => {
    if (mode === 'off')
      vi.spyOn(window.localStorage, 'getItem').mockReturnValue('{"pieceAnimation":"none"}');
    else vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    window.dispatchEvent(new Event('mistboard:display-preferences-change'));
    const host = board();
    movers[0]![1](host);
    expect(effects.size).toBe(0);
    expect(host.querySelector('.xq-marker--glyph')?.getAttribute('style')).toBeNull();
  });
  it('fades in-place flip glyphs with the reveal, with no glide delay', () => {
    const host = board();
    expect(
      flipBanqiFamilyReveal(
        host,
        'a2',
        () => ({ x: 30, y: 30 }),
        () => '<circle/>',
        'flat',
      ),
    ).toBe(true);
    expectLandingFade(fadeFor(host), pieceAnimationDurationMs(), 0);
    expectLandingFade(fadeFor(host, '.luck-mark'), pieceAnimationDurationMs(), 0);
  });
  it('fades a stationary jieqi reveal immediately, but preserves the delay along a glide', () => {
    const host = board();
    animateJieqiReveal(host, 'a2', 'red', 'red', { tile3d: false });
    expectLandingFade(fadeFor(host, '.luck-mark'), pieceAnimationDurationMs(), 0);
    host.innerHTML = board().innerHTML;
    animateJieqiBoardMove(host, { from: 'a1', to: 'a2' }, 'red');
    animateJieqiReveal(host, 'a2', 'red', 'red', { tile3d: false, alongGlide: true });
    expectLandingFade(
      fadeFor(host, '.luck-mark'),
      Math.min(100, pieceAnimationDurationMs()),
      Math.max(0, pieceAnimationDurationMs() - 100),
    );
  });
  it('starts step-reveal glyphs at the flip midpoint and keeps refreshes on that timeline', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const host = board();
    const move = { from: 'a1', to: 'a2' } as const;
    animateJieqiBoardMove(host, move, 'red');
    const arrival = fadeFor(host, '.luck-mark');
    expect(
      animateJieqiStepReveal(
        host,
        move,
        { a1: { faceDown: true } },
        { a2: { faceDown: false, color: 'red' } },
        'red',
      ),
    ).toBe(true);
    expect(arrival.cancel).toHaveBeenCalledOnce();
    const delay = Math.round(Math.round(pieceAnimationDurationMs() * 0.75) / 2);
    expect(delay).toBe(94);
    for (const selector of ['.xq-marker--glyph', '.luck-mark']) {
      const fades = effects.get(host.querySelector(selector)!)!;
      expectLandingFade(fades[fades.length - 1]!, 150, delay);
    }

    host.querySelector('.luck-mark')!.outerHTML = '<g class="luck-mark" data-luck-square="a2"/>';
    clock.mockReturnValue(1120);
    refreshMoveGlyphs(host);
    const patched = fadeFor(host, '.luck-mark');
    expectLandingFade(patched, 150, delay);
    expect((patched as unknown as Animation).currentTime).toBe(120);
  });
  it('keeps badges immediate without WAAPI and cancels a pending fade when disabled', () => {
    const host = board();
    animateMoveGlyphs(host, 250);
    const old = fadeFor(host);
    animateMoveGlyphs(host, 0);
    expect(old.cancel).toHaveBeenCalledOnce();
    delete (Element.prototype as { animate?: unknown }).animate;
    expect(() => animateMoveGlyphs(board(), 250)).not.toThrow();
  });
});
