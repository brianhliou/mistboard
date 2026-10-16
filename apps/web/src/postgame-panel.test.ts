import { describe, expect, it, vi } from 'vitest';
import { postGameActions, renderGameResult, resultScore } from './postgame-panel.js';

vi.mock('./analytics.js', () => ({ track: vi.fn() }));

function labels(box: HTMLElement): string[] {
  return [...box.children].map((child) => child.textContent ?? '');
}

describe('postGameActions', () => {
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

  it('orders a seated bot game rematch, new game, review, then the friend invite', () => {
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
    expect(labels(box)).toEqual(['Rematch', 'New game', 'Review game', 'Challenge a friend']);
    expect(rematch.classList.contains('postgame-actions__rematch')).toBe(true);
    const newOpponent = box.children[1] as HTMLAnchorElement;
    expect(newOpponent.getAttribute('href')).toContain('play=computer');
  });

  it('sends a PvP player to Find opponent and offers no friend invite', () => {
    const box = postGameActions({
      variant: 'xiangqi',
      mode: 'pvp',
      seated: true,
      rematch: null,
      reviewHref: '/game/x',
    });
    expect(labels(box)).toEqual(['New opponent', 'Review game']);
    expect((box.children[0] as HTMLAnchorElement).getAttribute('href')).toContain('play=lobby');
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
