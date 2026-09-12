import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { POSITION_OG_VARIANTS } from './og-position.js';
import { isClientRoute } from './server-policy.js';
import {
  injectPageMeta,
  positionRouteMeta,
  routePreloadLinksForPath,
  SITEMAP_STATIC_ROUTES,
  serveArticlePage,
  serveArticlesIndexPage,
  serveNotFoundShell,
  serveRulesIndexPage,
  serveSitemap,
  serveSpaShellWithRoutePreloads,
  serveStudyPage,
} from './server-static-pages.js';

type ResponseCapture = {
  body: string;
  headers: Record<string, string>;
  status: number | null;
};

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {},
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as ServerResponse & ResponseCapture;
}

function indexHtml(): string {
  return [
    // Carries lang="en" because the real dist/index.html does, and the servers
    // rewrite that exact attribute for a localized route. Two tests used to
    // patch it in by hand, which is a fixture disagreeing with production on
    // precisely the attribute under test.
    '<html lang="en">',
    '<head>',
    '<title>Mistboard</title>',
    '<meta name="description" content="old">',
    '<meta property="og:title" content="old">',
    '<meta property="og:description" content="old">',
    '<meta property="og:url" content="old">',
    '<meta property="og:image" content="old">',
    '<meta name="twitter:title" content="old">',
    '<meta name="twitter:description" content="old">',
    '<meta name="twitter:image" content="old">',
    '</head>',
    '<body><div id="app"></div></body>',
    '</html>',
  ].join('');
}

test('injectPageMeta replaces share tags and escapes injected values', () => {
  const html = injectPageMeta(indexHtml(), {
    title: 'A "quoted" <title>',
    description: 'Dark & hidden <info>',
    url: 'https://example.test/game/abc',
    imageUrl: 'https://example.test/og.png?x=1&y=2',
  });

  assert.match(html, /<title>A &quot;quoted&quot; &lt;title&gt;<\/title>/);
  assert.match(html, /<meta name="description" content="Dark &amp; hidden &lt;info&gt;">/);
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/example.test\/og.png\?x=1&amp;y=2">/,
  );
});

test('serveNotFoundShell serves the SPA shell with a 404 status and noindex', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveNotFoundShell({ response, staticDir });

  assert.equal(response.status, 404);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(response.body, /<title>Page not found · Mistboard<\/title>/);
  assert.match(response.body, /<meta name="robots" content="noindex, follow">/);
  // The SPA mount point survives so the client can render the branded 404.
  assert.match(response.body, /<div id="app"><\/div>/);
});

test('serveArticlePage returns prerendered rules files from the rules base', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await mkdir(join(staticDir, 'rules'), { recursive: true });
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  await writeFile(join(staticDir, 'rules', 'fog-chess.html'), '<h1>prerendered</h1>');
  const response = captureResponse();

  await serveArticlePage({
    slug: 'fog-chess',
    base: 'rules',
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.body, '<h1>prerendered</h1>');
});

test('serveArticlePage falls back to index shell with rules metadata', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveArticlePage({
    slug: 'fog-chess',
    base: 'rules',
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /<title>Fog Chess Rules \| Mistboard<\/title>/);
  assert.match(
    response.body,
    /<meta property="og:url" content="https:\/\/mistboard.test\/rules\/fog-chess">/,
  );
  assert.match(
    response.body,
    /<meta property="og:image" content="https:\/\/mistboard.test\/og\/article\/fog-chess.png">/,
  );
});

