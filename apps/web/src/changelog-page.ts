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

export function mountChangelog(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'changelog-route');
  root.append(
    buildNav(locale),
    buildStaticPageLayout('changelog', buildChangelogPage(locale), locale),
  );
  scrollToHashMonth(root);
}

export function buildChangelogPage(locale: Locale = currentLocale()): HTMLElement {
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

  // One month has nothing to jump between; the index earns its row from two.
  if (months.length > 1) section.append(buildMonthIndex(months, locale));
  for (const month of months) section.append(buildMonth(month, locale));
  return section;
}

// The month list at the top doubles as lichess's month anchors: one link per
// section so a reader can jump, and so a shared link lands on a month.
function buildMonthIndex(months: ChangelogMonth[], locale: Locale): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'changelog-months';
  nav.setAttribute('aria-label', t('changelog.monthsLabel', {}, locale));
  for (const month of months) {
    const link = document.createElement('a');
    link.className = 'changelog-months-link';
    link.href = `#${month.id}`;
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
  const hash = decodeURIComponent(globalThis.location?.hash ?? '').replace(/^#/, '');
  if (!/^\d{4}-\d{2}$/.test(hash)) return;
  const target = root.querySelector<HTMLElement>(`[id="${hash}"]`);
  if (!target) return;
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
}

/** Build-time shell for /changelog (prerender-articles.mjs): the page is the
 *  committed file with no live data, so the baked DOM is the page. */
export function renderChangelogShellForPrerender(): string {
  return `${buildNav().outerHTML}${buildStaticPageLayout('changelog', buildChangelogPage()).outerHTML}`;
}
