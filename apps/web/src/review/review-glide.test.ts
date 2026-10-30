import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  type JieqiMove,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountChessReview } from './chess-review.js';
import { mountJieqiReview } from './jieqi-review.js';

// A study, a postgame review and /analysis all step through a tree review, and
// the presentation's animateMove is the only thing that glides a piece there.
// Jieqi and chess had it as a no-op, so every jieqi study (R612nAlt, 100 engine
// games) jumped pieces between squares while xiangqi studies glided.

let animate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // happy-dom has no WAAPI; glideSvgPiece feature-checks for it.
  animate = vi.fn();
  Object.assign(Element.prototype, { animate, getAnimations: () => [] });
});
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
  document.body.replaceChildren();
});

function key(name: string): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
  );
}

/** Squares of the piece slots a glide started on. */
function glidedSquares(): string[] {
  return animate.mock.contexts
    .map((ctx) => ctx as Element)
    .filter((ctx) => ctx.hasAttribute('data-piece-square'))
    .map((ctx) => ctx.getAttribute('data-piece-square')!);
}

function host(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

describe('tree review glides', () => {
  it('jieqi: a face-down piece glides forward and back', () => {
    const state = createInitialJieqiState('t', STANDARD_JIEQI_DEAL);
    // A face-down piece's move: the "?" is what used to read as a reason not
    // to glide.
    const move: JieqiMove = getJieqiLegalMoves(state).find(
      (candidate) => state.board[candidate.from]?.faceDown,
    )!;
    expect(move).toBeDefined();
    expect(applyJieqiMove(state, move)).toBeTruthy();
    mountJieqiReview(host(), 'room-glide', STANDARD_JIEQI_DEAL, {
      ariaLabel: 'test',
      title: 'Jieqi',
      summary: 'test',
      moves: [move],
      analysis: null,
    });
    // A review opens on the mainline tip: back one glides the piece home,
    // forward again glides it out.
    key('ArrowLeft');
    expect(glidedSquares()).toEqual([move.from]);
    animate.mockClear();
    key('ArrowRight');
    expect(glidedSquares()).toEqual([move.to]);
  });

  it('chess: a step forward glides the pawn', () => {
    mountChessReview(host(), {
      ariaLabel: 'test',
      title: 'Chess',
      summary: 'test',
      moves: [],
      initialTree: { version: 1, root: { children: [{ uci: 'e2e4', children: [] }] } },
      analysis: null,
    });
    key('ArrowLeft');
    animate.mockClear();
    key('ArrowRight');
    expect(glidedSquares()).toEqual(['e4']);
  });
});

describe('review presentations that do not glide', () => {
  // Fog never glides (a path can imply a redacted square, #158). Any other
  // presentation must glide (Duck Xiangqi glides the piece then the duck); a
  // new one copying a no-op is the bug this guards.
  it('are only the fog boards', () => {
    const dir = resolve(__dirname);
    const noop = readdirSync(dir)
      .filter((name) => name.endsWith('-review.ts'))
      .filter((name) =>
        /animateMove:\s*\(\)\s*=>\s*\{\s*\}/.test(readFileSync(resolve(dir, name), 'utf8')),
      )
      .sort();
    expect(noop).toEqual(['dark-chess-review.ts', 'dark-xiangqi-review.ts']);
  });
});