test('serveArticlePage redirects an unpublished localized article to its English prerender', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await mkdir(join(staticDir, 'blog'), { recursive: true });
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  await writeFile(join(staticDir, 'blog', 'misty.html'), '<h1>English article</h1>');
  const response = captureResponse();

  await serveArticlePage({
    slug: 'misty',
    base: 'blog',
    langPrefix: 'zh-hans',
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/blog/misty');
  assert.equal(response.body, '');
});

test('serveArticlePage marks an unlisted rules page as non-indexable', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveArticlePage({
    slug: 'shogi4',
    base: 'rules',
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /<meta name="robots" content="noindex, follow">/);
});

test('serveSitemap omits unlisted and retired rules while retaining public articles', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await mkdir(join(staticDir, 'rules'), { recursive: true });
  await mkdir(join(staticDir, 'blog'), { recursive: true });
  for (const slug of ['xiangqi', 'shogi4', 'dark-draft960']) {
    await writeFile(join(staticDir, 'rules', `${slug}.html`), '<h1>rules</h1>');
  }
  await writeFile(join(staticDir, 'blog', 'misty.html'), '<h1>article</h1>');
  const response = captureResponse();

  await serveSitemap({
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /https:\/\/mistboard\.test\/rules\/xiangqi/);
  assert.match(response.body, /https:\/\/mistboard\.test\/blog\/misty/);
  assert.doesNotMatch(response.body, /shogi4|dark-draft960/);
});

test('serveArticlePage 301s legacy /articles/<rules-slug> to /rules/<clean>', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveArticlePage({
    slug: 'dark-chess-rules',
    base: 'articles',
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 301);
  assert.equal(response.headers.location, '/rules/fog-chess');
});

test('serveArticlePage 301s legacy rules slugs to their canonical slug', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');

  for (const [slug, canonical] of [
    ['flip-xiangqi', 'banqi'],
    ['dark-chess', 'fog-chess'],
    ['dark-xiangqi', 'fog-xiangqi'],
    ['reveal-xiangqi', 'jieqi'],
  ] as const) {
    const response = captureResponse();
    await serveArticlePage({
      slug,
      base: 'rules',
      response,
      publicHost: 'https://mistboard.test',
      staticDir,
    });
    assert.equal(response.status, 301);
    assert.equal(response.headers.location, `/rules/${canonical}`);
  }
});

test('serveArticlePage 301s a rules slug requested under /articles to /rules, preserving lang', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveArticlePage({
    slug: 'fog-chess',
    base: 'articles',
    langPrefix: 'zh-hans',
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 301);
  assert.equal(response.headers.location, '/zh-hans/rules/fog-chess');
});

test('serveArticlePage 301s legacy /articles/<article-slug> to /blog/<slug>', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveArticlePage({
    slug: 'misty',
    base: 'articles',
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 301);
  assert.equal(response.headers.location, '/blog/misty');
});

test('serveArticlesIndexPage injects localized metadata', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveArticlesIndexPage({
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
    langPrefix: 'zh-hans',
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /<html lang="zh-Hans">/);
  assert.match(response.body, /<title>文章 \| Mistboard<\/title>/);
  assert.match(
    response.body,
    /<meta property="og:url" content="https:\/\/mistboard.test\/zh-hans\/blog">/,
  );
});

test('serveArticlesIndexPage keeps the community-posts view canonical', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveArticlesIndexPage({
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
    view: 'community',
  });

  assert.equal(response.status, 200);
  assert.match(
    response.body,
    /<meta property="og:url" content="https:\/\/mistboard\.test\/blog\/community">/,
  );
});

test('serveArticlesIndexPage serves the prerendered post list when the build baked one', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  await writeFile(
    join(staticDir, 'blog.html'),
    '<html><body>baked post list</body></html>',
    'utf-8',
  );
  const response = captureResponse();

  await serveArticlesIndexPage({
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /baked post list/);
});

// Only the default-locale "By Mistboard" list is baked. The localized indexes
// and the community view are still client-rendered, and handing them the
// English baked file would ship the wrong language or the wrong list.
test('serveArticlesIndexPage keeps localized and community views on the shell', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  await writeFile(
    join(staticDir, 'blog.html'),
    '<html><body>baked post list</body></html>',
    'utf-8',
  );

  for (const params of [{ langPrefix: 'zh-hans' }, { view: 'community' as const }]) {
    const response = captureResponse();
    await serveArticlesIndexPage({
      response,
      publicHost: 'https://mistboard.test',
      staticDir,
      ...params,
    });
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.body, /baked post list/);
  }
});

// An older build (or a partial deploy) has no blog.html. The index still has to
// answer, so the shell path stays the fallback rather than a 500.
test('serveArticlesIndexPage falls back to the shell when no prerender exists', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveArticlesIndexPage({
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /<title>Articles \| Mistboard<\/title>/);
});

test('serveRulesIndexPage injects rules metadata', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveRulesIndexPage({
    response,
    publicHost: 'https://mistboard.test',
    staticDir,
    langPrefix: 'zh-hant',
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /<html lang="zh-Hant">/);
  assert.match(response.body, /<title>規則 \| Mistboard<\/title>/);
  assert.match(
    response.body,
    /<meta property="og:url" content="https:\/\/mistboard.test\/zh-hant\/rules">/,
  );
});

// --- per-route modulepreload hints (issue #31) ---------------------------------

