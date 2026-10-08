// Static content pages — about / source / faq / terms / not-found / articles / rules.

import './pages-static.css';

import { loadCachedCurrentUser, readCachedUser } from './account-nav.js';
import { buildContact } from './contact.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
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

/* /blog, /zh-hans/blog and /zh-hant/blog, baked at build time. The index is
 * authored data with no live or per-account content, so the prerendered DOM is
 * exactly the page a reader gets. The "By Mistboard" view only: the (currently
 * empty) community view stays on the client-rendered shell. The two Chinese
 * indexes served a 4.7KB shell with no canonical or hreflang until 2026-10-02
 * while sitting in the sitemap. */
export async function renderArticlesIndexShellForPrerender(
  lang?: import('./article-i18n.js').ArticleLang | null,
): Promise<string> {
  const { buildArticlesIndex } = await import('./articles.js');
  const locale: Locale = lang ?? 'en';
  return `${buildNav(locale).outerHTML}${buildArticlesIndex(lang ?? undefined, 'mistboard').outerHTML}`;
}

// Meta and head links for each baked index (blog, rules). The three indexes of
// a section are one page in three languages, so every one names the same
// alternate set (hreflang is a property of the group, not the page) and a
// self-referencing canonical. Title and description match ARTICLES_INDEX_META
// and RULES_INDEX_META in apps/server/src/server-static-pages.ts, which cover
// the shell fallback.
type IndexPrerenderMeta = Record<Locale, { title: string; description: string }>;

const INDEX_PATH_PREFIX: Record<Locale, string> = {
  en: '',
  'zh-Hans': '/zh-hans',
  'zh-Hant': '/zh-hant',
};

const ARTICLES_INDEX_PRERENDER_META: IndexPrerenderMeta = {
  en: {
    title: 'Articles | Mistboard',
    description: 'Long-form writing on original strategy games, rules, and engine research.',
  },
  'zh-Hans': {
    title: '文章 | Mistboard',
    description: '原创策略游戏的文章、规则说明与引擎工作。',
  },
  'zh-Hant': {
    title: '文章 | Mistboard',
    description: '原創策略遊戲的文章、規則說明與引擎工作。',
  },
};

const RULES_INDEX_PRERENDER_META: IndexPrerenderMeta = {
  en: {
    title: 'Rules | Mistboard',
    description: 'Reference rules for Mistboard games, classic bases, and Fog of War variants.',
  },
  'zh-Hans': {
    title: '规则 | Mistboard',
    description: 'Mistboard 游戏、经典基础规则与战争迷雾变体的规则参考。',
  },
  'zh-Hant': {
    title: '規則 | Mistboard',
    description: 'Mistboard 遊戲、經典基礎規則與戰爭迷霧變體的規則參考。',
  },
};

type IndexPrerenderHead = {
  title: string;
  description: string;
  url: string;
  htmlLang: Locale;
  headLinks: string;
};

function indexPrerenderHead(
  host: string,
  section: 'blog' | 'rules',
  table: IndexPrerenderMeta,
  lang?: import('./article-i18n.js').ArticleLang | null,
): IndexPrerenderHead {
  const locale: Locale = lang ?? 'en';
  const meta = table[locale];
  const urlFor = (l: Locale) => `${host}${INDEX_PATH_PREFIX[l]}/${section}`;
  const url = urlFor(locale);
  const alternates = (['en', 'zh-Hans', 'zh-Hant'] as const)
    .map((l) => `<link rel="alternate" hreflang="${l}" href="${urlFor(l)}" />`)
    .join('');
  return {
    title: meta.title,
    description: meta.description,
    url,
    htmlLang: locale,
    headLinks: `<link rel="canonical" href="${url}" />${alternates}<link rel="alternate" hreflang="x-default" href="${urlFor('en')}" />`,
  };
}

export function articlesIndexPrerenderHead(
  host: string,
  lang?: import('./article-i18n.js').ArticleLang | null,
): IndexPrerenderHead {
  return indexPrerenderHead(host, 'blog', ARTICLES_INDEX_PRERENDER_META, lang);
}

export function rulesIndexPrerenderHead(
  host: string,
  lang?: import('./article-i18n.js').ArticleLang | null,
): IndexPrerenderHead {
  return indexPrerenderHead(host, 'rules', RULES_INDEX_PRERENDER_META, lang);
}

/* /rules, /zh-hans/rules and /zh-hant/rules, baked at build time: the same DOM
 * mountRulesIndex builds, minus the thumbnail hydration it runs after mount.
 * All three served a 4.9KB client shell with no canonical, hreflang or text
 * until 2026-10-02 while sitting in the sitemap. */
