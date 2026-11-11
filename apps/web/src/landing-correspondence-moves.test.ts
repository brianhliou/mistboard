import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CorrespondenceGame } from './correspondence-model.js';
import {
  buildLandingCorrespondenceMoves,
  renderLandingCorrespondenceMoves,
} from './landing-correspondence-moves.js';
import { setResolvedSignedIn } from './signed-in-state.js';

// #1058: the signed-in homepage lists the player's correspondence games on their
// move, and shows nothing at all otherwise (no promotional tile).

function game(roomId: string, isYourMove: boolean, dueInDays = 2): CorrespondenceGame {
  return {
    roomId,
    url: `/room/${roomId}`,
    gameSpecId: 'xiangqi',
    mySeat: 'red',
    isYourMove,
    opponentName: 'Alice',
    dueAt: new Date(Date.now() + dueInDays * 86_400_000).toISOString(),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  // Detach first so the rows built here stop listening for auth changes.
  document.body.replaceChildren();
  setResolvedSignedIn(undefined);
  vi.unstubAllGlobals();
});

describe('homepage correspondence row', () => {
  it('lists only games on your move, soonest deadline first, each linking its room', () => {
    const box = document.createElement('section');
    renderLandingCorrespondenceMoves(box, [
      game('later', true, 3),
      game('theirs', false),
      game('sooner', true, 1),
    ]);
    expect(box.hidden).toBe(false);
    expect(box.querySelector('.landing-corr-moves-head')?.getAttribute('href')).toBe(
      '/correspondence',
    );
    expect(box.querySelector('.landing-corr-moves-head')?.textContent).toContain(
      'Your move in correspondence',
    );
    const links = [...box.querySelectorAll<HTMLAnchorElement>('.landing-corr-moves-game')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/room/sooner', '/room/later']);
    expect(links[0]?.textContent).toContain('vs Alice');
    expect(links[0]?.textContent).toContain('Xiangqi');
  });

  it('is hidden and empty with no game on your move', () => {
    const box = document.createElement('section');
    renderLandingCorrespondenceMoves(box, [game('theirs', false)]);
    expect(box.hidden).toBe(true);
    expect(box.childElementCount).toBe(0);
  });

  it('asks nothing of the server for a signed-out visitor', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const box = buildLandingCorrespondenceMoves();
    document.body.append(box);
    setResolvedSignedIn(false);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(box.hidden).toBe(true);
  });

  it('loads once auth settles signed in', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ games: [game('mine', true)], yourMoveCount: 1 }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const box = buildLandingCorrespondenceMoves();
    document.body.append(box);
    expect(fetchMock).not.toHaveBeenCalled();
    setResolvedSignedIn(true);
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/correspondence/games');
    expect(box.hidden).toBe(false);
    expect(box.querySelector('.landing-corr-moves-game')?.getAttribute('href')).toBe('/room/mine');
  });

  it('does not hydrate in the prerendered shell', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setResolvedSignedIn(true);
    const box = buildLandingCorrespondenceMoves({ hydrate: false });
    expect(box.hidden).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
