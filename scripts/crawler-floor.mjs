import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crawlerCharCount, crawlerFacts } from './lib/crawler-text.mjs';

export const CRAWLER_UA = 'OAI-SearchBot/1.0; Mistboard crawler content floor';

export function crawlerMinimumChars(entry) {
  // Keep recorded minChars intact while comparing weighted content against
  // the weighted baseline and the English-calibrated absolute minimum.
  return Math.max(150, entry.minChars, Math.floor((entry.baselineChars ?? 0) * 0.6));
}

export function pageFailures(entry, { status, html, location }) {
  const facts = crawlerFacts(html, { contentOnly: true });
  if (entry.redirect) {
    const failures = [];
    if (status !== entry.redirect.status)
      failures.push(`HTTP ${status}, expected redirect ${entry.redirect.status}`);
    if (location !== entry.redirect.location)
      failures.push(`Location ${location ?? '(missing)'}, expected ${entry.redirect.location}`);
    return { failures, facts };
  }
  const chars = crawlerCharCount(facts.text);
  const minimum = crawlerMinimumChars(entry);
  const failures = [];
  if (status !== 200) failures.push(`HTTP ${status}`);
  if (chars < minimum) failures.push(`body ${chars} < ${minimum} chars`);
  if (
    !facts.text
      .replace(/\s+/gu, '')
      .toLowerCase()
      .includes(entry.phrase.replace(/\s+/gu, '').toLowerCase())
  )
    failures.push(`missing catalog phrase: ${entry.phrase}`);
  if (entry.kind === 'tool' && !facts.description) failures.push('missing meta description');
  if ((entry.h1 || entry.kind === 'tool') && !facts.h1) failures.push('missing h1');
  if (entry.canonical && !facts.canonical) failures.push('missing canonical');
  for (const lang of entry.hreflang ?? []) {
    if (!facts.alternates.some((alternate) => alternate.lang?.toLowerCase() === lang.toLowerCase()))
      failures.push(`missing hreflang ${lang}`);
  }
  return { failures, facts };
}

export function ratchetFailures(entry, failures) {
  if (!entry.knownGap) return failures;
  return failures.length ? [] : [`remove knownGap ${entry.knownGap}: route now passes`];
}

export async function auditCrawlerRoute(
  entry,
  { base, manifest = [], fetchImpl = fetch, cache = new Map() },
) {
  async function read(path) {
    if (!cache.has(path))
      cache.set(
        path,
        (async () => {
          const response = await fetchImpl(new URL(path, base), {
            redirect: 'manual',
            headers: { 'user-agent': CRAWLER_UA },
            signal: AbortSignal.timeout(15_000),
          });
          return {
            status: response.status,
            location: response.headers.get('location'),
            html: await response.text(),
          };
        })(),
      );
    return cache.get(path);
  }
  try {
    const { failures, facts } = pageFailures(entry, await read(entry.path));
    // One hop is intentional: alternates are checked by their own locale's
    // contract, without recursing through cyclic/self hreflang sets.
    for (const alternate of facts.alternates) {
      if (!alternate.href) {
        failures.push('alternate has no href');
        continue;
      }
      const url = new URL(alternate.href, base);
      if (!['http:', 'https:'].includes(url.protocol)) {
        failures.push(`invalid alternate ${url}`);
        continue;
      }
      const path = url.pathname;
      const target = manifest.find((item) => item.path === path);
      if (!target) {
        failures.push(`alternate ${path} has no manifest contract`);
        continue;
      }
      // Build HTML names the public origin. Fetch the same path on this local
      // built app so CI never reaches production to validate an alternate.
      const result = pageFailures(target, await read(path));
      failures.push(...result.failures.map((failure) => `alternate ${path}: ${failure}`));
    }
    return { path: entry.path, chars: crawlerCharCount(facts.text), failures };
  } catch (error) {
    return { path: entry.path, chars: 0, failures: [`fetch: ${error.message}`] };
  }
}

async function main() {
  const port = Number(process.env.MISTBOARD_CRAWLER_PORT ?? 3197);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('crawler floor requires a strict, nonzero port');
  // Import only compiled server modules. No production DB or secret files.
  delete process.env.DATABASE_URL;
  process.env.MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE = 'true';
  process.env.MISTBOARD_REQUIRE_DATABASE = 'false';
  const { CRAWLER_CONTENT_MANIFEST } = await import(
    '../apps/server/dist/crawler-content-manifest.js'
  );
  const { startServer, stopServer } = await import('../apps/server/dist/index.js');
  const { crawlerFixtureSources } = await import('../apps/server/dist/crawler-content-fixtures.js');
  let server;
  try {
    server = await startServer({
      port,
      host: '127.0.0.1',
      crawlerSources: crawlerFixtureSources(),
    });
  } catch (error) {
    await stopServer().catch(() => {});
    if (error.code === 'EADDRINUSE') {
      console.error(`Crawler floor port ${port} is occupied. Listener:`);
      try {
        console.error(
          execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }),
        );
      } catch {
        try {
          console.error(execFileSync('ss', ['-ltnp', `sport = :${port}`], { encoding: 'utf8' }));
        } catch {
          console.error('listener inspection unavailable');
        }
      }
    }
    throw error;
  }
  try {
    let failed = false;
    const cache = new Map();
    for (const entry of CRAWLER_CONTENT_MANIFEST) {
      const result = await auditCrawlerRoute(entry, {
        base: `http://127.0.0.1:${port}`,
        manifest: CRAWLER_CONTENT_MANIFEST,
        cache,
      });
      const errors = ratchetFailures(entry, result.failures);
      console.log(
        `${errors.length ? 'FAIL' : entry.knownGap ? 'GAP' : 'PASS'} ${entry.path} (${result.chars} chars)${result.failures.length ? `: ${result.failures.join('; ')}` : ''}`,
      );
      for (const error of errors) console.error(`${entry.path}: ${error}`);
      failed ||= errors.length > 0;
    }
    if (failed) process.exitCode = 1;
  } finally {
    await server.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
