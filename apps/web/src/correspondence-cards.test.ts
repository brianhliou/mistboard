import { describe, expect, it } from 'vitest';
import { buildInboxCard, type PageContext } from './correspondence.js';
import type { CorrespondenceGame } from './correspondence-model.js';

// The /correspondence lists are the site's game cards (current-games.css
// .current-game-card), the same frame as /games and the homepage (2026-10-04).

function pageCtx(): PageContext {
  return { signedIn: true, isConnected: () => true, handles: [], tickers: [] };
}

const game: CorrespondenceGame = {
  roomId: 'xq_9',
  url: '/room/xq_9',
  gameSpecId: 'xiangqi',
  mySeat: 'red',
  isYourMove: true,
  opponentName: 'Bob',
  opponentHandle: 'bob_h',
  dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
};

function seats(card: HTMLElement): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>(':scope > .current-game-seat')];
}

function visibleClock(seat: HTMLElement | undefined): string | null {
  const clock = seat?.querySelector<HTMLElement>('.current-game-seat-clock');
  return clock && !clock.hidden ? clock.textContent : null;
}

describe('correspondence inbox card', () => {
  it('a Your move card: board, seats, time left on your seat, Play your move', () => {
    const card = buildInboxCard(pageCtx(), game, undefined, true);
    expect(card.classList.contains('current-game-card')).toBe(true);
    expect(card.dataset.kind).toBe('correspondence');
    expect(card.querySelector('.current-game-board')).not.toBeNull();
    const [top, bottom] = seats(card);
    // Red moves first and the board draws it at the bottom: you sit there.
    expect(top?.textContent).toContain('Bob');
    expect(bottom?.querySelector('.current-game-seat-name')?.textContent).toBe('You');
    expect(visibleClock(bottom)).toMatch(/left$/);
    expect(visibleClock(top)).toBeNull();
    const play = card.querySelector<HTMLAnchorElement>('a.correspondence-card-play');
    expect(play?.textContent).toBe('Play your move');
    expect(play?.getAttribute('href')).toBe('/room/xq_9');
    expect(card.querySelector('.current-game-chip')?.textContent).toBe('Xiangqi');
    expect(card.querySelectorAll('a a')).toHaveLength(0);
  });

  it('a Waiting card: time left on the opponent seat, no Play button', () => {
    const card = buildInboxCard(
      pageCtx(),
      { ...game, mySeat: 'black', isYourMove: false },
      undefined,
      false,
    );
    const [top, bottom] = seats(card);
    // Black moves second: you sit at the top, the opponent at the bottom.
    expect(top?.querySelector('.current-game-seat-name')?.textContent).toBe('You');
    expect(bottom?.textContent).toContain('Bob');
    expect(visibleClock(bottom)).toMatch(/left$/);
    expect(visibleClock(top)).toBeNull();
    expect(card.querySelector('.correspondence-card-play')).toBeNull();
  });

  // The badge and its bar already say how long is left; a second line restating
  // the deadline as a date (and an "Updated" time that is any event, not the
  // last move) read as three competing clocks. The exact due time is the
  // badge's tooltip instead.
  it('tells the deadline once: the badge, with the due time as its tooltip', () => {
    for (const yourMove of [true, false]) {
      const card = buildInboxCard(
        pageCtx(),
        { ...game, mySeat: yourMove ? 'red' : 'black', isYourMove: yourMove },
        undefined,
        yourMove,
      );
      expect(card.querySelector('.correspondence-card-when')).toBeNull();
      const clock = [...card.querySelectorAll<HTMLElement>('.current-game-seat-clock')].find(
        (el) => !el.hidden,
      );
      expect(clock?.title).toMatch(/^due /);
    }
  });

  it('marks a deadline under a day away as urgent', () => {
    const card = buildInboxCard(
      pageCtx(),
      { ...game, dueAt: new Date(Date.now() + 3 * 3_600_000).toISOString() },
      undefined,
      true,
    );
    expect(card.dataset.urgency).toBe('urgent');
  });
});
