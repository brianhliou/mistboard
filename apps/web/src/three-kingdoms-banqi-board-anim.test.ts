// Three Kingdoms banqi (#628): stepping back through the moves glides the
// undone piece home while the board already shows the previous move's marks.
// On 3D tiles that mark is the tile's coloured edge, drawn over every piece, so
// it sat in place before the piece arrived (Brian, 2026-10-30). The marks now
// fade in as the glide lands.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const anim = vi.hoisted(() => ({ drawn: [] as Element[], glides: 0 }));

vi.mock('./board-anim.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./board-anim.js')>();
  return {
    ...actual,
    pieceAnimationDurationMs: () => 200,
    glideSvgPiece: () => {
      anim.glides += 1;
    },
    drawMarkerOnArrival: (el: Element | null) => {
      if (el) anim.drawn.push(el);
    },
  };
});

const { animateThreeKingdomsBanqiBoardMove } = await import('./three-kingdoms-banqi-diagrams.js');

function host(): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `<svg>
    <g data-piece-square="e3"></g>
    <g data-piece-square="e4"></g>
    <path class="xq-live-lastmove-ring xq-live-lastmove-edge tk-flip-ring--red"></path>
  </svg>`;
  return el;
}

describe('the step-back glide on the Three Kingdoms board', () => {
  beforeEach(() => {
    anim.drawn = [];
    anim.glides = 0;
  });

  it('fades the previous move’s edge in as the undone piece lands', () => {
    const board = host();
    animateThreeKingdomsBanqiBoardMove(board, { from: 'e3', to: 'e4' } as never, {
      reverse: true,
    });

    expect(anim.glides).toBe(1);
    expect(anim.drawn).toEqual([board.querySelector('.xq-live-lastmove-edge')]);
  });

  it('does not fade a mark when the glide never runs', () => {
    const board = host();
    animateThreeKingdomsBanqiBoardMove(board, { from: 'e3', to: 'e3' } as never, {
      reverse: true,
    });

    expect(anim.glides).toBe(0);
    expect(anim.drawn).toEqual([]);
  });
});
