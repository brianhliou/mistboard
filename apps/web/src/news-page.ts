// /feed: the full announcement history as a dated feed, the landing rail's
// News box "More" target. Mirrors lichess's updates-feed page shape: one
// entry per update with date, headline, and the short body line.
import './news-page.css';
import { localizeAnnouncement } from './announcement-i18n.js';
import { type Announcement, announcementSlug, announcements } from './announcements.js';
import { localizedArticleHref } from './article-i18n.js';
import { articles } from './articles-data.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { formatAnnouncementDate } from './landing-announcements.js';
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

export function buildNewsPage(locale: Locale = currentLocale()): HTMLElement {
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

  // Pure reverse-chronological: pinning is a rail concern, not a history one.
  const entries = [...announcements()]
    .filter((entry) => rulesHrefPublicSurfaceEnabled(entry.href))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'news-page-empty';
    empty.textContent = t('news.empty', {}, locale);
    section.append(empty);
    return section;
  }

  const list = document.createElement('ol');
  list.className = 'news-page-list';
  for (const source of entries) {
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
    list.append(item);
  }
  section.append(list, buildChangelogFooter(locale));
  highlightHashEntry(section);

  return section;
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
  target.classList.add('news-page-entry-linked');
  // The list is built before it is in the document, so defer the scroll until
  // the browser can measure it.
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
  });
}

function announcementCtaLabel(entry: Announcement, locale: Locale): string {
  return entry.cta ?? t('news.readMore', {}, locale);
}

/** Build-time shell for /feed (prerender-articles.mjs). The archive is a static
 *  list of authored copy with no per-account or live data in it, so the baked
 *  DOM is the same page a reader gets; the SPA still takes over on boot. Without
 *  this the route served a bare shell, which is not worth the sitemap entry it
 *  now has. */
export function renderNewsShellForPrerender(): string {
  return `${buildNav().outerHTML}${buildStaticPageLayout('news', buildNewsPage()).outerHTML}`;
}
