import './site-box.css';
import './landing-announcements.css';
import { localizeAnnouncement } from './announcement-i18n.js';
import { type Announcement, announcementSlug, announcements } from './announcements.js';
import { t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale, localizedHref } from './i18n/locale.js';
import { buildNewsDisc, buildNewsMoreDisc } from './news-disc.js';
import { buildSiteBox } from './site-box.js';
import { rulesHrefPublicSurfaceEnabled } from './variant-public-surfaces.js';

// All announcements render as one dated News feed box (lichess lobby__feed
// grammar); the full history lives at /feed.
//
// The box is one of the two bands-3/4 side rails, so its height comes from the
// blog + video rows beside it, not from its row count: render more rows than fit
// and let the timeline scroll. The old cap of 3 predates the compact row (a
// clamped body under its own headline line) and left the archive link doing all
// the work of "there is more here".
const MAX_FEED_ROWS = 12;

export function buildLandingAnnouncements(locale: Locale = currentLocale()): HTMLElement {
  const ordered = announcements()
    .filter((entry) => rulesHrefPublicSurfaceEnabled(entry.href))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (ordered.length === 0) {
    const empty = document.createElement('aside');
    empty.className = 'landing-announcements landing-news-feed';
    empty.setAttribute('aria-label', t('news.heading', {}, locale));
    return empty;
  }

  // Same shell as Top studies (the other bands-3/4 rail): a linked header whose
  // "More »" goes to the archive. It replaced a terminal ☆ row inside the
  // timeline, which sat below the fold once the box scrolled and so was the one
  // affordance a reader had to scroll to find.
  const { box, body } = buildSiteBox({
    title: t('news.heading', {}, locale),
    href: localizedHref('/feed', locale),
    moreLabel: t('site.more', {}, locale),
    className: 'landing-announcements landing-news-feed',
  });
  box.setAttribute('aria-label', t('news.heading', {}, locale));
  // Two-class selector in the stylesheet: site-box.css is shared and Vite may
  // emit it in a later chunk than this widget's own sheet.
  body.classList.add('landing-news-scroll');

  const updates = document.createElement('div');
  updates.className = 'landing-news-updates';
  for (const entry of ordered.slice(0, MAX_FEED_ROWS)) {
    updates.append(renderFeedEntry(entry, locale));
  }
  // The timeline ends on a disc that leads to the archive, so a reader who
  // scrolls to the bottom finds the way on, in the same grammar as the rows.
  // The header's "More »" stays: it is the affordance that is visible without
  // scrolling (the reason a terminal row alone was retired on 2026-08-27).
  updates.append(renderMoreRow(locale));
  body.append(updates);

  return box;
}

function renderFeedEntry(source: Announcement, locale: Locale): HTMLElement {
  const entry = localizeAnnouncement(source, locale);
  // From `source`: the slug is built from the English headline so one anchor
  // works in every locale (announcementSlug). `entry` is already translated.
  const entryHref = `${localizedHref('/feed', locale)}#${announcementSlug(source)}`;
  const row = document.createElement('article');
  row.className = `landing-news-update landing-news-update-${entry.kind}`;
  row.dataset.announcementKind = entry.kind;

  const marker = document.createElement('span');
  marker.className = `landing-news-marker landing-news-marker-${entry.kind}`;
  marker.dataset.announcementKind = entry.kind;
  marker.setAttribute('aria-hidden', 'true');
  // A sticker drawing in the broadcast TV's style, not a line icon: see news-disc.ts.
  marker.append(buildNewsDisc(entry.kind));

  const content = document.createElement('div');
  content.className = 'landing-news-content';

  // Match the Lichess lobby feed: the relative date is a link to the full
  // archive, while hovering it exposes the exact calendar date.
  const dateLink = document.createElement('a');
  dateLink.className = 'landing-news-date';
  dateLink.href = entryHref;
  dateLink.title = formatAnnouncementDate(entry.date, true, locale);
  const date = document.createElement('time');
  date.dateTime = entry.date;
  date.textContent = formatAnnouncementRelativeDate(entry.date, locale);
  dateLink.append(date);

  // The headline links to this entry ON /feed, not to the feature it announces.
  // The row clamps its body to one line, so every row ends in an ellipsis, and
  // a reader who clicks a truncated headline is asking to read the rest, not to
  // be dropped into /import. /feed renders the full body with the authored CTA
  // inline, so the feature is still one click away, from a place where the
  // reader has the whole update in front of them.
  //
  // It used to link straight to entry.href, and the only route to the full text
  // was the small uppercase date. That inverted the affordances: the least
  // prominent element in the row was the one that did what the row looked like
  // it would do.
  const headline = document.createElement('p');
  headline.className = 'landing-news-headline';
  const link = document.createElement('a');
  link.className = 'landing-news-link';
  link.href = entryHref;
  link.textContent = entry.headline;
  headline.append(link);
  content.append(dateLink, headline);

  if (entry.body) {
    const body = document.createElement('p');
    body.className = 'landing-news-body';
    body.textContent = entry.body;
    content.append(body);
  }

  row.append(marker, content);
  return row;
}

function renderMoreRow(locale: Locale): HTMLElement {
  const row = document.createElement('a');
  row.className = 'landing-news-update landing-news-more';
  row.href = localizedHref('/feed', locale);

  const marker = document.createElement('span');
  marker.className = 'landing-news-marker landing-news-marker-more';
  marker.setAttribute('aria-hidden', 'true');
  marker.append(buildNewsMoreDisc());

  // One label, one hover: the row is a single link, and a date line over a
  // headline (the entry-row shape) gave it two hover states and read as two
  // targets.
  const content = document.createElement('div');
  content.className = 'landing-news-content landing-news-more-content';
  const label = document.createElement('span');
  label.className = 'landing-news-more-label';
  label.textContent = t('site.more', {}, locale);
  content.append(label);

  row.append(marker, content);
  return row;
}

function formatAnnouncementRelativeDate(iso: string, locale: Locale): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  const then = Date.UTC(year, month - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((then - today) / 86_400_000);
  if (days > -7 && days <= 0) {
    return new Intl.RelativeTimeFormat(LOCALE_META[locale].dateLocale, {
      numeric: 'auto',
    }).format(days, 'day');
  }
  return formatAnnouncementDate(iso, false, locale);
}

export function formatAnnouncementDate(
  iso: string,
  withYear = false,
  locale: Locale = currentLocale(),
): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString(LOCALE_META[locale].dateLocale, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}
