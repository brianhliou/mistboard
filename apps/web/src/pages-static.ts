// Static content pages — about / source / faq / terms / not-found / articles / rules.

import './pages-static.css';

import { loadCachedCurrentUser, readCachedUser } from './account-nav.js';
import { track } from './analytics.js';
import { buildContact } from './contact.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildNav, GITHUB_URL } from './site-shell.js';
import { buildStaticPageLayout } from './static-page-shell.js';
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
  const { buildNewsPage, newsArchiveHrefForHash, newsMonthExists, newsMonthFromPath } =
    await import('./news-page.js');
  let monthId = newsMonthFromPath(globalThis.location?.pathname ?? '');
  const hash = decodeURIComponent(globalThis.location?.hash ?? '').replace(/^#/, '');
  // A /feed#<entry> link from before the entry moved to its month's page.
  const archiveHref = !monthId && hash ? newsArchiveHrefForHash(hash) : null;
  if (archiveHref) {
    globalThis.location.replace(archiveHref);
    return;
  }
  // An unknown month renders /feed, so the address says so too.
  if (monthId && !newsMonthExists(monthId)) {
    globalThis.history.replaceState(null, '', '/feed');
    monthId = null;
  }
  root.append(
    buildNav(locale),
    buildStaticPageLayout('news', buildNewsPage(locale, monthId), locale),
  );
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
  const { articleTopicFromSearch, buildArticlesIndex, mountArticleThumbnails } = await import(
    './articles.js'
  );
  // ?topic= narrows the list here, on the client: the prerendered /blog is the
  // whole list whatever the query, and its canonical stays /blog.
  const topic = articleTopicFromSearch(window.location.search);
  const index = buildArticlesIndex(lang ?? undefined, view, topic);
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
    title: 'Xiangqi and Variant Articles | Mistboard',
    description:
      'Long-form articles on xiangqi (Chinese chess) and its variants: rules explained, champions and players, engine research, puzzles, and how Mistboard is built.',
  },
  'zh-Hans': {
    title: '象棋与变体文章 | Mistboard',
    description:
      '关于象棋（中国象棋）及其变体的长文：规则详解、历届冠军与棋手、引擎研究、残局题目，以及 Mistboard 是怎样做出来的。',
  },
  'zh-Hant': {
    title: '象棋與變體文章 | Mistboard',
    description:
      '關於象棋（中國象棋）及其變體的長文：規則詳解、歷屆冠軍與棋手、引擎研究、殘局題目，以及 Mistboard 是怎樣做出來的。',
  },
};

