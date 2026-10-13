// /feed: the announcement history as a dated feed, the landing rail's News box
// "More" target. Mirrors lichess's updates-feed page shape: one entry per
// update with date, headline, and the short body line. /feed shows the latest
// months; each month has its own page at /feed/YYYY-MM.
import './news-page.css';
import { localizeAnnouncement } from './announcement-i18n.js';
import { type Announcement, announcementSlug, announcements } from './announcements.js';
import { localizedArticleHref } from './article-i18n.js';
import { articles } from './articles-data.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { formatAnnouncementDate } from './landing-announcements.js';
import { formatMonth } from './month-label.js';
import { buildNav } from './site-shell.js';
import { buildStaticPageLayout } from './static-page-shell.js';
import { rulesHrefPublicSurfaceEnabled } from './variant-public-surfaces.js';

// An announcement pointing at an article has to be localized through the
// article's own rule, not the generic path helper. localizedHref prefixes any
// internal path with the locale, which for an untranslated article invents
// /zh-hant/blog/<slug>: a URL the prerenderer never emits, because it emits a
// localized variant only when the translation is published. localizedArticleHref
// already encodes that, and falls back to the English path. Everything that is
// not an article (a play link, /watch, a broadcast) keeps the plain helper.
function localizedFeedHref(href: string, locale: Locale): string {
  const slug = /^\/(?:blog|rules)\/([a-z0-9-]+)$/.exec(href)?.[1];
  const article = slug ? articles.find((candidate) => candidate.slug === slug) : undefined;
  return article ? localizedArticleHref(article, locale) : localizedHref(href, locale);
}

/**
 * How many months /feed shows, newest first. Every month also has a page of its
 * own at /feed/YYYY-MM, so the page stays a month or two long however long the
 * history gets (a busy month is ~30 entries). Same shape as /changelog.
 */
export const NEWS_MONTHS_ON_INDEX = 2;

type NewsMonth = { id: string; entries: Announcement[] };

/** `/feed/2026-09` → `2026-09`; any other path → null. */
export function newsMonthFromPath(path: string): string | null {
  return /^\/feed\/(\d{4}-\d{2})\/?$/.exec(path)?.[1] ?? null;
}

// Pure reverse-chronological: pinning is a rail concern, not a history one.
function newsMonths(): NewsMonth[] {
  const entries = [...announcements()]
    .filter((entry) => rulesHrefPublicSurfaceEnabled(entry.href))
    .sort((a, b) => b.date.localeCompare(a.date));
  const months: NewsMonth[] = [];
  for (const entry of entries) {
    const id = entry.date.slice(0, 7);
    const last = months.at(-1);
    if (last?.id === id) last.entries.push(entry);
    else months.push({ id, entries: [entry] });
  }
  return months;
}

/** Every month with an entry, for the prerender. The latest ones get a page
 *  too, so a month that drops off /feed when a dated entry goes live before
 *  the next build still has one. */
export function newsMonthIds(): string[] {
  return newsMonths().map((month) => month.id);
}

/**
 * Where an old `/feed#<entry>` link now lives: the month page for an entry that
 * has left /feed, or null when the entry is on /feed (or is no entry at all).
 */
export function newsArchiveHrefForHash(hash: string): string | null {
  const months = newsMonths();
  for (const month of months.slice(NEWS_MONTHS_ON_INDEX)) {
    if (month.entries.some((entry) => announcementSlug(entry) === hash)) {
      return `/feed/${month.id}#${hash}`;
    }
  }
  return null;
}

/** Whether `/feed/<monthId>` has entries; an unknown month shows /feed. */
export function newsMonthExists(monthId: string): boolean {
  return newsMonths().some((month) => month.id === monthId);
}

export function buildNewsPage(
  locale: Locale = currentLocale(),
  monthId: string | null = null,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-section news-page';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('news.feedHeading', {}, locale);
  section.append(heading);

  const intro = document.createElement('p');
  intro.className = 'news-page-intro';
  intro.append(`${t('news.intro', {}, locale)} `);
  // The archive is the only page that names the RSS document; the <link
  // rel="alternate"> in the shell is for readers, not for people.
  const subscribe = document.createElement('a');
  subscribe.className = 'news-page-subscribe';
  subscribe.href = '/feed.xml';
  subscribe.textContent = t('news.subscribe', {}, locale);
  intro.append(subscribe);
  section.append(intro);

  const months = newsMonths();
  if (months.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'news-page-empty';
    empty.textContent = t('news.empty', {}, locale);
    section.append(empty);
    return section;
  }

  // An unknown month shows the latest ones rather than an empty page.
  const single = monthId ? months.find((month) => month.id === monthId) : undefined;
  const shown = single ? [single] : months.slice(0, NEWS_MONTHS_ON_INDEX);
  // One month has nothing to jump between; the row earns its place from two.
  if (months.length > 1) section.append(buildMonthIndex(months, shown, Boolean(single), locale));
  for (const month of shown) section.append(buildMonth(month, locale));
  section.append(buildChangelogFooter(locale));
  highlightHashEntry(section);

  return section;
}

