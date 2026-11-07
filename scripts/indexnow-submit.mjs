#!/usr/bin/env node
// Tell Bing (and Yandex, Naver, Seznam, via api.indexnow.org) which URLs to
// crawl. Reads the live sitemap, checks the key file is being served, POSTs
// the URL list in batches. See apps/server/src/indexnow.ts for why.
//
//   npm run indexnow                          # full manual sitemap sweep
//   npm run indexnow -- --changed             # new or changed sitemap URLs
//   npm run indexnow -- --only /zh-hans/      # URLs containing a substring
//   npm run indexnow -- --prerendered         # exclude studies from either mode
//   npm run indexnow -- --dry-run             # preview, never write state
//   npm run indexnow -- --batch 500
//   npm run indexnow -- --base https://mistboard.com
//
// release-prod.mjs runs `--changed` after a deploy's smokes pass, across all
// sitemap sections (pages, studies, players, broadcasts), with no fixed count.
// It compares lastmod with ~/.config/mistboard/indexnow-state.json; URLs with
// no lastmod are sent when new and refreshed only after more than 30 days.
// Missing, unreadable or corrupt state seeds a baseline and sends nothing.
// Baseline timestamps start the 30-day clock, without claiming a submission.
// A baseline always covers the whole sitemap, and only `--changed` writes one:
// a partial baseline would turn the next release into a full submission. So a
// manual sweep with no state records nothing, and an empty section refuses to
// seed (the server answers 200 with no rows when a section's loader fails).
// `--prerendered` remains a scope filter: everything except studies, including
// players and broadcasts. A manual sweep also skips fetching study sections.
//
// Each non-dry run appends a line to ~/.config/mistboard/indexnow-log.jsonl,
// including a zero when nothing changed. State lives beside the log, one file
// per host, because the release has already pushed; a repo record would dirty
// each release.
//
// IndexNow answers 200 (ok) or 202 (accepted, key pending validation) for a
// good batch; only those batches advance state. Failed URLs retry next run.

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

// Read each URL's own lastmod, rather than pairing independent loc/date lists:
// many sitemap entries deliberately have no lastmod.
export function sitemapEntries(xml) {
  return [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/g)].flatMap(([, body]) => {
    const url = locs(body)[0];
    const lastmod = body.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1].trim() || null;
    return url ? [{ url, lastmod }] : [];
  });
}

export function parseIndexNowState(text) {
  try {
    const state = JSON.parse(text);
    if (!state || Array.isArray(state) || typeof state !== 'object') return null;
    for (const entry of Object.values(state)) {
      if (
        !entry ||
        !(entry.lastmod === null || typeof entry.lastmod === 'string') ||
        typeof entry.lastSentAt !== 'string' ||
        !Number.isFinite(Date.parse(entry.lastSentAt))
      ) {
        return null;
      }
    }
    return state;
  } catch {
    return null;
  }
}

// Pure selection; null state means bootstrap, never a full-sweep fallback.
export function selectChangedUrls(entries, state, now) {
  if (state === null) {
    return {
      urls: [],
      state: Object.fromEntries(
        entries.map(({ url, lastmod }) => [url, { lastmod, lastSentAt: now }]),
      ),
      seeded: true,
    };
  }
  const urls = entries.filter(({ url, lastmod }) => {
    const previous = Object.hasOwn(state, url) ? state[url] : null;
    return (
      !previous ||
      lastmod !== previous.lastmod ||
      (lastmod === null && Date.parse(now) - Date.parse(previous.lastSentAt) > REFRESH_MS)
    );
  });
  return { urls, state, seeded: false };
}

export function recordAcceptedBatch(state, entries, status, now) {
  if (status !== 200 && status !== 202) return state;
  return {
    ...state,
    ...Object.fromEntries(entries.map(({ url, lastmod }) => [url, { lastmod, lastSentAt: now }])),
  };
}

