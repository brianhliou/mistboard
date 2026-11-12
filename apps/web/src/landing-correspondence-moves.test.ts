import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CorrespondenceGame } from './correspondence-model.js';
import {
  buildLandingCorrespondenceMoves,
  createYourMoveFeed,
  renderLandingCorrespondenceMoves,
} from './landing-correspondence-moves.js';
import { buildPlayPanel } from './landing-play-panel.js';
import { setResolvedSignedIn } from './signed-in-state.js';
import { navPhoneMediaQuery } from './site-shell.js';

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

describe('one load for the phone card and the desktop Your move tab', () => {
  it('fetches once and draws both from the same answer', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/correspondence/games'
        ? new Response(JSON.stringify({ games: [game('a', true), game('b', true, 1)] }))
        : new Response('{}', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const feed = createYourMoveFeed();
    const panel = buildPlayPanel('en', { hydrate: false, yourMove: feed });
    const card = buildLandingCorrespondenceMoves({ feed, phoneOnly: true });
    document.body.append(panel, card);
    setResolvedSignedIn(true);
    await settle();
    const corrCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/correspondence/games');
    expect(corrCalls).toHaveLength(1);
    expect(card.hidden).toBe(false);
    const tab = panel.querySelector<HTMLElement>('.pp-tab-moves')!;
    expect(tab.hidden).toBe(false);
    expect(tab.textContent).toBe('Your move2');
  });

  it('marks the card phone-only where the panel lists the games, and only then', () => {
    expect(buildLandingCorrespondenceMoves({ hydrate: false, phoneOnly: true }).className).toBe(
      'landing-corr-moves is-phone-only',
    );
    expect(buildLandingCorrespondenceMoves({ hydrate: false }).className).toBe(
      'landing-corr-moves',
    );
  });

  it('hides the phone-only card exactly above the phone breakpoint', () => {
    // The panel (and so its tab) is built only when the header's phone query
    // fails at mount; the card must take over at that same width.
    const max = Number(/max-width: (\d+)px/.exec(navPhoneMediaQuery)?.[1]);
    const css = readFileSync('src/landing-correspondence-moves.css', 'utf8');
    expect(css).toMatch(
      new RegExp(
        `@media \\(min-width: ${max + 1}px\\) \\{\\s*\\.landing-corr-moves\\.is-phone-only \\{\\s*display: none;`,
      ),
    );
  });
});