function routePreloadManifestJson(): string {
  return JSON.stringify({
    version: 1,
    routes: [
      {
        pattern: '^/watch$',
        css: ['assets/watch-route-abc.css'],
        js: ['assets/watch-route-abc.js', 'assets/review-shell-def.js'],
      },
      { pattern: '^/game/[^/]+$', css: [], js: ['assets/landing-ghi.js'] },
      { pattern: '^/empty$', css: [], js: [] },
    ],
  });
}

async function staticDirWithPreloadManifest(): Promise<string> {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  await writeFile(join(staticDir, 'route-preload-manifest.json'), routePreloadManifestJson());
  return staticDir;
}

test('routePreloadLinksForPath renders stylesheet + modulepreload links for a matched route', async () => {
  const staticDir = await staticDirWithPreloadManifest();

  const links = await routePreloadLinksForPath({ staticDir, pathname: '/watch' });

  assert.equal(
    links,
    '<link rel="stylesheet" crossorigin href="/assets/watch-route-abc.css">' +
      '<link rel="modulepreload" crossorigin href="/assets/watch-route-abc.js">' +
      '<link rel="modulepreload" crossorigin href="/assets/review-shell-def.js">',
  );
});

test('routePreloadLinksForPath normalizes trailing slashes like isClientRoute', async () => {
  const staticDir = await staticDirWithPreloadManifest();

  const links = await routePreloadLinksForPath({ staticDir, pathname: '/watch/' });

  assert.match(links ?? '', /watch-route-abc\.js/);
});

test('routePreloadLinksForPath returns null for unmatched routes, empty entries, and missing or malformed manifests', async () => {
  const staticDir = await staticDirWithPreloadManifest();
  assert.equal(await routePreloadLinksForPath({ staticDir, pathname: '/streamer' }), null);
  assert.equal(await routePreloadLinksForPath({ staticDir, pathname: '/empty' }), null);

  const bareDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(bareDir, 'index.html'), indexHtml(), 'utf-8');
  assert.equal(await routePreloadLinksForPath({ staticDir: bareDir, pathname: '/watch' }), null);

  const brokenDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(brokenDir, 'index.html'), indexHtml(), 'utf-8');
  await writeFile(join(brokenDir, 'route-preload-manifest.json'), 'not json');
  assert.equal(await routePreloadLinksForPath({ staticDir: brokenDir, pathname: '/watch' }), null);
});

test('routePreloadLinksForPath skips an invalid pattern without dropping later routes', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  await writeFile(
    join(staticDir, 'route-preload-manifest.json'),
    JSON.stringify({
      version: 1,
      routes: [
        { pattern: '^/(watch$', js: ['assets/broken.js'] },
        { pattern: '^/watch$', js: ['assets/watch-route-abc.js'] },
      ],
    }),
  );

  const links = await routePreloadLinksForPath({ staticDir, pathname: '/watch' });

  assert.equal(links, '<link rel="modulepreload" crossorigin href="/assets/watch-route-abc.js">');
});

