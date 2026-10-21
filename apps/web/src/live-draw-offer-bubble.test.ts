import { afterEach, describe, expect, it } from 'vitest';
import { attachDrawOfferBubble, type DrawOfferBubbleTimers } from './live-draw-offer-bubble.js';

// The opponent's draw offer shows over the board for a reading time (#530);
// the Accept and Decline buttons stay in the column.

function room(): { controls: HTMLDivElement; stage: HTMLDivElement } {
  const stage = document.createElement('div');
  stage.className = 'board-stage';
  const board = document.createElement('div');
  board.dataset.board = '';
  stage.append(board);
  const controls = document.createElement('div');
  controls.className = 'game-controls';
  document.body.append(stage, controls);
  return { controls, stage };
}

function note(text = 'Your opponent offers a draw'): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'draw-offer-note';
  el.dataset.drawOfferNote = '';
  el.textContent = text;
  return el;
}

function fakeTimers(): DrawOfferBubbleTimers & { fire(): void; delays: number[] } {
  let pending: (() => void) | null = null;
  const delays: number[] = [];
  return {
    delays,
    setTimeout(fn, ms) {
      pending = fn;
      delays.push(ms);
      return 1;
    },
    clearTimeout() {
      pending = null;
    },
    fire() {
      const fn = pending;
      pending = null;
      fn?.();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const bubbleOf = (stage: HTMLElement) =>
  stage.querySelector<HTMLElement>('[data-draw-offer-bubble]');

afterEach(() => {
  document.body.replaceChildren();
});

describe('draw offer bubble', () => {
  it('shows the offer over the board and leaves the column line in place', async () => {
    const { controls, stage } = room();
    attachDrawOfferBubble(controls, stage, { timers: fakeTimers() });
    expect(bubbleOf(stage)).toBeNull();
    const line = note();
    controls.append(line);
    await flush();
    const bubble = bubbleOf(stage);
    expect(bubble?.textContent).toBe('Your opponent offers a draw');
    expect(bubble?.classList.contains('draw-offer-bubble')).toBe(true);
    expect(line.isConnected).toBe(true);
  });

  it('goes after its reading time and stays gone while the same offer is pending', async () => {
    const { controls, stage } = room();
    const timers = fakeTimers();
    controls.append(note());
    attachDrawOfferBubble(controls, stage, { timers });
    expect(timers.delays).toEqual([6000]);
    timers.fire();
    expect(bubbleOf(stage)).toBeNull();
    // The chrome re-renders the controls on every frame: the same offer.
    controls.replaceChildren(note());
    await flush();
    expect(bubbleOf(stage)).toBeNull();
  });

  it('goes on the next tap on the board', () => {
    const { controls, stage } = room();
    controls.append(note());
    attachDrawOfferBubble(controls, stage, { timers: fakeTimers() });
    expect(bubbleOf(stage)).not.toBeNull();
    stage.dispatchEvent(new Event('pointerdown'));
    expect(bubbleOf(stage)).toBeNull();
  });

  it('goes when the offer ends and shows again for a new one', async () => {
    const { controls, stage } = room();
    controls.append(note());
    attachDrawOfferBubble(controls, stage, { timers: fakeTimers() });
    controls.replaceChildren();
    await flush();
    expect(bubbleOf(stage)).toBeNull();
    controls.append(note());
    await flush();
    expect(bubbleOf(stage)).not.toBeNull();
  });
});
