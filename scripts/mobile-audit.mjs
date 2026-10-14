#!/usr/bin/env node
// mobile-audit.mjs: mechanical phone-layout check over the site's top page
// templates, with a per-page report.
//
// Where mobile-loop.mjs takes screenshots for a person to read, this asserts
// rules (scripts/lib/mobile-audit-rules.mjs): no sideways page scroll, nothing
// off-screen, tap targets >= 40px, form fields >= 16px (iOS zoom), and on board
// pages whether the board and the previous/next move arrows fit in one screen.
//
// It only reads pages (GETs, no clicks that write), so the prod default is
// safe; analytics is blocked and DNT set so audit loads never reach PostHog's
// mobile numbers.
//
// Usage:
//   npm run mobile:audit                                  # prod, iPhone 13 + Galaxy S8
//   npm run mobile:audit -- --base http://127.0.0.1:3360  # a local pair
//   npm run mobile:audit -- --only broadcast-board,analysis-jieqi
//   npm run mobile:audit -- --device iphone --shots       # + one viewport shot per page
//   npm run mobile:audit -- --list                        # the page list
//   npm run mobile:audit -- --strict                      # exit 1 on any fail
//   npm run mobile:audit -- --path study=/study/abc       # a page's URL on a local pair
//
// Output: tmp/mobile-audit/<stamp>/report.md and report.json (+ shots/).
// Not wired into CI or the release gate (2026-10-14): the first run is a
// backlog, not a baseline. Page list ranked by PostHog mobile pageviews,
// 30 days to 2026-10-14 (docs-private/mobile-audit-2026-10.md).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devices, webkit } from '@playwright/test';

import { resolveBaseUrl } from './lib/base-url.mjs';
import { launchChromium } from './lib/launch-browser.mjs';
import {
  INPUT_FONT_MIN,
  judgePage,
  measurePage,
  TAP_TARGET_MIN,
  TINY_TEXT_PX,
} from './lib/mobile-audit-rules.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEVICES = {
  // Mobile p50 viewport on the site is 393px wide, p10 360px (PostHog, 30d).
  iphone: { name: 'iPhone 13 (WebKit)', engine: 'webkit', descriptor: devices['iPhone 13'] },
  android: { name: 'Galaxy S8 (Chromium)', engine: 'chromium', descriptor: devices['Galaxy S8'] },
};

// Finished games come from the live recent-games feed, so the list never
// points at a deleted room. A resolver returns a path or null (skip).
async function recentGame(base, predicate) {
  try {
    const res = await fetch(new URL('/api/games/recent', base));
    if (!res.ok) return null;
    const { games = [] } = await res.json();
    return games.find(predicate) ?? null;
  } catch {
    return null;
  }
}

// Ordered by mobile pageviews, 30 days to 2026-10-14. `board: true` turns on
// the board + move-arrows rule.
export const PAGES = [
  {
    name: 'room-finished',
    template: 'play/room',
    board: true,
    resolve: async (base) => {
      const g = await recentGame(base, (x) => x.plyCount >= 40);
      return g ? `/room/${g.roomId}` : null;
    },
  },
  { name: 'analysis-jieqi', template: 'analysis', board: true, path: '/analysis/jieqi' },
  { name: 'editor-jieqi', template: 'editor', board: true, path: '/editor/jieqi' },
  { name: 'home', template: 'home', path: '/' },
  { name: 'home-zh-hans', template: 'home', path: '/zh-hans/' },
  {
    name: 'review-jieqi',
    template: 'review',
    board: true,
    resolve: async (base) => {
      const g = await recentGame(base, (x) => x.variant === 'jieqi' && x.plyCount >= 40);
      return g ? `/jieqi/game/${g.roomId}` : null;
    },
  },
  { name: 'article-zh', template: 'article', path: '/zh-hans/blog/jieqi-platform' },
  { name: 'account', template: 'account', path: '/account' },
  { name: 'article-en', template: 'article', path: '/blog/pikafish' },
  { name: 'analysis-xiangqi', template: 'analysis', board: true, path: '/analysis/xiangqi' },
  { name: 'bot-page', template: 'bot', path: '/bot/pikafish' },
  { name: 'study', template: 'study', board: true, path: '/study/vx8oxfxi' },
  { name: 'puzzles', template: 'puzzles', board: true, path: '/puzzles' },
  { name: 'rules-zh-hant', template: 'rules', path: '/zh-hant/rules/banqi' },
  {
    name: 'broadcast-board',
    template: 'broadcast',
    board: true,
    path: '/broadcast/xiangqi/board/2026-asian-individual-men-2026-asian-individual-men-r01-r01t01',
  },
  {
    name: 'broadcast-event',
    template: 'broadcast',
    path: '/broadcast/xiangqi/2026-asian-individual-men',
  },
  { name: 'rules-en', template: 'rules', path: '/rules/jieqi' },
  {
    name: 'review-xiangqi',
    template: 'review',
    board: true,
    resolve: async (base) => {
      const g = await recentGame(base, (x) => x.variant === 'xiangqi' && x.plyCount >= 40);
      return g ? `/xiangqi/game/${g.roomId}` : null;
    },
  },
  { name: 'watch', template: 'watch', path: '/watch' },
  { name: 'feed', template: 'feed', path: '/feed' },
  { name: 'correspondence', template: 'correspondence', path: '/correspondence' },
  { name: 'games-search', template: 'games', path: '/games/search' },
  { name: 'play', template: 'play/room', path: '/play' },
  { name: 'blog-index', template: 'article', path: '/blog' },
];

