import { describe, expect, it } from 'vitest';
import { BEST_STYLE } from './engine/engine-arrows.js';
import { HOVER_ARROW_INK, hoverArrowStyle } from './hover-arrow.js';
import { xiangqiHoverArrow } from './xiangqi-review.js';

describe('hover preview arrow', () => {
  it('is the engine arrow shape: solid, the best-line width', () => {
    for (const tone of ['book', 'win', 'draw', 'loss'] as const) {
      const style = hoverArrowStyle(tone);
      expect(style.dashed).toBeUndefined();
      expect(style.width).toBe(BEST_STYLE.width);
      expect(style.color).toBe(HOVER_ARROW_INK[tone]);
    }
  });

  it('inks results teal / grey / violet and the book a neutral slate, never red or green', () => {
    expect(HOVER_ARROW_INK).toEqual({
      book: '#45505c',
      win: '#016f53',
      draw: '#7a7771',
      loss: '#692db6',
    });
  });

  it('builds the xiangqi board arrow for a hovered row, and nothing on leave', () => {
    expect(xiangqiHoverArrow({ from: 'f8', to: 'd7' }, 'loss')).toEqual({
      from: 'f8',
      to: 'd7',
      width: BEST_STYLE.width,
      opacity: 0.55,
      color: '#692db6',
      className: 'xq-arrow--hover xq-arrow--hover-loss',
    });
    expect(xiangqiHoverArrow({ from: 'h3', to: 'e3' }, 'book')?.color).toBe('#45505c');
    expect(xiangqiHoverArrow(null, null)).toBeNull();
  });
});
