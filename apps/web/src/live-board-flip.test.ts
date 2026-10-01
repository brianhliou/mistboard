import { afterEach, describe, expect, it } from 'vitest';
import { isFlipShortcut } from './game-table.js';
import { flippedBottom, resetBoardFlip, toggleBoardFlip } from './live-board-flip.js';

afterEach(() => resetBoardFlip());

describe('chess-shell board flip', () => {
  it('turns the bottom colour over and back', () => {
    expect(flippedBottom('white')).toBe('white');
    toggleBoardFlip();
    expect(flippedBottom('white')).toBe('black');
    toggleBoardFlip();
    expect(flippedBottom('white')).toBe('white');
  });
});

describe('isFlipShortcut', () => {
  it('takes a bare f, not a modified one or one typed into a field', () => {
    expect(isFlipShortcut(new KeyboardEvent('keydown', { key: 'f' }))).toBe(true);
    expect(isFlipShortcut(new KeyboardEvent('keydown', { key: 'F' }))).toBe(true);
    expect(isFlipShortcut(new KeyboardEvent('keydown', { key: 'f', metaKey: true }))).toBe(false);
    const input = document.createElement('input');
    document.body.append(input);
    const typed = new KeyboardEvent('keydown', { key: 'f', bubbles: true });
    let result: boolean | null = null;
    input.addEventListener('keydown', (event) => {
      result = isFlipShortcut(event);
    });
    input.dispatchEvent(typed);
    expect(result).toBe(false);
    input.remove();
  });
});
