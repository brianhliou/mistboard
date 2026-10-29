import './site-box.css';
import './landing-announcements.css';
import './hover-grammar.css';
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
  // The whole row is one link (list-row hover grammar, hover-grammar.css): it
  // was a date link over a headline link, two targets with two hovers that
  // went to the same place. The headline links to this entry ON /feed, not to
  // the feature it announces: the row clamps its body to one line, so a reader
  // who clicks is asking to read the rest, not to be dropped into /import.
  // /feed renders the full body with the authored CTA inline.
  const row = document.createElement('a');
  row.className = `landing-news-update landing-news-update-${entry.kind} landing-news-link hover-row`;
  row.href = entryHref;
  row.dataset.announcementKind = entry.kind;

  const marker = document.createElement('span');
  marker.className = `landing-news-marker landing-news-marker-${entry.kind}`;
  marker.dataset.announcementKind = entry.kind;
  marker.setAttribute('aria-hidden', 'true');
  // A sticker drawing in the broadcast TV's style, not a line icon: see news-disc.ts.
  marker.append(buildNewsDisc(entry.kind));

  const content = document.createElement('div');
  content.className = 'landing-news-content';

  // The relative date stays the row's green timeline mark; hovering it still
  // shows the exact calendar date.
  const date = document.createElement('span');
  date.className = 'landing-news-date';
  date.title = formatAnnouncementDate(entry.date, true, locale);
  const time = document.createElement('time');
  time.dateTime = entry.date;
  time.textContent = formatAnnouncementRelativeDate(entry.date, locale);
  date.append(time);

  const headline = document.createElement('p');
  headline.className = 'landing-news-headline hover-title';
  headline.textContent = entry.headline;
  content.append(date, headline);

  if (entry.body) {
    // Out of the link's accessible name, which reads date then headline: the
    // body is a one-line clamp of the text /feed shows in full.
    const body = document.createElement('p');
    body.className = 'landing-news-body';
    body.setAttribute('aria-hidden', 'true');
    body.textContent = entry.body;
    content.append(body);
  }

  row.append(marker, content);
  return row;
}

function renderMoreRow(locale: Locale): HTMLElement {
  const row = document.createElement('a');
  row.className = 'landing-news-update landing-news-more hover-link-host';
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
  label.className = 'landing-news-more-label hover-link-text';
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
