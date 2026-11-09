import { createInitialJieqiState, getJieqiPlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { JIEQI_PIECE_PX, renderJieqiBoardSvg } from './live-jieqi-render.js';

describe('renderJieqiBoardSvg', () => {
  const view = getJieqiPlayerView(createInitialJieqiState('render'), 'red');

  it('renders a 9x10 board with no river tint and no fog', () => {
    const svg = renderJieqiBoardSvg(view);
    expect(svg).toContain('viewBox="0 0 660 732"');
    // The river is the plain board background, matching the xiangqi board: no
    // tinted river overlay (the old `.jieqi-river` rect made the river darker).
    expect(svg).not.toContain('jieqi-river');
    // Jieqi positions are public: there is no fog mask of any kind.
    expect(svg).not.toContain('mask');
    expect(svg.toLowerCase()).not.toContain('fog');
  });

  it('reveals generals and hides every dealt identity', () => {
    const svg = renderJieqiBoardSvg(view);
    expect(svg).toContain('aria-label="red general"');
    expect(svg).toContain('aria-label="black general"');
    const hidden = svg.match(/hidden piece/g) ?? [];
    expect(hidden).toHaveLength(30);
  });

  it('emits an interactive hit layer only when asked', () => {
    expect(renderJieqiBoardSvg(view)).not.toContain('data-square');
    const interactive = renderJieqiBoardSvg(view, 'red', { interactive: true });
    expect(interactive).toContain('data-square="e1"');
    expect(interactive).toContain('data-square="e10"');
  });

  it('draws move hints and a selection ring for the side to move', () => {
    const svg = renderJieqiBoardSvg(view, 'red', {
      selectedSquare: 'a1',
      legalMoves: view.legalMoves.filter((move) => move.from === 'a1'),
    });
    expect(svg).toContain('jieqi-selection');
    expect(svg).toContain('jieqi-hint');
  });

  for (const layout of ['intersection', 'cell'] as const) {
    for (const perspective of ['red', 'black'] as const) {
      it.each([false, true])(
        `keeps layout-specific capture hints below all flat pieces (${layout}, ${perspective}, interactive=%s)`,
        (interactive) => {
          // The covered cannon on b3 can take b10 over the covered piece on b8.
          const moves = view.legalMoves.filter((move) => move.from === 'b3');
          expect(moves.some((move) => move.to === 'b10')).toBe(true);
          const svg = renderJieqiBoardSvg(view, perspective, {
            layout,
            interactive,
            tile3d: false,
            pieceSet: 'traditional',
            selectedSquare: 'b3',
            legalMoves: moves,
          });
          const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
          const circles = [...doc.querySelectorAll('circle.jieqi-hint-capture')];
          const fills = [...doc.querySelectorAll('rect.jieqi-hint-capture-fill')];
          const captureCount = moves.filter((move) => view.board[move.to]).length;
          expect(captureCount).toBeGreaterThan(0);
          expect(circles).toHaveLength(layout === 'intersection' ? captureCount : 0);
          expect(fills).toHaveLength(layout === 'cell' ? captureCount : 0);
          for (const circle of circles) {
            expect(Number(circle.getAttribute('r'))).toBeGreaterThan(JIEQI_PIECE_PX / 2);
          }
          for (const fill of fills) {
            // A full cell with no stroke cannot bleed into a neighbour or river.
            const bounds = ['x', 'y', 'width', 'height'];
            const cells = [...doc.querySelectorAll('rect.xq-live-cell')];
            expect(
              cells.some((cell) =>
                bounds.every((attr) => cell.getAttribute(attr) === fill.getAttribute(attr)),
              ),
            ).toBe(true);
            expect(fill.getAttribute('style')).toContain('stroke: none');
          }
          for (const hint of [...circles, ...fills]) {
            const index = svg.indexOf(`<${hint.tagName} class="${hint.getAttribute('class')}"`);
            expect(index).toBeGreaterThan(-1);
            expect(index).toBeLessThan(svg.indexOf('<g class="jieqi-piece-slot'));
          }
        },
      );
    }
  }

  it('keeps a repetition-loss capture marked only by its warning', () => {
    const svg = renderJieqiBoardSvg(view, 'red', {
      interactive: true,
      tile3d: false,
      selectedSquare: 'b3',
      legalMoves: [{ from: 'b3', to: 'b10' }],
      repetitionLossPoints: new Set(['b10']),
    });
    expect(svg).toContain('data-repetition-loss="b10"');
    expect(svg).not.toContain('jieqi-hint-capture');
  });

  it('renders target hover highlights inside the interactive hit layer', () => {
    const svg = renderJieqiBoardSvg(view, 'red', {
      interactive: true,
      selectedSquare: 'a1',
      legalMoves: view.legalMoves.filter((move) => move.from === 'a1'),
    });

    expect(svg).toContain('jieqi-hit--target');
    expect(svg).toContain('jieqi-target-hover');
  });

  it('marks the dragged source as a translucent origin shadow', () => {
    const svg = renderJieqiBoardSvg(view, 'red', { draggingFrom: 'a1' });

    expect(svg).toContain('jieqi-piece jieqi-piece--drag-source');
  });

  it('renders ranked engine arrows over the pieces and flips their geometry', () => {
    const arrow = {
      from: 'e4' as const,
      to: 'e5' as const,
      className: 'xq-arrow--pv1',
      opacity: 0.4,
      width: 14,
    };
    const red = renderJieqiBoardSvg(view, 'red', { arrows: [arrow] });
    const black = renderJieqiBoardSvg(view, 'black', { arrows: [arrow] });

    expect(red).toContain('jieqi-board-arrows xq-live-arrows');
    expect(red).toContain('xq-arrow xq-arrow--pv1');
    expect(red).toContain('stroke-width="14"');
    expect(red).not.toBe(black);
  });
});

describe('jieqi start markers', () => {
  it('marks the 14 standard points the face-down pieces are dealt onto', () => {
    const view = getJieqiPlayerView(createInitialJieqiState('jq-start-marks'), 'red');
    const svg = renderJieqiBoardSvg(view);
    expect(svg.split('class="xq-live-start-mark"').length - 1).toBe(14);
  });
});
