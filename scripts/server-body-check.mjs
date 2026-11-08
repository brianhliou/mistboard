// Socketless build guard for request-time bodies. Inspect the real shell and
// fixture-backed server responses, including pages the prerender build cannot see.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crawlerDocument } from './lib/crawler-text.mjs';

export function serverBodyProblems(html, css) {
  const doc = crawlerDocument(html);
  const app = doc.querySelector('#app');
  if (!app?.textContent?.trim()) return [];
  const problems = [];
  const copy = app.cloneNode(true);
  for (const node of copy.querySelectorAll('.crawler-copy,script,style,template')) node.remove();
  if (copy.textContent.trim()) problems.push('server body text outside .crawler-copy');
  if (!/\.crawler-copy\s*\{[^}]*animation\s*:\s*crawler-copy-reveal\s+0s\s+4s\s+both/s.test(css))
    problems.push('crawler-copy first-paint stylesheet is not linked');
  return problems;
}

export async function checkServerBodies(staticDir = resolve('apps/web/dist')) {
  await import('../apps/server/dist/variant-tenant/register-tenants.js');
  const { CRAWLER_CONTENT_MANIFEST } = await import(
    '../apps/server/dist/crawler-content-manifest.js'
  );
  const { crawlerFixtureSources } = await import('../apps/server/dist/crawler-content-fixtures.js');
  const { serveSpaShellWithRoutePreloads, serveStudyPage } = await import(
    '../apps/server/dist/server-static-pages.js'
  );
  const sources = crawlerFixtureSources();
  const entries = CRAWLER_CONTENT_MANIFEST.filter((e) =>
    ['server-body', 'db-fixture'].includes(e.source),
  );
  const problems = [];
  for (const entry of entries) {
    let html = '';
    const response = {
      writeHead() {},
      end(body) {
        html = body ?? '';
      },
    };
    const study = /^\/(?:(zh-hans|zh-hant)\/)?study\/([^/]+)(?:\/([^/]+))?$/.exec(entry.path);
    if (study) {
      await serveStudyPage({
        response,
        staticDir,
        publicHost: 'https://mistboard.test',
        studyId: study[2],
        chapterId: study[3],
        localeSlug: study[1] ?? 'en',
        getStudy: sources.getStudy,
      });
    } else {
      const url = new URL(entry.path, 'https://mistboard.test');
      await serveSpaShellWithRoutePreloads({
        ...sources,
        response,
        staticDir,
        pathname: url.pathname,
        search: url.search,
        publicHost: url.origin,
      });
    }
    const doc = crawlerDocument(html);
    let css = '';
    for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
      const href = link.getAttribute('href');
      if (href && !/^(https?:)?\/\//.test(href))
        css += await readFile(resolve(staticDir, href.replace(/^\//, '')), 'utf8');
    }
    problems.push(...serverBodyProblems(html, css).map((p) => `${entry.path}: ${p}`));
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return entries.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkServerBodies()
    .then((n) =>
      console.log(`Server bodies: ${n} fixture pages wrapped and first-paint CSS linked`),
    )
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