export async function renderRulesIndexShellForPrerender(
  lang?: import('./article-i18n.js').ArticleLang | null,
): Promise<string> {
  const { buildRulesIndex } = await import('./articles.js');
  const locale: Locale = lang ?? 'en';
  return `${buildNav(locale).outerHTML}${buildRulesIndex(lang ?? undefined).outerHTML}`;
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
  // Load everything before clearing the root: a failed import then leaves the
  // prerendered article on screen instead of an empty page.
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
  root.replaceChildren();
  root.classList.add('landing-page', 'articles-route');
  const base = findArticle(slug);
  // Show the family's board/piece pickers while the article is open so the
  // diagrams react to the right controls (each family only when its flag is on).
  const family = base?.boardFamily;
  setBoardFamily(family === 'xiangqi' && xiangqiAppearanceEnabled() ? 'xiangqi' : 'chess');
  const article = base && lang ? translateArticle(base, lang) : base;
  // seoTitle, as the prerender uses: the display title here would replace the
  // search title Google indexes the moment the client mounts.
  if (article) document.title = `${article.seoTitle ?? article.title} · Mistboard`;
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
    // Its authors asked for a credit with a link (lxsgx23/AB-JChess#1).
    linkLine(t('source.abJchess', {}, locale), 'https://github.com/lxsgx23/AB-JChess'),
    // The top jungle bot (#434): engine, the engine it is built on, and the net's
    // source, each linked; hzyhhzy agreed to it running here credited (hzyhhzy/KataGomo#12).
    linkLine(
      t('source.katagomo', {}, locale),
      'https://github.com/hzyhhzy/KataGomo/tree/AnimalChess2025',
    ),
    linkLine(t('source.katago', {}, locale), 'https://github.com/lightvector/KataGo'),
    linkLine(t('source.dandelion', {}, locale), 'https://github.com/lxsgx23/Dandelion-Chess'),
    // The tablebase in the explorer pane and practice grading read chessdb.cn
    // (through our server); credited with a link like the engines.
    linkLine(t('source.chessdb', {}, locale), 'https://www.chessdb.cn/'),
    // Pikafish runs the top xiangqi bot and all xiangqi analysis; credited with
    // its home page and the NNUE weights license (no commercial use without
    // permission), in the reader's language where pikafish.com has one.
    pikafishCreditLine(locale),
    // The five third-party xiangqi piece sets (2026-10-08); sources and licences
    // sit beside the files in public/piece-sets/xiangqi/<id>/README.md. Wood is
    // CC BY 4.0, so its credit names the author and links the licence.
    linkLine(t('source.pieceSetLacquer', {}, locale), PIECE_SET_SOURCE_URLS.lacquer),
    woodPieceSetCreditLine(locale),
    linkLine(t('source.pieceSetBook', {}, locale), PIECE_SET_SOURCE_URLS.book),
    linkLine(t('source.pieceSetBrush', {}, locale), PIECE_SET_SOURCE_URLS.brush),
    linkLine(t('source.pieceSetClerical', {}, locale), PIECE_SET_SOURCE_URLS.clerical),
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

  // Playing online first: what a searcher for 象棋在线 / "xiangqi online" asks
  // before a first game. These sat on the homepage for a day (2026-09-25) and
  // moved here: the homepage stays the product, this page answers questions.
  const playQuestions = [
    ['faq.playWebQuestion', 'faq.playWebAnswer'],
    ['faq.playComputerQuestion', 'faq.playComputerAnswer'],
    ['faq.playFriendQuestion', 'faq.playFriendAnswer'],
    ['faq.playOtherQuestion', 'faq.playOtherAnswer'],
    ['faq.playReviewQuestion', 'faq.playReviewAnswer'],
  ] as const;
  const playBlock: HTMLElement[] = [];
  for (const [questionKey, answerKey] of playQuestions) {
    playBlock.push(aboutSubheading(t(questionKey, {}, locale)));
    const answer: Array<string | Node> = [t(answerKey, {}, locale)];
    if (answerKey === 'faq.playComputerAnswer') {
      answer.push(
        ' ',
        aboutLink(t('faq.playBotsLink', {}, locale), localizedHref('/bots', locale)),
      );
    }
    playBlock.push(aboutParagraph(answer));
  }

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
    ...playBlock,
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
    aboutLink(t('privacy.downloadsLink', {}, locale), '/data'),
    t('privacy.publicGamesMiddle', {}, locale),
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

export const PIKAFISH_REPO_URL = 'https://github.com/official-pikafish/Pikafish';
export const PIKAFISH_SITE_URL = 'https://pikafish.com/';
const PIKAFISH_WEIGHTS_LICENSE_URLS: Record<Locale, string> = {
  en: 'https://www.pikafish.com/en/list.html',
  'zh-Hans': 'https://www.pikafish.com/list.html',
  'zh-Hant': 'https://www.pikafish.com/zh-hant/list.html',
};

export function pikafishWeightsLicenseUrl(locale: Locale): string {
  return PIKAFISH_WEIGHTS_LICENSE_URLS[locale];
}

function pikafishCreditLine(locale: Locale): HTMLSpanElement {
  const line = document.createElement('span');
  line.className = 'source-credit-pikafish';
  line.append(
    linkLine(t('source.pikafish', {}, locale), PIKAFISH_REPO_URL),
    ' ',
    linkLine(t('source.pikafishSite', {}, locale), PIKAFISH_SITE_URL),
    ' · ',
    linkLine(t('source.pikafishWeightsLicense', {}, locale), pikafishWeightsLicenseUrl(locale)),
  );
  return line;
}

const PYCHESS_XIANGQI_PIECES_URL =
  'https://github.com/gbtami/pychess-variants/tree/master/static/images/pieces/xiangqi';

export const PIECE_SET_SOURCE_URLS = {
  lacquer: `${PYCHESS_XIANGQI_PIECES_URL}/playok`,
  wood: 'https://github.com/Kadagaden/chess-pieces/tree/master/xiangqi_gmchess_style_wood',
  book: 'https://www.babelstone.co.uk/Fonts/Xiangqi.html',
  brush: `${PYCHESS_XIANGQI_PIECES_URL}/hnzw`,
  clerical: `${PYCHESS_XIANGQI_PIECES_URL}/lishuw`,
} as const;

const CC_BY_4_URL = 'https://creativecommons.org/licenses/by/4.0/';

function woodPieceSetCreditLine(locale: Locale): HTMLSpanElement {
  const line = document.createElement('span');
  line.className = 'source-credit-wood';
  line.append(
    linkLine(t('source.pieceSetWood', {}, locale), PIECE_SET_SOURCE_URLS.wood),
    ' · ',
    linkLine(t('source.pieceSetWoodLicense', {}, locale), CC_BY_4_URL),
  );
  return line;
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