// One link per month, as on /changelog: an anchor when the month is on this
// page, its own page otherwise.
function buildMonthIndex(
  months: NewsMonth[],
  shown: NewsMonth[],
  monthPage: boolean,
  locale: Locale,
): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'news-page-months';
  nav.setAttribute('aria-label', t('changelog.monthsLabel', {}, locale));
  const onPage = new Set(shown.map((month) => month.id));
  for (const month of months) {
    const link = document.createElement('a');
    link.className = 'news-page-months-link';
    link.href = onPage.has(month.id) ? `#${month.id}` : `/feed/${month.id}`;
    if (monthPage && onPage.has(month.id)) link.setAttribute('aria-current', 'page');
    link.textContent = formatMonth(month.id, locale);
    nav.append(link);
  }
  return nav;
}

function buildMonth(month: NewsMonth, locale: Locale): HTMLElement {
  const block = document.createElement('section');
  block.className = 'news-page-month';
  block.id = month.id;

  const heading = document.createElement('h2');
  heading.className = 'news-page-month-heading';
  const anchor = document.createElement('a');
  anchor.className = 'news-page-month-anchor';
  anchor.href = `#${month.id}`;
  anchor.textContent = formatMonth(month.id, locale);
  heading.append(anchor);

  const list = document.createElement('ol');
  list.className = 'news-page-list';
  for (const source of month.entries) list.append(buildEntry(source, locale));
  block.append(heading, list);
  return block;
}

function buildEntry(source: Announcement, locale: Locale): HTMLElement {
  const entry = localizeAnnouncement(source, locale);
  const item = document.createElement('li');
  item.className = 'news-page-entry';
  // Anchor target for the landing News rail, whose rows link here rather than
  // straight to the feature they announce: the rail clamps every body to one
  // line, so the row ends in an ellipsis and a reader clicking it is asking to
  // read the rest. Slug from `source`, not `entry` — see announcementSlug.
  item.id = announcementSlug(source);

  const date = document.createElement('time');
  date.className = 'news-page-date';
  date.dateTime = entry.date;
  date.textContent = formatAnnouncementDate(entry.date, true, locale);

  const body = document.createElement('div');
  body.className = 'news-page-body';

  const headline = document.createElement('p');
  headline.className = 'news-page-headline';
  headline.textContent = entry.headline;
  body.append(headline);

  if (entry.body || entry.href) {
    const text = document.createElement('p');
    text.className = 'news-page-text';
    if (entry.body) text.append(`${entry.body} `);
    if (entry.href) {
      const isExternal = /^https?:/.test(entry.href);
      const link = document.createElement('a');
      link.className = 'news-page-link';
      link.href = isExternal ? entry.href : localizedFeedHref(entry.href, locale);
      link.textContent = announcementCtaLabel(entry, locale);
      if (isExternal) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      text.append(link);
    }
    body.append(text);
  }

  item.append(date, body);
  return item;
}

// This page is the curated megaphone; the complete record, removals and fixes
// included, is /changelog. One line at the foot so a reader who scrolled the
// whole archive knows the rest exists.
function buildChangelogFooter(locale: Locale): HTMLElement {
  const footer = document.createElement('p');
  footer.className = 'news-page-footer';
  footer.append(`${t('changelog.feedFooter', {}, locale)} `);
  const link = document.createElement('a');
  link.className = 'news-page-subscribe';
  link.href = localizedHref('/changelog', locale);
  link.textContent = t('changelog.heading', {}, locale);
  footer.append(link, t('changelog.sentenceEnd', {}, locale));
  return footer;
}

/** Bring the linked entry into view and mark it, so arriving from the News rail
 *  lands on the row that was clicked instead of the top of the list. A plain
 *  :target rule would not survive the SPA render (the hash is already set when
 *  this list is built, so the browser has nothing left to scroll to), hence the
 *  explicit scroll. */
function highlightHashEntry(section: HTMLElement): void {
  const hash = decodeURIComponent(globalThis.location?.hash ?? '').replace(/^#/, '');
  if (!hash) return;
  const target = section.querySelector<HTMLElement>(`[id="${CSS.escape(hash)}"]`);
  if (!target) return;
  // A month heading (#2026-09 from the month row) is a jump, not a highlight.
  const isEntry = target.classList.contains('news-page-entry');
  if (isEntry) target.classList.add('news-page-entry-linked');
  // The list is built before it is in the document, so defer the scroll until
  // the browser can measure it.
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: isEntry ? 'center' : 'start', behavior: 'auto' });
  });
}

function announcementCtaLabel(entry: Announcement, locale: Locale): string {
  return entry.cta ?? t('news.readMore', {}, locale);
}

/** Build-time shell for /feed and each /feed/YYYY-MM (prerender-articles.mjs).
 *  The archive is a static list of authored copy with no per-account or live data in it, so the baked
 *  DOM is the same page a reader gets; the SPA still takes over on boot. Without
 *  this the route served a bare shell, which is not worth the sitemap entry it
 *  now has. */
export function renderNewsShellForPrerender(monthId: string | null = null): string {
  const page = buildNewsPage(undefined, monthId);
  return `${buildNav().outerHTML}${buildStaticPageLayout('news', page).outerHTML}`;
}
