import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLandingStage, PHONE_NEWS_ROWS } from './landing.js';
import { buildLandingPhoneTiles, buildLandingTvStrip, isPhoneHome } from './landing-phone.js';
import { fallbackPlayableEngines } from './landing-play.js';
import { resetLiveStatsCacheForTests } from './live-stats-client.js';
import { navPhoneMediaQuery } from './site-shell.js';

// The phone home ends after the two article strips: live event banners and the chat
// room, then the footer. Everything else is never built there, so it never
// fetches (mobile pass #576).
describe('phone home widget set', () => {
  // Endpoints owned by widgets the phone home leaves out.
  const DESKTOP_ONLY_FETCHES = [
    '/api/puzzles/daily', // puzzle of the day
    '/api/forum/topics', // active forum topics
    '/api/studies/public', // latest studies
    '/api/xiangqi/broadcasts', // event banners
  ];
  const DESKTOP_ONLY_SELECTORS = [
    '.landing-lobby-panel',
    '.landing-event-banners',
    '.landing-puzzle-column',
    '.landing-forum-column',
    '.landing-studies-column',
  ];

  let fetchSpy: ReturnType<typeof vi.fn>;
  const fetchedUrls = (): string[] => fetchSpy.mock.calls.map((call) => String(call[0]));
  const stubViewport = (phone: boolean): void => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: phone && query === navPhoneMediaQuery,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(() => {
    resetLiveStatsCacheForTests();
    fetchSpy = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the site header phone breakpoint', () => {
    stubViewport(true);
    expect(isPhoneHome()).toBe(true);
    stubViewport(false);
    expect(isPhoneHome()).toBe(false);
  });

  it('on a phone, mounts none of the widgets below the blog strip and fetches none of their data', async () => {
    stubViewport(true);
    fetchSpy.mockImplementation(async (url: unknown) =>
      String(url).startsWith('/api/live-stats')
        ? new Response(
            JSON.stringify({
              playing: 0,
              totalCompletedGames: 4_888,
              last30dCompletedGames: 4_267,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : new Response('', { status: 503 }),
    );
    const stage = buildLandingStage(fallbackPlayableEngines());
    await flush();

    for (const selector of DESKTOP_ONLY_SELECTORS) {
      expect(stage.el.querySelector(selector), selector).toBeNull();
    }
    for (const url of DESKTOP_ONLY_FETCHES) {
      expect(
        fetchedUrls().some((fetched) => fetched.startsWith(url)),
        url,
      ).toBe(false);
    }
    // What the phone home keeps: TV, Play with its two buttons and the
    // games-played line, tiles, both article rows, the chat room and the footer.
    expect(stage.el.querySelector('.landing-tv-strip')).not.toBeNull();
    expect(stage.el.querySelector('.landing-play-quick')).not.toBeNull();
    expect(stage.el.querySelector('.landing-phone-tiles')).not.toBeNull();
    // Both article rows: the newest posts, then the deep dives (2026-10-17).
    expect(stage.el.querySelector('.landing-articles-row:not(.landing-dives-row)')).not.toBeNull();
    expect(stage.el.querySelector('.landing-dives-row .landing-article-card')).not.toBeNull();
    expect(stage.el.querySelector('.landing-activity-value')?.textContent).toBe('4,888');
    expect(stage.el.querySelector('.landing-chat-column .landing-chat-mount')).not.toBeNull();
    expect(stage.el.querySelector(':scope > .landing-demo + *')).not.toBeNull();
    // The h1 tagline stays in the DOM (search, screen readers) though the phone
    // hides it; the mission sits above News, with a link to /about
    // (2026-11-08). The footer still closes the page.
    expect(stage.el.querySelector('.landing-play-intro .landing-about h1')?.textContent).toBe(
      'Bringing people together across cultures through Chinese chess.',
    );
    expect(
      stage.el.querySelector('.landing-play-intro > .landing-about-more')?.getAttribute('href'),
    ).toBe('/about');
    const mission = stage.el.querySelector(
      '.landing-phone-mission + .landing-news-column',
    )?.previousElementSibling;
    expect(mission?.querySelector('.landing-phone-mission-text')?.textContent).toBe(
      "Bring people together across cultures through Chinese chess and the world's classic strategy games.",
    );
    expect(mission?.querySelector('.landing-phone-mission-about')?.getAttribute('href')).toBe(
      '/about',
    );
    const totals = mission?.querySelector('.landing-activity-primary');
    expect(totals?.textContent).toBe('4,888games played (4,267 in the last 30 days)');
    expect(totals?.querySelector('a')?.getAttribute('href')).toBe('/stats');
    expect(totals?.parentElement?.previousElementSibling?.className).toBe(
      'landing-phone-mission-text',
    );
    expect(totals?.parentElement?.nextElementSibling?.className).toBe(
      'landing-phone-mission-about',
    );
    expect(stage.el.querySelector('.landing-play-stack .landing-activity-primary')).toBeNull();
    expect(stage.el.querySelector<HTMLElement>('.landing-activity')?.hidden).toBe(true);
    expect(fetchedUrls().filter((url) => url === '/api/live-stats')).toHaveLength(1);
    expect(
      stage.el.querySelectorAll(':scope > .landing-footer .landing-footer-links a'),
    ).toHaveLength(4);
    // The three newest News entries (2026-11-08). News is static data, so it
    // costs the phone no fetch.
    expect(
      stage.el.querySelectorAll(
        '.landing-news-column .landing-news-update:not(.landing-news-more)',
      ),
    ).toHaveLength(PHONE_NEWS_ROWS);
    // The header's More » leads on; no closing row under three entries.
    expect(stage.el.querySelector('.landing-news-column .landing-news-more')).toBeNull();
  });

  it('reserves the phone mission totals in the prerendered shell without fetching', () => {
    stubViewport(true);
    const stage = buildLandingStage(fallbackPlayableEngines(), { skipLiveWidgets: true });
    expect(
      stage.el.querySelector('.landing-phone-mission .landing-activity-value')?.textContent,
    ).toBe('–');
    expect(
      stage.el.querySelector('.landing-phone-mission .landing-activity-label')?.textContent,
    ).toBe('games played');
    expect(stage.el.querySelector('.landing-play-stack .landing-activity-primary')).toBeNull();
    expect(fetchedUrls()).not.toContain('/api/live-stats');
  });

  it('on desktop, still mounts every widget and fetches its data', async () => {
    stubViewport(false);
    const stage = buildLandingStage(fallbackPlayableEngines());

    for (const selector of DESKTOP_ONLY_SELECTORS) {
      expect(stage.el.querySelector(selector), selector).not.toBeNull();
    }
    expect(stage.el.querySelector('.landing-chat-column .landing-chat-mount')).not.toBeNull();
    await vi.waitFor(() => {
      for (const url of DESKTOP_ONLY_FETCHES) {
        expect(
          fetchedUrls().some((fetched) => fetched.startsWith(url)),
          url,
        ).toBe(true);
      }
    });
  });
});

describe('phone home TV strip', () => {
  it('names Mistboard TV before a game loads, with no link of its own', () => {
    const strip = buildLandingTvStrip('en');
    expect(strip.el.querySelector('.landing-tv-strip-label')?.textContent).toBe('Mistboard TV');
    // The board under the strip is the way to the TV (2026-11-08).
    expect(strip.el.querySelector('a')).toBeNull();
    // Nothing claims to be live until the TV says so.
    expect(strip.el.querySelector<HTMLElement>('.landing-tv-strip-live')?.hidden).toBe(true);
    expect(strip.el.classList).not.toContain('is-live');
  });

  it('shows Live only for a live game and follows the game the TV switches to', () => {
    const strip = buildLandingTvStrip('en');
    const live = () => strip.el.querySelector<HTMLElement>('.landing-tv-strip-live');
    const label = () => strip.el.querySelector('.landing-tv-strip-label')?.textContent;

    strip.update({ mode: 'live', variantLabel: 'Xiangqi' });
    expect(live()?.hidden).toBe(false);
    expect(live()?.textContent).toBe('Live');
    expect(strip.el.classList).toContain('is-live');
    expect(label()).toBe('Mistboard TV · Xiangqi');

    strip.update({ mode: 'frozen', variantLabel: 'Jieqi' });
    expect(live()?.hidden).toBe(true);
    expect(strip.el.classList).not.toContain('is-live');
    expect(label()).toBe('Mistboard TV · Jieqi');
  });

  it('localizes', () => {
    const strip = buildLandingTvStrip('zh-Hant');
    strip.update({ mode: 'live', variantLabel: '象棋' });
    expect(strip.el.querySelector('.landing-tv-strip-live')?.textContent).toBe('直播');
    expect(strip.el.querySelector('.landing-tv-strip-label')?.textContent).toBe(
      'Mistboard 電視 · 象棋',
    );
  });
});

describe('phone home shortcut tiles', () => {
  it('links the six destinations in order, each with an icon', () => {
    const nav = buildLandingPhoneTiles('en');
    expect(nav.tagName).toBe('NAV');
    expect(nav.getAttribute('aria-label')).toBe('More on Mistboard');
    const tiles = [...nav.querySelectorAll<HTMLAnchorElement>('a.landing-phone-tile')];
    expect(tiles.map((tile) => [tile.textContent, tile.getAttribute('href')])).toEqual([
      ['Puzzles', '/puzzles'],
      ['Rules', '/rules'],
      ['Study', '/study'],
      ['Analysis', '/analysis/xiangqi'],
      ['Forum', '/forum'],
      ['Watch', '/watch'],
    ]);
    expect(
      tiles.map((tile) =>
        tile.querySelector('svg.landing-phone-tile-art')?.getAttribute('data-art'),
      ),
    ).toEqual(['puzzles', 'rules', 'study', 'analysis', 'forum', 'watch']);
  });

  it('localizes labels and hrefs', () => {
    const nav = buildLandingPhoneTiles('zh-Hans');
    const tiles = [...nav.querySelectorAll<HTMLAnchorElement>('a.landing-phone-tile')];
    expect(tiles[0]?.textContent).toBe('题目');
    expect(tiles[3]?.textContent).toBe('分析');
    // Rules is a localized content path; Puzzles is not, so it stays unprefixed.
    expect(tiles[1]?.getAttribute('href')).toBe('/zh-hans/rules');
    expect(tiles[0]?.getAttribute('href')).toBe('/puzzles');
  });
});
