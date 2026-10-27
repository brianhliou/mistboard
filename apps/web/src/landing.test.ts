import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPlayableEnginesOnce,
  loadPlayableEnginesWithRetry,
  renderLandingShellForPrerender,
  shouldUseBundledShowcaseDemos,
  watchHrefForTvGame,
} from './landing.js';
import { resetLiveStatsCacheForTests } from './live-stats-client.js';

const ROSTER = [
  { id: 'python-v2-v1.0', name: 'Misty 1.0', familyName: 'Misty', kind: 'container' },
];

// /api/live-stats reads are shared through a module cache; start each test cold.
beforeEach(() => resetLiveStatsCacheForTests());

describe('playable engines loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    expect(await fetchPlayableEnginesOnce()).toBeNull();
  });

  it('returns null on an empty roster (never the placeholder)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ engines: [] })),
    );
    expect(await fetchPlayableEnginesOnce()).toBeNull();
  });

  it('returns null when the fetch itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await fetchPlayableEnginesOnce()).toBeNull();
  });

  it('returns the roster on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ engines: ROSTER })),
    );
    expect(await fetchPlayableEnginesOnce()).toEqual(ROSTER);
  });

  it('retries transient failures and resolves once the roster is available', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValue(jsonResponse({ engines: ROSTER }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();

    const promise = loadPlayableEnginesWithRetry();
    await vi.runAllTimersAsync();

    expect(await promise).toEqual(ROSTER);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('gives up and returns null after exhausting retries', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();

    const promise = loadPlayableEnginesWithRetry();
    await vi.runAllTimersAsync();

    expect(await promise).toBeNull();
    // initial attempt + one per backoff delay (4 delays) = 5 fetches
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});

describe('homepage TV widget link', () => {
  // Regression (2026-08-14): the widget's href was baked once as
  // /watch?channel=top, so clicking the board landed the visitor on whatever
  // game the channel's own head happened to be — a different game than the one
  // they had just been looking at.
  it('hands /watch the exact room a frozen or aired board is showing', () => {
    expect(watchHrefForTvGame('frozen', 'xq_a16ddaaa')).toBe('/watch?channel=top&game=xq_a16ddaaa');
    expect(watchHrefForTvGame('replay', 'jgf_1234')).toBe('/watch?channel=top&game=jgf_1234');
  });

  it('links a LIVE board to the bare channel so /watch re-elects the live game', () => {
    // ?game= resolves against the COMPLETED feed only; a still-running room is
    // not in it, and /watch runs the same top-election poll anyway.
    expect(watchHrefForTvGame('live', 'xq_live')).toBe('/watch?channel=top');
  });

  it('escapes the room id', () => {
    expect(watchHrefForTvGame('frozen', 'a b&c')).toBe('/watch?channel=top&game=a%20b%26c');
  });
});

describe('landing shell', () => {
  it('uses bundled showcase games only when a demo is explicitly requested', () => {
    expect(shouldUseBundledShowcaseDemos('')).toBe(false);
    expect(shouldUseBundledShowcaseDemos('?only=xiangqi')).toBe(false);
    expect(shouldUseBundledShowcaseDemos('?demo=engine-v2-g0000')).toBe(true);
  });

  it('bakes no admin menu into the signed-out prerender, in any language', async () => {
    // The prerender is what crawlers index; a hidden admin menu still put
    // 管理 / 数据库 / 运营简报 / 转播运维 into the Chinese home page's HTML.
    const { ensureLocaleCatalog } = await import('./i18n/catalog.js');
    try {
      for (const path of ['/', '/zh-hans', '/zh-hant']) {
        window.history.replaceState(null, '', path);
        if (path !== '/') await ensureLocaleCatalog(path === '/zh-hans' ? 'zh-Hans' : 'zh-Hant');
        const html = renderLandingShellForPrerender();
        expect(html).toContain('site-nav-links');
        expect(html, path).not.toContain('data-admin-only');
        for (const label of [
          'Admin',
          'Readouts',
          'Broadcast ops',
          '管理',
          '运营简报',
          '營運簡報',
          '转播运维',
          '轉播運維',
          'href="/database"',
          'href="/readouts"',
          'href="/broadcast/xiangqi/ops"',
        ]) {
          expect(html, `${path}: ${label}`).not.toContain(label);
        }
      }
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('keeps the grid-area hooks the homepage band CSS keys on', () => {
    // landing.css places the bands via these class names (grid-areas
    // left/panel/play, puzzle/forum/chat, news/blogs+learn/studies); renaming
    // them in the DOM without updating landing.css would silently break the
    // layout.
    const wrap = document.createElement('div');
    wrap.innerHTML = renderLandingShellForPrerender();

    const demo = wrap.querySelector('.landing-demo');
    expect(demo).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-left-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-lobby-panel')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-play-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-puzzle-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-forum-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-chat-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-articles-row')).not.toBeNull();
    // Side rails: News (band 2 right) and Top studies (band 3 left).
    expect(demo?.querySelector(':scope > .landing-news-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-studies-column')).not.toBeNull();
    // Band 4: the deep-dives row sits in its own grid-area above the blog row
    // (on top since 2026-10-26), and the player pages are in it, not in the
    // blog row below.
    const deepDives = demo?.querySelector(':scope > .landing-dives-row');
    expect(deepDives).not.toBeNull();
    expect(
      deepDives?.querySelector('.landing-article-card[href="/blog/yin-sheng"]'),
    ).not.toBeNull();
    expect(
      demo?.querySelector(
        ':scope > .landing-articles-row:not(.landing-dives-row) .landing-article-card[href="/blog/yin-sheng"]',
      ),
    ).toBeNull();
    expect(deepDives?.querySelector('.landing-row-label')?.textContent).toBe('Xiangqi deep dives');
    // The other row is labelled too, and its label line links to the blog index.
    const latest = demo?.querySelector(':scope > .landing-articles-row:not(.landing-dives-row)');
    expect(latest?.querySelector('.landing-row-label')?.textContent).toBe('From the blog');
    expect(
      latest?.querySelector('.landing-row-header a.landing-row-more')?.getAttribute('href'),
    ).toBe('/blog');
    // The deep-dives row links on only while it holds posts back, which depends on
    // the live corpus (blog-topic-filter.test.ts pins when it shows); when it
    // does, it opens the filtered blog, not the whole index.
    const divesMore = deepDives?.querySelector('.landing-row-more');
    if (divesMore) expect(divesMore.getAttribute('href')).toBe('/blog?topic=deep-dives');
    expect(demo?.querySelector('.landing-learn-row')).toBeNull();
    expect(demo?.querySelector('.landing-left-column .landing-board-column')).not.toBeNull();
    // The support/store pair left the homepage (patronage stays in the nav).
    expect(demo?.querySelector('.landing-support-row')).toBeNull();
  });

  it('leads the left rail with the viewer and parks the event spotlight under the play stats', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderLandingShellForPrerender();

    const leftColumn = wrap.querySelector('.landing-left-column');
    // The phone-only TV strip (display: none above 600px) heads the rail; the
    // viewer is the first thing tablet and desktop paint.
    expect(leftColumn?.firstElementChild?.classList.contains('landing-tv-strip')).toBe(true);
    expect(
      leftColumn?.firstElementChild?.nextElementSibling?.classList.contains(
        'landing-viewer-column',
      ),
    ).toBe(true);
    expect(leftColumn?.querySelector('.landing-event-banners')).toBeNull();
    // The event-banner slot (collapses via CSS when empty) is the play column's
    // last child, after the centred tagline/button/stats group, so it sits at
    // the column's bottom edge and never moves the Play button.
    const playColumn = wrap.querySelector('.landing-play-column');
    expect(playColumn?.firstElementChild?.classList.contains('landing-play-center')).toBe(true);
    expect(playColumn?.lastElementChild?.classList.contains('landing-event-banners')).toBe(true);
    // The News feed is back on the homepage, in the bands-3/4 left rail (not
    // band 1); chat left the play rail for the band-2 right slot.
    expect(wrap.querySelector('.landing-left-column .landing-announcements')).toBeNull();
    expect(wrap.querySelector('.landing-news-column .landing-announcements')).not.toBeNull();
    expect(wrap.querySelector('.landing-play-column .landing-chat-mount')).toBeNull();
    expect(wrap.querySelector('.landing-chat-column .landing-chat-mount')).not.toBeNull();
  });

  it('mounts the band-2 widgets and the single unified Play button', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderLandingShellForPrerender();

    expect(wrap.querySelector('.landing-forum-column .landing-forum')).not.toBeNull();
    // Top studies moved down to the bands-3/4 right rail; chat took its band-2 slot.
    expect(wrap.querySelector('.landing-studies-column .landing-study-widget')).not.toBeNull();
    // One action, the unified Play button (the 2026-10-03 correspondence card
    // was removed 2026-10-20).
    const actions = wrap.querySelectorAll('.landing-play-column .landing-play-action');
    expect(actions.length).toBe(1);
    expect(actions[0]?.classList.contains('landing-play-action-primary')).toBe(true);
  });

  it('links only the About Mistboard tagline tail', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderLandingShellForPrerender();

    const about = wrap.querySelector('.landing-about');
    const link = about?.querySelector<HTMLAnchorElement>('a[href="/about"]');

    expect(about?.textContent).toBe(
      'Chinese chess and original strategy games. Free and open source. About Mistboard...',
    );
    expect(link?.textContent).toBe('About Mistboard...');
    expect(about?.childNodes[0]?.textContent).toBe(
      'Chinese chess and original strategy games. Free and open source. ',
    );
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: init.status ?? 200,
  });
}

describe('homepage band layout (CSS)', () => {
  const css = readFileSync('src/landing.css', 'utf8');

  it('puts the deep-dives row above the blog row at every width', () => {
    // Brian, 2026-10-26: deep dives go above the laptop fold. The three grid
    // layouts and the phone flex order must all agree.
    const areas = [...css.matchAll(/grid-template-areas:([^;]*);/g)].map((m) => m[1] ?? '');
    const withRows = areas.filter((a) => a.includes('dives') && a.includes('blogs'));
    expect(withRows).toHaveLength(3);
    for (const a of withRows) expect(a.indexOf('dives')).toBeLessThan(a.indexOf('blogs'));
    const order = (selector: string) =>
      Number(
        css.match(new RegExp(`${selector.replace(/[.()]/g, '\\$&')} \\{\\s*order: (\\d+);`))?.[1],
      );
    expect(order('.landing-demo .landing-dives-row')).toBeLessThan(
      order('.landing-demo .landing-articles-row:not(.landing-dives-row)'),
    );
  });

  it('reads News before Top studies at every width', () => {
    // Brian, 2026-10-26: News matters more than Top studies, so it takes the
    // band-2 right rail (under the play column) and studies drops to band 3.
    const areas = [...css.matchAll(/grid-template-areas:([^;]*);/g)].map((m) => m[1] ?? '');
    const withBoth = areas.filter((a) => /\bnews\b/.test(a) && /\bstudies\b/.test(a));
    expect(withBoth).toHaveLength(3);
    for (const a of withBoth) expect(a.search(/\bnews\b/)).toBeLessThan(a.search(/\bstudies\b/));
    const desktop = withBoth[0] ?? '';
    expect(desktop).toMatch(/"puzzle\s+dives\s+news"/);
    expect(desktop).toMatch(/"studies\s+forum\s+chat"/);
  });

  it('keeps the "more broadcasts" link out of the cards\' equal-height rows', () => {
    // .landing-event-banners is grid-auto-rows: 1fr, so the link in flow took a
    // card-tall row: a ~70px gap under the cards that also stretched band 1.
    expect(css).toMatch(
      /^\.landing-play-column > \.landing-event-banners > \.landing-event-banners-more \{[^}]*position: absolute;/m,
    );
    expect(css).toMatch(
      /^\.landing-play-column > \.landing-event-banners:has\(> \.landing-event-banners-more\) \{[^}]*margin-block: auto;/m,
    );
  });

  it('sizes the broadcast card for one line of name and keeps the square icon slot', () => {
    // 2026-10-26: 84px two-line cards made the play column the band's tallest
    // column. The name is one line at 13px; the icon slot stays 34px square
    // for the illustrated card art.
    const banners = readFileSync('src/landing-event-banners.css', 'utf8');
    const rule = (selector: string) =>
      banners.match(new RegExp(`^${selector.replace(/[.]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ??
      '';
    expect(rule('.landing-event-banner')).toMatch(/padding: 8px 12px;/);
    expect(rule('.landing-event-banner-title')).toMatch(/font-size: 13px;/);
    expect(rule('.landing-event-banner-title')).toMatch(/-webkit-line-clamp: 2;/);
    expect(rule('.landing-event-banner-icon')).toMatch(/width: 34px;\s*height: 34px;/);
  });

  it('sizes the phone shortcut tiles for their drawings, one 6px gutter with the Play pair', () => {
    // Brian, 2026-10-27: bigger tiles with less gap between them, and the
    // Play the computer / Play a friend pair as close as the tiles. Then less
    // empty space inside each tile: a shorter tile, a larger drawing and label.
    const phone = css.slice(css.indexOf('@media (max-width: 600px)'));
    const rule = (selector: string) =>
      phone.match(new RegExp(`^  ${selector.replace(/[.]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ??
      '';
    expect(rule('.landing-phone-tiles')).toMatch(/gap: 6px;/);
    expect(rule('.landing-play-quick')).toMatch(/gap: 6px;/);
    expect(rule('.landing-phone-tile')).toMatch(/height: 84px;/);
    expect(rule('.landing-phone-tile')).toMatch(/font-size: 15px;/);
    expect(rule('.landing-phone-tile-art')).toMatch(/width: 52px;\s*height: 52px;/);
  });

  it('runs the Play a game label a couple of px above the old clamp, same height', () => {
    const play = readFileSync('src/landing-play.css', 'utf8');
    const rule =
      play.match(/^\.landing-play-action\.landing-play-action-primary \{([^}]*)\}/m)?.[1] ?? '';
    expect(rule).toMatch(/font-size: clamp\(19px, 1\.35vw, 22px\);/);
    expect(rule).toMatch(/min-height: 76px;/);
  });
});
