#!/usr/bin/env node
/**
 * Mechanical audit of a book's edits file, and a README skeleton for the operator.
 *
 * Replaces the parts of the 2026-09-13 adversarial audit that were rules rather
 * than reading: completeness against the mined records, publish gating, count
 * consistency across the three study names, em dashes, editorial markers in
 * kept prose, English-title collisions, one-character title pairs, zh-Hant that
 * merely copies the Simplified where a Traditional form exists, and volume/kind
 * shape. What it cannot judge (is this rendering good, is this prose the
 * book's) is exactly what a sampled human or agent read is for; this prints the
 * sample list so that read is short.
 *
 *   node check-edits.mjs --dir <corpus dir> --slug <book> [--readme]
 *
 * --readme writes edits/<slug>.README.md from the file (counts, every held-back
 * record with its reason, one-character title pairs, the sample) when no README
 * exists; an existing README is never overwritten.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    slug: { type: 'string' },
    readme: { type: 'boolean', default: false },
  },
});
if (!values.dir || !values.slug) {
  console.error('usage: check-edits.mjs --dir <corpus dir> --slug <book> [--readme]');
  process.exit(2);
}
const { dir, slug } = values;
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const edits = read(join(dir, 'edits', `${slug}.edits.json`));
const raw = read(join(dir, `${slug}.json`));
const verify = read(join(dir, `${slug}.verify.json`));
const rawById = new Map(raw.map((r) => [String(r.id), r]));
const errById = new Map(verify.records.map((r) => [String(r.id), r.error ?? null]));

const problems = [];
const warnings = [];
const recs = edits.records ?? {};

// completeness
for (const r of raw)
  if (!recs[String(r.id)]) problems.push(`record ${r.id} ${r.title} missing from edits`);
for (const id of Object.keys(recs))
  if (!rawById.has(id)) problems.push(`edits record ${id} is not in the mined data`);

// per record
const SIMPLIFIED_ONLY = /[马车龙凤将来对开关东门长时间说话当会电点边区]/;
const EDITORIAL =
  /(19\d\d年|20\d\d年|诠订|詮訂|内容提要|內容提要|编者|編者|http|www\.|本局即|杨官璘|楊官璘|屠景明|裘望禹)/;
const EM = /—/;
const byVol = {};
const enMap = new Map();
const single = edits.book?.singleStudy === true; // one study for the whole book; volumes fold into 1
let publish = 0;
for (const [id, r] of Object.entries(recs)) {
  if (typeof r !== 'object' || r === null) {
    problems.push(`${id}: record is not an object`);
    continue;
  }
  const vol = single ? 1 : (rawById.get(id)?.vol ?? 1);
  const tag = `${id} ${r.zh ?? '?'}`;
  for (const f of ['n', 'zh', 'hant', 'en', 'sound', 'publish'])
    if (r[f] === undefined) problems.push(`${tag}: missing ${f}`);
  if (r.publish) {
    publish += 1;
    byVol[vol] ??= [];
    byVol[vol].push(r.n);
    if (errById.get(id)) problems.push(`${tag}: publish=true with replay error`);
    if (r.sound === 'suspect') problems.push(`${tag}: publish=true with sound=suspect`);
    if (!r.en) problems.push(`${tag}: publish=true with no English title`);
    if (r.en && /[㐀-鿿]/.test(r.en)) problems.push(`${tag}: English title contains Han script`);
    if (r.en && r.en.split(/\s+/).length > 9)
      warnings.push(`${tag}: English title has ${r.en.split(/\s+/).length} words`);
    if (r.en) {
      const prev = enMap.get(r.en);
      if (prev && prev.zh !== r.zh)
        problems.push(`${tag}: English "${r.en}" also used by ${prev.id} ${prev.zh}`);
      enMap.set(r.en, { id, zh: r.zh });
    }
    if (r.hant === r.zh && SIMPLIFIED_ONLY.test(r.zh))
      warnings.push(`${tag}: hant equals zh but zh has a Simplified-only character`);
  }
  for (const f of ['en', 'gloss', 'notes', 'soundNote'])
    if (typeof r[f] === 'string' && EM.test(r[f])) problems.push(`${tag}: em dash in ${f}`);
  for (const [k, t] of Object.entries(r.prose ?? {})) {
    if (EM.test(t)) problems.push(`${tag}: em dash in prose[${k}]`);
    if (EDITORIAL.test(t))
      problems.push(`${tag}: editorial marker in kept prose[${k}]: ${t.slice(0, 30)}`);
    const src = rawById.get(id)?.comments?.[k];
    if (src === undefined) problems.push(`${tag}: prose[${k}] has no source comment`);
    else if (!src.includes(t.replace(/, /g, '—')) && !src.includes(t))
      warnings.push(`${tag}: prose[${k}] is not verbatim from the record`);
  }
}
// numbering per volume
for (const [v, ns] of Object.entries(byVol)) {
  const sorted = [...ns].sort((a, b) => a - b);
  const dup = sorted.filter((n, i) => i > 0 && n === sorted[i - 1]);
  if (dup.length) problems.push(`vol ${v}: duplicate n ${[...new Set(dup)].join(', ')}`);
}
// one-character pairs among published titles
const pubs = Object.entries(recs).filter(([, r]) => r?.publish);
const pairs = [];
for (let i = 0; i < pubs.length; i += 1) {
  for (let j = i + 1; j < pubs.length; j += 1) {
    const a = pubs[i][1].zh ?? '';
    const b = pubs[j][1].zh ?? '';
    if (a.length === b.length && a.length >= 3) {
      let diff = 0;
      for (let k = 0; k < a.length; k += 1) if (a[k] !== b[k]) diff += 1;
      if (diff === 1) pairs.push(`${a} / ${b}  ->  "${pubs[i][1].en}" / "${pubs[j][1].en}"`);
    }
  }
}

// book block + study copy
const book = edits.book ?? {};
const volumes =
  Array.isArray(book.volumes) && book.volumes.length ? book.volumes : [{ vol: 1, zh: book.zh }];
const studyFor = (v) => volumes[v - 1]?.study ?? (volumes.length === 1 ? book.study : null);
for (const v of Object.keys(byVol).map(Number)) {
  const st = studyFor(v);
  if (!st) {
    problems.push(`vol ${v}: no study block`);
    continue;
  }
  for (const loc of ['en', 'zh-Hans', 'zh-Hant']) {
    if (!st[loc]?.name || !st[loc]?.description)
      problems.push(`vol ${v}: study ${loc} name/description missing`);
    for (const f of ['name', 'description'])
      if (EM.test(st[loc]?.[f] ?? '')) problems.push(`vol ${v}: em dash in study ${loc} ${f}`);
  }
  const m = /\b(\d+)\s+(?:classical|endgame|full)/.exec(st.en?.name ?? '');
  const n = byVol[v].length;
  if (!m) warnings.push(`vol ${v}: English study name carries no "<N> classical/endgame" count`);
  else if (Number(m[1]) !== n) problems.push(`vol ${v}: English name says ${m[1]}, ${n} publish`);
  if (/[㐀-鿿]/.test(st.en?.name ?? ''))
    warnings.push(`vol ${v}: English study name contains Han script`);
}
if (!book.kind) warnings.push('book.kind missing');
if (!book.date) warnings.push('book.date missing');

// sample for the human read: 10% of published, spread, plus every reconciled/flagged title
const sample = pubs
  .filter(
    (_, i) =>
      i % Math.max(1, Math.floor(pubs.length / Math.max(1, Math.round(pubs.length / 10)))) === 0,
  )
  .slice(0, 12);

console.log(
  `${slug}: ${Object.keys(recs).length} records, ${publish} publish; ${problems.length} problem(s), ${warnings.length} warning(s)`,
);
for (const p of problems) console.log(`  PROBLEM ${p}`);
for (const w of warnings.slice(0, 40)) console.log(`  warn ${w}`);
if (pairs.length) {
  console.log(`  one-character title pairs (${pairs.length}):`);
  for (const p of pairs.slice(0, 30)) console.log(`    ${p}`);
}

if (values.readme) {
  const path = join(dir, 'edits', `${slug}.README.md`);
  if (existsSync(path)) {
    console.log(`  README exists, not overwritten: ${path}`);
  } else {
    const held = Object.entries(recs)
      .filter(([, r]) => r && !r.publish)
      .map(
        ([id, r]) =>
          `| ${r.n ?? ''} | ${id} | ${r.zh} | ${errById.get(id) ? 'replay error' : (r.sound ?? '')} | ${(errById.get(id) ?? r.soundNote ?? r.notes ?? '').replace(/\|/g, '/').slice(0, 220)} |`,
      );
    const lines = [
      `# ${book.zh ?? slug} (${slug}): README`,
      '',
      `Generated by check-edits.mjs from \`${slug}.edits.json\`. Nothing here publishes on its own; the operator is shown this list first.`,
      '',
      '## Counts',
      '',
      `| | |`,
      `|---|---|`,
      `| records on dpxq | ${raw.length} |`,
      `| publish | ${publish} |`,
      `| held back | ${Object.keys(recs).length - publish} (suspect ${Object.values(recs).filter((r) => r && !r.publish && r.sound === 'suspect' && !errById.get(String(r.id ?? ''))).length}, replay errors ${verify.records.filter((r) => r.error).length}) |`,
      '',
      `Study: ${volumes.map((_v, i) => studyFor(i + 1)?.en?.name ?? '(no study copy)').join(' / ')}`,
      '',
      '## Held back',
      '',
      '| n | id | title | why | note |',
      '|---|---|---|---|---|',
      ...held,
      '',
      '## One-character title pairs (English must differ)',
      '',
      ...(pairs.length ? pairs.map((p) => `- ${p}`) : ['- none']),
      '',
      '## Sample for a human read (10%)',
      '',
      ...sample.map(
        ([id, r]) =>
          `- ${id} ${r.zh} / ${r.hant} / "${r.en}"${r.gloss ? ` (${r.gloss.slice(0, 120)})` : ''}`,
      ),
      '',
      '## Checks',
      '',
      ...(problems.length ? problems.map((p) => `- PROBLEM ${p}`) : ['- no problems']),
      ...warnings.slice(0, 40).map((w) => `- warn ${w}`),
      '',
    ];
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
    console.log(`  wrote ${path}`);
  }
}
process.exit(problems.length ? 1 : 0);
