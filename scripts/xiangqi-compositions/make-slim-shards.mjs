#!/usr/bin/env node
/**
 * Cut a book into the smallest input a title-and-prose agent needs.
 *
 * The 2026-09-13 shard files carried engine FENs, replay states and full
 * soundness rows (1,800 lines per 40 records) into agents whose job was English
 * titles, Traditional titles and prose triage. This writes `shards/<slug>.slim.<i>.json`
 * with id, volume, title, the comments (each cut to 300 characters; the front
 * matter runs to thousands and its first 300 say what it is), plies, and the
 * rule-derived soundness class from `<slug>.sound.json`, so the agent copies a
 * verdict instead of deriving one.
 *
 *   node make-slim-shards.mjs --dir <corpus dir> --slug <book> [--size 60]
 * Prints the shard list as JSON on the last line.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    slug: { type: 'string' },
    size: { type: 'string', default: '60' },
  },
});
if (!values.dir || !values.slug) {
  console.error('usage: make-slim-shards.mjs --dir <corpus dir> --slug <book> [--size N]');
  process.exit(2);
}
const { dir, slug } = values;
const SIZE = Number(values.size);
const records = JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8'));
const verify = new Map(
  JSON.parse(readFileSync(join(dir, `${slug}.verify.json`), 'utf8')).records.map((r) => [r.id, r]),
);
const soundPath = join(dir, `${slug}.sound.json`);
if (!existsSync(soundPath)) {
  console.error(`${slug}: no sound.json; run classify-soundness.mjs first`);
  process.exit(1);
}
const sound = JSON.parse(readFileSync(soundPath, 'utf8'));
// Existing English renderings, looked up here so the agent never opens the
// 817-entry file (and never needs a Grep tool it may not have).
const titlesPath = join(
  dir,
  '..',
  '..',
  'mistboard',
  'scripts',
  'data',
  'xiangqi-compositions',
  'titles-en.json',
);
const byTitle = existsSync(titlesPath)
  ? (JSON.parse(readFileSync(titlesPath, 'utf8')).byTitle ?? {})
  : {};
const bare = (t) => (t ?? '').replace(/^(第\s*\d+\s*局\s*|N?\d+\s*)/, '').trim();

mkdirSync(join(dir, 'shards'), { recursive: true });
const shards = [];
for (let a = 0, i = 0; a < records.length; a += SIZE, i += 1) {
  const z = Math.min(a + SIZE, records.length);
  const rows = records.slice(a, z).map((rec, k) => {
    const v = verify.get(rec.id) ?? {};
    const s = sound[String(rec.id)] ?? {};
    const comments = {};
    for (const [key, text] of Object.entries(rec.comments ?? {})) {
      comments[key] = text.length > 300 ? `${text.slice(0, 300)} [... ${text.length} chars]` : text;
    }
    return {
      index: a + k,
      id: rec.id,
      vol: rec.vol,
      volName: rec.volName,
      title: rec.title,
      comments,
      plies: v.plies ?? 0,
      turn: v.turn ?? null,
      replayError: v.error ?? null,
      sound: s.sound ?? 'unclear',
      claim: s.claim ?? null,
      // A hit here is reused verbatim; the agent renders only when this is absent.
      enExisting: byTitle[bare(rec.title)] ?? undefined,
    };
  });
  const path = join(dir, 'shards', `${slug}.slim.${i}.json`);
  writeFileSync(
    path,
    `${JSON.stringify({ slug, shard: i, range: [a, z], records: rows }, null, 1)}\n`,
    'utf8',
  );
  shards.push({ shard: i, range: [a, z], path, records: z - a });
}
console.log(JSON.stringify({ slug, total: records.length, shards }));