const RULES_INDEX_PRERENDER_META: IndexPrerenderMeta = {
  en: {
    title: 'Xiangqi and Variant Rules | Mistboard',
    description:
      'Full rules for every game on Mistboard: xiangqi (Chinese chess), jieqi, banqi, Jungle and chess, plus Fog of War, Duck Xiangqi and other xiangqi variants.',
  },
  'zh-Hans': {
    title: '象棋与变体规则 | Mistboard',
    description:
      'Mistboard 上每一种棋的完整规则：象棋（中国象棋）、揭棋、暗棋、斗兽棋和国际象棋，以及迷雾、鸭子等各种象棋变体。',
  },
  'zh-Hant': {
    title: '象棋與變體規則 | Mistboard',
    description:
      'Mistboard 上每一種棋的完整規則：象棋（中國象棋）、揭棋、暗棋、鬥獸棋和國際象棋，以及迷霧、鴨子等各種象棋變體。',
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

/* /blog/<slug>, /rules/<slug> and their zh copies, baked at build time into a
 * root carrying ARTICLE_ROUTE_CLASS: the same frame mountArticle builds, nav
 * first. Until #557 the bake was the bare <main> in a classless root, so the
 * client mount put the nav above it and restyled the root, and the whole page
 * jumped (rules p75 layout shift 0.40, blog 0.26). */
export const ARTICLE_ROUTE_CLASS = 'landing-page articles-route';

export async function renderArticlePageShellForPrerender(
  slug: string,
  lang?: import('./article-i18n.js').ArticleLang | null,
): Promise<string> {
  const { buildArticlePage } = await import('./articles.js');
  const locale: Locale = lang ?? 'en';
  return `${buildNav(locale).outerHTML}${buildArticlePage(slug, lang ?? undefined).outerHTML}`;
}

type ArticleLangOrNull = import('./article-i18n.js').ArticleLang | null;

type ArticleModules = {
  articles: typeof import('./articles.js');
  findArticle: typeof import('./articles-data.js').findArticle;
  translateArticle: typeof import('./article-i18n.js').translateArticle;
  theme: typeof import('./theme.js');
};

// The article on screen, kept so a rules-rail click can swap its content in
// place. `teardown` releases what the content (not the rail) mounted.
let mountedArticle: {
  root: HTMLElement;
  slug: string;
  modules: ArticleModules;
  teardown: () => void;
} | null = null;

export async function mountArticle(
  root: HTMLElement,
  slug: string,
  lang?: ArticleLangOrNull,
): Promise<void> {
  // Load everything before clearing the root: a failed import then leaves the
  // prerendered article on screen instead of an empty page.
  const modules: ArticleModules = {
    articles: await import('./articles.js'),
    findArticle: (await import('./articles-data.js')).findArticle,
    translateArticle: (await import('./article-i18n.js')).translateArticle,
    theme: await import('./theme.js'),
  };
  mountedArticle?.teardown();
  root.replaceChildren();
  root.classList.add(...ARTICLE_ROUTE_CLASS.split(' '));
  applyArticleChrome(modules, slug, lang);
  const articlePage = modules.articles.buildArticlePage(slug, lang ?? undefined);
  root.append(buildNav(), articlePage);
  // Delegated from the page, so it covers content swapped in later.
  modules.articles.mountArticleLightbox(articlePage);
  const rail = articlePage.querySelector<HTMLElement>(':scope > .article-variant-sidebar');
  // The variant rail carries board-kind thumbnails that mount like index cards.
  // It outlives a rail swap, so they mount once, outside the content teardown.
  if (rail) modules.articles.mountArticleThumbnails(rail);
  mountedArticle = {
    root,
    slug,
    modules,
    teardown: mountArticleContent(modules, articlePage),
  };
  if (rail) installRulesRailNavigation();
  // The client builds the page after the load event, when the browser has
  // already given up looking for the #fragment, so the mount scrolls to it.
  scrollToLocationHash();
}

/** Scrolls the element the address's #fragment names into view; false when
 *  there is no fragment or nothing on the page carries that id. */
export function scrollToLocationHash(): boolean {
  const raw = window.location.hash.slice(1);
  if (!raw) return false;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // A malformed escape: look the id up as written.
  }
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView();
  return true;
}

function applyArticleChrome(modules: ArticleModules, slug: string, lang?: ArticleLangOrNull): void {
  const base = modules.findArticle(slug);
  // Show the family's board/piece pickers while the article is open so the
  // diagrams react to the right controls (each family only when its flag is on).
  const family = base?.boardFamily;
  modules.theme.setBoardFamily(
    family === 'xiangqi' && modules.theme.xiangqiAppearanceEnabled() ? 'xiangqi' : 'chess',
  );
  const article = base && lang ? modules.translateArticle(base, lang) : base;
  // seoTitle, as the prerender uses: the display title here would replace the
  // search title Google indexes the moment the client mounts.
  if (article) document.title = `${article.seoTitle ?? article.title} | Mistboard`;
}

/** Mounts the widgets, TOC tracking and thumbnails of everything in the page
 *  except the variant rail; returns their teardown. */
function mountArticleContent(modules: ArticleModules, page: HTMLElement): () => void {
  const content = [...page.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && !el.classList.contains('article-variant-sidebar'),
  );
  const controllers = content.flatMap((el) => [
    ...modules.articles.mountPendingWidgets(el),
    ...modules.articles.mountArticleThumbnails(el),
  ]);
  const stopEnhancements = modules.articles.mountArticleEnhancements(page);
  return () => {
    stopEnhancements();
    for (const controller of controllers) controller.destroy();
  };
}

// --- in-place rules navigation ----------------------------------------------
// A rules page was a full document load per rail click: the prerendered HTML
// painted, then the client rebuilt the whole page, and the rail jumped back to
// its top. Rail clicks between rules pages of one locale now swap the centre
// and TOC columns in place, so the rail (its scroll and its thumbnails) stays.
// Anything else (a modified click, a cross-locale link, a page with no rail)
// keeps the browser's own navigation.

const RULES_ARTICLE_PATH = /^(\/zh-han[st])?\/rules\/([^/]+)$/;

/** The rules article a path names, with its locale prefix; null for any other
 *  path. Mirrors main.ts's articleSlugFromPath/articleLangFromPath for rules. */
export function rulesArticleRoute(
  pathname: string,
): { prefix: string; slug: string; lang: ArticleLangOrNull } | null {
  const match = pathname.match(RULES_ARTICLE_PATH);
  if (!match) return null;
  const prefix = match[1] ?? '';
  const lang = prefix === '/zh-hans' ? 'zh-Hans' : prefix === '/zh-hant' ? 'zh-Hant' : null;
  return { prefix, slug: decodeURIComponent(match[2]!), lang };
}

let rulesNavInstalled = false;
let rulesNavPushed = false;

function installRulesRailNavigation(): void {
  if (rulesNavInstalled) return;
  rulesNavInstalled = true;
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a.article-variant-link[href]');
    if (!(link instanceof HTMLAnchorElement) || !link.closest('.article-variant-sidebar')) return;
    if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const target = rulesArticleRoute(url.pathname);
    const here = rulesArticleRoute(window.location.pathname);
    if (!target || !here || target.prefix !== here.prefix) return;
    event.preventDefault();
    if (target.slug === here.slug) {
      window.scrollTo(0, 0);
      return;
    }
    if (!swapRulesArticle(target.slug, target.lang)) {
      window.location.assign(url.href);
      return;
    }
    window.history.pushState({ rulesArticle: true }, '', `${url.pathname}${url.search}${url.hash}`);
    rulesNavPushed = true;
    window.scrollTo(0, 0);
    afterRulesSwap();
  });
  window.addEventListener('popstate', () => {
    const here = rulesArticleRoute(window.location.pathname);
    // A hash step within the page on screen: the browser scrolls it.
    if (here && here.slug === mountedArticle?.slug) return;
    if (here && swapRulesArticle(here.slug, here.lang)) {
      afterRulesSwap();
    } else if (rulesNavPushed) {
      window.location.reload();
    }
  });
}

