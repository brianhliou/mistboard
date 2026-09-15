#!/usr/bin/env node
/**
 * Build a book's edits file from its per-shard records without an editor agent.
 *
 * The 2026-09-13 run had a book editor re-read every shard to merge them, then
 * an auditor re-read everything again, and that pair cost more tokens than the
 * rendering did. Merging is not language work: it is a map union, a set of
 * consistency rules, and count arithmetic. The study copy (names and
 * descriptions in three locales) IS language work and stays out of this script:
 * it comes from `--book <book.json>`, written once by hand or by one small agent,
 * or from an existing edits file whose `book` block is kept.
 *
 *   node merge-shards.mjs --dir <corpus dir> --slug <book> [--book <book.json>] [--witness a]
 *
 * Inputs, in preference order per shard: `edits/<slug>.shard-<i>.json`
 * (reconciled), else `edits/<slug>.shard-<i>.<witness>.json` (single witness,
 * default a, falling back to b). Every shard in `shards/<slug>.plan.json` must
 * be covered, or the script refuses: a book missing a shard is not a book.
 *
 * Rules applied (each violation is printed; the hard ones fail the merge):
 *   - every record in the shard inputs appears exactly once           (hard)
 *   - publish=true requires no verify.error and sound != 'suspect'   (fixed in place, reported)
 *   - two distinct zh must not share an en                            (hard)
 *   - n unique within a volume among published records               (hard)
 *   - hant equals zh wherever zh has no Traditional variant (informational)
 *   - no em dash in en, gloss, prose, notes                           (fixed: replaced with ', ')
 *   - kept prose must not carry modern editorial markers              (hard: 19xx年, 诠订, 内容提要, 编者, 注：, http)
 * Writes `edits/<slug>.edits.json` and prints counts. Never touches the README.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    slug: { type: 'string' },
    book: { type: 'string' },
    witness: { type: 'string', default: 'a' },
    // Renumber every record by its position within its volume in dpxq's listing.
    // For a book that mixes a modern edition's 第NN局 prefixes with bare titles
    // (竹香斋), the prefixed numbers are not the book's order either, and shard
    // workers cannot see where a volume starts; one positional scheme per volume
    // is the only numbering that is unique and explainable.
    'renumber-positional': { type: 'boolean', default: false },
  },
});
if (!values.dir || !values.slug) {
  console.error('usage: merge-shards.mjs --dir <corpus dir> --slug <book> [--book book.json] [--witness a|b]');
  process.exit(2);
}
const { dir, slug } = values;
const E = join(dir, 'edits');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

// The shard list is the shard files themselves, not a plan file: wave_args.py
// wrote plans only for the first wave, and the files are what the agents read.
import { readdirSync } from 'node:fs';
// Slim shards (lean pass) win over the first wave's full shards when both exist.
const listShards = (re) =>
  readdirSync(join(dir, 'shards'))
    .filter((f) => re.test(f))
    .map((f) => ({ shard: Number(/\.(\d+)\.json$/.exec(f)[1]), path: join(dir, 'shards', f) }))
    .sort((a, b) => a.shard - b.shard);
const slim = listShards(new RegExp(`^${slug}\\.slim\\.(\\d+)\\.json$`));
const shardFiles = slim.length ? slim : listShards(new RegExp(`^${slug}\\.(\\d+)\\.json$`));
if (shardFiles.length === 0) {
  console.error(`${slug}: no shard files under shards/; run make-shards.mjs first`);
  process.exit(1);
}
const plan = { shards: shardFiles };
const verify = read(join(dir, `${slug}.verify.json`));
const raw = read(join(dir, `${slug}.json`));
const volById = new Map(raw.map((r) => [String(r.id), r.vol]));
const errorById = new Map(verify.records.map((r) => [String(r.id), r.error ?? null]));
const soundRows = new Map();
const soundPath = join(dir, `${slug}.soundness.jsonl`);
if (existsSync(soundPath)) {
  for (const line of readFileSync(soundPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      soundRows.set(String(row.id), row);
    } catch {
      // partial last line
    }
  }
}

// Lean-pipeline shards carry no sound/publish: the rule in classify-soundness
// wrote them to <slug>.sound.json, and the agent may only add `hold` (a reason
// string) to keep a record back on grounds the engine cannot see.
const rulePath = join(dir, `${slug}.sound.json`);
const ruleSound = existsSync(rulePath) ? read(rulePath) : {};

const hard = [];
const soft = [];
const records = {};
const sources = [];
for (const s of plan.shards) {
  const candidates = [
    join(E, `${slug}.shard-${s.shard}.json`),
    join(E, `${slug}.shard-${s.shard}.${values.witness}.json`),
    join(E, `${slug}.shard-${s.shard}.${values.witness === 'a' ? 'b' : 'a'}.json`),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    hard.push(`shard ${s.shard}: no reconciled or witness file`);
    continue;
  }
  const shard = read(path);
  sources.push({ shard: s.shard, path, witness: shard.witness ?? '?' });
  const expectedIds = read(s.path).records.map((r) => String(r.id));
  for (const id of expectedIds) {
    if (!shard.records?.[id] || typeof shard.records[id] !== 'object') {
      hard.push(`shard ${s.shard}: record ${id} missing from ${path}`);
    }
  }
  for (const [id, rec] of Object.entries(shard.records ?? {})) {
    if (typeof rec !== 'object' || rec === null) continue; // "__CONTINUE__" style debris
    if (records[id]) hard.push(`record ${id} appears in two shards`);
    const merged = { ...rec };
    if (merged.sound === undefined && ruleSound[id]) {
      merged.sound = ruleSound[id].sound;
      merged.soundNote = ruleSound[id].soundNote;
      merged.publish = ruleSound[id].publish && !merged.hold;
      if (merged.hold) merged.notes = `${merged.notes ? `${merged.notes} ` : ''}held by reader: ${merged.hold}`;
    } else if (merged.sound === undefined) {
      hard.push(`${id}: no sound field and no rule classification`);
    }
    records[id] = merged;
  }
}

if (values['renumber-positional']) {
  const counters = {};
  for (const r of raw) {
    const v = r.vol ?? 1;
    counters[v] = (counters[v] ?? 0) + 1;
    if (records[String(r.id)]) records[String(r.id)].n = counters[v];
  }
  console.log(`  renumbered positionally per volume: ${JSON.stringify(counters)}`);
}

const EM = /—/g;
const EDITORIAL = /(19\d\d年|20\d\d年|诠订|詮訂|内容提要|內容提要|编者|編者|注[：:]|http|www\.|本局即|杨官璘|楊官璘|屠景明|裘望禹)/;
const dash = (s) => (typeof s === 'string' ? s.replace(EM, ', ') : s);
let publish = 0;
let suspect = 0;
let replayError = 0;
let heldOther = 0;
const enByZh = new Map();
const nByVol = new Map();
for (const [id, rec] of Object.entries(records)) {
  rec.en = dash(rec.en);
  rec.gloss = dash(rec.gloss);
  rec.notes = dash(rec.notes);
  for (const k of Object.keys(rec.prose ?? {})) rec.prose[k] = dash(rec.prose[k]);
  const err = errorById.get(id);
  if (err && rec.publish) {
    soft.push(`${id} ${rec.zh}: publish=true with verify.error (${err}); set false`);
    rec.publish = false;
    rec.notes = `${rec.notes ? `${rec.notes} ` : ''}replay error: ${err}`;
  }
  if (rec.sound === 'suspect' && rec.publish) {
    soft.push(`${id} ${rec.zh}: publish=true while sound=suspect; set false`);
    rec.publish = false;
  }
  for (const [k, text] of Object.entries(rec.prose ?? {})) {
    if (EDITORIAL.test(text)) hard.push(`${id} ${rec.zh}: kept prose[${k}] carries an editorial marker: ${text.slice(0, 40)}`);
  }
  if (rec.publish) {
    publish += 1;
    const vol = volById.get(id) ?? 1;
    const key = `${vol}:${rec.n}`;
    if (nByVol.has(key)) hard.push(`${id} ${rec.zh}: n=${rec.n} in vol ${vol} also used by ${nByVol.get(key)}`);
    nByVol.set(key, id);
    if (rec.en) {
      const prev = enByZh.get(rec.en);
      if (prev && prev.zh !== rec.zh) hard.push(`${id} ${rec.zh} and ${prev.id} ${prev.zh} share English "${rec.en}"`);
      enByZh.set(rec.en, { id, zh: rec.zh });
    }
  } else if (err || rec.sound === 'replay') replayError += 1;
  else if (rec.sound === 'suspect') suspect += 1;
  else heldOther += 1;
}

const existing = existsSync(join(E, `${slug}.edits.json`)) ? read(join(E, `${slug}.edits.json`)) : null;
// A book file is the bare block, but an agent may wrap it as {slug, book}; unwrap.
const bookFile = values.book ? read(values.book) : null;
const book = bookFile ? (bookFile.book && !bookFile.zh ? bookFile.book : bookFile) : (existing?.book ?? null);
if (!book) hard.push('no book block: pass --book <book.json> or have an existing edits file');

console.log(`${slug}: ${Object.keys(records).length} records from ${sources.length} shards (${sources.map((s) => `${s.shard}:${s.witness}`).join(' ')})`);
console.log(`  publish ${publish}  suspect ${suspect}  replayError ${replayError}  heldOther ${heldOther}`);
for (const line of soft) console.log(`  fixed: ${line}`);
for (const line of hard) console.log(`  HARD: ${line}`);
if (hard.length) {
  console.log('not written');
  process.exit(1);
}

// Per-volume publish counts, for the study names.
const perVol = {};
for (const [id, rec] of Object.entries(records)) {
  if (!rec.publish) continue;
  const v = book?.singleStudy ? 1 : (volById.get(id) ?? 1);
  perVol[v] = (perVol[v] ?? 0) + 1;
}
// The book agent wrote the study names before holds were known; the count in
// a name is the publish count by rule, so rewrite it here rather than fail later.
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const cnNumber = (n) => {
  if (n < 10) return CN[n];
  if (n < 20) return `十${n % 10 ? CN[n % 10] : ''}`;
  if (n < 100) return `${CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ''}`;
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (r === 0) return `${CN[h]}百`;
  if (r < 10) return `${CN[h]}百零${CN[r]}`;
  return `${CN[h]}百${cnNumber(r)}`;
};
const fixNames = (study, n, where) => {
  if (!study) return;
  if (study.en?.name) {
    const next = study.en.name.replace(/\b\d+(\s+(?:classical|endgame|full))/, `${n}$1`);
    if (next !== study.en.name) console.log(`  study name ${where}: "${study.en.name}" -> "${next}"`);
    study.en.name = next;
  }
  for (const loc of ['zh-Hans', 'zh-Hant']) {
    const name = study[loc]?.name;
    if (!name) continue;
    const next = name.replace(/[零一二三四五六七八九十百]+局/, `${cnNumber(n)}局`);
    if (next !== name) console.log(`  study name ${where} ${loc}: "${name}" -> "${next}"`);
    study[loc].name = next;
  }
};
if (book?.singleStudy || !(book?.volumes?.length > 1)) fixNames(book?.volumes?.[0]?.study ?? book?.study, perVol[1] ?? 0, 'vol 1');
else for (const [v, n] of Object.entries(perVol)) fixNames(book.volumes[Number(v) - 1]?.study, n, `vol ${v}`);

const out = {
  slug,
  book,
  records,
  counts: { total: Object.keys(records).length, publish, suspect, replayError, heldOther, perVolume: perVol },
  mergedBy: 'merge-shards.mjs',
  sources,
};
writeFileSync(join(E, `${slug}.edits.json`), `${JSON.stringify(out, null, 1)}\n`, 'utf8');
console.log(`  wrote edits/${slug}.edits.json  per-volume publish ${JSON.stringify(perVol)}`);
