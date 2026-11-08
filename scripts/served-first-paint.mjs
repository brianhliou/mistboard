#!/usr/bin/env node
// Served-page guard for the unstyled first paint, two ways a page sent with
// markup in #app can paint before it is styled:
//  - it does not link, in its own HTML, a stylesheet that styles that markup
//    (the /rules flash, 10-16);
//  - the markup is a crawler copy with none of the page's classes, painted as
//    a bare text page until the client replaces it (the /players flash, 10-17).
//    Server copies go through crawlerCopyRoot, which keeps them out of the
//    first paint; anything else this bare is reported.
//
// For the first: The build checks the pages it bakes (prerender-css-coverage.mjs);
// this checks what a server actually answers, which also covers the pages the
// server fills per request (/players, /bots, /study/:id), the ones the build
// never sees. Until 2026-10-17 those linked only the base CSS and painted as
// bare text until the route's chunk brought the rest.
//
// The page list is the sitemap, one or two samples per route shape, plus the
// shapes the sitemap leaves out. The stylesheet universe is every CSS file the
// entry bundle can load (Vite's dependency map), which is exactly the CSS that
// would otherwise arrive late.
//
//   node scripts/served-first-paint.mjs [--base https://mistboard.com] [--per-shape 2] [--json]
//   node scripts/served-first-paint.mjs --base http://127.0.0.1:PORT --manifest-samples
//
// --manifest-samples is for a local server with no database (the crawler-floor
// fixture server): board, puzzle and player samples come from the crawler
// manifest's paths, which that server serves from fixtures, instead of the
// public APIs, which answer 503 without a database. Production keeps the API
// samples.
//
// Exit 1 with one line per page and problem.
import {
  stylesheetSelectors,
  unlinkedMatchingRules,
} from '../apps/web/scripts/prerender-css-coverage.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const base = arg('--base', 'https://mistboard.com').replace(/\/+$/, '');
const perShape = Number(arg('--per-shape', '2'));
const asJson = args.includes('--json');
const manifestSamples = args.includes('--manifest-samples');

// Served with body markup but absent from the sitemap (noindex, or not a page
// a crawler should land on), so they are named here.
export const INDEX_PATHS = ['', '/zh-hans', '/zh-hant'].flatMap((prefix) =>
  ['/blog', '/blog/community', '/rules'].map((path) => `${prefix}${path}`),
);

export const EXTRA_PATHS = [
  ...INDEX_PATHS,
  '/bot/pikafish',
  '/',
  '/players',
  '/players/teams',
  '/bots',
  '/zh-hans/bots',
  '/zh-hant/bots',
  '/study',
  '/puzzles',
  '/player',
  '/watch',
  '/feed',
  '/changelog',
  '/terms',
  '/privacy',
  '/contact',
  '/forum/etiquette',
  '/practice',
  '/analysis/xiangqi',
  '/editor/xiangqi',
  '/import',
  '/games/search',
  '/stats',
  '/data',
  '/coach',
  '/forum',
  '/player/rating-stats',
];

const LOCALES = new Set(['zh-hans', 'zh-hant']);

/** The route shape a path belongs to: its locale prefix and first segment are
 *  kept, every later segment is a parameter. /players/zuo-wenjing and
 *  /players/tony-fung share `/players/*`. */
export function routeShape(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  const head = [];
  if (LOCALES.has(segments[0])) head.push(segments.shift());
  if (segments[0] === 'blog' && segments[1] === 'community' && segments.length === 2)
    return `/${[...head, ...segments].join('/')}`;
  if (segments.length) head.push(segments.shift());
  return `/${[...head, ...segments.map(() => '*')].join('/')}`;
}

/** True when a page's #app holds text a visitor would see painted with none of
 *  the page's classes: markup with no class attribute at all, not wrapped in
 *  the server's `.crawler-copy` (which app-base.css keeps out of the first
 *  paint). */
