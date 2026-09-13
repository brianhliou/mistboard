// Build-time pre-render for published articles.
//
// Runs AFTER `vite build`, against the hashed `dist/index.html` shell. For each
// published article it renders the real client renderer (buildArticlePage) under
// happy-dom, bakes the resulting <main> into #app, injects per-route meta from
// articles-data (single source of truth), and writes dist/blog/<slug>.html.
//
// The server serves these files for /blog/<slug>; the client SPA still boots
// and replaceChildren()s #app on takeover, mounting the deferred board widgets.
// So crawlers/LLMs and first paint get real prose; humans get the full app.
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
// Mirrors ARTICLE_OG_IMAGE_VERSION in apps/server/src/og-image.ts (the server
// cannot be imported from the web build). Scrapers hold a card under its URL
// with a year-long immutable max-age, so the LOOK of the card can only change
// behind a new ?v=; og-image.test.ts pins the two numbers to each other.
const ARTICLE_OG_IMAGE_VERSION = 2;

const host = process.env.MISTBOARD_HOST ?? 'https://mistboard.com';

// --- happy-dom globals (Node 26: some globals are read-only getters) ---------
const win = new Window({ url: host });
const define = (key, value) => {
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    /* read-only getter we can't override; leave Node's own */
  }
};
define('window', win);
define('document', win.document);
define('navigator', win.navigator);
for (const key of [
  'HTMLElement',
  'HTMLHeadingElement',
  'HTMLParagraphElement',
  'HTMLAnchorElement',
  'HTMLLIElement',
  'HTMLUListElement',
  'Element',
  'Node',
  'SVGElement',
  'SVGSVGElement',
  'SVGGElement',
  'SVGPathElement',
  'SVGRectElement',
  'SVGCircleElement',
  'SVGTextElement',
  'SVGUseElement',
  'SVGLineElement',
  'SVGImageElement',
  'CustomEvent',
  'Event',
  'DOMParser',
  'customElements',
  'IntersectionObserver',
  'MutationObserver',
  'ResizeObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  if (win[key] !== undefined && globalThis[key] === undefined) define(key, win[key]);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Mirror of the server's injectPageMeta so pre-rendered pages carry the same
// share-card surface. Source of truth is the article record, not a duplicated map.
function injectPageMeta(html, meta) {
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${escapeHtml(meta.description)}$2`,
    )
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${escapeHtml(meta.title)}$2`)
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
      `$1${escapeHtml(meta.description)}$2`,
    )
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/, `$1${escapeHtml(meta.url)}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, `$1${escapeHtml(meta.title)}$2`)
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
      `$1${escapeHtml(meta.description)}$2`,
    );
  if (meta.imageUrl) {
    out = out
      .replace(
        /(<meta\s+property="og:image"\s+content=")[^"]*(")/,
        `$1${escapeHtml(meta.imageUrl)}$2`,
      )
      .replace(
        /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/,
        `$1${escapeHtml(meta.imageUrl)}$2`,
      );
  }
  // The shell declares og:type="website" for the site as a whole. A blog post is
  // an article, and og:type is what tells a share card renderer to look for
  // published/modified times and a byline instead of treating the page as a
  // site homepage.
  if (meta.ogType) {
    out = out.replace(
      /(<meta\s+property="og:type"\s+content=")[^"]*(")/,
      `$1${escapeHtml(meta.ogType)}$2`,
    );
  }
  // Likewise og:image:alt, which the shell sets to the site's generic card
  // description. On an article the card is that article's own card.
  if (meta.imageAlt) {
    out = out.replace(
      /(<meta\s+property="og:image:alt"\s+content=")[^"]*(")/,
      `$1${escapeHtml(meta.imageAlt)}$2`,
    );
  }
  return out;
}

// --- route-chunk CSS + modulepreload baking -----------------------------------
// The prerendered pages carry real route markup, but Vite code-splits each
// route's CSS into its JS chunk, so without these links the markup paints
// half-styled (a large FOUC/CLS: measured 0.6 layout shift on the homepage)
// until the chunk loads and injects its stylesheet. Walking the build manifest
// from the route's source module collects the transitive CSS (linked so first
// paint is fully styled) and JS files (modulepreloaded so the client takeover
// happens sooner). Vite's runtime preload helper dedupes by href, so the baked
// links are not double-loaded.
function collectRouteAssets(manifest, entryId) {
  const css = new Set();
  const js = new Set();
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = manifest[id];
    if (!node) return;
    if (node.file) js.add(node.file);
    for (const file of node.css ?? []) css.add(file);
    for (const dep of node.imports ?? []) walk(dep);
  };
  walk(entryId);
  return { css: [...css], js: [...js] };
}

function routeAssetLinks(manifest, entryId, shellHtml) {
  const { css, js } = collectRouteAssets(manifest, entryId);
  const links = [];
  for (const file of css) {
    if (shellHtml.includes(file)) continue; // already linked by the entry shell
    links.push(`<link rel="stylesheet" crossorigin href="/${file}">`);
  }
  for (const file of js) {
    if (shellHtml.includes(file)) continue; // the entry script itself
    links.push(`<link rel="modulepreload" crossorigin href="/${file}">`);
  }
  return links.join('');
}

// --- per-route modulepreload manifest for the SPA shell (issue #31) ------------
// dist/index.html (the shell the server serves for every non-prerendered client
// route) declares only the entry script, so a cold load discovers the route's
// chunk one round-trip AFTER the entry executes: HTML -> entry -> route chunk
// (+ its deps, preloaded together by Vite's helper) -> data. The server
// collapses the route-chunk layer by injecting the matched route's stylesheet +
// modulepreload links into the shell head (server-static-pages.ts,
// routePreloadLinksForPath), so the route graph downloads in parallel with the
// entry. This table is the only hand-maintained part: route pattern -> source
// module, mirroring main.ts's dispatch for the public, cold-load-heavy routes.
// The emitted file lists are generated from the build manifest, so hrefs always
// point at really-emitted hashed chunks; a renamed/missing module key fails the
// build loudly instead of silently shipping stale hints. A route absent from
// this table just serves the plain shell (graceful degradation).
const ROUTE_PRELOADS = [
  { pattern: '^/watch$', module: 'src/watch-route.ts' },
  { pattern: '^/room(?:/[^/]+)?$', module: 'src/live.ts' },
  // /game/:id mounts the replay/review surface through landing.ts (mountGame),
  // which statically pulls the shared replay + board graph.
  { pattern: '^/game/[^/]+$', module: 'src/landing.ts' },
  { pattern: '^/puzzles(?:/[^/]+)?$', module: 'src/puzzles.ts' },
  // /player normally serves the prerendered player.html (already hinted); this
  // covers /player/rating-stats and the fallback when player.html is absent.
  { pattern: '^/player(?:/rating-stats)?$', module: 'src/profile.ts' },
  { pattern: '^/@/[^/]+$', module: 'src/profile.ts' },
  { pattern: '^/videos$', module: 'src/videos.ts' },
  { pattern: '^/forum(?:/.+)?$', module: 'src/forum.ts' },
  { pattern: '^/learn/xiangqi$', module: 'src/learn-xiangqi/learn-xiangqi-page.ts' },
  { pattern: '^/account(?:/.+)?$', module: 'src/account.ts' },
  { pattern: '^/inbox(?:/.+)?$', module: 'src/inbox.ts' },
  {
    pattern: '^/(?:about|source|contact|patron|faq|terms|privacy|feed|news)$',
    module: 'src/pages-static.ts',
  },
];

async function writeRoutePreloadManifest(manifest, shellHtml) {
  const routes = ROUTE_PRELOADS.map(({ pattern, module }) => {
    if (!manifest[module]) {
      throw new Error(
        `route-preload manifest: "${module}" is not in the build manifest (route ${pattern}); ` +
          'update ROUTE_PRELOADS to match main.ts',
      );
    }
    const { css, js } = collectRouteAssets(manifest, module);
    return {
      pattern,
      css: css.filter((file) => !shellHtml.includes(file)),
      js: js.filter((file) => !shellHtml.includes(file)),
    };
  });
  await fs.writeFile(
    resolve(distDir, 'route-preload-manifest.json'),
    `${JSON.stringify({ version: 1, routes }, null, 2)}\n`,
    'utf-8',
  );
  console.log(`route-preload manifest: ${routes.length} route pattern(s)`);
}

// Production env for the SSR pass so modules see the same import.meta.env the
// built client bundle does: NODE_ENV drives DEV/PROD, mode drives .env file
// selection. Without both, the prerender baked dev-on flag-gated variants into
// prod HTML (leaking hidden variants and flashing panels that hydration then
// removes).
process.env.NODE_ENV = 'production';
// --- RSS 2.0 for the announcement archive -----------------------------------
// Hand-rolled rather than a dependency: the document is a dozen lines and the
// only hard parts are escaping and the RFC-822 date.
const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Announcements carry a date with no time. Noon UTC keeps every reader's local
// date equal to the authored one.
const rssDate = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toUTCString();
};

const absoluteHref = (href) => {
  if (!href) return `${host}/feed`;
  return /^https?:/.test(href) ? href : `${host}${href}`;
};

function renderNewsRss(entries) {
  const items = entries
    .map((entry) => {
      // Stable id that does not change when an entry's link does, so a reader
      // that has seen an item never sees it twice.
      const slug = entry.headline
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
      // The authored CTA ("Open the editor") is a UI label, not prose. In a
      // reader, and in a tweet built from this document, the link is the call
      // to action, so the label would only read as a dangling imperative.
      const description = entry.body ?? '';
      return [
        '    <item>',
        `      <title>${xmlEscape(entry.headline)}</title>`,
        `      <link>${xmlEscape(absoluteHref(entry.href))}</link>`,
        `      <guid isPermaLink="false">mistboard:${entry.date}:${slug}</guid>`,
        `      <pubDate>${rssDate(entry.date)}</pubDate>`,
        `      <category>${xmlEscape(entry.kind)}</category>`,
        description ? `      <description>${xmlEscape(description)}</description>` : null,
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Mistboard updates</title>
    <link>${host}/feed</link>
    <atom:link href="${host}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Releases, articles, and status updates from Mistboard.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

// The blog's own feed, separate from /feed.xml (which carries announcements:
// one-line release notes, not posts). A reader who subscribes to a blog wants
// the posts, and mixing the two means either the announcements drown the posts
// or subscribing to the posts signs you up for changelog entries.
function renderArticlesRss(entries) {
  const items = entries
    .map((entry) => {
      const url = `${host}/blog/${encodeURIComponent(entry.slug)}`;
      return [
        '    <item>',
        `      <title>${xmlEscape(entry.title)}</title>`,
        `      <link>${xmlEscape(url)}</link>`,
        // Keyed by slug, not URL: a renamed slug 301s (RENAMED_ARTICLE_SLUGS)
        // and the post is still the same post, so the id has to survive it.
        `      <guid isPermaLink="false">mistboard:blog:${xmlEscape(entry.slug)}</guid>`,
        ...(entry.publishedAt ? [`      <pubDate>${rssDate(entry.publishedAt)}</pubDate>`] : []),
        `      <description>${xmlEscape(entry.summary)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Mistboard blog</title>
    <link>${host}/blog</link>
    <atom:link href="${host}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>Xiangqi, fog variants, and engine work from Mistboard.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}

// Advertised in the head of every blog page so a reader's extension finds the
// feed without being told it exists.
const BLOG_RSS_LINK = `<link rel="alternate" type="application/rss+xml" title="Mistboard blog" href="${host}/blog/feed.xml" />`;

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  mode: 'production',
});

