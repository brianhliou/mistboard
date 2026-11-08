import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachAbortCountdownBubble, placeBoardCenterBubble } from './live-abort-bubble.js';

// The phone room shows the abort countdown over the board instead of as a line
// under the viewer's seat: that line pushed the action bar 14px off a 320x568
// screen at game start (#576). Desktop keeps the line.

function room(): { controls: HTMLDivElement; stage: HTMLDivElement; countdown: HTMLSpanElement } {
  const stage = document.createElement('div');
  stage.className = 'board-stage';
  const board = document.createElement('div');
  board.dataset.board = '';
  stage.append(board);
  const controls = document.createElement('div');
  controls.className = 'game-controls';
  const countdown = document.createElement('span');
  countdown.className = 'abort-countdown';
  countdown.dataset.abortCountdown = '';
  countdown.textContent = 'Make your first move, aborting in 30s';
  controls.append(countdown);
  document.body.append(stage, controls);
  return { controls, stage, countdown };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.replaceChildren();
});

describe('abort countdown bubble', () => {
  it('shows the countdown over the board on a phone and hides the column line', () => {
    const { controls, stage, countdown } = room();
    attachAbortCountdownBubble(controls, stage, { isPhone: () => true });
    const bubble = stage.querySelector<HTMLElement>('[data-abort-bubble]');
    expect(bubble?.textContent).toBe('Make your first move, aborting in 30s');
    expect(bubble?.classList.contains('abort-bubble')).toBe(true);
    expect(countdown.hasAttribute('data-board-bubble')).toBe(true);
  });

  it('follows the ticking text and goes when the countdown does', async () => {
    const { controls, stage, countdown } = room();
    attachAbortCountdownBubble(controls, stage, { isPhone: () => true });
    countdown.textContent = 'Make your first move, aborting in 29s';
    await flush();
    expect(stage.querySelector('[data-abort-bubble]')?.textContent).toBe(
      'Make your first move, aborting in 29s',
    );
    // The first move landed: the room stack re-renders the controls without it.
    controls.replaceChildren();
    await flush();
    expect(stage.querySelector('[data-abort-bubble]')).toBeNull();
  });

  it('picks up a countdown the controls render later', async () => {
    const { controls, stage, countdown } = room();
    countdown.remove();
    attachAbortCountdownBubble(controls, stage, { isPhone: () => true });
    expect(stage.querySelector('[data-abort-bubble]')).toBeNull();
    controls.append(countdown);
    await flush();
    expect(stage.querySelector('[data-abort-bubble]')?.textContent).toContain('30s');
  });

  it('leaves desktop on the column line', () => {
    const { controls, stage, countdown } = room();
    attachAbortCountdownBubble(controls, stage, { isPhone: () => false });
    expect(stage.querySelector('[data-abort-bubble]')).toBeNull();
    expect(countdown.hasAttribute('data-board-bubble')).toBe(false);
  });

  it('hides the column line only while the bubble shows it', () => {
    const css = readFileSync(resolve(__dirname, 'live-abort-bubble.css'), 'utf-8');
    expect(css).toMatch(
      /\.game-controls > \.abort-countdown\[data-board-bubble\]\s*\{\s*display:\s*none;/,
    );
    // The convention: an overlay that never takes a tap.
    const bubble = css.slice(css.indexOf('.abort-bubble {'));
    expect(bubble.slice(0, bubble.indexOf('}'))).toMatch(
      /position: absolute;[\s\S]*pointer-events: none;/,
    );
  });
});

describe('placeBoardCenterBubble', () => {
  const board = { left: 0, top: 10, width: 300, height: 330 };

  it('sizes to the board, not to a drawing inside one of its tiles', () => {
    // The mahjong table is a board of tiles, each with its own piece svg. Read
    // as "the board", the first tile's 44px drawing squeezed the bubble to one
    // word a line on a phone.
    const { controls, stage } = room();
    const board = stage.querySelector<HTMLElement>('[data-board]')!;
    const tile = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const slot = document.createElement('span');
    slot.append(tile);
    board.append(slot);
    const rect = (left: number, width: number) => () =>
      ({ left, top: 0, width, height: width, right: left + width, bottom: width }) as DOMRect;
    stage.getBoundingClientRect = rect(0, 390);
    board.getBoundingClientRect = rect(3, 384);
    tile.getBoundingClientRect = rect(60, 44);
    attachAbortCountdownBubble(controls, stage, { isPhone: () => true });
    const bubble = stage.querySelector<HTMLElement>('[data-abort-bubble]');
    expect(bubble?.style.getPropertyValue('--abort-bubble-board-max')).toBe('372px');
  });

  it('centres the bubble on the board', () => {
    expect(placeBoardCenterBubble(board, { width: 200, height: 30 })).toEqual({
      left: 50,
      top: 10 + 150,
    });
  });

  it('clamps a bubble as wide as the board inside its edges', () => {
    const placed = placeBoardCenterBubble(board, { width: 320, height: 30 });
    expect(placed.left).toBe(6);
  });
});
