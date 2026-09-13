// Static content pages — about / source / faq / terms / not-found / articles / rules.

import './pages-static.css';

import { loadCachedCurrentUser, readCachedUser } from './account-nav.js';
import { buildContact } from './contact.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav, GITHUB_URL } from './site-shell.js';
import { buildStaticPageLayout } from './static-page-shell.js';
import {
  formatStatNumber as formatNumber,
  type PublicSiteStats,
  type PublicStatsMode,
} from './stats-charts.js';

const publicStatsModes: Array<{
  key: PublicStatsMode;
  labelKey: 'about.modePve' | 'about.modePvp';
}> = [
  { key: 'pvp', labelKey: 'about.modePvp' },
  { key: 'pve', labelKey: 'about.modePve' },
];

export function mountAbout(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'about-route');
  root.append(buildNav(locale), buildStaticPageLayout('about', buildAbout(locale), locale));
}

export function mountSource(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'source-route');
  root.append(buildNav(locale), buildStaticPageLayout('source', buildSource(locale), locale));
}

export function mountFaq(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'faq-route');
  root.append(buildNav(locale), buildStaticPageLayout('faq', buildFaq(locale), locale));
}

export function mountTerms(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'terms-route');
  root.append(buildNav(locale), buildStaticPageLayout('terms', buildTerms(locale), locale));
}

export function mountPrivacy(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'privacy-route');
  root.append(buildNav(locale), buildStaticPageLayout('privacy', buildPrivacy(locale), locale));
}

export function mountNotFound(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'not-found-route');
  root.append(buildNav(locale), buildNotFound(locale));
}

export async function mountNews(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'news-route');
  const { buildNewsPage } = await import('./news-page.js');
  root.append(buildNav(locale), buildStaticPageLayout('news', buildNewsPage(locale), locale));
}

export async function mountPatron(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'patron-route');
  document.title = `${t('patron.heading', {}, locale)} · Mistboard`;
  const { buildPatronPage } = await import('./patron-page.js');
  // Focused, hero-led layout (no static side rail) to match the donate page
  // shape; the footer + other pages' rails still link here.
  root.append(buildNav(locale), buildPatronPage(locale));
}

export function mountContact(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'contact-route');
  const cachedUser = readCachedUser();
  const contact = buildContact(cachedUser, isLikelySignedIn(), locale);
  root.append(buildNav(locale), buildStaticPageLayout('contact', contact.el, locale));
  void loadCachedCurrentUser()
    .then((user) => contact.applyAuth(user))
    .catch(() => contact.applyAuth(null));
}

export async function mountArticlesIndex(
  root: HTMLElement,
  lang?: import('./article-i18n.js').ArticleLang | null,
  view: import('./articles.js').ArticleIndexView = 'mistboard',
): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page', 'articles-route');
  const { buildArticlesIndex, mountArticleThumbnails } = await import('./articles.js');
  const index = buildArticlesIndex(lang ?? undefined, view);
  root.append(buildNav(), index);
  mountArticleThumbnails(index);
}

/* /blog, baked at build time. The index is authored data with no live or
 * per-account content, so the prerendered DOM is exactly the page a reader
 * gets. It was the one sitemap-advertised article surface still answering with
 * an empty shell while every individual post was prerendered. Default locale
 * and the "By Mistboard" view only: the localized indexes and the (currently
 * empty) community view stay on the client-rendered shell. */
export async function renderArticlesIndexShellForPrerender(): Promise<string> {
  const { buildArticlesIndex } = await import('./articles.js');
  return `${buildNav().outerHTML}${buildArticlesIndex(undefined, 'mistboard').outerHTML}`;
}

export async function mountRulesIndex(
  root: HTMLElement,
  lang?: import('./article-i18n.js').ArticleLang | null,
): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page', 'articles-route', 'rules-route');
  const { buildRulesIndex, mountArticleThumbnails } = await import('./articles.js');
  const index = buildRulesIndex(lang ?? undefined);
  root.append(buildNav(), index);
  mountArticleThumbnails(index);
}