export function paintsBareCopy(html) {
  const start = html.indexOf('<div id="app"');
  if (start < 0) return false;
  const app = html.slice(start);
  if (/^<div id="app"[^>]*>\s*<div class="crawler-copy">/.test(app)) return false;
  const inner = app.replace(/^<div id="app"[^>]*>/, '');
  if (/\bclass="/.test(inner)) return false;
  const text = inner
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  return text.length > 0;
}

export function boardPageSamples({ games = [], puzzles = [], players = [] }) {
  const historical = games.find((game) => game.kind === 'historical');
  const puzzle = puzzles[0];
  const player = players[0];
  if (!historical?.id || !puzzle?.id || !player?.handle)
    throw new Error(
      'First-paint board coverage needs a public historical game, puzzle and profile',
    );
  return [
    `/historical-xiangqi/game/${encodeURIComponent(historical.id)}`,
    `/puzzles/${encodeURIComponent(puzzle.id)}`,
    `/@/${encodeURIComponent(player.handle)}`,
  ];
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'mistboard-css-coverage' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function sitemapPaths() {
  const index = await fetchText(`${base}/sitemap.xml`);
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const out = [];
  for (const loc of locs(index)) {
    // Child sitemaps carry the production origin; read them from --base so a
    // local or preview check sees its own sitemap, not production's.
    const child = loc.endsWith('.xml')
      ? locs(await fetchText(new URL(new URL(loc).pathname, base).href))
      : [loc];
    for (const url of child) out.push(new URL(url).pathname);
  }
  if (manifestSamples) {
    const { CRAWLER_CONTENT_MANIFEST } = await import(
      '../apps/server/dist/crawler-content-manifest.js'
    );
    out.push(...CRAWLER_CONTENT_MANIFEST.map((entry) => entry.path));
    return out;
  }
  // These shapes have no sitemap section yet (#959). Take public samples from
  // the same APIs the client uses; never probe private/live room state.
  const games = JSON.parse(
    await fetchText(`${base}/api/historical-xiangqi/games?source=archive&limit=1`),
  );
  const puzzles = JSON.parse(await fetchText(`${base}/api/puzzles?variant=xiangqi`));
  const players = JSON.parse(await fetchText(`${base}/api/leaderboard?variant=xiangqi&limit=1`));
  out.push(
    ...boardPageSamples({
      games: games.games,
      puzzles: puzzles.puzzles,
      players: players.leaderboard,
    }),
  );
  return out;
}

/** Every stylesheet the entry bundle can load later: the CSS hrefs named in the
 *  entry script (Vite's preload dependency map lists them all). */
async function lazyStylesheets(shellHtml) {
  const entry = shellHtml.match(/<script[^>]*type="module"[^>]*src="\/?([^"]+)"/)?.[1];
  if (!entry) throw new Error('no module entry script in the shell');
  const js = await fetchText(`${base}/${entry}`);
  const hrefs = new Set();
  for (const m of js.matchAll(/["'](?:\/)?(assets\/[\w.-]+\.css)["']/g)) hrefs.add(m[1]);
  for (const m of shellHtml.matchAll(/href="\/?(assets\/[\w.-]+\.css)"/g)) hrefs.add(m[1]);
  const sheets = new Map();
  for (const href of hrefs)
    sheets.set(href, stylesheetSelectors(await fetchText(`${base}/${href}`)));
  return sheets;
}

async function main() {
  const shell = await fetchText(`${base}/`);
  const stylesheets = await lazyStylesheets(shell);
  const byShape = new Map();
  for (const path of [...EXTRA_PATHS, ...(await sitemapPaths())]) {
    const shape = routeShape(path);
    const list = byShape.get(shape) ?? [];
    if (list.length < perShape && !list.includes(path)) list.push(path);
    byShape.set(shape, list);
  }
  const results = [];
  for (const [shape, paths] of [...byShape].sort()) {
    for (const path of paths) {
      let html;
      try {
        html = await fetchText(`${base}${path}`);
      } catch (err) {
        results.push({ shape, path, error: String(err.message ?? err) });
        continue;
      }
      const hasBody = /<div id="app"[^>]*>(?!<\/div>)/.test(html);
      const misses = hasBody ? unlinkedMatchingRules(html, stylesheets) : [];
      const bare = hasBody && paintsBareCopy(html);
      results.push({ shape, path, hasBody, bare, misses });
    }
  }
  const failing = results.filter((r) => r.misses?.length || r.bare);
  if (asJson) {
    console.log(JSON.stringify({ base, stylesheets: stylesheets.size, results }, null, 2));
  } else {
    const withBody = results.filter((r) => r.hasBody).length;
    console.log(
      `${base}: ${results.length} pages over ${byShape.size} route shapes, ${withBody} sent with markup, ${stylesheets.size} stylesheets`,
    );
    for (const r of results.filter((r) => r.error)) console.log(`  skipped ${r.path}: ${r.error}`);
    for (const r of failing) {
      if (r.bare)
        console.log(`  ${r.path}: paints a classless crawler copy before the page mounts`);
      for (const miss of r.misses) {
        console.log(`  ${r.path}: /${miss.stylesheet} (${miss.selectors.join(' | ')})`);
      }
    }
    if (!failing.length) console.log('  every page sent with markup paints styled');
  }
  if (failing.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
