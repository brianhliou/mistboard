// /changelog: the root CHANGELOG.md as a page, lichess.org/changelog-shaped.
// Months newest first with anchors, one heading per part of the site, one line
// per change ending in its commit link. /feed is the curated megaphone; this
// is the complete record, removals included. Renders inside the shared /about
// rail + panel shell. The body is English only (the file is), the chrome is
// localized.
import './changelog-page.css';

import { type ChangelogInline, type ChangelogMonth, changelogMonths } from './changelog-data.js';
import { t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale, localizedHref } from './i18n/locale.js';
import { buildNav, GITHUB_URL } from './site-shell.js';
import { proseExternalLink, proseHeading, proseLink, proseParagraph } from './static-page-dom.js';
import { buildStaticPageLayout } from './static-page-shell.js';

/**
 * How many months /changelog shows in full, newest first. Each older month has
 * a page of its own at /changelog/YYYY-MM, so the page stays one or two months
 * long however long the record gets (a busy month is ~250 lines).
 */
export const CHANGELOG_MONTHS_ON_INDEX = 2;

/** `/changelog/2026-09` → `2026-09`; any other path → null. */
export function changelogMonthFromPath(path: string): string | null {
  return /^\/changelog\/(\d{4}-\d{2})\/?$/.exec(path)?.[1] ?? null;
}

/** The months that live on pages of their own, for the prerender. */
export function changelogArchiveMonthIds(): string[] {
  return changelogMonths()
    .slice(CHANGELOG_MONTHS_ON_INDEX)
    .map((month) => month.id);
}

export function mountChangelog(
  root: HTMLElement,
  monthId: string | null = changelogMonthFromPath(globalThis.location?.pathname ?? ''),
): void {
  // An old /changelog#2026-08 link, from before the older months moved out:
  // send it to the month's own page.
  const hash = hashMonth();
  if (!monthId && hash && changelogArchiveMonthIds().includes(hash)) {
    globalThis.location.replace(`/changelog/${hash}`);
    return;
  }
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'changelog-route');
  root.append(
    buildNav(locale),
    buildStaticPageLayout('changelog', buildChangelogPage(locale, monthId), locale),
  );
  scrollToHashMonth(root);
}

/**
 * The page: the latest months in full, or with `monthId` that one month, under
 * a row linking every month.
 */
export function buildChangelogPage(
  locale: Locale = currentLocale(),
  monthId: string | null = null,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-section static-prose changelog-page';
  section.append(
    proseHeading(t('changelog.heading', {}, locale)),
    // Two sentences, two paragraphs: the sentence break carries no ASCII space
    // in Chinese, so joining them in one paragraph would need a per-locale
    // separator for no gain.
    proseParagraph([
      `${t('changelog.intro', {}, locale)} `,
      proseLink(t('changelog.feedLink', {}, locale), localizedHref('/feed', locale)),
      t('changelog.sentenceEnd', {}, locale),
    ]),
    proseParagraph([
      `${t('changelog.sourcePrefix', {}, locale)} `,
      proseExternalLink(
        t('changelog.sourceLink', {}, locale),
        `${GITHUB_URL}/blob/main/CHANGELOG.md`,
      ),
      t('changelog.sentenceEnd', {}, locale),
    ]),
  );

  const months = changelogMonths();
  if (months.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'changelog-empty';
    empty.textContent = t('news.empty', {}, locale);
    section.append(empty);
    return section;
  }

  // An unknown month shows the latest ones rather than an empty page.
  const single = monthId ? months.find((month) => month.id === monthId) : undefined;
  const shown = single ? [single] : months.slice(0, CHANGELOG_MONTHS_ON_INDEX);
  // One month has nothing to jump between; the index earns its row from two.
  if (months.length > 1) section.append(buildMonthIndex(months, shown, Boolean(single), locale));
  for (const month of shown) section.append(buildMonth(month, locale));
  return section;
}

