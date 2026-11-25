import { describe, expect, it, vi } from 'vitest';
import {
  abortedGameActions,
  postGameActions,
  renderGameResult,
  resultScore,
} from './postgame-panel.js';

vi.mock('./analytics.js', () => ({
  track: vi.fn(),
  trackCorrespondenceSeekPosted: vi.fn(),
}));

function labels(box: HTMLElement): string[] {
  return [...box.children].map((child) => child.textContent ?? '');
}

describe('postGameActions', () => {
  // "Play again by correspondence" (#606) was removed on 2026-11-25: no finished
  // game offers it, after a live game between two accounts or a correspondence one.
  it.each(['pvp', 'correspondence'])(
    'offers no correspondence play-again after a finished %s game between two accounts',
    (mode) => {
      const rematch = document.createElement('button');
      rematch.textContent = 'Rematch';
      const seated = postGameActions({
        variant: 'xiangqi',
        mode,
        seated: true,
        rematch,
        reviewHref: '/game/room-1',
      });
      expect(labels(seated).slice(0, 2)).toEqual(['Rematch', 'Review game']);
      expect(labels(seated)).not.toContain('Play again by correspondence');
      expect(seated.querySelector('[data-correspondence-again]')).toBeNull();
      expect(seated.querySelector('.postgame-actions__correspondence')).toBeNull();
      expect(seated.textContent?.toLowerCase()).not.toContain('by correspondence');
    },
  );

  it('gives a spectator only the review', () => {
    const box = postGameActions({
      variant: 'xiangqi',
      mode: 'pve',
      seated: false,
      rematch: document.createElement('button'),
      reviewHref: '/game/x',
    });
    expect(labels(box)).toEqual(['Review game']);
  });

  // #618: a lone action rides in the phone room's bottom bar (live-review.css);
  // two or more, or a rematch offer block, keep the band.
  it('marks a lone action for the bar and leaves groups and rematch blocks alone', () => {
    const spectator = postGameActions({
      variant: 'xiangqi',
      mode: 'pvp',
      seated: false,
      rematch: null,
      reviewHref: '/game/x',
    });
    expect(spectator.classList.contains('postgame-actions--solo')).toBe(true);
    const seated = postGameActions({
      variant: 'xiangqi',
      mode: 'pvp',
      seated: true,
      rematch: null,
      reviewHref: '/game/x',
    });
    expect(seated.classList.contains('postgame-actions--solo')).toBe(false);
    const offer = document.createElement('div');
    offer.className = 'room-rematch';
    const offerOnly = postGameActions({
      variant: 'no-such-variant',
      mode: 'pvp',
      seated: true,
      rematch: offer,
      reviewHref: null,
    });
    expect(offerOnly.children).toHaveLength(1);
    expect(offerOnly.classList.contains('postgame-actions--solo')).toBe(false);
  });

  // #1235: Review game is second, the accent outline under the filled rematch.
  it('orders a seated bot game rematch, review, new game, then the friend invite', () => {
    const rematch = document.createElement('button');
    rematch.textContent = 'Rematch';
    const box = postGameActions({
      variant: 'xiangqi',
      mode: 'pve',
      seated: true,
      rematch,
      reviewHref: '/game/x',
    });
    // A bot game's second action is "New game" (the dialog reopens on the same
    // bot), not "New opponent" (lichess's post-AI-game label).
    expect(labels(box)).toEqual(['Rematch', 'Review game', 'New game', 'Challenge a friend']);
    expect(rematch.classList.contains('postgame-actions__rematch')).toBe(true);
    const review = box.children[1] as HTMLAnchorElement;
    expect(review.classList.contains('postgame-actions__review')).toBe(true);
    expect(review.getAttribute('href')).toBe('/game/x');
    // Only the review link carries the outline class.
    expect(box.querySelectorAll('.postgame-actions__review')).toHaveLength(1);
    const newGame = box.children[2] as HTMLAnchorElement;
    expect(newGame.getAttribute('href')).toContain('play=computer');
    expect(newGame.classList.contains('postgame-actions__review')).toBe(false);
  });

  it('sends a PvP player to Find opponent, then offers the friend invite', () => {
    const box = postGameActions({
      variant: 'xiangqi',
      mode: 'pvp',
      seated: true,
      rematch: null,
      reviewHref: '/game/x',
    });
    // No rematch: Review game leads.
    expect(labels(box)).toEqual(['Review game', 'New opponent', 'Challenge a friend']);
    expect(box.children[0]?.classList.contains('postgame-actions__review')).toBe(true);
    expect((box.children[1] as HTMLAnchorElement).getAttribute('href')).toContain('play=lobby');
  });

  it('keeps the rest in order when there is no review link', () => {
    const rematch = document.createElement('button');
    rematch.textContent = 'Rematch';
    const box = postGameActions({
      variant: 'xiangqi',
      mode: 'pvp',
      seated: true,
      rematch,
      reviewHref: null,
    });
    expect(labels(box)).toEqual(['Rematch', 'New opponent', 'Challenge a friend']);
    expect(box.querySelector('.postgame-actions__review')).toBeNull();
  });

  it('drops New opponent for a variant the play dialog would not open', () => {
    const box = postGameActions({
      variant: 'no-such-variant',
      mode: 'pve',
      seated: true,
      rematch: null,
      reviewHref: '/game/x',
    });
    expect(labels(box)).toEqual(['Review game']);
  });
});

describe('abortedGameActions', () => {
  // A bot game that never started still leads back to the bot picker; a PvP
  // abort and a variant with no setup deep link offer nothing.
  it('offers only New game after an aborted bot game', () => {
    const box = abortedGameActions('xiangqi', 'pve');
    expect(box && labels(box)).toEqual(['New game']);
    expect(box?.querySelector('a')?.getAttribute('href')).toBe('/?play=computer&variant=xiangqi');
    expect(box?.classList.contains('postgame-actions--solo')).toBe(true);
    expect(abortedGameActions('xiangqi', 'pvp')).toBeNull();
    expect(abortedGameActions(undefined, 'pve')).toBeNull();
    expect(abortedGameActions('not-a-variant', 'pve')).toBeNull();
  });
});

describe('renderGameResult', () => {
  function tableFixture() {
    const console = document.createElement('section');
    console.className = 'game-console';
    const anchor = document.createElement('div');
    const result = document.createElement('div');
    result.dataset.gameResult = '';
    result.hidden = true;
    console.append(anchor, result);
    return { anchor, result };
  }

  it('fills and clears the result block', () => {
    const { anchor, result } = tableFixture();
    renderGameResult(anchor, { score: resultScore(1), summary: 'Checkmate • Black is victorious' });
    expect(result.hidden).toBe(false);
    expect(result.textContent).toBe('0-1Checkmate • Black is victorious');
    renderGameResult(anchor, null);
    expect(result.hidden).toBe(true);
    expect(result.textContent).toBe('');
  });

  it('scores draws and first-seat wins', () => {
    expect(resultScore(null)).toBe('½-½');
    expect(resultScore(0)).toBe('1-0');
  });
});
