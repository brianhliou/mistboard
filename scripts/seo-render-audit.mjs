#!/usr/bin/env node
// Render every sitemap page the way Google does and flag the ones a search
// engine would index wrong.
//
// Google runs our client JavaScript before it indexes a page, so a page whose
// server HTML is perfect can still be indexed as whatever the client left on
// screen. On 2026-09-25 Google showed /rules/duck-xiangqi as
// "Articles · Mistboard" with a TypeError for a summary: the client remount
// failed and its error panel replaced a complete prerendered page. Nothing
// else we run renders pages as a crawler, so nothing caught it.
//
// Per URL: the raw HTML (status, title, noindex) and the rendered DOM under a
// Googlebot user agent (title, h1, error panel, uncaught errors).
// `--block-lazy-chunks` also aborts every script the raw HTML does not name,
// which is what a renderer holding a pre-deploy entry bundle sees; a page
// that survives it keeps its content when a chunk goes missing.
//
//   npm run seo:render-audit                          # sitemap-pages.xml, prod
//   npm run seo:render-audit -- --sitemaps all --limit 40
//   npm run seo:render-audit -- --block-lazy-chunks --base http://localhost:3000
//   npm run seo:render-audit -- --url /rules/duck-xiangqi --json out.json
//
// Exit 1 when any page fails; warnings (a rendered title that differs from
// the server's) never fail the run.
import { writeFile } from 'node:fs/promises';
import { launchChromium } from './lib/launch-browser.mjs';

const GOOGLEBOT_UA =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const SITEMAPS = ['pages', 'studies', 'chapters', 'players', 'broadcasts'];
// Titles the client sets as a stand-in while a route loads. Indexed, they
// replace a page's real title in results.
const PLACEHOLDER_TITLES = new Set(['Articles', 'News', 'Mistboard', 'Page failed to load']);

function parseArgs(argv) {
  const args = {
    base: 'https://mistboard.com',
    sitemaps: ['pages'],
    limit: 0,
    urls: [],
    concurrency: 4,
    blockLazyChunks: false,
    json: null,
    timeoutMs: 25_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === '--base') args.base = next().replace(/\/+$/, '');
    else if (flag === '--sitemaps') {
      const value = next();
      args.sitemaps = value === 'all' ? SITEMAPS : value.split(',');
    } else if (flag === '--limit') args.limit = Number(next());
    else if (flag === '--url') args.urls.push(next());
    else if (flag === '--concurrency') args.concurrency = Number(next());
    else if (flag === '--block-lazy-chunks') args.blockLazyChunks = true;
    else if (flag === '--json') args.json = next();
    else if (flag === '--timeout-ms') args.timeoutMs = Number(next());
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

// Sitemaps always name https://mistboard.com; --base points the same paths at
// a local pair or a preview.
function rebase(url, base) {
  const parsed = new URL(url, base);
  return `${base}${parsed.pathname}${parsed.search}`;
}

async function sitemapUrls(base, name, limit) {
  const res = await fetch(`${base}/sitemap-${name}.xml`);
  if (!res.ok) throw new Error(`sitemap-${name}.xml returned ${res.status}`);
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => rebase(m[1], base));
  return limit > 0 ? urls.slice(0, limit) : urls;
}

function baseTitle(title) {
  return (title ?? '').replace(/\s*[|·]\s*Mistboard\s*$/, '').trim();
}

async function fetchServerHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': GOOGLEBOT_UA }, redirect: 'manual' });
  const html = res.status === 200 ? await res.text() : '';
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
  const noindex = /<meta[^>]+name="robots"[^>]+noindex/i.test(html);
  const scripts = new Set(
    [...html.matchAll(/<(?:script[^>]+src|link[^>]+href)="([^"]+\.js)"/g)].map(
      (m) => new URL(m[1], url).pathname,
    ),
  );
  // An empty #app means the client draws the whole page: nothing to fall back
  // to when a chunk fails.
  const prerendered = html !== '' && !/<div id="app">\s*<\/div>/.test(html);
  return {
    status: res.status,
    location: res.headers.get('location'),
    title,
    noindex,
    scripts,
    prerendered,
  };
}

