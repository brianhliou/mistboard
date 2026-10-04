import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChallengeCard, type ChallengeView } from './challenge-accept.js';
import { appendVsLabel, renderChallenges } from './correspondence.js';
import type { CorrespondenceGame } from './correspondence-model.js';
import { corrSeekRow } from './landing-play.js';
import { buildSeekCard } from './seek-card.js';

// Player names on the correspondence surfaces link to the player's profile the
// way the rest of the site does, from the handle the server sends and nothing
// else: no handle (a private or closed account) means plain text, and the name
// is never turned into a handle.

function nestedAnchors(root: Element): number {
  return root.querySelectorAll('a a').length;
}

const game: CorrespondenceGame = {
  roomId: 'xq_1',
  url: '/room/xq_1',
  gameSpecId: 'xiangqi',
  mySeat: 'red',
  isYourMove: true,
  opponentName: 'Bob',
  opponentHandle: 'bob_h',
  dueAt: new Date(Date.now() + 86_400_000).toISOString(),
};

describe('correspondence game card: vs <opponent>', () => {
  it('links the opponent to /@/<handle>', () => {
    const host = document.createElement('h3');
    appendVsLabel(host, game);
    expect(host.textContent).toBe('vs Bob');
    const link = host.querySelector('a.player-name-link');
    expect(link?.getAttribute('href')).toBe('/@/bob_h');
    expect(link?.textContent).toBe('Bob');
  });

  it('keeps the name plain without a handle, and never builds one from the name', () => {
    const host = document.createElement('h3');
    appendVsLabel(host, { ...game, opponentHandle: null });
    expect(host.textContent).toBe('vs Bob');
    expect(host.querySelector('a')).toBeNull();

    const fallback = document.createElement('h3');
    appendVsLabel(fallback, { ...game, opponentName: null, opponentHandle: undefined });
    expect(fallback.textContent).toBe('vs Opponent');
    expect(fallback.querySelector('a')).toBeNull();
  });
});

describe('seek card creator', () => {
  const seek = { id: 'seek_1', gameSpecId: 'xiangqi', daysPerMove: 3, creatorName: 'Erin' };

  it('links an account with a handle, beside (not inside) the card-wide link', () => {
    const card = buildSeekCard({ ...seek, creatorHandle: 'erin' }, { href: '/challenge/seek_1' });
    const link = card.querySelector('.current-game-seat-name');
    expect(link?.tagName).toBe('A');
    expect(link?.getAttribute('href')).toBe('/@/erin');
    expect(card.querySelector('a.current-game-open')).not.toBeNull();
    expect(nestedAnchors(card)).toBe(0);
  });

  it('renders plain text with no handle', () => {
    const card = buildSeekCard({ ...seek, creatorHandle: null }, { href: '/challenge/seek_1' });
    const name = card.querySelector('.current-game-seat-name');
    expect(name?.tagName).toBe('SPAN');
    expect(name?.textContent).toBe('Erin');
    expect(card.querySelectorAll('a.player-name-link')).toHaveLength(0);
  });
});

describe('homepage lobby correspondence row', () => {
  const seek = {
    id: 'seek_2',
    gameSpecId: 'xiangqi',
    daysPerMove: 2,
    creatorName: 'Erin',
    isMine: false,
  };

  it('links the creator when the server sent a handle', () => {
    const row = corrSeekRow({ ...seek, creatorHandle: 'erin' }, 'en');
    const link = row.querySelector('a.player-name-link');
    expect(link?.getAttribute('href')).toBe('/@/erin');
    expect(link?.textContent).toBe('Erin');
    expect(nestedAnchors(row)).toBe(0);
  });

  it('keeps the creator plain without one', () => {
    const row = corrSeekRow(seek, 'en');
    expect(row.querySelector('a.player-name-link')).toBeNull();
    expect(row.textContent).toContain('Erin');
  });
});

describe('outgoing directed challenge row', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const directed = {
    id: 'seek_3',
    gameSpecId: 'xiangqi',
    daysPerMove: 3,
    preferredColor: 'random',
    rated: false,
    visibility: 'private',
    targetName: 'Finn',
    challengeUrl: null,
    expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
  };

  async function render(seeks: unknown[]): Promise<HTMLElement> {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ limit: 6, seeks }), { status: 200 })),
    );
    const host = document.createElement('section');
    await renderChallenges(host, () => {});
    return host;
  }

  it('links the recipient by handle', async () => {
    const host = await render([{ ...directed, targetHandle: 'finn' }]);
    const name = host.querySelector('[data-seek-id="seek_3"] .correspondence-row-name');
    expect(name?.textContent).toBe('Challenge to Finn');
    expect(name?.querySelector('a.player-name-link')?.getAttribute('href')).toBe('/@/finn');
  });

  it('keeps a recipient with no handle plain', async () => {
    const host = await render([{ ...directed, targetHandle: null }]);
    const name = host.querySelector('[data-seek-id="seek_3"] .correspondence-row-name');
    expect(name?.textContent).toBe('Challenge to Finn');
    expect(name?.querySelector('a')).toBeNull();
  });
});

describe('challenge page heading', () => {
  const view: ChallengeView = {
    id: 'seek_4',
    gameSpecId: 'xiangqi',
    daysPerMove: 3,
    preferredColor: 'random',
    visibility: 'private',
    challengerName: 'Erin',
    isMine: false,
    canAccept: true,
    canDecline: false,
    expired: false,
  };

  it('links the challenger by handle', () => {
    const heading = buildChallengeCard({ ...view, challengerHandle: 'erin' }).querySelector('h1');
    expect(heading?.textContent).toBe('Erin challenged you');
    expect(heading?.querySelector('a.player-name-link')?.getAttribute('href')).toBe('/@/erin');
  });

  it('keeps the challenger plain without a handle', () => {
    const heading = buildChallengeCard(view).querySelector('h1');
    expect(heading?.textContent).toBe('Erin challenged you');
    expect(heading?.querySelector('a')).toBeNull();
  });
});
