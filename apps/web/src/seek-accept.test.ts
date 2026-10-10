import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildChallengeCard,
  buildClosedNotice,
  buildGoneNotice,
  type ChallengeView,
} from './challenge-accept.js';
import { buildGamesSeekCard } from './current-games.js';
import { corrSeekRow } from './landing-play.js';
import { buildSeekAcceptAction, seekAcceptErrorText, seekSignInHref } from './seek-accept.js';

// Open correspondence seeks are accepted in place wherever they are listed, and
// the /challenge page reads as an open seek or a challenge from `visibility`.

const seek = { id: 'seek_9', gameSpecId: 'jieqi', daysPerMove: 3, creatorName: 'Erin' };

function stubAccept(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('seek sign-in link', () => {
  it('uses the sign-in tab and the referrer the account page reads back', () => {
    expect(seekSignInHref('seek_9', 'en')).toBe(
      '/account?tab=login&referrer=%2Fchallenge%2Fseek_9',
    );
    const params = new URLSearchParams(seekSignInHref('a/b', 'en').split('?')[1]);
    expect(params.get('tab')).toBe('login');
    expect(params.get('referrer')).toBe('/challenge/a%2Fb');
    expect(params.has('return')).toBe(false);
  });

  it('is what a signed-out Accept links to', () => {
    const link = buildSeekAcceptAction({
      className: 'x',
      seek,
      signedIn: false,
      surface: 'games',
    });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/account?tab=login&referrer=%2Fchallenge%2Fseek_9');
  });
});

describe('accept error copy', () => {
  it('reads the same for a public seek taken, withdrawn or expired', () => {
    for (const code of ['seek_taken', 'seek_not_found', 'challenge_expired']) {
      expect(seekAcceptErrorText(code, 'public', 'en')).toBe('This seek is no longer open.');
    }
  });

  it('keeps challenge wording for a private link and maps seek_not_found', () => {
    expect(seekAcceptErrorText('seek_not_found', 'private', 'en')).toBe(
      'This challenge is no longer open.',
    );
    expect(seekAcceptErrorText('seek_taken', 'private', 'en')).toBe(
      'This challenge is no longer open.',
    );
    expect(seekAcceptErrorText('challenge_expired', 'private', 'en')).toBe(
      'This challenge has expired.',
    );
    expect(seekAcceptErrorText('boom', 'public', 'en')).toBe('Could not accept. Try again.');
  });
});

describe('/games seek card', () => {
  it('accepts in place: POSTs accept and goes to the room, never to /challenge', async () => {
    const fetchMock = stubAccept(200, { url: '/room/abc' });
    const navigate = vi.fn();
    const card = buildGamesSeekCard(seek, { navigate, signedIn: true });
    expect(card.querySelector('a.current-game-open')).toBeNull();
    expect(card.querySelector('a[href*="/challenge/"]')).toBeNull();

    const accept = card.querySelector<HTMLButtonElement>('button.current-game-seek-accept');
    expect(accept?.textContent).toBe('Accept');
    accept?.click();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('/api/correspondence/seeks/seek_9/accept', {
      method: 'POST',
    });
    expect(navigate).toHaveBeenCalledWith('/room/abc');
    expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/challenge/'));
  });

  it('says a taken seek is no longer open and stops offering it', async () => {
    stubAccept(404, { error: 'seek_not_found' });
    const navigate = vi.fn();
    const card = buildGamesSeekCard(seek, { navigate, signedIn: true });
    const accept = card.querySelector<HTMLButtonElement>('button.current-game-seek-accept');
    accept?.click();
    await flush();
    const status = card.querySelector<HTMLElement>('.current-game-seek-status');
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe('This seek is no longer open.');
    expect(accept?.disabled).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends a stale signed-in hint to sign in on a 401', async () => {
    stubAccept(401, { error: 'unauthorized' });
    const navigate = vi.fn();
    const card = buildGamesSeekCard(seek, { navigate, signedIn: true });
    card.querySelector<HTMLButtonElement>('button.current-game-seek-accept')?.click();
    await flush();
    expect(navigate).toHaveBeenCalledWith('/account?tab=login&referrer=%2Fchallenge%2Fseek_9');
  });

  it('says which side the accepter plays, or that colours are random', () => {
    const meta = (preferredColor: string) =>
      buildGamesSeekCard({ ...seek, preferredColor }, { signedIn: true }).textContent ?? '';
    // The poster moves first, so the accepter plays the second mover.
    expect(meta('first')).toContain('you play Black');
    expect(meta('second')).toContain('you play Red');
    expect(meta('random')).toContain('random colors');
  });

  it("puts Accept in its own bottom row, not beside the poster's name", () => {
    const card = buildGamesSeekCard({ ...seek, preferredColor: 'random' }, { signedIn: true });
    const accept = card.querySelector('.current-game-seek-accept');
    expect(accept?.closest('.current-game-seat')).toBeNull();
    const row = accept?.closest('.current-game-seek-actions');
    expect(row?.parentElement).toBe(card);
    expect(row?.previousElementSibling?.classList.contains('current-game-meta')).toBe(true);
  });

  it("turns the board to the accepter's side when the poster picked one; random stays", () => {
    const view = (preferredColor: string) => {
      const card = buildGamesSeekCard({ ...seek, preferredColor }, { signedIn: true });
      const seats = [...card.querySelectorAll(':scope > .current-game-seat')];
      return {
        emptySeatAtBottom: seats[1]?.classList.contains('is-empty-seat') ?? false,
        perspective: card.querySelector<HTMLElement>('.current-game-board')?.dataset.perspective,
      };
    };
    expect(view('first')).toEqual({ emptySeatAtBottom: true, perspective: 'second' });
    expect(view('second')).toEqual({ emptySeatAtBottom: true, perspective: 'first' });
    expect(view('random')).toEqual({ emptySeatAtBottom: false, perspective: undefined });
  });

  it('keeps your own seek leading to /correspondence with no Accept', () => {
    const card = buildGamesSeekCard({ ...seek, isMine: true }, { signedIn: true });
    expect(card.querySelector('a.current-game-open')?.getAttribute('href')).toBe('/correspondence');
    expect(card.querySelector('.current-game-seek-accept')).toBeNull();
  });
});

describe('homepage lobby correspondence row', () => {
  it('joins in place instead of linking to /challenge', () => {
    const row = corrSeekRow({ ...seek, isMine: false }, 'en', { signedIn: true });
    const join = row.querySelector('.landing-lobby-join');
    expect(join?.tagName).toBe('BUTTON');
    expect(join?.textContent).toBe('Join');
    expect(row.querySelector('a[href*="/challenge/"]')).toBeNull();
  });
});

describe('/challenge page copy', () => {
  const view: ChallengeView = {
    id: 'seek_4',
    gameSpecId: 'xiangqi',
    daysPerMove: 3,
    preferredColor: 'random',
    visibility: 'public',
    challengerName: 'Erin',
    isMine: false,
    canAccept: true,
    canDecline: false,
    expired: false,
  };

  it('a public seek is someone looking for a game, not a challenge to you', () => {
    const card = buildChallengeCard(view);
    expect(card.querySelector('h1')?.textContent).toBe('Erin is looking for a game');
    expect(card.textContent).not.toContain('challenged you');
    expect(card.querySelector('.challenge-subhead')?.textContent).toContain('Xiangqi');
  });

  it('a private link keeps "challenged you"', () => {
    const card = buildChallengeCard({ ...view, visibility: 'private' });
    expect(card.querySelector('h1')?.textContent).toBe('Erin challenged you');
  });

  it('an expired public seek says it is no longer open and points to open games', () => {
    const card = buildChallengeCard({ ...view, expired: true, canAccept: false });
    expect(card.querySelector('.challenge-status')?.textContent).toBe(
      'This seek is no longer open.',
    );
    expect(card.querySelector('a[href="/games"]')?.textContent).toBe('See open games');
  });

  it('maps seek_not_found on accept to the neutral line', async () => {
    stubAccept(404, { error: 'seek_not_found' });
    const card = buildChallengeCard(view);
    card.querySelector<HTMLButtonElement>('.challenge-actions .challenge-btn')?.click();
    await flush();
    const status = card.querySelector<HTMLElement>('.challenge-status');
    expect(status?.textContent).toBe('This seek is no longer open.');
    expect(status?.textContent).not.toBe('Could not accept. Try again.');
    expect(card.querySelector('a[href="/games"]')).not.toBeNull();
  });

  it('gives the poster of a public seek Cancel, not a share link', async () => {
    const fetchMock = stubAccept(200, { ok: true });
    const host = document.createElement('div');
    const card = buildChallengeCard({ ...view, isMine: true, canAccept: false });
    host.append(card);
    expect(card.querySelector('h1')?.textContent).toBe('Your open seek');
    expect(card.querySelector('.challenge-share-link')).toBeNull();
    const cancel = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    cancel?.click();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/correspondence/seeks/seek_4', {
      method: 'DELETE',
    });
    expect(host.querySelector('h1')?.textContent).toBe('Seek cancelled');
  });

  it('keeps the share link for the poster of a private link', () => {
    const card = buildChallengeCard({
      ...view,
      isMine: true,
      canAccept: false,
      visibility: 'private',
    });
    expect(card.querySelector('h1')?.textContent).toBe('Your challenge');
    expect(card.querySelector('.challenge-share-link')).not.toBeNull();
  });

  it('a 404 reads for either kind and links to open games', () => {
    const notice = buildClosedNotice();
    expect(notice.querySelector('h1')?.textContent).toBe('This game offer is no longer open');
    expect(notice.querySelector('a[href="/games"]')?.textContent).toBe('See open games');
  });

  // #527: the 410 body names what happened to the offer.
  it('a 410 taken offer names who took it and links to watch the game', () => {
    const notice = buildGoneNotice({ reason: 'taken', roomId: 'room_9', accepterName: 'Bo' });
    expect(notice.querySelector('h1')?.textContent).toBe('Taken by Bo');
    expect(notice.querySelector('a[href="/room/room_9"]')?.textContent).toBe('Watch');
    expect(notice.querySelector('a[href="/games"]')?.textContent).toBe('See open games');
  });

  it('a 410 taken offer the viewer plays in opens the game instead', () => {
    const notice = buildGoneNotice({ reason: 'taken', roomId: 'room_9', youPlay: true });
    expect(notice.querySelector('h1')?.textContent).toBe('This game has started');
    expect(notice.querySelector('a[href="/room/room_9"]')?.textContent).toBe('Open game');
    expect(notice.querySelector('a[href="/games"]')).toBeNull();
  });

  it('a 410 withdrawn, declined or expired offer says so and links to open games', () => {
    for (const [reason, title] of [
      ['withdrawn', 'Withdrawn'],
      ['declined', 'Declined'],
      ['expired', 'Expired'],
    ] as const) {
      const notice = buildGoneNotice({ reason });
      expect(notice.querySelector('h1')?.textContent).toBe(title);
      expect(notice.querySelector('a[href="/games"]')?.textContent).toBe('See open games');
      expect(notice.textContent).not.toContain('\u2014');
    }
  });

  it('a 410 with no readable body falls back to the closed notice', () => {
    expect(buildGoneNotice(null).querySelector('h1')?.textContent).toBe(
      'This game offer is no longer open',
    );
    expect(
      buildGoneNotice({ reason: 'taken', accepterName: 'Bo' }).querySelector('h1')?.textContent,
    ).toBe('This game offer is no longer open');
  });
});