/** Replaces the mounted rules page's content columns with `slug`'s, keeping the
 *  rail element. False when there is no rail to keep or the target has none
 *  (not found, not a rules page): the caller then loads the page instead. */
export function swapRulesArticle(slug: string, lang?: ArticleLangOrNull): boolean {
  const current = mountedArticle;
  if (!current) return false;
  const main = current.root.querySelector<HTMLElement>(':scope > main.article-page');
  const rail = main?.querySelector<HTMLElement>(':scope > .article-variant-sidebar');
  if (!main || !rail) return false;
  const { modules } = current;
  const next = modules.articles.buildArticlePage(slug, lang ?? undefined);
  const nextRail = next.querySelector(':scope > .article-variant-sidebar');
  if (!nextRail) return false;
  nextRail.remove();

  current.teardown();
  applyArticleChrome(modules, slug, lang);
  main.className = next.className;
  for (const key of Object.keys(main.dataset)) delete main.dataset[key];
  Object.assign(main.dataset, next.dataset);
  main.replaceChildren(rail, ...next.children);
  for (const link of rail.querySelectorAll<HTMLAnchorElement>('a.article-variant-link')) {
    const active =
      rulesArticleRoute(new URL(link.href, window.location.href).pathname)?.slug === slug;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  current.slug = slug;
  current.teardown = mountArticleContent(modules, main);
  return true;
}

function afterRulesSwap(): void {
  const path = window.location.pathname;
  // A page load counts one pageview (main.ts); a swap is a page too.
  track('$pageview', { path });
  scrollToLocationHash();
  void syncHeadFromPrerender(path);
}

// Canonical, hreflang, description, Open Graph and structured data are baked
// per page by the prerender and nowhere else, so the swap copies them from the
// target's own baked HTML rather than re-deriving them. A response with no
// canonical (the dev server's client shell) is not a baked page and is skipped,
// as is one that lands after the reader has moved on.
const SYNCED_HEAD_SELECTOR = [
  'meta[name="description"]',
  'meta[property^="og:"]',
  'meta[name^="twitter:"]',
  'link[rel="canonical"]',
  'link[rel="alternate"][hreflang]',
  'script[type="application/ld+json"]',
].join(', ');

export async function syncHeadFromPrerender(path: string): Promise<void> {
  try {
    const response = await fetch(path, { headers: { accept: 'text/html' } });
    if (!response.ok) return;
    const baked = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (window.location.pathname !== path) return;
    if (!baked.head.querySelector('link[rel="canonical"]')) return;
    for (const el of document.head.querySelectorAll(SYNCED_HEAD_SELECTOR)) el.remove();
    for (const el of baked.head.querySelectorAll(SYNCED_HEAD_SELECTOR)) {
      document.head.append(document.importNode(el, true));
    }
  } catch {
    // The swap already showed the page; stale meta is all a failure costs.
  }
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
  engineP.append(
    ' ',
    aboutLink(t('champions.heading', {}, locale), localizedHref('/champions', locale)),
  );

  const communityHeading = aboutSubheading(t('about.communityHeading', {}, locale));
  const communityP = aboutParagraph([t('about.communityBody', {}, locale)]);
  communityP.append(
    ' ',
    aboutLink(t('creators.heading', {}, locale), localizedHref('/creators', locale)),
  );

  const oss1Heading = aboutSubheading(t('about.openSourceHeading', {}, locale));
  const oss1P = aboutParagraph([
    t('about.openSourcePrefix', {}, locale),
    aboutExternalLink('GitHub', GITHUB_URL),
    t('about.openSourceMiddle', {}, locale),
    aboutLink(t('footer.source', {}, locale), '/source'),
    t('about.openSourceSuffix', {}, locale),
  ]);

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
    communityHeading,
    communityP,
    oss1Heading,
    oss1P,
  );
  return section;
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
    // The xiangqi ladder below Pikafish and the Duck Xiangqi bot run upstream
    // Fairy-Stockfish builds (fairy-stockfish-*.ref); uncredited until 2026-10-17.
    linkLine(
      t('source.fairyStockfish', {}, locale),
      'https://github.com/fairy-stockfish/Fairy-Stockfish',
    ),
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
    // Our patched jieqi_old branch (pikafish-jieqi.ref); GPL, so the link is the
    // fork that carries our patches.
    linkLine(
      t('source.pikafishJieqi', {}, locale),
      'https://github.com/brianhliou/pikafish-jieqi-wasm/tree/jieqi_old-mistboard',
    ),
    // The five third-party xiangqi piece sets (2026-10-08); sources and licences
    // sit beside the files in public/piece-sets/xiangqi/<id>/README.md. Wood is
    // CC BY 4.0, so its credit names the author and links the licence.
    linkLine(t('source.pieceSetLacquer', {}, locale), PIECE_SET_SOURCE_URLS.lacquer),
    woodPieceSetCreditLine(locale),
    linkLine(t('source.pieceSetBook', {}, locale), PIECE_SET_SOURCE_URLS.book),
    linkLine(t('source.pieceSetBrush', {}, locale), PIECE_SET_SOURCE_URLS.brush),
    linkLine(t('source.pieceSetClerical', {}, locale), PIECE_SET_SOURCE_URLS.clerical),
    // Chess pieces, sounds and fonts were credited only in public/*/CREDITS.md,
    // which nothing links to (2026-10-17).
    linkLine(
      t('source.chessPieceSets', {}, locale),
      'https://github.com/lichess-org/lila/tree/master/public/piece',
    ),
    linkLine(t('source.sounds', {}, locale), 'https://github.com/lichess-org/lila'),
    textLine(t('source.fonts', {}, locale)),
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
