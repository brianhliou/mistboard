#!/usr/bin/env node
/**
 * Cut a mined book into agent-sized shard files, each record joined with its
 * replay and soundness rows and pretty-printed, so a worker reads one file and
 * needs no index arithmetic across three.
 *
 * Writes `<dir>/shards/<slug>.<i>.json` for i = 0.. and prints the shard list as
 * JSON on the last line (the orchestrator passes it into the workflow's args).
 *
 *   node make-shards.mjs --dir ~/projects/xiangqi-corpus/dpxq-compositions --slug hu-ya-ji [--size 40]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { dir: { type: 'string' }, slug: { type: 'string' }, size: { type: 'string', default: '40' } },
});
if (!values.dir || !values.slug) {
  console.error('usage: make-shards.mjs --dir <corpus dir> --slug <book> [--size N]');
  process.exit(2);
}
const { dir, slug } = values;
const SIZE = Number(values.size);

const records = JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8'));
const verify = JSON.parse(readFileSync(join(dir, `${slug}.verify.json`), 'utf8'));
const verifyById = new Map(verify.records.map((r) => [r.id, r]));
const soundById = new Map();
const soundPath = join(dir, `${slug}.soundness.jsonl`);
if (existsSync(soundPath)) {
  for (const line of readFileSync(soundPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      soundById.set(row.id, row);
    } catch {
      // a partial last line; the sweep is resumable and will rewrite it
    }
  }
}

const missingSound = records.filter((r) => verifyById.get(r.id)?.engineFen && !soundById.has(r.id)).length;
if (missingSound > 0) {
  console.error(`${slug}: ${missingSound} replayed record(s) have no soundness row yet; run the sweep first`);
  process.exit(1);
}

function slimSound(row) {
  if (!row) return null;
  const strip = (search) => (search ? { score: search.score, depth: search.depth, bestmove: search.bestmove } : null);
  return {
    pov: row.pov,
    lineMates: row.lineMates,
    claim: row.claim,
    root: strip(row.root),
    end: strip(row.end),
    engineView: row.engineView,
    agrees: row.agrees,
  };
}

mkdirSync(join(dir, 'shards'), { recursive: true });
const shards = [];
for (let a = 0, i = 0; a < records.length; a += SIZE, i += 1) {
  const z = Math.min(a + SIZE, records.length);
  const rows = records.slice(a, z).map((rec, k) => {
    const v = verifyById.get(rec.id) ?? {};
    const { rootFen, engineFen, uci, engineUci, url, title, vol, volName, id, ...verifyRest } = v;
    return {
      index: a + k,
      id: rec.id,
      vol: rec.vol,
      volName: rec.volName,
      title: rec.title,
      url: rec.url,
      comments: rec.comments,
      variationCount: rec.variations?.length ?? 0,
      verify: verifyRest,
      engineFen,
      // Scores and bestmoves only; the six-move pvs quadruple the file for nothing a reader uses.
      soundness: slimSound(soundById.get(rec.id)),
    };
  });
  const path = join(dir, 'shards', `${slug}.${i}.json`);
  writeFileSync(path, `${JSON.stringify({ slug, shard: i, range: [a, z], records: rows }, null, 1)}\n`, 'utf8');
  shards.push({ shard: i, range: [a, z], path, records: z - a });
}
console.log(JSON.stringify({ slug, total: records.length, shards }));
