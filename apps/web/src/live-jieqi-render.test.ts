import { createInitialJieqiState, getJieqiPlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { renderJieqiBoardSvg } from './live-jieqi-render.js';

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
