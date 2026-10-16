#!/usr/bin/env node
// Step 3 of docs-private/players/README.md: get the 1M analysis of every game
// on a player page FROM THE SITE, so the site is the cache and nothing is
// computed twice. The broadcast archive already analyses its finished boards
// (xiangqi-broadcast-analysis.ts), and a local run on the pinned engine
// reproduces those rows exactly (checked 2026-09-25: 38/38 plies identical), so
// the pipeline reads what the site holds and asks the site for what it lacks.
//
//   node scripts/player-analysis.mjs --player cao-yanlei --out docs-private/players/cao-yanlei/site
//   node scripts/player-analysis.mjs ... --request [--cookie ~/.mistboard-cookie]
//
// Writes <out>/<dpxq key>.site.json ({boardId, engineId, depth, plies}) for every
// archive board of the player whose analysis the site has. --request POSTs the
// site's own request-analysis for the rest (account-gated, one at a time, the
// same queue a reader's request uses) and waits for each. Then:
//
//   node scripts/annotate-game.mjs docs-private/games/dpxq/<key>.json \
//     --evals-from <out>/<key>.site.json --json annot1m/<key>.json
//
// A game the archive does not hold is listed at the end; run it locally on the
// pinned engine (MISTBOARD_PIKAFISH_XIANGQI_PATH, built from pikafish.ref).
// The cookie is read from a file and sent as a header, never printed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (k, d = '') => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : (args[i + 1] ?? d);
};
const SLUG = argOf('player');
const OUT = argOf('out');
const BASE = argOf('base', 'https://mistboard.com');
const REQUEST = args.includes('--request');
const KEYS = argOf('keys'); // optional: only these dpxq keys, one per line
if (!SLUG || !OUT) {
  console.error(
    'usage: player-analysis.mjs --player <slug> --out <dir> [--keys keys.txt] [--request] [--cookie path] [--base url]',
  );
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const cookie = REQUEST
  ? readFileSync(argOf('cookie', join(homedir(), '.mistboard-cookie')), 'utf8').trim()
  : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const player = await (await fetch(`${BASE}/api/xiangqi/players/${SLUG}`)).json();
const wanted = KEYS
  ? new Set(
      readFileSync(KEYS, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;
const boards = [];
for (const b of player.boards ?? []) {
  const key = /view_(m_\d+)\.html/.exec(b.sourceUrl ?? '')?.[1];
  if (!key) continue;
  if (wanted && !wanted.has(key)) continue;
  boards.push({ key, boardId: b.boardId, plies: b.plyCount });
}

const analysisUrl = (boardId) =>
  `${BASE}/api/xiangqi-broadcasts/games/${encodeURIComponent(boardId)}/analysis`;

async function fetchStored(board) {
  const res = await fetch(analysisUrl(board.boardId));
  if (res.status !== 200) return null;
  const body = await res.json();
  if (!Array.isArray(body.plies) || body.plies.length !== board.plies + 1) {
    throw new Error(
      `${board.key}: stored analysis has ${body.plies?.length} positions for ${board.plies} plies`,
    );
  }
  writeFileSync(
    join(OUT, `${board.key}.site.json`),
    `${JSON.stringify({ boardId: board.boardId, ...body }, null, 2)}\n`,
  );
  return body;
}

let have = 0;
const missing = [];
for (const board of boards) {
  if (existsSync(join(OUT, `${board.key}.site.json`)) || (await fetchStored(board))) have += 1;
  else missing.push(board);
}
console.log(
  `${SLUG}: ${boards.length} archive boards, ${have} analysed on the site, ${missing.length} not yet`,
);

if (REQUEST) {
  for (const board of missing) {
    const res = await fetch(analysisUrl(board.boardId), { method: 'POST', headers: { cookie } });
    if (res.status !== 202 && res.status !== 200) {
      console.log(`  ${board.key}: request refused (${res.status}); try later`);
      continue;
    }
    // One at a time: the queue caps pending jobs per account. A ply is about a
    // second on the site's engine; give up on a game after 20 minutes.
    const deadline = Date.now() + 20 * 60_000;
    let done = null;
    while (!done && Date.now() < deadline) {
      await sleep(15_000);
      done = await fetchStored(board);
    }
    console.log(`  ${board.key}: ${done ? 'analysed' : 'still pending, re-run to pick it up'}`);
    if (done) have += 1;
  }
}

if (KEYS) {
  const inArchive = new Set(boards.map((b) => b.key));
  const outside = [...wanted].filter((k) => !inArchive.has(k));
  if (outside.length) {
    console.log(`not in the archive (run locally on the pinned engine): ${outside.join(' ')}`);
  }
}