export async function main(
  args = process.argv.slice(2),
  {
    fetchImpl = fetch,
    directory = resolve(homedir(), '.config', 'mistboard'),
    now = new Date().toISOString(),
  } = {},
) {
  const { values: a } = parseArgs({
    args,
    options: {
      base: { type: 'string', default: 'https://mistboard.com' },
      only: { type: 'string' },
      changed: { type: 'boolean', default: false },
      prerendered: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      batch: { type: 'string', default: '500' },
    },
  });
  const size = Number(a.batch);
  if (!Number.isInteger(size) || size < 1) throw new Error('--batch wants a positive integer');
  const base = a.base.replace(/\/$/, '');
  const host = new URL(base).host;
  const statePath = resolve(directory, `indexnow-state-${host}.json`);
  const fetchText = async (url) => {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`${url} -> ${response.status}`);
    return response.text();
  };

  // Read both a sitemap index and a legacy plain urlset. Abort on HTTP errors
  // so a failed sitemap fetch can never become an empty bootstrap baseline.
  const root = await fetchText(`${base}/sitemap.xml`);
  const sections = root.includes('<sitemapindex')
    ? await Promise.all(
        locs(root)
          .filter((url) => a.changed || !a.prerendered || !/sitemap-studies/.test(url))
          .map(fetchText),
      )
    : [root];
  const entries = [
    ...new Map(
      sections
        .flatMap(sitemapEntries)
        .filter(({ url }) => new URL(url).host === host)
        .map((entry) => [entry.url, entry]),
    ).values(),
  ];
  const loaded = parseIndexNowState(await readFile(statePath, 'utf8').catch(() => null));
  const plan = a.changed
    ? selectChangedUrls(entries, loaded, now)
    : { urls: entries, state: loaded ?? {}, seeded: false };
  if (plan.seeded && sections.some((xml) => sitemapEntries(xml).length === 0)) {
    throw new Error('a sitemap section is empty: not seeding a partial baseline');
  }
  const keepState = a.changed || loaded !== null;
  let state = plan.state;
  const selected = plan.urls.filter(
    ({ url }) => (!a.only || url.includes(a.only)) && (!a.prerendered || !/\/study\//.test(url)),
  );
  const urls = selected.map(({ url }) => url);
  const selection = [
    a.changed ? 'changed' : '',
    a.only ? `matching ${a.only}` : '',
    a.prerendered ? 'excluding studies' : '',
  ]
    .filter(Boolean)
    .join(', ');
  console.log(`${urls.length} urls from sitemap${selection ? ` (${selection})` : ''}`);
  if (plan.seeded) console.log('state unavailable: seeding current sitemap, submitting nothing');
  if (a['dry-run']) {
    for (const url of urls.slice(0, 20)) console.log(`  ${url}`);
    if (urls.length > 20) console.log(`  ... ${urls.length - 20} more`);
    return 0;
  }
  const saveState = async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${statePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, statePath);
  };
  if (plan.seeded) await saveState();

  let failed = 0;
  let accepted = 0;
  if (selected.length > 0) {
    const { INDEXNOW_KEY } = await import('../apps/server/src/indexnow.ts');
    const keyLocation = `${base}/${INDEXNOW_KEY}.txt`;
    const keyBody = (await fetchText(keyLocation)).trim();
    if (keyBody !== INDEXNOW_KEY) throw new Error(`key file not served: ${keyLocation}`);
    for (let i = 0; i < selected.length; i += size) {
      const batch = selected.slice(i, i + size);
      let response;
      try {
        response = await fetchImpl('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            host,
            key: INDEXNOW_KEY,
            keyLocation,
            urlList: batch.map(({ url }) => url),
          }),
        });
      } catch (error) {
        failed += 1;
        console.error(`batch ${i / size + 1}: request failed: ${error.message}`);
        continue;
      }
      const ok = response.status === 200 || response.status === 202;
      if (ok) {
        accepted += batch.length;
        state = recordAcceptedBatch(state, batch, response.status, now);
        // Persist each acceptance, even if a later batch or the process fails.
        if (keepState) await saveState();
      } else {
        failed += 1;
      }
      console.log(
        `batch ${i / size + 1}: ${batch.length} urls -> ${response.status}${ok ? '' : ` ${await response.text()}`}`,
      );
    }
  }
  await appendLog(directory, {
    at: now,
    base,
    selection: selection || 'all',
    submitted: urls.length,
    accepted,
    failedBatches: failed,
    sample: urls.slice(0, 3),
  });
  return failed ? 1 : 0;
}

async function appendLog(directory, entry) {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(
      resolve(directory, 'indexnow-log.jsonl'),
      `${JSON.stringify(entry)}\n`,
      'utf8',
    );
  } catch (err) {
    // A record that cannot be written is not worth failing a submission over.
    console.error(`could not append the submission log: ${err.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
