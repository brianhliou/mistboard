import { afterEach, describe, expect, it, vi } from 'vitest';
import { localizeAnnouncement } from './announcement-i18n.js';
import { type AnnouncementKind, announcementSlug, announcements } from './announcements.js';
import { localizedArticleHref } from './article-i18n.js';
import { articles } from './articles-data.js';
import { buildLandingAnnouncements } from './landing-announcements.js';
import { newsDiscInkForKind, newsDiscMarkForKind } from './news-disc.js';
import { buildNewsPage } from './news-page.js';
import {
  rulesHrefPublicSurfaceEnabled,
  variantPublicSurfaceEnabled,
} from './variant-public-surfaces.js';
import { leaderboardVariants } from './variants.js';

describe('landing announcements', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows current launch announcements without old variant env flags', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DARK_SHOGI_ENABLED', 'false');
    vi.stubEnv('VITE_DARK_CROSSROADS_CHESS_ENABLED', 'false');
    vi.stubEnv('VITE_DARK_CRAZYHOUSE_ENABLED', 'false');
    vi.stubEnv('VITE_KRIEGSPIEL_ENABLED', 'false');

    const panel = buildLandingAnnouncements();
    const hrefs = [...panel.querySelectorAll<HTMLAnchorElement>('a.landing-news-link')].map((row) =>
      row.getAttribute('href'),
    );

    // Xiangqi pivot: the News rail is gated by variantPublicSurfaceEnabled. The
    // mini xiangqi trio (incl. drop-mini) and dark-crazyhouse are retired from
    // public surfaces; the elevated Chinese-chess-family launches (dark-xiangqi,
    // banqi) now surface. The rail shows the newest MAX_FEED_ROWS entries.
    // Derived from the announcement data rather than pinned to specific posts:
    // this asserts the gating and ordering behaviour, and does not need editing
    // every time a new announcement ships.
    // Rows link to their own entry on /feed now, so this compares anchors
    // rather than feature hrefs; the assertion is still gating and ordering.
    const expected = [...announcements()]
      .filter((entry) => rulesHrefPublicSurfaceEnabled(entry.href))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((entry) => `/feed#${announcementSlug(entry)}`)
      .slice(0, hrefs.length);
    expect(hrefs).toEqual(expected);
  });

  it('keeps parked and gated variant launches out of the homepage News rail', () => {
    vi.stubEnv('DEV', false);

    const panel = buildLandingAnnouncements();
    const hrefs = new Set(
      [...panel.querySelectorAll<HTMLAnchorElement>('a.landing-news-link')].map((row) =>
        row.getAttribute('href'),
      ),
    );

    expect(hrefs).not.toContain('/rules/reveal-chess');
    expect(hrefs).not.toContain('/rules/crossroads-chess');
    expect(hrefs).not.toContain('/rules/dark-crossroads-chess');
    expect(hrefs).not.toContain('/rules/kriegspiel');
  });

  it('uses the same variant flag for the homepage News rail and /feed archive', () => {
    vi.stubEnv('DEV', false);

    expect(variantPublicSurfaceEnabled('reveal-chess')).toBe(false);
    expect(variantPublicSurfaceEnabled('crossroads-chess')).toBe(false);
    expect(variantPublicSurfaceEnabled('dark-crossroads-chess')).toBe(false);
    expect(variantPublicSurfaceEnabled('dark-shogi')).toBe(false);
    expect(variantPublicSurfaceEnabled('kriegspiel')).toBe(false);

    const landing = buildLandingAnnouncements();
    const news = buildNewsPage();

    for (const hidden of [
      'Reveal Chess',
      'Crossroads Chess',
      'Dark Crossroads Chess',
      'Fog Shogi',
      'Kriegspiel',
    ]) {
      expect(landing.textContent).not.toContain(hidden);
      expect(news.textContent).not.toContain(hidden);
    }
  });

  it('retires the Drop Mini Xiangqi launch announcement from the homepage News rail', () => {
    // Xiangqi pivot: drop-mini's public surface is off (variantPublicSurfaceEnabled
    // = false), so its launch row no longer shows on the homepage News rail (the
    // /rules/drop-mini-xiangqi page stays reachable by direct URL).
    vi.stubEnv('DEV', false);

    const panel = buildLandingAnnouncements();
    const row = [...panel.querySelectorAll<HTMLAnchorElement>('a.landing-news-link')].find((r) =>
      r.textContent?.includes('Drop Mini Xiangqi'),
    );

    expect(row).toBeUndefined();
  });

  it('keeps older launch items in the full announcements history', () => {
    const hrefs = new Set(announcements().map((entry) => entry.href));

    expect(hrefs).toContain('/forum');
    expect(hrefs).toContain('/rules/banqi');
    expect(hrefs).toContain('/rules/jieqi');
    expect(hrefs).toContain('/?play=computer');
  });

  it('reaches the archive from a linked header, the way Top studies does', () => {
    const panel = buildLandingAnnouncements();
    const top = panel.querySelector<HTMLAnchorElement>('a.site-box-top');

    // The affordance used to be a terminal ☆ row at the bottom of the timeline,
    // which the reader had to scroll to reach once the box overflowed.
    expect(top?.getAttribute('href')).toBe('/feed');
    expect(top?.querySelector('.site-box-more')?.textContent).toBe('More »');
    expect(panel.querySelector('.landing-news-all-updates')).toBeNull();
  });

  it('renders more rows than the box shows, and scrolls the rest', () => {
    const panel = buildLandingAnnouncements();
    const rows = panel.querySelectorAll('.landing-news-update[data-announcement-kind]');
    const visible = [
      ...panel.querySelectorAll<HTMLElement>(
        '.landing-news-update[data-announcement-kind] .landing-news-headline',
      ),
    ];

    // The box's height comes from the band beside it, so the cap is only there
    // to bound the DOM: it has to clear what any plausible box height shows.
    expect(rows.length).toBeGreaterThan(6);
    expect(visible).toHaveLength(rows.length);
  });

  it('links each hoverable relative date to its own entry on the feed', () => {
    const panel = buildLandingAnnouncements();
    const dates = [...panel.querySelectorAll<HTMLAnchorElement>('a.landing-news-date')];

    expect(dates).toHaveLength(
      panel.querySelectorAll('.landing-news-update[data-announcement-kind]').length,
    );
    for (const date of dates) {
      const stamp = date.querySelector('time')?.dateTime ?? '';
      expect(stamp).toMatch(/^2026-\d{2}-\d{2}$/);
      // The anchor starts with this row's own date, so a row cannot link to a
      // different row's entry.
      expect(date.getAttribute('href')).toMatch(/^\/feed#2026-\d{2}-\d{2}-[a-z0-9-]+$/);
      expect(date.getAttribute('href')).toContain(`/feed#${stamp}-`);
      expect(date.getAttribute('title')).toMatch(/2026/);
    }
  });

  it('sends the headline to the entry on /feed, not to the feature it announces', () => {
    // The row clamps its body to one line, so every row ends in an ellipsis. A
    // reader clicking a truncated headline is asking to read the rest; before
    // this, the headline jumped to /import (or wherever) and the only route to
    // the full text was the small uppercase date.
    const panel = buildLandingAnnouncements();
    const links = [...panel.querySelectorAll<HTMLAnchorElement>('a.landing-news-link')];

    expect(links).toHaveLength(
      panel.querySelectorAll('.landing-news-update[data-announcement-kind]').length,
    );
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/feed#2026-\d{2}-\d{2}-[a-z0-9-]+$/);
    }
    // Every row's headline and its date agree on the target.
    const rows = [...panel.querySelectorAll('.landing-news-update[data-announcement-kind]')];
    for (const row of rows) {
      const headline = row.querySelector('a.landing-news-link')?.getAttribute('href');
      const date = row.querySelector('a.landing-news-date')?.getAttribute('href');
      expect(headline).toBe(date);
    }
  });

  it('gives every announcement a unique, locale-stable anchor', () => {
    // Two entries share 2026-08-30, so the date alone cannot identify a row.
    // The slug comes from the English headline, so a link shared from a zh page
    // resolves on an en one.
    const slugs = announcements().map((entry) => announcementSlug(entry));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of announcements()) {
      expect(announcementSlug(entry)).toMatch(/^2026-\d{2}-\d{2}(-[a-z0-9-]+)?$/);
    }
  });

  it('/feed carries the anchor every rail row links to', () => {
    // The rail's target only works if the entry it names exists on the page.
    // These are built in two different modules from the same slug function, so
    // nothing but this test stops a rail link pointing at a missing anchor.
    const panel = buildLandingAnnouncements();
    const news = buildNewsPage();
    const ids = new Set(
      [...news.querySelectorAll<HTMLElement>('.news-page-entry')].map((entry) => entry.id),
    );

    const targets = [...panel.querySelectorAll<HTMLAnchorElement>('a.landing-news-link')].map(
      (link) => link.getAttribute('href')?.split('#')[1] ?? '',
    );
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(ids, `rail links to #${target}, which /feed does not render`).toContain(target);
    }
  });

  it('keeps English announcement copy free of Han script', () => {
    for (const entry of announcements()) {
      expect(`${entry.headline} ${entry.body ?? ''}`).not.toMatch(/\p{Script=Han}/u);
    }
  });

  it('marks feed rows by supported post type and renders disc markers', () => {
    const firstRow = buildLandingAnnouncements().querySelector<HTMLElement>('.landing-news-update');
    const marker = firstRow?.querySelector<HTMLElement>('.landing-news-marker');

    // The invariant is that the marker agrees with the row's own kind and
    // renders that kind's mark, whatever the newest announcement happens to be.
    const kind = firstRow?.dataset.announcementKind;
    expect(kind).toBeTruthy();
    expect(marker?.dataset.announcementKind).toBe(kind);
    // Resolved through the same mapping the view uses, rather than assuming the
    // mark is named after the kind, so the assertion survives a remap.
    const mark = newsDiscMarkForKind(kind as AnnouncementKind);
    const disc = marker?.querySelector<SVGSVGElement>('svg.landing-news-disc');
    expect(disc?.dataset.mark).toBe(mark);
    expect(disc?.classList.contains(`landing-news-disc-${mark}`)).toBe(true);
    // The disc carries its own ring and fill, so the marker needs no icon font
    // or currentColor to render: nothing in it is a ui-icon.
    expect(marker?.querySelector('svg.ui-icon')).toBeNull();
  });

  it('ends the timeline on an archive disc that links to /feed', () => {
    const box = buildLandingAnnouncements();
    const rows = box.querySelectorAll<HTMLElement>('.landing-news-update');
    const last = rows[rows.length - 1];
    expect(last?.classList.contains('landing-news-more')).toBe(true);
    expect(last?.tagName).toBe('A');
    expect((last as HTMLAnchorElement).getAttribute('href')).toBe('/feed');
    expect(last?.querySelector('svg.landing-news-disc-more')).not.toBeNull();
    // The archive row is not an announcement: it carries no kind.
    expect(last?.dataset.announcementKind).toBeUndefined();
  });

  it('gives every announcement kind its own mark, and both inks a use', () => {
    const kinds: AnnouncementKind[] = ['release', 'update', 'article', 'status'];
    const marks = kinds.map((kind) => newsDiscMarkForKind(kind));
    expect(new Set(marks).size).toBe(kinds.length);

    const inks = new Set(kinds.map((kind) => newsDiscInkForKind(kind)));
    expect(inks).toEqual(new Set(['red', 'black']));
  });

  it('localizes the News rail and feed chrome', () => {
    vi.stubEnv('DEV', false);

    const landing = buildLandingAnnouncements('zh-Hant');
    const firstRow = landing.querySelector<HTMLAnchorElement>('a.landing-news-link');
    const more = landing.querySelector<HTMLElement>('.site-box-more');
    const news = buildNewsPage('zh-Hant');

    // A row targets its own entry on /feed, so the expectation is the LOCALIZED
    // feed path plus the anchor. The anchor itself is not localized: it is
    // slugged from the English headline so one link resolves in every locale.
    const newestRailEntry = [...announcements()]
      .filter((entry) => rulesHrefPublicSurfaceEnabled(entry.href))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    // /feed is not a locale-prefixed content path (localizedHref leaves it
    // alone), and the anchor is slugged from English, so the whole target is
    // identical in every locale. Only the row's TEXT is translated.
    const newestHref = newestRailEntry ? `/feed#${announcementSlug(newestRailEntry)}` : undefined;
    // The CTA on /feed itself still points at the feature, and IS localized
    // when it targets a translated article. That link is the reason the rail
    // can stop carrying one: the reader meets it with the full entry in view.
    const articleSlug = /^\/(?:blog|rules)\/([a-z0-9-]+)$/.exec(newestRailEntry?.href ?? '')?.[1];
    const article = articleSlug ? articles.find((a) => a.slug === articleSlug) : undefined;
    const newestFeatureHref = article
      ? localizedArticleHref(article, 'zh-Hant')
      : newestRailEntry?.href;

    expect(landing.getAttribute('aria-label')).toBe('新聞');
    expect(firstRow?.getAttribute('href')).toBe(newestHref);
    expect(more?.textContent).toBe('更多 »');
    expect(news.querySelector('.site-section-heading')?.textContent).toBe('Mistboard 更新');
    expect(news.querySelector('.news-page-intro')?.textContent).toBe(
      'Mistboard 的發布、狀態更新和公告。 訂閱 RSS',
    );
    expect(news.querySelector<HTMLAnchorElement>('.news-page-subscribe')?.href).toContain(
      '/feed.xml',
    );
    expect(news.querySelector<HTMLAnchorElement>('.news-page-link')?.getAttribute('href')).toBe(
      newestFeatureHref,
    );
    // Both of the row's targets are the entry's anchor, so nothing in the row
    // sends a reader somewhere other than the update they clicked.
    expect(
      landing.querySelector<HTMLAnchorElement>('a.landing-news-date')?.getAttribute('href'),
    ).toBe(newestHref);
    // Authored announcement copy (headline, body, CTA label) is translated by
    // announcement-i18n.ts, not the catalog, so the whole entry renders in zh.
    const newest = [...announcements()].sort((a, b) => b.date.localeCompare(a.date))[0];
    const localized = localizeAnnouncement(newest, 'zh-Hant');
    expect(localized.headline).not.toBe(newest?.headline);
    expect(news.querySelector('.news-page-link')?.textContent).toBe(localized.cta);
    expect(news.querySelector('.news-page-headline')?.textContent).toBe(localized.headline);
  });

  it('has a rules announcement for every launched leaderboard variant', () => {
    const announcementHrefs = new Set(announcements().map((entry) => entry.href));
    const readerFacingRuleSlugs: Record<string, string> = {
      'dark-chess': 'fog-chess',
      'dark-xiangqi': 'fog-xiangqi',
    };

    for (const variant of leaderboardVariants) {
      const slug = readerFacingRuleSlugs[variant.gameSpecId] ?? variant.gameSpecId;
      expect(announcementHrefs).toContain(`/rules/${slug}`);
    }
  });
});
