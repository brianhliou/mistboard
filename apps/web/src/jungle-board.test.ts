import { createInitialJungleState, getJunglePlayerView, type JungleColor } from '@mistboard/game';
import { describe, expect, it, vi } from 'vitest';
import { createJungleInteractiveBoard } from './jungle-board.js';

describe('createJungleInteractiveBoard overlays', () => {
  it('patches streamed arrows in place and preserves them across renders', () => {
    const boardEl = document.createElement('div');
    const view = getJunglePlayerView(createInitialJungleState('arrow-board'), 'red');
    let perspective: JungleColor = 'red';
    const board = createJungleInteractiveBoard({
      board: boardEl,
      getInteractionView: () => view,
      getPerspective: () => perspective,
      seatFor: (current) => (current.status.type === 'playing' ? current.status.turn : null),
      enabled: () => true,
      onMove: vi.fn(),
    });

    board.render(view, perspective);
    const svgBefore = boardEl.querySelector('svg');
    board.setArrows([
      {
        from: 'a1',
        to: 'b2',
        className: 'xq-arrow--pv1',
        opacity: 0.4,
        width: 14,
      },
    ]);

    expect(boardEl.querySelector('svg')).toBe(svgBefore);
    expect(boardEl.querySelector('.xq-arrow--pv1')).not.toBeNull();

    perspective = 'black';
    board.render(view, perspective);
    expect(boardEl.querySelector('.xq-arrow--pv1')).not.toBeNull();

    board.setArrows([]);
    expect(boardEl.querySelector('.xq-arrow--pv1')).toBeNull();
  });

  it('draws the review glyph marker in place and keeps it across renders', () => {
    const boardEl = document.createElement('div');
    const view = getJunglePlayerView(createInitialJungleState('marker-board'), 'red');
    const board = createJungleInteractiveBoard({
      board: boardEl,
      getInteractionView: () => view,
      getPerspective: () => 'red',
      seatFor: (current) => (current.status.type === 'playing' ? current.status.turn : null),
      enabled: () => true,
      onMove: vi.fn(),
    });

    board.render(view, 'red');
    const svgBefore = boardEl.querySelector('svg');
    board.setMarkers([{ square: 'a1', kind: 'circle', className: 'engine-marker--pv1', width: 5 }]);
    expect(boardEl.querySelector('svg')).toBe(svgBefore);
    expect(boardEl.querySelector('.jungle-board-markers')?.innerHTML).not.toBe('');

    board.render(view, 'red');
    expect(boardEl.querySelector('.jungle-board-markers')?.innerHTML).not.toBe('');

    board.setMarkers([]);
    expect(boardEl.querySelector('.jungle-board-markers')?.innerHTML).toBe('');
  });
});
