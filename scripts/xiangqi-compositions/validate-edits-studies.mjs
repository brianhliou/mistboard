#!/usr/bin/env node
/**
 * Validate seeded studies against the edits file they were seeded from.
 *
 * `validate-studies.mjs` knows 適情雅趣's shapes (第N局 names, six 卷, volume in
 * the comment). The 2026-09-14 manuals are seeded from a reviewed edits file, so
 * the file is the specification: every published chapter must be one of its
 * publish=true records and say the same thing in all three places (English
 * name, zh-Hans name, root comment), and nothing held back may have seeded.
 *
 *   command railway run -s Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node validate-edits-studies.mjs --edits <slug>.edits.json --data <slug>.json --slugs hundred-games-manual'
 *
 * --slugs is the comma-separated list of study slugs the seeder created, in
 * volume order. Read-only; exits non-zero on any problem.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: { edits: { type: 'string' }, slugs: { type: 'string' }, data: { type: 'string' } },
});
if (!values.edits || !values.slugs || !values.data) {
  console.error('usage: validate-edits-studies.mjs --edits <file> --data <slug>.json --slugs <slug,slug>');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set; run through `command railway run -s Postgres`');
  process.exit(1);
}

const edits = JSON.parse(readFileSync(values.edits, 'utf8'));
const slugs = values.slugs.split(',').filter(Boolean);
const bookZh = edits.book?.zh;
const CJK = /[㐀-鿿]/;
// Edits records carry no volume; the mined data does. n is unique per volume,
// not per book, so the lookup is keyed by (vol, n).
// A singleStudy book folds every dpxq volume into one study, so its chapters all live in vol 1.
const single = edits.book?.singleStudy === true;
const volById = new Map(JSON.parse(readFileSync(values.data, 'utf8')).map((r) => [String(r.id), single ? 1 : r.vol]));
const byN = new Map();
// A revised-diagram record (改图) shares its n with the original and is held;
// the seeded chapter is the published one, so that is the one to compare.
for (const [id, rec] of Object.entries(edits.records ?? {})) {
  if (!rec || typeof rec !== 'object') continue;
  const key = `${volById.get(id) ?? 1}:${rec.n}`;
  if (!byN.has(key) || (rec.publish && !byN.get(key).publish)) byN.set(key, { id, ...rec });
}
const publishable = Object.values(edits.records ?? {}).filter((r) => r.publish);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const problems = [];
try {
  let seeded = 0;
  const enSeen = new Map();
  for (const [vi, slug] of slugs.entries()) {
    const vol = vi + 1;
    const study = await client.query(
      'SELECT id, name, description, i18n, visibility FROM studies WHERE slug = $1',
      [slug],
    );
    if (study.rows.length !== 1) {
      problems.push(`${slug}: study not found`);
      continue;
    }
    const s = study.rows[0];
    const chapters = await client.query(
      'SELECT id, name, i18n, root, ordinal FROM study_chapters WHERE study_id = $1 ORDER BY ordinal',
      [s.id],
    );
    const stated = /\b(\d+)\s+(?:classical|endgame|full)/.exec(s.name);
    if (stated && Number(stated[1]) !== chapters.rows.length) {
      problems.push(`${slug}: name says ${stated[1]} but ${chapters.rows.length} chapters exist`);
    }
    for (const locale of ['zh-Hans', 'zh-Hant']) {
      if (!s.i18n?.[locale]?.name || !s.i18n?.[locale]?.description) problems.push(`${slug}: study i18n ${locale} incomplete`);
    }
    if (/—/.test(`${s.name}${s.description}`)) problems.push(`${slug}: em dash in study name or description`);
    console.log(`${slug}  [${s.visibility}]  ${chapters.rows.length} chapters  ${s.name}`);

    const nums = [];
    for (const c of chapters.rows) {
      seeded += 1;
      const where = `${slug}/${c.name}`;
      const m = /^(\d+)\.\s+(.+)$/.exec(c.name);
      if (!m) {
        problems.push(`${where}: name is not "<n>. <Title>"`);
        continue;
      }
      const n = Number(m[1]);
      const en = m[2];
      nums.push(n);
      if (CJK.test(en)) problems.push(`${where}: English title contains Chinese`);
      const rec = byN.get(`${vol}:${n}`);
      if (!rec) {
        problems.push(`${where}: no edits record with n=${n}`);
        continue;
      }
      if (!rec.publish) problems.push(`${where}: record ${rec.id} is publish=false in the edits file`);
      if (rec.en && rec.en !== en) problems.push(`${where}: English "${en}" but edits say "${rec.en}"`);
      const hans = c.i18n?.['zh-Hans']?.name;
      if (!hans) problems.push(`${where}: no zh-Hans name`);
      else if (rec.zh && !hans.includes(rec.zh) && !hans.includes(rec.zh.replace(/（.*）$/, ''))) problems.push(`${where}: zh-Hans "${hans}" does not contain "${rec.zh}"`);
      const hant = c.i18n?.['zh-Hant']?.name;
      if (!hant) problems.push(`${where}: no zh-Hant name`);
      else if (rec.hant && !hant.includes(rec.hant)) problems.push(`${where}: zh-Hant "${hant}" does not contain "${rec.hant}"`);
      const text = c.root?.root?.annotations?.comments?.[0]?.text ?? '';
      if (!text) problems.push(`${where}: no root comment`);
      else {
        if (!text.includes(en)) problems.push(`${where}: comment does not quote its English title`);
        if (bookZh && !new RegExp(`(Problem|Game) ${n} of ${bookZh}`).test(text)) problems.push(`${where}: comment lacks "Problem/Game ${n} of ${bookZh}"`);
        if (!text.includes('dpxq.com')) problems.push(`${where}: comment carries no dpxq credit`);
        if (/https:\/\/www\.dpxq/.test(text)) problems.push(`${where}: dpxq link is https (operator asked for http)`);
        for (const kept of Object.values(rec.prose ?? {})) {
          if (!text.includes(kept)) problems.push(`${where}: kept prose missing from comment: ${kept.slice(0, 20)}`);
        }
        for (const [key, cls] of Object.entries(rec.dropped ?? {})) {
          void key;
          if (cls && /19\d\d年|诠订|内容提要/.test(text)) problems.push(`${where}: comment carries modern editorial text`);
        }
      }
      const prev = enSeen.get(en);
      if (prev && prev.zh !== rec.zh) problems.push(`${where}: English title also used by ${prev.where} (${prev.zh} vs ${rec.zh})`);
      enSeen.set(en, { where, zh: rec.zh });
    }
    const sorted = [...nums].sort((a, b) => a - b);
    const contiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    console.log(`  numbering ${sorted[0]}-${sorted.at(-1)} contiguous=${contiguous}`);
    if (!contiguous) console.log('  (gaps are expected where records were held back)');
  }
  if (seeded !== publishable.length) {
    problems.push(`seeded ${seeded} chapters but the edits file has ${publishable.length} publish=true records`);
  }
} finally {
  await client.end();
}

console.log(`\n${problems.length} problem(s)`);
for (const p of problems.slice(0, 60)) console.log(`  ${p}`);
process.exit(problems.length ? 1 : 0);
