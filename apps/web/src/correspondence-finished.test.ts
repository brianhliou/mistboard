import { afterEach, describe, expect, it, vi } from 'vitest';
import { type FinishedCorrespondenceGame, renderFinishedGames } from './correspondence.js';

// Brian, 2026-10-14: a correspondence game he lost vanished from
// /correspondence, and only his profile said what happened. The page now lists
// recently finished games with the result, how each ended and a "New" tag.

function finishedGame(
  overrides: Partial<FinishedCorrespondenceGame> = {},
): FinishedCorrespondenceGame {
  return {
    roomId: 'xq_room1',
    variant: 'xiangqi',
    mode: 'pvp',
    rated: false,
    result: 'black-wins',
    termination: 'checkmate',
    plyCount: 41,
    whiteName: null,
    blackName: null,
    corpusId: null,
    endedAt: '2026-10-13T18:00:00.000Z',
    initialMs: 86_400_000,
    incrementMs: 0,
    playerColor: 'red',
    participants: [
      {
        color: 'red',
        displayName: 'Me',
        subjectType: 'user',
        subjectId: 'u_me',
        visibility: 'public',
      },
      {
        color: 'black',
        displayName: 'Bob',
        subjectType: 'user',
        subjectId: 'u_bob',
        handle: 'bob',
        visibility: 'public',
      },
    ],
    isNew: false,
    ...overrides,
  } as FinishedCorrespondenceGame;
}

function stubFetch(games: FinishedCorrespondenceGame[], ok = true) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/correspondence/games/finished') {
        return ok
          ? new Response(JSON.stringify({ games, windowDays: 14, historyHref: '/@/me' }), {
              status: 200,
            })
          : new Response('{}', { status: 500 });
      }
      return new Response('{"ok":true}', { status: 200 });
    }),
  );
  return calls;
}

async function render(games: FinishedCorrespondenceGame[], ok = true) {
  const calls = stubFetch(games, ok);
  const host = document.createElement('section');
  host.hidden = true;
  const counts: number[] = [];
  await renderFinishedGames(host, (n) => counts.push(n));
  return { host, counts, calls };
}

const seenPosts = (calls: Array<{ url: string; init?: RequestInit }>) =>
  calls.filter((call) => call.url === '/api/notifications/seen');

describe('correspondence: recently finished', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays hidden with no finished games, and when the read fails', async () => {
    const empty = await render([]);
    expect(empty.host.hidden).toBe(true);
    expect(empty.host.childElementCount).toBe(0);
    expect(empty.counts).toEqual([0]);
    expect(seenPosts(empty.calls)).toHaveLength(0);

    const failed = await render([finishedGame()], false);
    expect(failed.host.hidden).toBe(true);
    expect(failed.counts).toEqual([0]);
  });

  it('a lost game: result, opponent, variant, how it ended, when, and a link to the game', async () => {
    const { host, counts } = await render([finishedGame()]);
    expect(host.hidden).toBe(false);
    expect(counts).toEqual([1]);
    expect(host.querySelector('h2')?.textContent).toBe('Recently finished');
    expect(host.querySelector('.correspondence-count')?.textContent).toBe('1');
    const row = host.querySelector<HTMLElement>('.profile-game-row');
    expect(row?.classList.contains('profile-game-row-loss')).toBe(true);
    expect(row?.querySelector('.profile-game-outcome')?.textContent).toBe('Loss');
    expect(row?.querySelector('.profile-game-opponent')?.textContent).toContain('Bob');
    expect(row?.querySelector('.profile-game-variant')?.textContent).toContain('Xiangqi');
    expect(row?.querySelector('.profile-game-ending')?.textContent).toBe('Checkmate');
    expect(row?.querySelector('.profile-game-date')?.textContent).not.toBe('');
    expect(row?.querySelector('a.profile-game-row-open')?.getAttribute('href')).toBe(
      '/xiangqi/game/xq_room1',
    );
    expect(row?.querySelector('.profile-game-new')).toBeNull();
    // The full history is the profile.
    const foot = host.querySelector('.correspondence-finished-foot');
    expect(foot?.textContent).toContain('The last 14 days.');
    expect(foot?.querySelector('a')?.getAttribute('href')).toBe('/@/me');
  });

  it('a won game by the opponent running out of days', async () => {
    const { host } = await render([finishedGame({ result: 'red-wins', termination: 'timeout' })]);
    const row = host.querySelector<HTMLElement>('.profile-game-row');
    expect(row?.classList.contains('profile-game-row-win')).toBe(true);
    expect(row?.querySelector('.profile-game-outcome')?.textContent).toBe('Win');
    expect(row?.querySelector('.profile-game-ending')?.textContent).toBe('Timeout');
  });

  it('a game that ended since the last visit is tagged New, and the page marks it seen', async () => {
    const { host, calls } = await render([
      finishedGame({
        roomId: 'xq_new',
        isNew: true,
        termination: 'resignation',
        result: 'red-wins',
      }),
      finishedGame({ roomId: 'xq_old' }),
    ]);
    const rows = [...host.querySelectorAll<HTMLElement>('.profile-game-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.profile-game-new')?.textContent).toBe('New');
    expect(rows[1]?.querySelector('.profile-game-new')).toBeNull();
    const posts = seenPosts(calls);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.init?.body))).toEqual({ kind: 'correspondence-finished' });
  });

  it('marks nothing seen when nothing is new', async () => {
    const { calls } = await render([finishedGame()]);
    expect(seenPosts(calls)).toHaveLength(0);
  });
});