export async function mountArticle(
  root: HTMLElement,
  slug: string,
  lang?: import('./article-i18n.js').ArticleLang | null,
): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page', 'articles-route');
  const {
    buildArticlePage,
    mountPendingWidgets,
    mountArticleEnhancements,
    mountArticleLightbox,
    mountArticleThumbnails,
  } = await import('./articles.js');
  const { findArticle } = await import('./articles-data.js');
  const { translateArticle } = await import('./article-i18n.js');
  const { setBoardFamily, xiangqiAppearanceEnabled } = await import('./theme.js');
  const base = findArticle(slug);
  // Show the family's board/piece pickers while the article is open so the
  // diagrams react to the right controls (each family only when its flag is on).
  const family = base?.boardFamily;
  setBoardFamily(family === 'xiangqi' && xiangqiAppearanceEnabled() ? 'xiangqi' : 'chess');
  const article = base && lang ? translateArticle(base, lang) : base;
  if (article) document.title = `${article.title} · Mistboard`;
  const articlePage = buildArticlePage(slug, lang ?? undefined);
  root.append(buildNav(), articlePage);
  mountPendingWidgets(articlePage);
  mountArticleEnhancements(articlePage);
  mountArticleLightbox(articlePage);
  // The variant rail carries board-kind thumbnails that mount like index cards.
  mountArticleThumbnails(articlePage);
}

function buildAbout(locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-section about-section';
  section.id = 'about';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('about.heading', {}, locale);

  const lede = aboutParagraph([t('about.lede', {}, locale)]);

  const whyHeading = aboutSubheading(t('about.whyHeading', {}, locale));
  const whyP = aboutParagraph([t('about.whyBody', {}, locale)]);

  const rulesHeading = aboutSubheading(t('about.darkChessHeading', {}, locale));
  const rulesP = aboutParagraph([t('about.darkChessBody', {}, locale)]);

  const featuresHeading = aboutSubheading(t('about.playStudyHeading', {}, locale));
  const featuresP = aboutParagraph([t('about.playStudyBody', {}, locale)]);

  const fairnessHeading = aboutSubheading(t('about.trustHeading', {}, locale));
  const fairnessP = aboutParagraph([t('about.trustBody', {}, locale)]);

  const engineHeading = aboutSubheading(t('about.enginesHeading', {}, locale));
  const engineP = aboutParagraph([t('about.enginesBody', {}, locale)]);

  const oss1Heading = aboutSubheading(t('about.openSourceHeading', {}, locale));
  const oss1P = aboutParagraph([
    t('about.openSourcePrefix', {}, locale),
    aboutExternalLink('GitHub', GITHUB_URL),
    t('about.openSourceMiddle', {}, locale),
    aboutLink(t('footer.source', {}, locale), '/source'),
    t('about.openSourceSuffix', {}, locale),
  ]);

  const platformActivity = buildPlatformActivity(locale);
  section.append(
    heading,
    lede,
    whyHeading,
    whyP,
    rulesHeading,
    rulesP,
    featuresHeading,
    featuresP,
    fairnessHeading,
    fairnessP,
    engineHeading,
    engineP,
    oss1Heading,
    oss1P,
    platformActivity,
  );
  void hydratePlatformActivity(platformActivity, locale);
  return section;
}

function buildPlatformActivity(locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'platform-activity';
  section.id = 'platform-activity';
  section.setAttribute('aria-labelledby', 'platform-activity-heading');

  const heading = document.createElement('h2');
  heading.id = 'platform-activity-heading';
  heading.className = 'about-subheading';
  heading.textContent = t('about.activityHeading', {}, locale);

  const intro = aboutParagraph([t('about.activityIntro', {}, locale)]);

  const body = document.createElement('div');
  body.className = 'platform-activity-body';
  body.setAttribute('aria-live', 'polite');
  renderPlatformActivityLoading(body, locale);

  section.append(heading, intro, body);
  return section;
}

async function hydratePlatformActivity(
  section: HTMLElement,
  locale: Locale = currentLocale(),
): Promise<void> {
  const body = section.querySelector<HTMLElement>('.platform-activity-body');
  if (!body) return;
  try {
    const stats = await fetchPublicStats();
    renderPlatformActivityStats(body, stats, locale);
  } catch {
    renderPlatformActivityUnavailable(body, locale);
  }
}

async function fetchPublicStats(): Promise<PublicSiteStats> {
  const response = await fetch('/api/stats/public', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`stats unavailable: ${response.status}`);
  return (await response.json()) as PublicSiteStats;
}