// The month list at the top doubles as lichess's month anchors: one link per
// month, an anchor when the month is on this page and its own page otherwise.
function buildMonthIndex(
  months: ChangelogMonth[],
  shown: ChangelogMonth[],
  monthPage: boolean,
  locale: Locale,
): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'changelog-months';
  nav.setAttribute('aria-label', t('changelog.monthsLabel', {}, locale));
  const latest = new Set(months.slice(0, CHANGELOG_MONTHS_ON_INDEX).map((month) => month.id));
  const onPage = new Set(shown.map((month) => month.id));
  for (const month of months) {
    const link = document.createElement('a');
    link.className = 'changelog-months-link';
    link.href = onPage.has(month.id)
      ? `#${month.id}`
      : latest.has(month.id)
        ? `/changelog#${month.id}`
        : `/changelog/${month.id}`;
    if (monthPage && onPage.has(month.id)) link.setAttribute('aria-current', 'page');
    link.textContent = formatMonth(month.id, locale);
    nav.append(link);
  }
  return nav;
}

function buildMonth(month: ChangelogMonth, locale: Locale): HTMLElement {
  const article = document.createElement('section');
  article.className = 'changelog-month';
  article.id = month.id;

  const heading = document.createElement('h2');
  heading.className = 'changelog-month-heading';
  const anchor = document.createElement('a');
  anchor.className = 'changelog-month-anchor';
  anchor.href = `#${month.id}`;
  anchor.textContent = formatMonth(month.id, locale);
  heading.append(anchor);
  article.append(heading);

  for (const section of month.sections) {
    const subheading = document.createElement('h3');
    subheading.className = 'changelog-section-heading';
    subheading.textContent = section.heading;
    article.append(subheading);

    const list = document.createElement('ul');
    list.className = 'changelog-entries';
    for (const entry of section.entries) {
      const item = document.createElement('li');
      item.className = 'changelog-entry';
      for (const part of entry.parts) item.append(renderInline(part));
      list.append(item);
    }
    article.append(list);
  }
  return article;
}

function renderInline(part: ChangelogInline): Node {
  switch (part.kind) {
    case 'text':
      return document.createTextNode(part.text);
    case 'code': {
      const code = document.createElement('code');
      code.textContent = part.text;
      return code;
    }
    case 'strong': {
      const strong = document.createElement('strong');
      strong.textContent = part.text;
      return strong;
    }
    case 'link': {
      const external = /^https?:/.test(part.href);
      const link = external
        ? proseExternalLink(part.text, part.href)
        : proseLink(part.text, part.href);
      // A commit hash reads as a reference, not prose: mark it so the stylesheet
      // can set it small and monospace.
      if (/\/commit\/[0-9a-f]{7,40}$/.test(part.href)) link.classList.add('changelog-commit');
      return link;
    }
  }
}

/** `2026-09` as "September 2026" (or 2026年9月), the lichess month label. */
export function formatMonth(id: string, locale: Locale = currentLocale()): string {
  const [year, month] = id.split('-').map(Number);
  if (!year || !month) return id;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(LOCALE_META[locale].dateLocale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// The page is built before it is in the document, so a #2026-09 hash has
// nothing to land on until the next frame; scroll it explicitly, like /feed.
function scrollToHashMonth(root: HTMLElement): void {
  const hash = hashMonth();
  if (!hash) return;
  const target = root.querySelector<HTMLElement>(`[id="${hash}"]`);
  if (!target) return;
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
}

function hashMonth(): string | null {
  const hash = decodeURIComponent(globalThis.location?.hash ?? '').replace(/^#/, '');
  return /^\d{4}-\d{2}$/.test(hash) ? hash : null;
}

/** Build-time shell for /changelog and each /changelog/YYYY-MM
 *  (prerender-articles.mjs): the page is the committed file with no live data,
 *  so the baked DOM is the page. */
export function renderChangelogShellForPrerender(monthId: string | null = null): string {
  const page = buildChangelogPage(undefined, monthId);
  return `${buildNav().outerHTML}${buildStaticPageLayout('changelog', page).outerHTML}`;
}