async function auditUrl(browser, url, args) {
  const server = await fetchServerHtml(url);
  const result = {
    url,
    status: server.status,
    serverTitle: server.title,
    failures: [],
    warnings: [],
  };
  if (server.status >= 300 && server.status < 400) {
    result.warnings.push(`redirects to ${server.location}`);
    return result;
  }
  if (server.status !== 200) {
    result.failures.push(`HTTP ${server.status}`);
    return result;
  }
  if (server.noindex) result.warnings.push('server HTML is noindex');

  const context = await browser.newContext({
    userAgent: GOOGLEBOT_UA,
    viewport: { width: 412, height: 915 },
    isMobile: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  if (args.blockLazyChunks) {
    await page.route('**/*.js', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/assets/') && !server.scripts.has(path)) return route.abort();
      return route.continue();
    });
  }
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: args.timeoutMs });
  } catch (err) {
    result.warnings.push(`load: ${err.message.split('\n')[0]}`);
  }
  // A blocked chunk triggers the one-shot stale-chunk reload; let it settle.
  await page.waitForTimeout(args.blockLazyChunks ? 2500 : 800);
  const rendered = await page
    .evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() ?? null,
      errorPanel: document.querySelector('.app-error-panel') !== null,
      appText: (document.querySelector('#app')?.textContent ?? '').trim().length,
    }))
    .catch((err) => ({ evaluateError: err.message }));
  await context.close();

  Object.assign(result, { renderedTitle: rendered.title, h1: rendered.h1, pageErrors });
  if (rendered.evaluateError) result.failures.push(`evaluate: ${rendered.evaluateError}`);
  // With chunks blocked, a client-only page has nothing else to show: that is
  // the known gap (prerender it to close), not a regression.
  const brokenBody = rendered.errorPanel || rendered.appText === 0;
  if (brokenBody && args.blockLazyChunks && !server.prerendered) {
    result.warnings.push('client-only page: a crawler sees the error panel if a chunk fails');
  } else {
    if (rendered.errorPanel) result.failures.push('error panel replaced the page');
    if (rendered.appText === 0) result.failures.push('#app is empty');
  }
  if (!rendered.h1) result.warnings.push('no h1');
  const renderedBase = baseTitle(rendered.title);
  const serverBase = baseTitle(server.title);
  // A placeholder the client put there is a regression; one the server sends
  // is a weak title to rewrite, not a render failure.
  if (PLACEHOLDER_TITLES.has(renderedBase)) {
    if (renderedBase === serverBase) result.warnings.push(`generic title "${server.title}"`);
    else result.failures.push(`placeholder title "${rendered.title}"`);
  } else if (server.title && renderedBase !== serverBase) {
    result.warnings.push(`title changed: "${server.title}" -> "${rendered.title}"`);
  }
  // Chunk errors are the point of --block-lazy-chunks, not a finding.
  const unexpected = args.blockLazyChunks
    ? pageErrors.filter((m) => !/dynamically imported module|preload/i.test(m))
    : pageErrors;
  if (unexpected.length) result.warnings.push(`uncaught: ${unexpected[0]}`);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const urls = args.urls.length
    ? args.urls.map((u) => rebase(u, args.base))
    : (await Promise.all(args.sitemaps.map((s) => sitemapUrls(args.base, s, args.limit)))).flat();
  const browser = await launchChromium();
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        results.push(await auditUrl(browser, url, args));
      } catch (err) {
        results.push({ url, failures: [`audit crashed: ${err.message}`], warnings: [] });
      }
      if (results.length % 25 === 0) console.error(`… ${results.length}/${urls.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, urls.length) }, worker));
  await browser.close();

  results.sort((a, b) => a.url.localeCompare(b.url));
  const failed = results.filter((r) => r.failures.length);
  const warned = results.filter((r) => !r.failures.length && r.warnings.length);
  for (const r of failed) console.log(`FAIL  ${r.url}\n      ${r.failures.join('; ')}`);
  for (const r of warned) console.log(`warn  ${r.url}\n      ${r.warnings.join('; ')}`);
  console.log(
    `\n${results.length} pages${args.blockLazyChunks ? ' (lazy chunks blocked)' : ''}: ` +
      `${failed.length} failed, ${warned.length} warned, ${results.length - failed.length - warned.length} clean`,
  );
  if (args.json) {
    await writeFile(
      args.json,
      `${JSON.stringify({ at: new Date().toISOString(), args, results }, null, 2)}\n`,
    );
  }
  process.exit(failed.length ? 1 : 0);
}

await main();
