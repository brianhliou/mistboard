import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLandingStage } from './landing.js';
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
  ];
  const DESKTOP_ONLY_SELECTORS = [
    '.landing-lobby-panel',
    '.landing-activity',
    '.landing-corr-card',
    '.landing-puzzle-column',
    '.landing-forum-column',
    '.landing-studies-column',
    '.landing-news-column',
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
    // What the phone home keeps: TV, Play with its two buttons, tiles, both
    // article rows, event
    // banners, the chat room and the footer.
    expect(stage.el.querySelector('.landing-tv-strip')).not.toBeNull();
    expect(stage.el.querySelector('.landing-play-quick')).not.toBeNull();
    expect(stage.el.querySelector('.landing-phone-tiles')).not.toBeNull();
    // Both article rows: the newest posts, then the deep dives (2026-10-17).
    expect(stage.el.querySelector('.landing-articles-row:not(.landing-dives-row)')).not.toBeNull();
    expect(stage.el.querySelector('.landing-dives-row .landing-article-card')).not.toBeNull();
    expect(stage.el.querySelector('.landing-event-banners')).not.toBeNull();
    expect(stage.el.querySelector('.landing-chat-column .landing-chat-mount')).not.toBeNull();
    expect(stage.el.querySelector(':scope > .landing-demo + *')).not.toBeNull();
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
  it('names Mistboard TV and links to the top channel before a game loads', () => {
    const strip = buildLandingTvStrip('en', '/watch?channel=top');
    expect(strip.el.querySelector('.landing-tv-strip-label')?.textContent).toBe('Mistboard TV');
    const watch = strip.el.querySelector<HTMLAnchorElement>('.landing-tv-strip-watch');
    expect(watch?.textContent).toBe('Watch');
    expect(watch?.getAttribute('href')).toBe('/watch?channel=top');
    // Nothing claims to be live until the TV says so.
    expect(strip.el.querySelector<HTMLElement>('.landing-tv-strip-live')?.hidden).toBe(true);
    expect(strip.el.classList).not.toContain('is-live');
  });

  it('shows Live only for a live game and follows the game the TV switches to', () => {
    const strip = buildLandingTvStrip('en', '/watch?channel=top');
    const live = () => strip.el.querySelector<HTMLElement>('.landing-tv-strip-live');
    const label = () => strip.el.querySelector('.landing-tv-strip-label')?.textContent;
    const href = () =>
      strip.el.querySelector<HTMLAnchorElement>('.landing-tv-strip-watch')?.getAttribute('href');

    strip.update({ mode: 'live', variantLabel: 'Xiangqi', watchHref: '/watch?channel=top' });
    expect(live()?.hidden).toBe(false);
    expect(live()?.textContent).toBe('Live');
    expect(strip.el.classList).toContain('is-live');
    expect(label()).toBe('Mistboard TV · Xiangqi');

    strip.update({
      mode: 'frozen',
      variantLabel: 'Jieqi',
      watchHref: '/watch?channel=top&game=abc',
    });
    expect(live()?.hidden).toBe(true);
    expect(strip.el.classList).not.toContain('is-live');
    expect(label()).toBe('Mistboard TV · Jieqi');
    expect(href()).toBe('/watch?channel=top&game=abc');
  });

  it('localizes', () => {
    const strip = buildLandingTvStrip('zh-Hant', '/zh-hant/watch?channel=top');
    strip.update({ mode: 'live', variantLabel: '象棋', watchHref: '/zh-hant/watch?channel=top' });
    expect(strip.el.querySelector('.landing-tv-strip-live')?.textContent).toBe('直播');
    expect(strip.el.querySelector('.landing-tv-strip-watch')?.textContent).toBe('觀看');
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
    for (const tile of tiles) {
      expect(tile.querySelector('svg.ui-icon.landing-phone-tile-icon')).not.toBeNull();
    }
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