function parseArgs(argv) {
  const args = {
    base: undefined,
    only: null,
    devices: ['iphone', 'android'],
    shots: false,
    strict: false,
    list: false,
    concurrency: 3,
    settleMs: 2500,
    navWaitMs: 10_000,
    paths: new Map(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--base') args.base = next();
    else if (a === '--only')
      args.only = new Set(
        next()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else if (a === '--device') {
      const v = next();
      args.devices = v === 'all' ? ['iphone', 'android'] : v.split(',').map((s) => s.trim());
      for (const d of args.devices)
        if (!DEVICES[d]) throw new Error(`unknown device ${d} (iphone, android, all)`);
    } else if (a === '--shots') args.shots = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--list') args.list = true;
    else if (a === '--concurrency')
      args.concurrency = Math.max(1, Number.parseInt(next(), 10) || 1);
    else if (a === '--path') {
      // A local pair has no prod study slug and few long games in its recent
      // feed: point a page at a row that exists there (--path study=/study/abc).
      const v = next();
      const eq = v.indexOf('=');
      if (eq < 1 || !v.slice(eq + 1).startsWith('/'))
        throw new Error(`--path wants <page>=/path (got ${v})`);
      args.paths.set(v.slice(0, eq), v.slice(eq + 1));
    } else if (a === '--settle-ms') args.settleMs = Math.max(0, Number.parseInt(next(), 10) || 0);
    else if (a === '--help' || a === '-h') {
      console.log(readHelp());
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

function readHelp() {
  return [
    'npm run mobile:audit -- [--base URL] [--only a,b] [--device iphone|android|all]',
    '                        [--shots] [--strict] [--list] [--concurrency N] [--settle-ms MS]',
    '                        [--path <page>=/path ...]   (override a page URL, e.g. on a local pair)',
    '',
    'Pages:',
    ...PAGES.map(
      (p) =>
        `  ${p.name.padEnd(18)} ${p.template.padEnd(14)} ${p.path ?? '(resolved from /api/games/recent)'}`,
    ),
  ].join('\n');
}

const BOARD_NAV_SELECTOR =
  '.move-nav-bar__button, [aria-label="Next move"], [aria-label="Previous move"]';

// PostHog, direct or through a same-origin /ingest proxy.
const ANALYTICS_HOST = /posthog|\/ingest\//i;

async function auditPage(context, base, page, args, shotsDir, deviceKey) {
  const viewport = DEVICES[deviceKey].descriptor.viewport;
  const path = args.paths.get(page.name) ?? page.path ?? (await page.resolve(base));
  if (!path)
    return {
      page: page.name,
      template: page.template,
      device: deviceKey,
      skipped: 'no URL resolved',
    };
  const tab = await context.newPage();
  const url = new URL(path, base).toString();
  try {
    const res = await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await tab.waitForLoadState('load', { timeout: 20_000 }).catch(() => {});
    await tab.waitForTimeout(args.settleMs);
    if (page.board) {
      // The move tree and its arrow bar mount after the game record loads,
      // seconds after `load` on a busy tab. Give them a bounded wait; a page
      // with no arrows (the editor) just times out and is judged as it is.
      await tab
        .waitForSelector(BOARD_NAV_SELECTOR, { state: 'visible', timeout: args.navWaitMs })
        .catch(() => {});
    }
    const status = res?.status() ?? 0;
    const measured = await tab.evaluate(measurePage, {
      tapMin: TAP_TARGET_MIN,
      inputFontMin: INPUT_FONT_MIN,
      tinyTextPx: TINY_TEXT_PX,
      deviceWidth: viewport.width,
      deviceHeight: viewport.height,
    });
    const judged = judgePage(measured, { boardPage: Boolean(page.board) });
    let shot = null;
    if (shotsDir) {
      shot = join(shotsDir, `${deviceKey}-${page.name}.png`);
      await tab.screenshot({ path: shot });
    }
    return {
      page: page.name,
      template: page.template,
      device: deviceKey,
      url: path,
      status,
      ...judged,
      measured,
      shot,
    };
  } catch (error) {
    return {
      page: page.name,
      template: page.template,
      device: deviceKey,
      url: path,
      error: String(error?.message ?? error).split('\n')[0],
    };
  } finally {
    await tab.close().catch(() => {});
  }
}

async function runDevice(deviceKey, base, pages, args, shotsDir) {
  const device = DEVICES[deviceKey];
  const browser = device.engine === 'webkit' ? await webkit.launch() : await launchChromium();
  const { defaultBrowserType: _ignored, ...descriptor } = device.descriptor;
  // A fresh context per page: a zh page stores the locale, and every later
  // page in a shared context would render in Chinese (and its arrows lose the
  // English labels the board rule looks for).
  const newContext = async () => {
    const context = await browser.newContext({ ...descriptor, extraHTTPHeaders: { DNT: '1' } });
    await context.addInitScript(() => {
      try {
        Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' });
      } catch {}
    });
    await context.route(
      (u) => ANALYTICS_HOST.test(u.href),
      (route) => route.abort(),
    );
    return context;
  };
  const results = [];
  const queue = [...pages];
  const workers = Array.from({ length: Math.min(args.concurrency, queue.length) }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const context = await newContext();
      const r = await auditPage(context, base, p, args, shotsDir, deviceKey);
      await context.close().catch(() => {});
      process.stdout.write(
        `  ${deviceKey.padEnd(8)} ${p.name.padEnd(18)} ${r.skipped ? 'skip' : r.error ? 'ERROR' : r.verdict}\n`,
      );
      results.push(r);
    }
  });
  await Promise.all(workers);
  await browser.close();
  const order = new Map(pages.map((p, i) => [p.name, i]));
  return results.sort((a, b) => order.get(a.page) - order.get(b.page));
}

function boardCell(r) {
  const b = r.boardNav;
  if (!b) return '';
  if (b.status === 'fits') return `fits (${b.span}/${b.vh})`;
  if (b.status === 'split') return `**split** ${b.span}/${b.vh}px, arrows +${b.gap}px`;
  return b.status;
}

export function renderMarkdown(base, results, startedAt) {
  const lines = [
    `# Mobile audit ${startedAt}`,
    '',
    `Base: ${base.origin}. Rules: scripts/lib/mobile-audit-rules.mjs.`,
    '',
    '| page | template | device | verdict | fails | warns | board + arrows |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    const verdict = r.skipped ? `skip: ${r.skipped}` : r.error ? `ERROR: ${r.error}` : r.verdict;
    lines.push(
      `| ${r.page} | ${r.template} | ${r.device} | ${verdict} | ${r.fails ?? ''} | ${r.warns ?? ''} | ${boardCell(r)} |`,
    );
  }
  lines.push('');
  for (const r of results) {
    if (!r.findings?.length) continue;
    lines.push(`## ${r.page} (${r.device}) ${r.url}`, '');
    for (const f of r.findings) lines.push(`- **${f.severity}** \`${f.rule}\`: ${f.detail}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    console.log(readHelp());
    return;
  }
  const base = resolveBaseUrl(args.base);
  const pages = args.only ? PAGES.filter((p) => args.only.has(p.name)) : PAGES;
  if (args.only) {
    const unknown = [...args.only].filter((n) => !PAGES.some((p) => p.name === n));
    if (unknown.length)
      throw new Error(`unknown page(s): ${unknown.join(', ')} (--list shows them)`);
  }
  const startedAt = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join(REPO_ROOT, 'tmp', 'mobile-audit', startedAt);
  const shotsDir = args.shots ? join(outDir, 'shots') : null;
  await mkdir(shotsDir ?? outDir, { recursive: true });

  console.log(
    `mobile audit: ${pages.length} page(s) x ${args.devices.join(', ')} on ${base.origin}`,
  );
  const results = [];
  for (const d of args.devices) results.push(...(await runDevice(d, base, pages, args, shotsDir)));

  await writeFile(
    join(outDir, 'report.json'),
    `${JSON.stringify({ base: base.origin, startedAt, results }, null, 2)}\n`,
  );
  const md = renderMarkdown(base, results, startedAt);
  await writeFile(join(outDir, 'report.md'), `${md}\n`);

  const fails = results.filter((r) => r.verdict === 'fail').length;
  const warns = results.filter((r) => r.verdict === 'warn').length;
  const errors = results.filter((r) => r.error).length;
  console.log(`\n${fails} fail, ${warns} warn, ${errors} error of ${results.length} page loads`);
  console.log(`report: ${join(outDir, 'report.md')}`);
  if (args.strict && (fails || errors)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
