#!/usr/bin/env node
/**
 * Make every study name's number equal what the seeder will actually seed.
 *
 * The seeder's count is "publish=true AND replays AND has a chapter number";
 * an edits file edited after the merge (a release, a revert) can drift from
 * that, and the seeder refuses the mismatch. This recomputes the seedable count
 * per volume with the same rules and rewrites the names in three locales.
 *
 *   node sync-counts.mjs --dir <corpus dir> [--only slug,slug]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { dir: { type: 'string' }, only: { type: 'string', default: '' } } });
if (!values.dir) {
  console.error('usage: sync-counts.mjs --dir <corpus dir> [--only slug,slug]');
  process.exit(2);
}
const { dir } = values;
const only = new Set(values.only.split(',').filter(Boolean));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const cn = (n) => {
  if (n < 10) return CN[n];
  if (n < 20) return `十${n % 10 ? CN[n % 10] : ''}`;
  if (n < 100) return `${CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ''}`;
  const h = Math.floor(n / 100);
  const r = n % 100;
  return `${CN[h]}百${r === 0 ? '' : r < 10 ? `零${CN[r]}` : cn(r)}`;
};

for (const f of readdirSync(join(dir, 'edits')).filter((x) => x.endsWith('.edits.json')).sort()) {
  const slug = f.replace(/\.edits\.json$/, '');
  if (only.size && !only.has(slug)) continue;
  const path = join(dir, 'edits', f);
  const d = read(path);
  const b = d.book ?? {};
  const err = new Map(read(join(dir, `${slug}.verify.json`)).records.map((r) => [String(r.id), r.error ?? null]));
  const volOf = new Map(read(join(dir, `${slug}.json`)).map((r) => [String(r.id), b.singleStudy ? 1 : r.vol]));
  const per = {};
  let fixedPublish = 0;
  for (const [id, r] of Object.entries(d.records ?? {})) {
    if (!r || typeof r !== 'object') continue;
    if (r.publish && (err.get(id) || r.n === null || r.n === undefined)) {
      r.publish = false;
      r.notes = `${r.notes ? `${r.notes} ` : ''}publish reverted by sync-counts: ${err.get(id) ? 'replay error' : 'no chapter number'}`;
      fixedPublish += 1;
    }
    if (r.publish) per[volOf.get(id) ?? 1] = (per[volOf.get(id) ?? 1] ?? 0) + 1;
  }
  const vols = Array.isArray(b.volumes) ? b.volumes : [];
  const studyFor = (v) => vols[v - 1]?.study ?? (vols.length <= 1 ? b.study : null);
  const changes = [];
  for (const [v, n] of Object.entries(per)) {
    const st = studyFor(Number(v));
    if (!st) continue;
    if (st.en?.name) {
      const next = st.en.name.replace(/\b\d+(\s+(?:classical|endgame|full))/, `${n}$1`);
      if (next !== st.en.name) changes.push(`vol ${v}: ${st.en.name} -> ${next}`);
      st.en.name = next;
    }
    for (const loc of ['zh-Hans', 'zh-Hant']) {
      if (st[loc]?.name) st[loc].name = st[loc].name.replace(/[零一二三四五六七八九十百]+局/, `${cn(n)}局`);
    }
  }
  d.counts = { ...(d.counts ?? {}), publish: Object.values(per).reduce((a, x) => a + x, 0), perVolume: Object.fromEntries(Object.entries(per).map(([k, v]) => [String(k), v])) };
  writeFileSync(path, `${JSON.stringify(d, null, 1)}\n`, 'utf8');
  if (changes.length || fixedPublish) console.log(`${slug}: ${fixedPublish} publish reverted; ${changes.join('; ') || 'names unchanged'}`);
}
