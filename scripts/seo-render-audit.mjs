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
// Per URL: the raw HTML (status, title, noindex, canonical, server h1) and the
// rendered DOM under a Googlebot user agent (title, h1, error panel, uncaught
// errors). A broadcast, player or study URL whose server HTML has neither a
// body in #app nor a canonical fails: until 2026-10-17 all 195 broadcast URLs
// served that empty shell and Search Console filed them as duplicates, while
// this audit passed them because the client drew a page after the fact.
// `--block-lazy-chunks` also aborts every script the raw HTML does not name,
// which is what a renderer holding a pre-deploy entry bundle sees; a page
// that survives it keeps its content when a chunk goes missing.
//
//   npm run seo:render-audit                          # sitemap-pages.xml, prod
//   npm run seo:render-audit -- --sitemaps all --limit 40
//   npm run seo:render-audit -- --block-lazy-chunks --base http://localhost:3000
//   npm run seo:render-audit -- --url /rules/duck-xiangqi --json out.json
//
// The server HTML's meta is checked too (serverMetaFindings): a page other
// than the homepage serving the homepage's title fails, since Bing files it as
// a duplicate of '/' (/terms, /privacy, /contact, /watch and 35 endgame deep
// links did until 2026-10-24). The homepage's description elsewhere, a title
// or description under the length floors, and an <img> with no alt attribute
// warn: the floors are gated where each title is written (seo-meta-length
// tests), and this run is the backstop for data-driven pages.
//
// Exit 1 when any page fails; warnings (a rendered title that differs from
// the server's) never fail the run.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
// The server's copy, not a third one: it imports nothing and its types are
// erasable, so Node (22.18 and later) loads it as it stands.
import { seoMetaLengthProblems } from '../apps/server/src/seo-meta-length.ts';

const GOOGLEBOT_UA =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const SITEMAPS = ['pages', 'studies', 'players', 'broadcasts'];
// Titles the client sets as a stand-in while a route loads. Indexed, they
// replace a page's real title in results.
const PLACEHOLDER_TITLES = new Set(['Articles', 'News', 'Mistboard', 'Page failed to load']);
// apps/web/index.html's own title: what every route without route meta serves,
// and the fallback when the run cannot read the homepage itself.
const SHELL_TITLE = 'Free Online Chinese Chess (Xiangqi) | Mistboard';
const HOME_PATHS = new Set(['/', '/zh-hans', '/zh-hant']);

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

