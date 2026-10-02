import { describe, expect, it } from 'vitest';
import { placeHiddenPoolUnderBoard } from './hidden-pool-placement.js';

// The face-down tally lives under the flip variants' boards (banqi, flip
// jungle) from the two-column layout up (the right rail needs its height for
// the table, 2026-10-02 incident), and at the foot of the table on a phone,
// where the seat row hugs the board. The
// layout itself is checked in a real browser by scripts/room-layout-check.mjs.

function room() {
  const host = document.createElement('div');
  host.innerHTML = `
    <div class="review-shell__center"><div class="board-shell"><div data-board></div></div></div>
    <section class="game-console"><div data-captures></div><div data-hidden-pool></div><p data-clocks-note></p></section>`;
  const board = host.querySelector<HTMLDivElement>('[data-board]') as HTMLDivElement;
  const hiddenPool = host.querySelector<HTMLDivElement>('[data-hidden-pool]') as HTMLDivElement;
  return { host, refs: { board, hiddenPool } };
}

function fakeMedia(matches: boolean) {
  const listeners: ((event: { matches: boolean }) => void)[] = [];
  return {
    media: {
      matches,
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
        listeners.push(listener);
      },
    } as unknown as MediaQueryList,
    change: (next: boolean) => {
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

describe('face-down tally placement', () => {
  it('sits under the board in the centre column on a wide layout', () => {
    const { host, refs } = room();
    placeHiddenPoolUnderBoard(refs, fakeMedia(true).media);
    expect(refs.hiddenPool.parentElement?.className).toBe('review-shell__center');
    expect(refs.hiddenPool.previousElementSibling?.className).toBe('board-shell');
    expect(refs.hiddenPool.classList.contains('hidden-pool--under-board')).toBe(true);
    expect(host.querySelectorAll('[data-hidden-pool]')).toHaveLength(1);
  });

  it('stays at the foot of the table on a phone, and follows a resize both ways', () => {
    const { refs } = room();
    const { media, change } = fakeMedia(false);
    placeHiddenPoolUnderBoard(refs, media);
    expect(refs.hiddenPool.parentElement?.className).toBe('game-console');

    change(true);
    expect(refs.hiddenPool.parentElement?.className).toBe('review-shell__center');

    change(false);
    // Back in its own slot: after the captures strip, before the clocks note.
    expect(refs.hiddenPool.parentElement?.className).toBe('game-console');
    expect(refs.hiddenPool.previousElementSibling?.hasAttribute('data-captures')).toBe(true);
    expect(refs.hiddenPool.nextElementSibling?.hasAttribute('data-clocks-note')).toBe(true);
    expect(refs.hiddenPool.classList.contains('hidden-pool--under-board')).toBe(false);
  });
});