test('serveSpaShellWithRoutePreloads injects hints into the shell head for a known route', async () => {
  const staticDir = await staticDirWithPreloadManifest();
  const response = captureResponse();

  const served = await serveSpaShellWithRoutePreloads({ response, staticDir, pathname: '/watch' });

  assert.equal(served, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(
    response.body,
    /<link rel="modulepreload" crossorigin href="\/assets\/watch-route-abc\.js"><link rel="modulepreload" crossorigin href="\/assets\/review-shell-def\.js"><\/head>/,
  );
  // Still the SPA shell: empty mount point, no prerendered markup.
  assert.match(response.body, /<div id="app"><\/div>/);
});

test('serveSpaShellWithRoutePreloads gives a route with meta its own title and canonical url', async () => {
  const staticDir = await staticDirWithPreloadManifest();
  const response = captureResponse();

  const served = await serveSpaShellWithRoutePreloads({
    response,
    staticDir,
    pathname: '/learn/xiangqi',
    publicHost: 'https://mistboard.com',
  });

  assert.equal(served, true);
  assert.match(response.body, /<title>Learn Chinese Chess \(Xiangqi\) \| Mistboard<\/title>/);
  assert.match(
    response.body,
    /<meta property="og:url" content="https:\/\/mistboard\.com\/learn\/xiangqi">/,
  );
  // Still the SPA shell: the meta is the only thing prerendered.
  assert.match(response.body, /<div id="app"><\/div>/);
});

test('serveSpaShellWithRoutePreloads serves route meta even with no preload manifest entry', async () => {
  // /learn/xiangqi has route meta but no manifest entry in the fixture. The old
  // early-return on missing preloads would have dropped the meta entirely.
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  const served = await serveSpaShellWithRoutePreloads({
    response,
    staticDir,
    pathname: '/learn/xiangqi',
    publicHost: 'https://mistboard.com',
  });

  assert.equal(served, true);
  assert.match(response.body, /<title>Learn Chinese Chess \(Xiangqi\) \| Mistboard<\/title>/);
});

// Sitemap routes whose meta comes from a dedicated per-locale renderer rather
// than SPA_ROUTE_META: the article and rules indexes, and '/' which is the
// static index itself. There is no third category any more. Every other
// advertised route now carries its own title.
const SITEMAP_ROUTES_WITH_OWN_RENDERER = new Set([
  '/',
  '/blog',
  '/rules',
  '/zh-hans/rules',
  '/zh-hant/rules',
]);

// The old version of this test hand-listed four routes while claiming "every",
// which is how /videos came to sit in the sitemap with no meta at all, serving
// the homepage title to a crawler. Ten more were in the same state behind it.
test('every sitemap SPA route carries its own distinct title', async () => {
  const staticDir = await staticDirWithPreloadManifest();
  const titles = new Map<string, string>();
  for (const route of SITEMAP_STATIC_ROUTES) {
    if (SITEMAP_ROUTES_WITH_OWN_RENDERER.has(route)) continue;
    assert.ok(isClientRoute(route), `${route} is advertised but is not a client route`);
    const response = captureResponse();
    await serveSpaShellWithRoutePreloads({
      response,
      staticDir,
      pathname: route,
      publicHost: 'https://mistboard.com',
    });
    const title = response.body.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Mistboard';
    assert.ok(
      title !== 'Mistboard',
      `${route} serves the default shell title. Give it an SPA_ROUTE_META entry before advertising it in the sitemap.`,
    );
    const clash = [...titles.entries()].find(([, other]) => other === title);
    assert.ok(!clash, `${route} shares a title with ${clash?.[0]}`);
    titles.set(route, title);
  }
  assert.ok(titles.size >= 15, `only ${titles.size} routes checked`);
});

// The point of #293: a Chinese-language visitor arriving at a prefixed URL used
// to get the 404 page, and a crawler had no Chinese URL to index at all.
test('the videos library serves all three locales, each distinct and cross-linked', async () => {
  const staticDir = await staticDirWithPreloadManifest();
  const seen = new Map<string, { title: string; body: string }>();
  for (const route of ['/videos', '/zh-hans/videos', '/zh-hant/videos']) {
    assert.ok(isClientRoute(route), `${route} would 404 on a direct hit in production`);
    assert.ok(SITEMAP_STATIC_ROUTES.includes(route), `${route} is not advertised in the sitemap`);
    const response = captureResponse();
    const served = await serveSpaShellWithRoutePreloads({
      response,
      staticDir,
      pathname: route,
      publicHost: 'https://mistboard.com',
    });
    assert.equal(served, true, `${route} fell through to the plain shell`);
    const title = response.body.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    assert.ok(title && title !== 'Mistboard', `${route} serves the default title`);
    seen.set(route, { title, body: response.body });
    // hreflang, so the three read as one page in three languages rather than
    // three near-duplicates competing with each other.
    for (const [lang, href] of [
      ['en', 'https://mistboard.com/videos'],
      ['zh-Hans', 'https://mistboard.com/zh-hans/videos'],
      ['zh-Hant', 'https://mistboard.com/zh-hant/videos'],
    ]) {
      assert.ok(
        response.body.includes(`<link rel="alternate" hreflang="${lang}" href="${href}">`),
        `${route} is missing the ${lang} alternate`,
      );
    }
  }
  assert.equal(new Set([...seen.values()].map((v) => v.title)).size, 3, 'titles must differ');
  // <html lang> follows the prefix, so a crawler and a screen reader both get
  // the served language rather than index.html's baked-in English.
  assert.match(seen.get('/zh-hans/videos')!.body, /<html lang="zh-Hans">/);
  assert.match(seen.get('/zh-hant/videos')!.body, /<html lang="zh-Hant">/);
  assert.match(seen.get('/videos')!.body, /<html lang="en">/);
});

// --- position routes (/analysis, /editor) --------------------------------------

// A mid-game banqi deal: five public fields plus the sixth field naming the
// identities under the face-down tiles. The og:image URL must carry only the
// five public fields; the sixth is the one thing a share preview may not name.
const BANQI_PUBLIC_FEN = 'X1X2r1X/2XGX1X1/X1s1XX1X/1XXX2XX r A2E2R1H2C1S3a1e1h1c1 3 12';
const BANQI_DEALT_FEN = `${BANQI_PUBLIC_FEN} AAEERHHCSSSaehc`;

test('a variant analysis link with a FEN gets its own title, og:url, and a position card', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  const served = await serveSpaShellWithRoutePreloads({
    response,
    staticDir,
    pathname: '/analysis/banqi',
    search: `?fen=${encodeURIComponent(BANQI_DEALT_FEN)}`,
    publicHost: 'https://mistboard.com',
  });

  assert.equal(served, true);
  assert.match(response.body, /<title>Banqi Analysis Board \| Mistboard<\/title>/);
  const image = /<meta property="og:image" content="([^"]*)">/.exec(response.body)?.[1] ?? '';
  assert.equal(
    image,
    `https://mistboard.com/og/position/banqi.png?fen=${encodeURIComponent(BANQI_PUBLIC_FEN).replace(/&/g, '&amp;')}&amp;v=1`,
  );
  assert.ok(!image.includes('AAEERHHCSSSaehc'), 'the image URL must not carry the deal');
  assert.match(
    response.body,
    /<meta name="twitter:image" content="https:\/\/mistboard\.com\/og\/position\/banqi\.png/,
  );
  // og:url is the link as shared.
  assert.match(
    response.body,
    new RegExp(
      `<meta property="og:url" content="https://mistboard\\.com/analysis/banqi\\?fen=${encodeURIComponent(BANQI_DEALT_FEN).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`,
    ),
  );
  assert.match(response.body, /<div id="app"><\/div>/);
});