function renderPlatformActivityLoading(body: HTMLElement, locale: Locale = currentLocale()): void {
  const loading = document.createElement('p');
  loading.className = 'platform-activity-status';
  loading.textContent = t('about.activityLoading', {}, locale);
  body.replaceChildren(loading);
}

function renderPlatformActivityUnavailable(
  body: HTMLElement,
  locale: Locale = currentLocale(),
): void {
  const status = document.createElement('p');
  status.className = 'platform-activity-status';
  status.textContent = t('about.activityUnavailable', {}, locale);
  body.replaceChildren(status);
}

function renderPlatformActivityStats(
  body: HTMLElement,
  stats: PublicSiteStats,
  locale: Locale = currentLocale(),
): void {
  const summary = document.createElement('p');
  summary.className = 'platform-activity-summary';
  summary.append(
    document.createTextNode(
      t(
        'about.activitySummaryTotal',
        { total: formatNumber(stats.totalCompletedGames, locale) },
        locale,
      ),
    ),
  );
  if (stats.last30dCompletedGames > 0) {
    summary.append(
      document.createTextNode(
        t(
          'about.activitySummaryRecent',
          { count: formatNumber(stats.last30dCompletedGames, locale) },
          locale,
        ),
      ),
    );
  }
  summary.append(document.createTextNode('. '));
  // The chart lives on /stats now (one chart, one home); this section keeps
  // the sentence and the split and points at the full page.
  const more = aboutLink(t('about.activityFullStats', {}, locale), '/stats');
  more.className = 'platform-activity-more';
  summary.append(more);
  body.replaceChildren(summary, buildModeSplit(stats.modeTotals, locale));
}

function buildModeSplit(
  modeTotals: Record<PublicStatsMode, number>,
  locale: Locale = currentLocale(),
): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'platform-activity-mode-list';
  list.setAttribute('aria-label', t('about.modeSplit', {}, locale));
  for (const mode of publicStatsModes) {
    const item = document.createElement('li');
    item.className = `platform-activity-mode-item mode-${mode.key}`;

    const name = document.createElement('span');
    name.textContent = `${t(mode.labelKey, {}, locale)} `;

    const value = document.createElement('strong');
    value.textContent = formatNumber(modeTotals[mode.key] ?? 0, locale);

    item.append(name, value);
    list.append(item);
  }

  return list;
}

function aboutSubheading(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'about-subheading';
  h.textContent = text;
  return h;
}

function aboutParagraph(parts: Array<string | Node>): HTMLParagraphElement {
  const p = document.createElement('p');
  for (const part of parts) {
    p.append(typeof part === 'string' ? document.createTextNode(part) : part);
  }
  return p;
}

function aboutLink(label: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  return a;
}

function aboutExternalLink(label: string, href: string): HTMLAnchorElement {
  const a = aboutLink(label, href);
  a.target = '_blank';
  a.rel = 'noreferrer noopener';
  return a;
}

function buildSource(locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-section source-section';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('source.heading', {}, locale);

  const intro = document.createElement('p');
  intro.textContent = t('source.intro', {}, locale);

  const source = sourceBlock(t('source.projectSource', {}, locale), [
    linkLine(t('source.githubRepository', {}, locale), GITHUB_URL),
    textLine(t('source.licenseAgpl', {}, locale)),
    textLine(t('source.noWarranty', {}, locale)),
  ]);

  const thirdParty = sourceBlock(t('source.thirdParty', {}, locale), [
    textLine(t('source.chessground', {}, locale)),
    textLine(t('source.chessops', {}, locale)),
    textLine(t('source.stockfish', {}, locale)),
  ]);

  const identity = sourceBlock(t('source.projectIdentity', {}, locale), [
    textLine(t('source.identityAssets', {}, locale)),
    textLine(t('source.identityForksName', {}, locale)),
    textLine(t('source.identityForksBrand', {}, locale)),
  ]);

  section.append(heading, intro, source, thirdParty, identity);
  return section;
}