export async function sitemapUrls(
  base,
  name,
  limit,
  { fetchImpl = fetch, wait = delay, timeoutMs = 15_000 } = {},
) {
  const filename = `sitemap-${name}.xml`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let retryable = true;
    try {
      // The deadline covers the response body too, with a fresh signal on
      // every attempt. Transient runner/network failures should get a short,
      // bounded retry; a broken sitemap must still fail the audit.
      const res = await fetchImpl(`${base}/${filename}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        retryable = res.status === 429 || res.status >= 500;
        await res.body?.cancel();
        throw new Error(`${filename} returned ${res.status}`);
      }
      const xml = await res.text();
      const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => rebase(m[1], base));
      return limit > 0 ? urls.slice(0, limit) : urls;
    } catch (error) {
      if (!retryable) throw error;
      if (attempt === 3) {
        throw new Error(`${filename} could not be fetched after 3 attempts`, { cause: error });
      }
      console.warn(`Retrying ${filename} after attempt ${attempt}/3`);
      await wait(attempt * 1000);
    }
  }
}

function baseTitle(title) {
  return (title ?? '').replace(/\s*[|·]\s*Mistboard\s*$/, '').trim();
}

/** What a crawler that does not run the bundle reads in the server HTML. */
export function serverHtmlFacts(html) {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
  const noindex = /<meta[^>]+name="robots"[^>]+noindex/i.test(html);
  const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/)?.[1] ?? null;
  const h1 =
    html
      .match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim() || null;
  // An empty #app means the client draws the whole page: nothing to fall back
  // to when a chunk fails, and nothing for a crawler that does not run it.
  const prerendered = html !== '' && !/<div id="app">\s*<\/div>/.test(html);
  const htmlLang = html.match(/<html[^>]*\slang="([^"]*)"/i)?.[1] || null;
  const description = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1];
  // alt="" is a decorative image and fine; no alt attribute at all is not.
  const imgsMissingAlt = [...html.matchAll(/<img\b[^>]*>/gi)].filter(
    (m) => !/\salt\s*=/i.test(m[0]),
  ).length;
  return {
    title: title === null ? null : decodeEntities(title),
    noindex,
    canonical,
    h1,
    prerendered,
    htmlLang,
    description: description === undefined ? null : decodeEntities(description),
    imgsMissingAlt,
  };
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Meta findings for a 200 response's server HTML, against the homepage's own
 * title and description. A noindexed page is out of search, so none apply.
 */
export function serverMetaFindings(pathname, facts, home = { title: SHELL_TITLE }) {
  const failures = [];
  const warnings = [];
  if (facts.noindex) return { failures, warnings };
  if (!HOME_PATHS.has(pathname.replace(/\/+$/, '') || '/')) {
    if (facts.title && home.title && facts.title === home.title) {
      failures.push(`serves the homepage title "${facts.title}"`);
    }
    if (facts.description && home.description && facts.description === home.description) {
      warnings.push('serves the homepage description');
    }
  }
  if (facts.title !== null || facts.description !== null) {
    for (const problem of seoMetaLengthProblems(pathname, {
      title: facts.title ?? '',
      description: facts.description ?? '',
    })) {
      warnings.push(problem.slice(pathname.length + 2));
    }
  }
  if (facts.imgsMissingAlt > 0) warnings.push(`${facts.imgsMissingAlt} <img> without alt`);
  return { failures, warnings };
}

/** Failures when the client changes the language <html lang> declares. The
 *  vi pages shipped lang="vi" and the client's locale init reset it to "en", so
 *  the rendered page Google indexes said it was English (2026-10-21). Case is
 *  not a change: BCP 47 tags compare case-insensitively. */
export function htmlLangFailures(serverLang, renderedLang) {
  if (!serverLang || !renderedLang) return [];
  if (serverLang.toLowerCase() === renderedLang.toLowerCase()) return [];
  return [`html lang changed: "${serverLang}" -> "${renderedLang}"`];
}

// Pages the server renders for a crawler (broadcast-pages.ts, player-pages.ts,
// the study pages), with or without a locale prefix.
const SERVER_RENDERED_PAGE =
  /^(?:\/zh-han[st])?\/(?:broadcast\/xiangqi(?:\/|$)|players(?:\/|$)|study(?:\/|$))/;

/** Failures for a 200 response's server HTML; empty when it is fine. */
export function serverHtmlFailures(pathname, facts) {
  if (facts.noindex || !SERVER_RENDERED_PAGE.test(pathname)) return [];
  if (!facts.prerendered && !facts.canonical) {
    return ['empty shell: no server-rendered body and no canonical'];
  }
  return [];
}

async function fetchServerHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': GOOGLEBOT_UA }, redirect: 'manual' });
  const html = res.status === 200 ? await res.text() : '';
  const scripts = new Set(
    [...html.matchAll(/<(?:script[^>]+src|link[^>]+href)="([^"]+\.js)"/g)].map(
      (m) => new URL(m[1], url).pathname,
    ),
  );
  return {
    status: res.status,
    location: res.headers.get('location'),
    scripts,
    ...serverHtmlFacts(html),
  };
}

async function auditUrl(browser, url, args) {
  const server = await fetchServerHtml(url);
  const result = {
    url,
    status: server.status,
    serverTitle: server.title,
    canonical: server.canonical,
    serverH1: server.h1,
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
  result.failures.push(...serverHtmlFailures(new URL(url).pathname, server));
  const meta = serverMetaFindings(new URL(url).pathname, server, args.home);
  result.failures.push(...meta.failures);
  result.warnings.push(...meta.warnings);

  const context = await browser.newContext({
    userAgent: GOOGLEBOT_UA,
    viewport: { width: 412, height: 915 },
    isMobile: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
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
      lang: document.documentElement.lang,
      errorPanel: document.querySelector('.app-error-panel') !== null,
      appText: (document.querySelector('#app')?.textContent ?? '').trim().length,
      imgsMissingAlt: document.querySelectorAll('img:not([alt])').length,
    }))
    .catch((err) => ({ evaluateError: err.message }));
  await context.close();

  Object.assign(result, {
    renderedTitle: rendered.title,
    h1: rendered.h1,
    pageErrors,
    navigations,
  });
  if (navigations > 2) result.failures.push(`reload loop: ${navigations} document navigations`);
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
  // The client draws most images; the server-HTML count above sees only the
  // prerendered ones.
  if (rendered.imgsMissingAlt > (server.imgsMissingAlt ?? 0)) {
    result.warnings.push(`${rendered.imgsMissingAlt} rendered <img> without alt`);
  }
  if (!rendered.evaluateError) {
    result.failures.push(...htmlLangFailures(server.htmlLang, rendered.lang));
  }
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

/** The homepage's served title and description, the duplicate check's reference. */
async function homeMeta(base) {
  try {
    const res = await fetch(`${base}/`, { headers: { 'user-agent': GOOGLEBOT_UA } });
    const facts = serverHtmlFacts(res.ok ? await res.text() : '');
    return { title: facts.title ?? SHELL_TITLE, description: facts.description };
  } catch {
    return { title: SHELL_TITLE, description: null };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const urls = args.urls.length
    ? args.urls.map((u) => rebase(u, args.base))
    : (await Promise.all(args.sitemaps.map((s) => sitemapUrls(args.base, s, args.limit)))).flat();
  args.home = await homeMeta(args.base);
  const { launchChromium } = await import('./lib/launch-browser.mjs');
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
