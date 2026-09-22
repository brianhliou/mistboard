#!/usr/bin/env node
// Tell Bing (and Yandex, Naver, Seznam, via api.indexnow.org) which URLs to
// crawl. Reads the live sitemap, checks the key file is being served, POSTs
// the URL list in batches. See apps/server/src/indexnow.ts for why.
//
//   npm run indexnow                          # every sitemap URL
//   npm run indexnow -- --only /zh-hans/      # URLs containing a substring
//   npm run indexnow -- --prerendered         # skip /study (the release set)
//   npm run indexnow -- --dry-run
//   npm run indexnow -- --base https://mistboard.com
//
// release-prod.mjs runs `--prerendered` after a deploy's smokes pass: the
// static routes and every article, in three languages, about a hundred URLs.
// Studies are left out of that set because there are thousands of them, they
// change on their own schedule rather than a release's, and re-announcing them
// every deploy is noise; sweep them by hand with `--only /study` when the
// library grows.
//
// Each run appends a line to ~/.config/mistboard/indexnow-log.jsonl. The log
// lives beside the machine rather than in the repo for the same reason the
// tweet ledger does: the release has already pushed by the time this runs, so
// an in-repo record would leave every release with a file to commit again.
//
// IndexNow answers 200 (ok) or 202 (accepted, key pending validation) for a
// good batch; 422 means a URL is off-host, 403 means the key file did not
// verify. Re-submitting unchanged URLs is harmless but pointless; run this
// after a release that adds or rewrites prerendered pages.

import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { INDEXNOW_KEY } = await import('../apps/server/src/indexnow.ts');

const { values: a } = parseArgs({
  options: {
    base: { type: 'string', default: 'https://mistboard.com' },
    only: { type: 'string' },
    prerendered: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    batch: { type: 'string', default: '500' },
  },
});

const base = a.base.replace(/\/$/, '');
const host = new URL(base).host;
const keyLocation = `${base}/${INDEXNOW_KEY}.txt`;

const keyRes = await fetch(keyLocation);
const keyBody = (await keyRes.text()).trim();
if (!keyRes.ok || keyBody !== INDEXNOW_KEY) {
  console.error(
    `key file not served: ${keyLocation} -> ${keyRes.status} ${JSON.stringify(keyBody.slice(0, 40))}`,
  );
  process.exit(1);
}

const sitemap = await fetch(`${base}/sitemap.xml`).then((r) => r.text());
let urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (a.only) urls = urls.filter((u) => u.includes(a.only));
if (a.prerendered) urls = urls.filter((u) => !/\/study\//.test(u));
urls = [...new Set(urls)].filter((u) => new URL(u).host === host);
const selection = [a.only ? `matching ${a.only}` : '', a.prerendered ? 'prerendered only' : '']
  .filter(Boolean)
  .join(', ');
console.log(`${urls.length} urls from sitemap${selection ? ` (${selection})` : ''}`);
if (urls.length === 0) process.exit(0);
if (a['dry-run']) {
  for (const u of urls.slice(0, 20)) console.log(`  ${u}`);
  if (urls.length > 20) console.log(`  ... ${urls.length - 20} more`);
  process.exit(0);
}

const size = Number(a.batch);
let failed = 0;
let accepted = 0;
for (let i = 0; i < urls.length; i += size) {
  const urlList = urls.slice(i, i + size);
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation, urlList }),
  });
  const ok = res.status === 200 || res.status === 202;
  if (ok) accepted += urlList.length;
  else failed += 1;
  console.log(
    `batch ${i / size + 1}: ${urlList.length} urls -> ${res.status}${ok ? '' : ` ${await res.text()}`}`,
  );
}
await appendLog({
  at: new Date().toISOString(),
  base,
  selection: selection || 'all',
  submitted: urls.length,
  accepted,
  failedBatches: failed,
  sample: urls.slice(0, 3),
});
process.exit(failed ? 1 : 0);

async function appendLog(entry) {
  const dir = resolve(homedir(), '.config', 'mistboard');
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await appendFile(resolve(dir, 'indexnow-log.jsonl'), `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch (err) {
    // A record that cannot be written is not worth failing a submission over.
    console.error(`could not append the submission log: ${err.message}`);
  }
}