try {
  const { buildArticlePage } = await server.ssrLoadModule('/src/articles.ts');
  const { articles } = await server.ssrLoadModule('/src/articles-data.ts');
  const { isArticleTranslationPublished, translateArticle } =
    await server.ssrLoadModule('/src/article-i18n.ts');
  const { rulesSlugPublicSurfaceEnabled } = await server.ssrLoadModule(
    '/src/variant-public-surfaces.ts',
  );

  // en + the two zh scripts. urlPrefix feeds canonical/hreflang URLs; htmlLang
  // sets <html lang> and JSON-LD inLanguage; langDir is the output-path segment.
  // The base segment (articles vs rules) is chosen per-article from its kind.
  const baseVariants = [
    { lang: null, urlPrefix: '', htmlLang: 'en', langDir: null },
    { lang: 'zh-Hans', urlPrefix: '/zh-hans', htmlLang: 'zh-Hans', langDir: 'zh-hans' },
    { lang: 'zh-Hant', urlPrefix: '/zh-hant', htmlLang: 'zh-Hant', langDir: 'zh-hant' },
  ];

  // An article written in a language the interface does not speak keeps the
  // same output path and canonical, and only changes what it DECLARES itself
  // to be. Without this a Vietnamese page ships as <html lang="en"> with
  // hreflang="en", which is the site telling Google the page is English.
  const variantsFor = (article) =>
    article.sourceLang ? [{ ...baseVariants[0], htmlLang: article.sourceLang }] : baseVariants;

  const shell = await fs.readFile(resolve(distDir, 'index.html'), 'utf-8');
  if (!shell.includes('<div id="app"></div>')) {
    throw new Error('shell index.html missing empty <div id="app"></div> mount point');
  }

  // Build manifest for route-chunk CSS/preload baking. Articles mount through
  // src/pages-static.ts; the homepage through src/landing.ts (main.ts dispatch).
  const manifest = JSON.parse(
    await fs.readFile(resolve(distDir, '.vite', 'manifest.json'), 'utf-8'),
  );
  const articleAssetLinks = routeAssetLinks(manifest, 'src/pages-static.ts', shell);
  const landingAssetLinks = routeAssetLinks(manifest, 'src/landing.ts', shell);

  await writeRoutePreloadManifest(manifest, shell);

  // zh catalogs live in lazy per-locale chunks (i18n/catalog.ts); main.ts gates
  // every localized mount on that fetch. The prerender knows each page's locale,
  // so bake a modulepreload for the locale chunk into the zh variants — the
  // catalog then downloads in parallel with the entry instead of one round-trip
  // after it. Keyed by the ArticleLang the variants table uses below.
  const localePreloadLinks = {};
  for (const [lang, moduleId] of [
    ['zh-Hans', 'src/i18n/locales/zh-hans.ts'],
    ['zh-Hant', 'src/i18n/locales/zh-hant.ts'],
  ]) {
    const node = manifest[moduleId];
    if (!node?.file) {
      throw new Error(`locale preload: "${moduleId}" is not in the build manifest`);
    }
    localePreloadLinks[lang] = `<link rel="modulepreload" crossorigin href="/${node.file}">`;
  }

  // Cross-language alternates. The zh variants below are URL-prefixed renderings of
  // ONE article, so their hreflang is derived. A Vietnamese page is a SEPARATE
  // article (the settled language policy keeps INTERFACE locales at en/zh-Hans/
  // zh-Hant while leaving CONTENT languages open), so nothing derives the relation
  // between /blog/jieqi-platform and /blog/co-up. It has to be declared, or the two
  // pages compete instead of reinforcing each other.
  //
  // Declared once per pair and expanded both ways, so the two directions cannot
  // drift apart. An alternate is only emitted when the partner is actually
  // published: pointing Google at a draft is pointing it at a 404.
  const CROSS_LANGUAGE_PAIRS = [
    { en: 'jieqi-platform', vi: 'co-up' },
    { en: 'jieqi-openings', vi: 'khai-cuoc-co-up' },
    { en: 'jieqi', vi: 'luat-co-up' },
  ];

  const published = articles.filter((a) => a.status === 'published');
  const publishedBySlug = new Map(published.map((a) => [a.slug, a]));
  const crossLanguageAlternates = new Map();
  for (const pair of CROSS_LANGUAGE_PAIRS) {
    for (const [langA, slugA] of Object.entries(pair)) {
      const partners = Object.entries(pair)
        .filter(([langB]) => langB !== langA)
        .map(([langB, slugB]) => ({ lang: langB, slug: slugB }))
        .filter((partner) => publishedBySlug.has(partner.slug));
      if (partners.length > 0) crossLanguageAlternates.set(slugA, partners);
    }
  }
  let count = 0;

  for (const article of published) {
    const slug = encodeURIComponent(article.slug);
    // Rules docs are canonical under /rules/<slug>, everything else /blog/<slug>.
    const base = article.kind === 'rules' ? 'rules' : 'blog';
    // OG card stays English for all variants for now (the card renderer has no
    // CJK font; baking zh titles would render tofu). Localized variants and
    // hreflang alternates exist only after the article crosses the explicit
    // translation publication boundary.
    const imageUrl = `${host}/og/article/${slug}.png?v=${ARTICLE_OG_IMAGE_VERSION}`;
    const translationPublished = isArticleTranslationPublished(article.slug);
    const selfHreflang = article.sourceLang ?? 'en';
    const hreflang = [
      `<link rel="alternate" hreflang="${selfHreflang}" href="${host}/${base}/${slug}" />`,
      ...(translationPublished
        ? [
            `<link rel="alternate" hreflang="zh-Hans" href="${host}/zh-hans/${base}/${slug}" />`,
            `<link rel="alternate" hreflang="zh-Hant" href="${host}/zh-hant/${base}/${slug}" />`,
          ]
        : []),
      ...(crossLanguageAlternates.get(article.slug) ?? []).map((partner) => {
        const partnerArticle = publishedBySlug.get(partner.slug);
        const partnerBase = partnerArticle.kind === 'rules' ? 'rules' : 'blog';
        return `<link rel="alternate" hreflang="${partner.lang}" href="${host}/${partnerBase}/${encodeURIComponent(partner.slug)}" />`;
      }),
      `<link rel="alternate" hreflang="x-default" href="${host}/${base}/${slug}" />`,
    ].join('');

    const localeVariants = variantsFor(article);
    const articleVariants = translationPublished ? localeVariants : localeVariants.slice(0, 1);
    for (const v of articleVariants) {
      const localized = v.lang ? translateArticle(article, v.lang) : article;
      const main = buildArticlePage(article.slug, v.lang ?? undefined);
      const url = `${host}${v.urlPrefix}/${base}/${slug}`;
      let html = shell
        .replace('<html lang="en">', `<html lang="${v.htmlLang}">`)
        .replace('<div id="app"></div>', `<div id="app">${main.outerHTML}</div>`);
      html = injectPageMeta(html, {
        // seoTitle drives the document title and, through injectPageMeta, the
        // og/twitter titles — all the places a stranger meets the page cold. The
        // h1 and the JSON-LD headline keep `title`, so the page still presents
        // itself under the name we actually use for the variant and the two stay
        // consistent with each other.
        title: `${localized.seoTitle ?? localized.title} | Mistboard`,
        description: localized.summary,
        url,
        imageUrl,
        ogType: 'article',
        imageAlt: localized.title,
      });
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        inLanguage: v.htmlLang,
        headline: localized.title,
        description: localized.summary,
        image: imageUrl,
        author: { '@type': 'Organization', name: 'Mistboard' },
        publisher: { '@type': 'Organization', name: 'Mistboard' },
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
        ...(article.updatedAt ? { dateModified: article.updatedAt } : {}),
      };
      // Extra documents ride alongside the Article node, each in its own script
      // tag so a malformed one cannot take the Article down with it. Two
      // independent sources feed this list and both must survive: an article's
      // own structuredData() (the champions ItemList), and FAQ blocks.
      //
      // FAQ blocks become a separate FAQPage rather than folding into the
      // Article node, because they are a different schema type that Google reads
      // independently. Built from the SAME block the page renders, so the markup
      // and the structured data cannot describe different questions, and from the
      // LOCALIZED article, so a zh or vi variant emits its own language's.
      const faqItems = [
        ...(localized.intro ?? []),
        ...(localized.sections ?? []).flatMap((sec) => sec.blocks ?? []),
      ]
        .filter((b) => b.kind === 'faq')
        .flatMap((b) => b.items ?? []);
      const faqLd =
        faqItems.length > 0
          ? {
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              inLanguage: v.htmlLang,
              mainEntity: faqItems.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: { '@type': 'Answer', text: item.answer },
              })),
            }
          : null;
      const ldScript = [jsonLd, ...(article.structuredData?.() ?? []), ...(faqLd ? [faqLd] : [])]
        .map(
          (doc) =>
            `<script type="application/ld+json">${JSON.stringify(doc).replace(/</g, '\\u003c')}</script>`,
        )
        .join('');
      // Self-referencing canonical: each language variant declares its OWN clean
      // URL as canonical (not all three → English). hreflang expresses the
      // language relationship; the canonical consolidates query-param, SPA-shell,
      // and trailing-slash variants of THIS url into a single indexed page.
      const canonical = `<link rel="canonical" href="${url}" />`;
      const robots =
        article.kind === 'rules' && !rulesSlugPublicSurfaceEnabled(article.slug)
          ? '<meta name="robots" content="noindex, follow" />'
          : '';
      const localeLinks = v.lang ? (localePreloadLinks[v.lang] ?? '') : '';
      const rssLink = article.kind === 'rules' ? '' : BLOG_RSS_LINK;
      html = html.replace(
        '</head>',
        `${robots}${canonical}${hreflang}${rssLink}${ldScript}${articleAssetLinks}${localeLinks}</head>`,
      );

      const dir = resolve(distDir, ...(v.langDir ? [v.langDir, base] : [base]));
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(resolve(dir, `${article.slug}.html`), html, 'utf-8');
      count += 1;
      console.log(`prerendered ${v.urlPrefix}/${base}/${article.slug} (lang=${v.htmlLang})`);
    }
  }
  console.log(
    `done: ${count} page(s) across ${published.length} article(s); localized variants require publication lock`,
  );

  // Homepage: bake the static landing shell so crawlers, no-JS clients, and
  // first paint get real content (heading, play panel, article links, footer)
  // instead of the empty SPA shell. index.html already carries the homepage meta;
  // we add a self-referencing canonical and write a separate home.html (the bare
  // index.html stays the empty shell that every other client route falls back to).
  const { renderLandingShellForPrerender } = await server.ssrLoadModule('/src/landing.ts');
  const landingInner = renderLandingShellForPrerender();
  let homeHtml = shell.replace('<div id="app"></div>', `<div id="app">${landingInner}</div>`);
  homeHtml = homeHtml.replace(
    '</head>',
    `<link rel="canonical" href="${host}/" />${landingAssetLinks}</head>`,
  );
  await fs.writeFile(resolve(distDir, 'home.html'), homeHtml, 'utf-8');
  console.log('prerendered / (home.html)');

  // /blog: the post index. Authored data only, so the baked DOM is the page a
  // reader gets. It has been in the sitemap all along while answering with the
  // empty shell, which is worse than not being listed.
  const { renderArticlesIndexShellForPrerender } =
    await server.ssrLoadModule('/src/pages-static.ts');
  const blogIndexInner = await renderArticlesIndexShellForPrerender();
  let blogIndexHtml = shell.replace(
    '<div id="app"></div>',
    `<div id="app" class="landing-page articles-route">${blogIndexInner}</div>`,
  );
  // Full meta, not a title-only replace: servePrerenderedPage returns this file
  // as-is and never runs the server's own injection, so anything left alone
  // here ships the homepage's copy. Same strings as ARTICLES_INDEX_META.en in
  // apps/server/src/server-static-pages.ts, which covers the fallback path.
  blogIndexHtml = injectPageMeta(blogIndexHtml, {
    title: 'Articles | Mistboard',
    description: 'Long-form writing on original strategy games, rules, and engine research.',
    url: `${host}/blog`,
  });
  blogIndexHtml = blogIndexHtml.replace(
    '</head>',
    `<link rel="canonical" href="${host}/blog" />${BLOG_RSS_LINK}${articleAssetLinks}</head>`,
  );
  await fs.writeFile(resolve(distDir, 'blog.html'), blogIndexHtml, 'utf-8');
  console.log('prerendered /blog (blog.html)');

  // blog/feed.xml: the posts as RSS, alongside the announcement feed at
  // /feed.xml. Published blog posts only, newest first; rules docs are
  // reference pages, not posts, and drafts are not public.
  const blogFeedEntries = published
    .filter((entry) => entry.kind === 'article')
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  await fs.mkdir(resolve(distDir, 'blog'), { recursive: true });
  await fs.writeFile(
    resolve(distDir, 'blog', 'feed.xml'),
    renderArticlesRss(blogFeedEntries),
    'utf-8',
  );
  console.log(`wrote /blog/feed.xml (${blogFeedEntries.length} entries)`);

  // Player: bake the players-page frame (rail, twin headings, loading
  // panels) with its route CSS so first paint gets the full layout instead of
  // the empty shell. Live data (ladder rows, online list) stays a client
  // fetch. The `landing-page` class is baked onto #app because it carries the
  // page background; the client mount re-adds it idempotently.
  const { renderLeaderboardShellForPrerender } = await server.ssrLoadModule('/src/profile.ts');
  const leaderboardAssetLinks = routeAssetLinks(manifest, 'src/profile.ts', shell);
  const leaderboardInner = renderLeaderboardShellForPrerender();
  let leaderboardHtml = shell.replace(
    '<div id="app"></div>',
    `<div id="app" class="landing-page">${leaderboardInner}</div>`,
  );
  leaderboardHtml = leaderboardHtml.replace(
    /<title>[^<]*<\/title>/,
    '<title>Players · Mistboard</title>',
  );
  leaderboardHtml = leaderboardHtml.replace(
    '</head>',
    `<link rel="canonical" href="${host}/player" />${leaderboardAssetLinks}</head>`,
  );
  await fs.writeFile(resolve(distDir, 'player.html'), leaderboardHtml, 'utf-8');
  await fs.writeFile(resolve(distDir, 'leaderboard.html'), leaderboardHtml, 'utf-8');
  console.log('prerendered /player (player.html)');

  // /feed: the announcement archive. Static authored copy with no live or
  // per-account data, so the baked DOM is exactly what a reader sees. It was
  // serving a bare shell while carrying a noindex; both were fixed 2026-08-27,
  // and a sitemap entry for a bare shell is worse than no entry at all.
  const { renderNewsShellForPrerender } = await server.ssrLoadModule('/src/news-page.ts');
  const newsAssetLinks = routeAssetLinks(manifest, 'src/news-page.ts', shell);
  const newsInner = renderNewsShellForPrerender();
  let newsHtml = shell.replace(
    '<div id="app"></div>',
    `<div id="app" class="landing-page news-route">${newsInner}</div>`,
  );
  // Same copy as the server's SPA_ROUTE_META['/feed'], which covers the fallback
  // path when this file is missing.
  newsHtml = injectPageMeta(newsHtml, {
    title: 'Updates and Announcements | Mistboard',
    description:
      'Every Mistboard release, article, and status update, newest first: new variants, engine work, and changes to the site.',
    url: `${host}/feed`,
  });
  newsHtml = newsHtml.replace(
    '</head>',
    `<link rel="canonical" href="${host}/feed" />${newsAssetLinks}</head>`,
  );
  await fs.writeFile(resolve(distDir, 'feed.html'), newsHtml, 'utf-8');
  console.log('prerendered /feed (feed.html)');

  // feed.xml: the same archive as RSS 2.0, so the announcements are followable
  // without opening the site. Gated by the same public-surface filter as the
  // page, or the feed would announce variants the site hides.
  const { announcements } = await server.ssrLoadModule('/src/announcements.ts');
  const { rulesHrefPublicSurfaceEnabled } = await server.ssrLoadModule(
    '/src/variant-public-surfaces.ts',
  );
  const feedEntries = announcements()
    .filter((entry) => rulesHrefPublicSurfaceEnabled(entry.href))
    .sort((a, b) => b.date.localeCompare(a.date));
  await fs.writeFile(resolve(distDir, 'feed.xml'), renderNewsRss(feedEntries), 'utf-8');
  console.log(`wrote /feed.xml (${feedEntries.length} entries)`);

  // Learn: bake the stage map (sidebar + all 20 stage tiles + "what next") with
  // its route CSS. /learn/xiangqi previously served the bare shell, so a crawler
  // saw a <title> and nothing else. Progress is localStorage-only, so the baked
  // map is the empty-progress view, which is exactly what a first visit shows.
  const { renderLearnXiangqiShellForPrerender } = await server.ssrLoadModule(
    '/src/learn-xiangqi/learn-xiangqi-page.ts',
  );
  const learnAssetLinks = routeAssetLinks(
    manifest,
    'src/learn-xiangqi/learn-xiangqi-page.ts',
    shell,
  );
  const learnInner = renderLearnXiangqiShellForPrerender();
  let learnHtml = shell.replace('<div id="app"></div>', `<div id="app">${learnInner}</div>`);
  // Full meta, not a title-only replace: this baked file is served as-is by
  // servePrerenderedPage, so until now /learn/xiangqi shipped the homepage's
  // description. Same copy as the server's SPA_ROUTE_META['/learn/xiangqi'].
  learnHtml = injectPageMeta(learnHtml, {
    title: 'Learn Chinese Chess (Xiangqi) | Mistboard',
    description:
      'A free interactive xiangqi course in English. Learn the pieces, the rules, and core tactics by playing them.',
    url: `${host}/learn/xiangqi`,
  });
  learnHtml = learnHtml.replace(
    '</head>',
    `<link rel="canonical" href="${host}/learn/xiangqi" />${learnAssetLinks}</head>`,
  );
  await fs.writeFile(resolve(distDir, 'learn-xiangqi.html'), learnHtml, 'utf-8');
  console.log('prerendered /learn/xiangqi (learn-xiangqi.html)');

  // Puzzles: bake the heading and the static explainer. /puzzles has been in
  // the sitemap all along while serving 27 characters of body, because the
  // trainer needs the API before it can render anything. The puzzles
  // themselves still arrive client-side; what bakes is the copy explaining
  // what the trainer is.
  const { renderPuzzlesShellForPrerender } = await server.ssrLoadModule('/src/puzzles.ts');
  const puzzlesAssetLinks = routeAssetLinks(manifest, 'src/puzzles.ts', shell);
  const puzzlesInner = renderPuzzlesShellForPrerender();
  let puzzlesHtml = shell.replace('<div id="app"></div>', `<div id="app">${puzzlesInner}</div>`);
  // Same copy as the server's SPA_ROUTE_META['/puzzles'], which covers the
  // fallback path when this file is missing. Injecting the FULL meta matters:
  // servePrerenderedPage returns the baked file as-is and never runs the
  // server's meta injection, so a title-only replace would have shipped the
  // homepage's description on this page.
  puzzlesHtml = injectPageMeta(puzzlesHtml, {
    title: 'Xiangqi Puzzles | Mistboard',
    description:
      'Free xiangqi (Chinese chess) puzzles drawn from real games, with puzzles for Mistboard variants alongside.',
    url: `${host}/puzzles`,
  });
  puzzlesHtml = puzzlesHtml.replace(
    '</head>',
    `<link rel="canonical" href="${host}/puzzles" />${puzzlesAssetLinks}</head>`,
  );
  await fs.writeFile(resolve(distDir, 'puzzles.html'), puzzlesHtml, 'utf-8');
  console.log('prerendered /puzzles (puzzles.html)');

  // Patron: bake the page that says what this site sells. It was serving a bare
  // shell, so a fetch without JavaScript got the meta description and nothing
  // else, on the one route whose whole job is to name the product and its price.
  // The copy and the four monthly amounts are static; the live card (checkout
  // state, "you are a Patron") stays a client fetch and replaces the baked one
  // on boot. Asset links come from pages-static.ts because that module owns
  // pages-static.css, where the patron styles live.
  const { renderPatronShellForPrerender } = await server.ssrLoadModule('/src/patron-page.ts');
  const patronAssetLinks = routeAssetLinks(manifest, 'src/pages-static.ts', shell);
  const patronInner = renderPatronShellForPrerender();
  let patronHtml = shell.replace(
    '<div id="app"></div>',
    `<div id="app" class="landing-page patron-route">${patronInner}</div>`,
  );
  // Same copy as the server's SPA_ROUTE_META['/patron'], which covers the
  // fallback path when this file is missing. Full meta, not a title-only
  // replace: servePrerenderedPage returns this file as-is.
  patronHtml = injectPageMeta(patronHtml, {
    title: 'Become a Patron | Mistboard',
    description:
      'Mistboard is independent and ad-free. Core play and learning stay free. Patron is an optional monthly subscription with a profile badge.',
    url: `${host}/patron`,
  });
  patronHtml = patronHtml.replace(
    '</head>',
    `<link rel="canonical" href="${host}/patron" />${patronAssetLinks}</head>`,
  );
  await fs.writeFile(resolve(distDir, 'patron.html'), patronHtml, 'utf-8');
  console.log('prerendered /patron (patron.html)');
} catch (err) {
  console.error('prerender failed:', err);
  process.exitCode = 1;
} finally {
  await server.close();
}