function buildFaq(locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-section faq-section';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('faq.heading', {}, locale);

  const q1 = aboutSubheading(t('faq.darkChessQuestion', {}, locale));
  const a1 = aboutParagraph([
    t('faq.darkChessPrefix', {}, locale),
    aboutLink(t('faq.rulesReference', {}, locale), '/rules'),
    t('faq.darkChessSuffix', {}, locale),
  ]);

  const qAccount = aboutSubheading(t('faq.accountQuestion', {}, locale));
  const aAccount = aboutParagraph([t('faq.accountAnswer', {}, locale)]);

  const q2 = aboutSubheading(t('faq.contactQuestion', {}, locale));
  const a2 = aboutParagraph([
    t('faq.contactPrefix', {}, locale),
    aboutExternalLink('GitHub', GITHUB_URL),
    t('faq.contactMiddle', {}, locale),
    aboutLink(t('faq.contactLink', {}, locale), '/contact'),
    t('faq.contactSuffix', {}, locale),
  ]);

  const q3 = aboutSubheading(t('faq.cheatingQuestion', {}, locale));
  const a3 = aboutParagraph([
    t('faq.cheatingPrefix', {}, locale),
    aboutExternalLink(t('faq.openSource', {}, locale), GITHUB_URL),
    t('faq.cheatingSuffix', {}, locale),
  ]);

  const q4 = aboutSubheading(t('faq.enginesQuestion', {}, locale));
  const a4 = aboutParagraph([t('faq.enginesAnswer', {}, locale)]);

  const qWatch = aboutSubheading(t('faq.liveWatchQuestion', {}, locale));
  const aWatch = aboutParagraph([t('faq.liveWatchAnswer', {}, locale)]);

  const q5 = aboutSubheading(t('faq.ratedQuestion', {}, locale));
  const a5 = aboutParagraph([t('faq.ratedAnswer', {}, locale)]);

  const qLibrary = aboutSubheading(t('faq.libraryQuestion', {}, locale));
  const aLibrary = aboutParagraph([t('faq.libraryAnswer', {}, locale)]);
  const aLibraryExplorer = aboutParagraph([t('faq.libraryExplorer', {}, locale)]);

  section.append(
    heading,
    q1,
    a1,
    qAccount,
    aAccount,
    q2,
    a2,
    q3,
    a3,
    q4,
    a4,
    qWatch,
    aWatch,
    q5,
    a5,
    qLibrary,
    aLibrary,
    aLibraryExplorer,
  );
  return section;
}

function buildTerms(locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-section terms-section';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('terms.heading', {}, locale);

  const intro = aboutParagraph([t('terms.intro', {}, locale)]);

  const h1 = aboutSubheading(t('terms.offeredHeading', {}, locale));
  const p1 = aboutParagraph([t('terms.offeredBody', {}, locale)]);

  const h2 = aboutSubheading(t('terms.anonymousHeading', {}, locale));
  const p2 = aboutParagraph([t('terms.anonymousBody', {}, locale)]);

  const h3 = aboutSubheading(t('terms.acceptableHeading', {}, locale));
  const p3 = aboutParagraph([t('terms.acceptableBody', {}, locale)]);

  const hr1 = aboutSubheading(t('terms.ratedAccountHeading', {}, locale));
  const pr1 = aboutParagraph([t('terms.ratedAccountBody', {}, locale)]);

  const hr2 = aboutSubheading(t('terms.ratingsHeading', {}, locale));
  const pr2 = aboutParagraph([t('terms.ratingsBody', {}, locale)]);

  const hr3 = aboutSubheading(t('terms.fairPlayHeading', {}, locale));
  const pr3 = aboutParagraph([t('terms.fairPlayBody', {}, locale)]);

  const hr4 = aboutSubheading(t('terms.integrityHeading', {}, locale));
  const pr4 = aboutParagraph([
    t('terms.integrityPrefix', {}, locale),
    aboutLink(t('terms.privacyLink', {}, locale), '/privacy'),
    t('terms.integritySuffix', {}, locale),
  ]);

  const h4 = aboutSubheading(t('terms.finishedGamesHeading', {}, locale));
  const p4 = aboutParagraph([
    t('terms.finishedGamesPrefix', {}, locale),
    aboutExternalLink(
      t('terms.ccByLink', {}, locale),
      'https://creativecommons.org/licenses/by/4.0/',
    ),
    t('terms.finishedGamesMiddle', {}, locale),
    aboutLink(t('terms.contactLink', {}, locale), '/contact'),
    t('terms.finishedGamesSuffix', {}, locale),
  ]);

  const hp1 = aboutSubheading(t('terms.patronHeading', {}, locale));
  const pp1 = aboutParagraph([
    t('terms.patronPrefix', {}, locale),
    aboutLink(t('terms.patronLink', {}, locale), '/patron'),
    t('terms.patronSuffix', {}, locale),
  ]);

  const hp2 = aboutSubheading(t('terms.refundHeading', {}, locale));
  const pp2 = aboutParagraph([
    t('terms.refundPrefix', {}, locale),
    aboutLink(t('terms.contactLink', {}, locale), '/contact'),
    t('terms.refundSuffix', {}, locale),
  ]);

  const h5 = aboutSubheading(t('terms.openSourceHeading', {}, locale));
  const p5 = aboutParagraph([
    t('terms.openSourcePrefix', {}, locale),
    aboutLink(t('terms.sourceLink', {}, locale), '/source'),
    t('terms.openSourceSuffix', {}, locale),
  ]);

  section.append(
    heading,
    intro,
    h1,
    p1,
    h2,
    p2,
    h3,
    p3,
    hr1,
    pr1,
    hr2,
    pr2,
    hr3,
    pr3,
    hr4,
    pr4,
    h4,
    p4,
    hp1,
    pp1,
    hp2,
    pp2,
    h5,
    p5,
  );
  return section;
}