test('the bare analysis and editor routes keep the xiangqi wording and take a FEN too', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

  for (const [pathname, title] of [
    ['/analysis', 'Xiangqi Analysis Board | Mistboard'],
    ['/editor', 'Xiangqi Board Editor | Mistboard'],
  ] as const) {
    const response = captureResponse();
    await serveSpaShellWithRoutePreloads({
      response,
      staticDir,
      pathname,
      search: `?fen=${encodeURIComponent(fen)}`,
      publicHost: 'https://mistboard.com',
    });
    assert.match(response.body, new RegExp(`<title>${title.replace('|', '\\|')}</title>`));
    assert.match(
      response.body,
      /<meta property="og:image" content="https:\/\/mistboard\.com\/og\/position\/xiangqi\.png\?fen=/,
    );
  }
});

test('a position route without a FEN, or with a bad one, keeps the default card', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');

  for (const search of ['', '?fen=nonsense', '?moves=e2e4']) {
    const response = captureResponse();
    await serveSpaShellWithRoutePreloads({
      response,
      staticDir,
      pathname: '/editor/jieqi',
      search,
      publicHost: 'https://mistboard.com',
    });
    assert.match(response.body, /<title>Jieqi Board Editor \| Mistboard<\/title>/, search);
    assert.match(response.body, /<meta property="og:image" content="old">/, search);
    assert.match(
      response.body,
      /<meta property="og:url" content="https:\/\/mistboard\.com\/editor\/jieqi">/,
      search,
    );
  }
});

test('every catalog variant gets a distinct analysis and editor title', () => {
  const titles = new Set<string>();
  for (const variant of POSITION_OG_VARIANTS) {
    for (const surface of ['analysis', 'editor']) {
      const meta = positionRouteMeta(`/${surface}/${variant}`, '');
      assert.ok(meta, `${surface}/${variant}`);
      assert.ok(meta.title.endsWith('| Mistboard'));
      assert.ok(!meta.title.includes('\u2014') && !meta.description.includes('\u2014'));
      titles.add(meta.title);
    }
  }
  assert.equal(titles.size, POSITION_OG_VARIANTS.length * 2);
});

test('an unknown variant slug gets no position meta', () => {
  assert.equal(positionRouteMeta('/analysis/chess', ''), null);
  assert.equal(positionRouteMeta('/editor/mini-xiangqi', '?fen=x'), null);
  assert.equal(positionRouteMeta('/analysis/xiangqi/extra', ''), null);
});

