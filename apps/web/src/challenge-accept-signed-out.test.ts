import { describe, expect, it, vi } from 'vitest';

vi.mock('./start-position-board.js', () => ({
  renderStartPositionSvg: () => Promise.resolve(null),
}));

import { buildSignedOutChallengeCard, parseChallengePreview } from './challenge-accept.js';

// #1058: a signed-out visitor holding a /challenge link sees who is asking, the
// game and the pace, then "Sign in to play", instead of a bare sign-in notice.
describe('signed-out challenge preview', () => {
  it('heads the card with the challenger, game and pace above Sign in to play', () => {
    const preview = parseChallengePreview({
      gameSpecId: 'xiangqi',
      daysPerMove: 3,
      preferredColor: 'random',
      visibility: 'private',
      challengerName: 'Alice',
      challengerHandle: 'alice',
      rated: false,
    });
    expect(preview).not.toBeNull();
    const card = buildSignedOutChallengeCard(preview!, 'seek_1');
    expect(card.querySelector('h1')?.textContent).toBe('Alice challenged you');
    const terms = card.querySelector('.challenge-subhead')?.textContent ?? '';
    expect(terms).toContain('Xiangqi');
    expect(terms).toContain('3 days');
    const signIn = card.querySelector<HTMLAnchorElement>('a.challenge-btn');
    expect(signIn?.textContent).toBe('Sign in to play');
    expect(signIn?.getAttribute('href')).toContain('seek_1');
    // The board slot comes before the words, as on the signed-in card.
    expect(card.firstElementChild?.className).toBe('challenge-board');
    // No accept or decline control for a visitor with no account.
    expect(card.querySelector('button')).toBeNull();
  });

  it('reads an open board seek as someone looking for a game', () => {
    const card = buildSignedOutChallengeCard(
      parseChallengePreview({
        gameSpecId: 'xiangqi',
        daysPerMove: 2,
        visibility: 'public',
        challengerName: 'Bob',
      })!,
      'seek_2',
    );
    expect(card.querySelector('h1')?.textContent).toContain('Bob');
    expect(card.querySelector('h1')?.textContent).not.toContain('challenged you');
  });

  it('refuses a preview with no game', () => {
    expect(parseChallengePreview(null)).toBeNull();
    expect(parseChallengePreview({ daysPerMove: 3 })).toBeNull();
    expect(parseChallengePreview({ gameSpecId: 'xiangqi' })).toBeNull();
  });
});