function buildPrivacy(locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-section terms-section';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('privacy.heading', {}, locale);

  const intro = aboutParagraph([t('privacy.intro', {}, locale)]);

  const h1 = aboutSubheading(t('privacy.collectHeading', {}, locale));
  const p1 = aboutParagraph([t('privacy.collectBody', {}, locale)]);

  const h2 = aboutSubheading(t('privacy.noDoHeading', {}, locale));
  const p2 = aboutParagraph([t('privacy.noDoBody', {}, locale)]);

  const h3 = aboutSubheading(t('privacy.publicGamesHeading', {}, locale));
  const p3 = aboutParagraph([
    t('privacy.publicGamesPrefix', {}, locale),
    aboutExternalLink(
      t('privacy.ccByLink', {}, locale),
      'https://creativecommons.org/licenses/by/4.0/',
    ),
    t('privacy.publicGamesSuffix', {}, locale),
  ]);

  const h4 = aboutSubheading(t('privacy.promisesHeading', {}, locale));
  const p4 = aboutParagraph([t('privacy.promisesBody', {}, locale)]);

  section.append(heading, intro, h1, p1, h2, p2, h3, p3, h4, p4);
  return section;
}

function sourceBlock(titleText: string, lines: HTMLElement[]): HTMLElement {
  const block = document.createElement('section');
  block.className = 'source-block';
  const title = document.createElement('h2');
  title.textContent = titleText;
  const list = document.createElement('ul');
  for (const line of lines) {
    const item = document.createElement('li');
    item.append(line);
    list.append(item);
  }
  block.append(title, list);
  return block;
}

function textLine(value: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
}

function linkLine(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.textContent = label;
  return link;
}

function buildNotFound(locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-section not-found-section';

  const code = document.createElement('div');
  code.className = 'not-found-code';
  code.setAttribute('aria-hidden', 'true');
  code.textContent = '404';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading not-found-heading';
  heading.textContent = t('notFound.heading', {}, locale);

  const lede = document.createElement('p');
  lede.className = 'not-found-lede';
  lede.textContent = t('notFound.lede', {}, locale);

  const home = aboutLink(t('notFound.homeCta', {}, locale), '/');
  home.className = 'not-found-cta';

  const quick = document.createElement('nav');
  quick.className = 'not-found-links';
  quick.setAttribute('aria-label', t('notFound.quickLinks', {}, locale));
  for (const [labelKey, href] of [
    ['nav.play', '/play'],
    ['nav.rules', '/rules'],
    ['nav.watch', '/watch'],
    ['nav.puzzles', '/puzzles'],
  ] as const) {
    quick.append(aboutLink(t(labelKey, {}, locale), href));
  }

  const contact = document.createElement('p');
  contact.className = 'not-found-contact';
  contact.append(
    document.createTextNode(t('notFound.stillLost', {}, locale)),
    aboutLink(t('notFound.contact', {}, locale), '/contact'),
    document.createTextNode(t('notFound.suffix', {}, locale)),
  );

  section.append(code, heading, lede, home, quick, contact);
  return section;
}