test('serveSpaShellWithRoutePreloads leaves the response untouched when nothing matches', async () => {
  const staticDir = await staticDirWithPreloadManifest();
  const response = captureResponse();

  // A path with no meta, no preload manifest entry, and no robots tag. It is
  // synthetic on purpose: this used to name /streamer, and broke the day
  // /streamer got a title, because "a route with nothing" is a moving target
  // while "a path that matches nothing" is not.
  const served = await serveSpaShellWithRoutePreloads({
    response,
    staticDir,
    pathname: '/not-a-route-with-hints',
  });

  assert.equal(served, false);
  assert.equal(response.status, null);
  assert.equal(response.body, '');
});

// The load-bearing case: /following has no route meta and no preload manifest
// entry, so before the noindex branch joined the bail condition this handler
// returned false and served the plain static shell with no robots tag. The
// policy would have looked correct in server-policy.ts and done nothing.
test('serveSpaShellWithRoutePreloads serves a robots tag for a private route with no meta or preloads', async () => {
  const staticDir = await staticDirWithPreloadManifest();
  const response = captureResponse();

  const served = await serveSpaShellWithRoutePreloads({
    response,
    staticDir,
    pathname: '/following',
  });

  assert.equal(served, true);
  assert.equal(response.status, 200);
  assert.match(response.body, /<meta name="robots" content="noindex, follow">/);
});

test('serveSpaShellWithRoutePreloads leaves a public route indexable', async () => {
  const staticDir = await staticDirWithPreloadManifest();
  const response = captureResponse();

  await serveSpaShellWithRoutePreloads({
    response,
    staticDir,
    pathname: '/rules',
    publicHost: 'https://mistboard.com',
  });

  assert.doesNotMatch(response.body, /noindex/);
});

test('serveStudyPage without persistence serves the plain shell (no meta leak, no crash)', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();

  await serveStudyPage({
    studyId: 'AbCd1234',
    response,
    staticDir,
    publicHost: 'https://mistboard.com',
  });

  assert.equal(response.status, 200);
  // Uninitialized persistence -> no study -> the generic shell title survives.
  assert.match(response.body, /<title>Mistboard<\/title>/);
});

test('the /games database carries its own route meta and sitemap entry', async () => {
  // /games spent its life serving the generic homepage <title> and staying out
  // of the sitemap. It is not a search form: unfiltered it lists the most
  // recently finished games, so it is indexable content.
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  // Since 2026-09-03 the database lives at /games/search and /games is the
  // current-games page; each carries its own title and both are in the sitemap.
  const search = captureResponse();
  const servedSearch = await serveSpaShellWithRoutePreloads({
    response: search,
    staticDir,
    pathname: '/games/search',
    publicHost: 'https://mistboard.com',
  });
  assert.equal(servedSearch, true);
  assert.match(search.body, /<title>Xiangqi Game Database \| Mistboard<\/title>/);
  assert.doesNotMatch(search.body, /noindex/);

  const current = captureResponse();
  const servedCurrent = await serveSpaShellWithRoutePreloads({
    response: current,
    staticDir,
    pathname: '/games',
    publicHost: 'https://mistboard.com',
  });
  assert.equal(servedCurrent, true);
  assert.match(current.body, /<title>Current Games \| Mistboard<\/title>/);
  assert.doesNotMatch(current.body, /noindex/);

  const sitemap = captureResponse();
  await serveSitemap({ response: sitemap, publicHost: 'https://mistboard.com', staticDir });
  assert.match(sitemap.body, /<loc>https:\/\/mistboard\.com\/games<\/loc>/);
  assert.match(sitemap.body, /<loc>https:\/\/mistboard\.com\/games\/search<\/loc>/);
});

test('the /study index carries its own route meta and sitemap entry', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), indexHtml(), 'utf-8');
  const response = captureResponse();
  const served = await serveSpaShellWithRoutePreloads({
    response,
    staticDir,
    pathname: '/study',
    publicHost: 'https://mistboard.com',
  });
  assert.equal(served, true);
  assert.match(response.body, /<title>Xiangqi Studies \| Mistboard<\/title>/);

  const sitemap = captureResponse();
  await serveSitemap({ response: sitemap, publicHost: 'https://mistboard.com', staticDir });
  assert.match(sitemap.body, /<loc>https:\/\/mistboard\.com\/study<\/loc>/);
});
