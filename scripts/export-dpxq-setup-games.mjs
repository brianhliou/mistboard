#!/usr/bin/env node
// Local-only source export for the DPXQ position-only puzzle setup backfill.
// Two local sources. --jsonl reads the corpus's local-games export: each
// record with source 'dpxq' and id N is game dpxq-N. The 14 live puzzles'
// games are in ~/projects/xiangqi-corpus/dpxq-local-games-1111/local-games.jsonl.
// --dir reads a folder of game files whose names (without extensions,
// punctuation sanitized) are the dpxq-* ids, as the miner's dir mode does.
// Either way the backfill refuses a game whose replay disagrees with the puzzle.
// No network, database or engine is used. Only requested games leave the
// archive, truncated at the greatest requested puzzle ply for each game.
// Keep all generated files outside git; never commit this source-game output.
//
// Full operator run, from the repo root (no production writes until step 3):
// 1. Put the 14 live xq-mined-dpxq-* puzzle ids in /tmp/dpxq-puzzles.txt,
//    one per line. Or repeat --puzzle ID in place of --puzzles-file FILE.
//    node --import tsx scripts/export-dpxq-setup-games.mjs \
//      --jsonl ~/projects/xiangqi-corpus/dpxq-local-games-1111/local-games.jsonl \
//      --puzzles-file /tmp/dpxq-puzzles.txt --out /tmp/dpxq-setup-games.json
// 2. Dry run and review the 14 setup moves and returned sha256:
//    npm run prod:db -- --read-only node --import tsx \
//      apps/server/src/xiangqi-puzzle-setup-backfill.ts \
//      --games /tmp/dpxq-setup-games.json --expect-total 14
// 3. Apply with that exact reviewed sha256 (replace DRY_RUN_SHA256):
//    npm run prod:db -- node --import tsx \
//      apps/server/src/xiangqi-puzzle-setup-backfill.ts \
//      --games /tmp/dpxq-setup-games.json --expect-total 14 \
//      --apply --expect-sha256 DRY_RUN_SHA256
// Omitting --out creates a private temporary directory outside the repo and
// reports its local.json path. Existing output files are never overwritten.

import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { importXiangqiGame } from '@mistboard/game';
import { extractGameText, gameIdForFile } from './variant-lab/xiangqi-puzzle-miner.ts';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    jsonl: { type: 'string' },
    puzzle: { type: 'string', multiple: true },
    'puzzles-file': { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

function main() {
  if (values.help) {
    console.log(
      'node --import tsx scripts/export-dpxq-setup-games.mjs (--jsonl LOCAL-GAMES.jsonl | --dir ARCHIVE) ' +
        '[--puzzle ID ...] [--puzzles-file IDS.txt] [--out LOCAL.json]\n' +
        'IDS.txt: one puzzle id per line (whitespace-separated). Default output: a private temp directory.',
    );
    return;
  }
  if (!values.dir === !values.jsonl) {
    throw new Error(
      'Pass exactly one of --jsonl LOCAL-GAMES.jsonl or --dir ARCHIVE (local only; no downloads)',
    );
  }
  const puzzleIds = [...(values.puzzle ?? [])];
  if (values['puzzles-file']) {
    puzzleIds.push(...readFileSync(values['puzzles-file'], 'utf8').split(/\s+/).filter(Boolean));
  }
  if (puzzleIds.length === 0) throw new Error('Supply --puzzle ID or --puzzles-file IDS.txt');

  const requested = new Map();
  for (const id of puzzleIds) {
    const match = /^xq-mined-(dpxq-.+)-([1-9]\d*)$/.exec(id);
    const ply = match ? Number(match[2]) : 0;
    if (!match || !Number.isSafeInteger(ply)) throw new Error(`Invalid DPXQ puzzle id: ${id}`);
    requested.set(match[1], Math.max(requested.get(match[1]) ?? 0, ply));
  }

  const sources = values.jsonl
    ? jsonlSources(resolve(values.jsonl), requested)
    : dirSources(resolve(values.dir), requested);

  const games = [...requested.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, ply]) => {
      const text = sources.get(id);
      if (text === undefined) throw new Error(`Missing local archive game: ${id}`);
      const imported = importXiangqiGame(extractGameText(text));
      if (imported.error) throw new Error(`Cannot import ${id}: ${imported.error}`);
      if (imported.moves.length < ply)
        throw new Error(`Local game ${id} has fewer than ${ply} plies`);
      return {
        id,
        moves: imported.moves.slice(0, ply).map(({ from, to }) => ({ from, to })),
      };
    });

  const out = values.out
    ? resolve(values.out)
    : join(mkdtempSync(join(tmpdir(), 'mistboard-dpxq-setup-')), 'local.json');
  writeFileSync(out, `${JSON.stringify({ games }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ out, games: games.length, puzzles: new Set(puzzleIds).size }));
}

// Index only filenames first. Do not read or import unrequested games.
function dirSources(dir, requested) {
  const files = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const id = gameIdForFile(entry.name);
    if (!requested.has(id)) continue;
    if (files.has(id)) throw new Error(`Ambiguous archive filenames for ${id}`);
    files.set(id, entry.name);
  }
  return new Map([...files].map(([id, name]) => [id, readFileSync(join(dir, name), 'utf8')]));
}

// local-games.jsonl (xiangqi-corpus `export:corpus --target local-games`): one
// record per line, { source: 'dpxq', id: 118023, moves: '<DhtmlXQ digits>', standardStart }.
function jsonlSources(file, requested) {
  const texts = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.source !== 'dpxq') continue;
    const id = `dpxq-${record.id}`;
    if (!requested.has(id)) continue;
    if (texts.has(id)) throw new Error(`Ambiguous local-games records for ${id}`);
    if (record.standardStart !== true || typeof record.moves !== 'string') {
      throw new Error(`Local game ${id} is not a standard-start movelist`);
    }
    texts.set(id, record.moves);
  }
  return texts;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
