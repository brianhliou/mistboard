#!/usr/bin/env node
// Local-only source export for the DPXQ position-only puzzle setup backfill.
// Use the SAME --dir archive that xiangqi-puzzle-miner.ts reads in dir mode:
// filenames (without extensions, punctuation sanitized) are the dpxq-* ids.
// No network, database or engine is used. Only requested games leave the
// archive, truncated at the greatest requested puzzle ply for each game.
// Keep all generated files outside git; never commit this source-game output.
//
// Full operator run, from the repo root (no production writes until step 3):
// 1. Put the 14 live xq-mined-dpxq-* puzzle ids in /tmp/dpxq-puzzles.txt,
//    one per line. Or repeat --puzzle ID in place of --puzzles-file FILE.
//    node --import tsx scripts/export-dpxq-setup-games.mjs \
//      --dir /absolute/path/to/local-dpxq-archive \
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
    puzzle: { type: 'string', multiple: true },
    'puzzles-file': { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

function main() {
  if (values.help) {
    console.log(
      'node --import tsx scripts/export-dpxq-setup-games.mjs --dir ARCHIVE ' +
        '[--puzzle ID ...] [--puzzles-file IDS.txt] [--out LOCAL.json]\n' +
        'IDS.txt: one puzzle id per line (whitespace-separated). Default output: a private temp directory.',
    );
    return;
  }
  if (!values.dir) throw new Error('--dir is required (the local DPXQ archive; no downloads)');
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

  // Index only filenames first. Do not read or import unrequested games.
  const dir = resolve(values.dir);
  const files = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const id = gameIdForFile(entry.name);
    if (!requested.has(id)) continue;
    if (files.has(id)) throw new Error(`Ambiguous archive filenames for ${id}`);
    files.set(id, entry.name);
  }

  const games = [...requested.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, ply]) => {
      const file = files.get(id);
      if (!file) throw new Error(`Missing local archive game: ${id}`);
      const imported = importXiangqiGame(extractGameText(readFileSync(join(dir, file), 'utf8')));
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

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
