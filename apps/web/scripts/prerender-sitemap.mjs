// Record immutable source dates and the actual head alternates, never dist mtimes.
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { relative, resolve } from 'node:path';
import { Window } from 'happy-dom';
import { crawlerCharCount, crawlerContentText } from '../../../scripts/lib/crawler-text.mjs';

const window = new Window({
  settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true },
});

export function prerenderSitemapRecord(html, file, publicHost, sourceDate, knownGaps = new Set()) {
  const doc = new window.DOMParser().parseFromString(html, 'text/html');
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (
    !canonical ||
    /noindex/i.test(doc.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '')
  )
    return null;
  const url = new URL(canonical, publicHost);
  // Decided 2026-11-07: tracked gaps stay discoverable to rendering search engines.
  // Untracked shells still cannot become sitemap candidates.
  const contentChars = crawlerCharCount(crawlerContentText(html));
  if (
    !knownGaps.has(url.pathname) &&
    (!doc.querySelector('h1')?.textContent?.trim() || contentChars < 150)
  )
    return null;
  if (url.origin !== new URL(publicHost).origin)
    throw new Error(`foreign prerender canonical: ${canonical}`);
  const ldDate =
    /"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ??
    /"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
  // undefined means the build has no repository history (Railway builds from a
  // snapshot with no .git): the page is listed without <lastmod>, never with an
  // invented date. Anything else that is not a date is a broken source.
  const lastmod = ldDate ?? sourceDate(url.pathname);
  if (lastmod !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(lastmod))
    throw new Error(`missing source-content date: ${url.pathname}`);
  const alternates = [...doc.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => {
    const target = new URL(link.getAttribute('href'), publicHost);
    if (target.origin !== url.origin) throw new Error(`foreign prerender alternate: ${target}`);
    return { lang: link.getAttribute('hreflang'), path: target.pathname + target.search };
  });
  return { path: url.pathname, file, lastmod, alternates, contentChars };
}

export function contentSources(path) {
  const locale = /^\/(zh-hans|zh-hant)(?:\/|$)/.exec(path)?.[1];
  const base = path.replace(/^\/zh-han[st](?=\/|$)/, '') || '/';
  const catalog = `apps/web/src/i18n/catalogs/content${locale ? `.${locale}` : ''}.ts`;
  const shell = `apps/web/src/i18n/catalogs/shell${locale ? `.${locale}` : ''}.ts`;
  const sources = {
    '/': [shell, 'apps/web/src/announcements.ts', 'apps/web/src/articles/content'],
    '/blog': [catalog, 'apps/web/src/articles/content', 'apps/web/src/article-i18n.ts'],
    '/rules': [catalog, 'apps/web/src/articles/content', 'apps/web/src/article-i18n.ts'],
    '/feed': ['apps/web/src/announcements.ts', 'apps/web/src/articles/content'],
    '/changelog': ['CHANGELOG.md'],
    '/washington-xiangqi': [catalog, 'apps/web/src/club-washington-page.ts'],
    '/learn/xiangqi': [
      'apps/web/src/learn-xiangqi/learn-copy.ts',
      'apps/web/src/learn-xiangqi/learn-copy-zh.ts',
    ],
  };
  if (base.startsWith('/changelog/')) return sources['/changelog'];
  if (base.startsWith('/feed/')) return sources['/feed'];
  return sources[base] ?? [catalog];
}

/** True when repoRoot is inside a git work tree. A source snapshot with no
 *  .git (the Railway build) has no history, so it has no content dates. */
export function gitHistoryAvailable(repoRoot) {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
}

export function gitContentDate(repoRoot, sources) {
  // A missing history must fail explicitly instead of inventing a deploy date.
  const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...sources], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`no git content date for ${sources.join(', ')}`);
  return date;
}

export async function writePrerenderSitemap(distDir, publicHost, repoRoot, trackedGaps = []) {
  const records = [];
  const knownGaps = new Set(trackedGaps.map((entry) => entry.path));
  const dates = new Map();
  // With history, a source with no date still fails the build; with none, every
  // date is left out rather than taken from mtimes or the deploy clock.
  const history = gitHistoryAvailable(repoRoot);
  const datedBy = (sources) => (history ? gitContentDate(repoRoot, sources) : undefined);
  const sourceDate = (path) => {
    const sources = contentSources(path);
    const key = sources.join('\n');
    if (!dates.has(key)) dates.set(key, datedBy(sources));
    return dates.get(key);
  };
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory() && ['blog', 'rules', 'zh-hans', 'zh-hant'].includes(entry.name))
        await visit(file);
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      const record = prerenderSitemapRecord(
        await fs.readFile(file, 'utf8'),
        relative(distDir, file),
        publicHost,
        sourceDate,
        knownGaps,
      );
      if (record) records.push(record);
    }
  }
  await visit(distDir);
  await fs.writeFile(
    resolve(distDir, 'puzzle-content-date.json'),
    JSON.stringify({ lastmod: datedBy(['packages/game/seed']) }),
  );
  // leaderboard.html is an alias whose canonical is /player.
  records.push({
    path: '/games',
    lastmod: datedBy(['apps/server/src/server-static-pages.ts']),
    alternates: [],
  });
  const unique = new Map(records.map((record) => [record.path, record]));
  // Server-only gaps have no prerender artifact. Keep their source date and
  // locale group in the sidecar without claiming a rendered body exists.
  for (const entry of trackedGaps) {
    if (!unique.has(entry.path))
      unique.set(entry.path, { ...entry, lastmod: sourceDate(entry.path) });
  }
  await fs.writeFile(
    resolve(distDir, 'prerender-sitemap.json'),
    `${JSON.stringify([...unique.values()])}\n`,
  );
}
