#!/usr/bin/env node
// Tell Bing (and Yandex, Naver, Seznam, via api.indexnow.org) which URLs to
// crawl. Reads the live sitemap, checks the key file is being served, POSTs
// the URL list in batches. See apps/server/src/indexnow.ts for why.
//
//   npm run indexnow                          # every sitemap URL
//   npm run indexnow -- --only /zh-hans/      # URLs containing a substring
//   npm run indexnow -- --dry-run
//   npm run indexnow -- --base https://mistboard.com
//
// IndexNow answers 200 (ok) or 202 (accepted, key pending validation) for a
// good batch; 422 means a URL is off-host, 403 means the key file did not
// verify. Re-submitting unchanged URLs is harmless but pointless; run this
// after a release that adds or rewrites prerendered pages.

import { parseArgs } from 'node:util';

const { INDEXNOW_KEY } = await import('../apps/server/src/indexnow.ts');

const { values: a } = parseArgs({
  options: {
    base: { type: 'string', default: 'https://mistboard.com' },
    only: { type: 'string' },
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
urls = [...new Set(urls)].filter((u) => new URL(u).host === host);
console.log(`${urls.length} urls from sitemap${a.only ? ` matching ${a.only}` : ''}`);
if (urls.length === 0) process.exit(0);
if (a['dry-run']) {
  for (const u of urls.slice(0, 20)) console.log(`  ${u}`);
  if (urls.length > 20) console.log(`  ... ${urls.length - 20} more`);
  process.exit(0);
}

const size = Number(a.batch);
let failed = 0;
for (let i = 0; i < urls.length; i += size) {
  const urlList = urls.slice(i, i + size);
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation, urlList }),
  });
  const ok = res.status === 200 || res.status === 202;
  if (!ok) failed += 1;
  console.log(
    `batch ${i / size + 1}: ${urlList.length} urls -> ${res.status}${ok ? '' : ` ${await res.text()}`}`,
  );
}
process.exit(failed ? 1 : 0);
