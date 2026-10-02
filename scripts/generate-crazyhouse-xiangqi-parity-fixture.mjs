#!/usr/bin/env node
// Crazyhouse Xiangqi engine-parity fixture.
//
// Drives stock Fairy-Stockfish, loaded with apps/server/src/crazyhouse-xiangqi.ini,
// over the positions of real crazyhouse-xiangqi games and writes, for each
// position, the FEN, FSF's sorted legal moves (`go perft 1`) and its perft-2
// node count. packages/game/src/variants-crazyhouse-xiangqi.parity.test.ts
// requires the kernel to agree at every one: a mismatch is a kernel bug, never
// a fixture to edit.
//
// The games are the variant lab's (docs-private/drop-game-lab/fullboard/games/,
// "one-sentence C" = s8-std-legal-nocheck): the 16 strong games (5 s/move)
// and the 30 depth-12 games. Positions kept: the start, every 5th ply of the
// strong games, every 60th of the depth-12 games, and, from every ply of every
// game, a capped sample of the rare cases a sampled ply can miss: the side to
// move in check with a piece in hand, and a drop refused only because it
// would give check through a cannon screen. The refused drops are found by
// running the same positions under a sibling variant with `dropChecks = true`
// and taking the difference, so the fixture names them without trusting the
// kernel.
//
// Usage:
//   node scripts/generate-crazyhouse-xiangqi-parity-fixture.mjs
//   MISTBOARD_FSF_PATH=/path/to/stockfish MISTBOARD_DROP_LAB_GAMES=/path/to/games node ...

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FSF =
  process.env.MISTBOARD_FSF_PATH ?? '/Users/brianliou/projects/tools/fairy-stockfish/src/stockfish';
const GAMES_DIR =
  process.env.MISTBOARD_DROP_LAB_GAMES ??
  '/Users/brianliou/projects/mistboard/docs-private/drop-game-lab/fullboard/games';
const INI = join(ROOT, 'apps/server/src/crazyhouse-xiangqi.ini');
const OUT = join(ROOT, 'packages/game/src/fixtures/crazyhouse-xiangqi-parity.json');
const VARIANT = 'crazyhousexiangqi';
const VARIANT_DROP_CHECKS = 'crazyhousexiangqidropchecks';

const SOURCES = [
  { name: 'strong', file: 's8-std-legal-nocheck-strong.json', every: 5 },
  { name: 'd12', file: 's8-std-legal-nocheck.json', every: 60 },
];
const EXTRA_IN_CHECK_WITH_HAND = 25;
const EXTRA_SCREEN_BLOCKED = 25;

// ── Fairy-Stockfish ─────────────────────────────────────────────────────────

const tmp = mkdtempSync(join(tmpdir(), 'chx-parity-'));
const iniPath = join(tmp, 'variants.ini');
writeFileSync(
  iniPath,
  `${readFileSync(INI, 'utf8')}\n[${VARIANT_DROP_CHECKS}:${VARIANT}]\ndropChecks = true\n`,
);

function engineSession(variant, commands) {
  const lines = [
    'uci',
    `setoption name VariantPath value ${iniPath}`,
    `setoption name UCI_Variant value ${variant}`,
    ...commands,
    'quit',
  ];
  const result = spawnSync(FSF, {
    input: `${lines.join('\n')}\n`,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0)
    throw new Error(`fairy-stockfish exited ${result.status}: ${result.stderr}`);
  const out = result.stdout.split('\n');
  const loaded = out.find((line) => line.startsWith('info string variant'));
  if (!loaded?.startsWith(`info string variant ${variant} `)) {
    throw new Error(`engine did not load ${variant}: ${loaded}`);
  }
  return out;
}

/**
 * FEN and checkers of each position (`d`). Kept apart from perft on purpose:
 * `go perft` runs on the search thread, so a `d` queued behind it can print
 * before the perft does.
 */
function displayPositions(variant, positions) {
  const out = [];
  for (const line of engineSession(
    variant,
    positions.flatMap((command) => [command, 'd']),
  )) {
    if (line.startsWith('Fen: ')) out.push({ fen: line.slice(5).trim(), checkers: '' });
    else if (line.startsWith('Checkers:')) out.at(-1).checkers = line.slice(9).trim();
  }
  if (out.length !== positions.length) {
    throw new Error(`expected ${positions.length} FENs, parsed ${out.length}`);
  }
  return out;
}

/** `go perft <depth>` per position: the divide lines and the node count. */
function perftPositions(variant, positions, depth) {
  const out = [];
  let moves = [];
  for (const line of engineSession(
    variant,
    positions.flatMap((command) => [command, `go perft ${depth}`]),
  )) {
    const move = /^([A-Za-z]@[a-i]\d+|[a-i]\d+[a-i]\d+): (\d+)$/.exec(line);
    if (move) {
      moves.push(move[1]);
      continue;
    }
    const nodes = /^Nodes searched: (\d+)/.exec(line);
    if (nodes) {
      out.push({ moves, nodes: Number(nodes[1]) });
      moves = [];
    }
  }
  if (out.length !== positions.length) {
    throw new Error(`expected ${positions.length} perft results, parsed ${out.length}`);
  }
  return out;
}

// ── Screen checks (generator-side, so the fixture does not trust the kernel) ─

function parseBoard(fen) {
  const placement = fen.split(/[\s[]/)[0];
  const board = new Map();
  placement.split('/').forEach((row, i) => {
    const rank = 10 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else board.set(`${'abcdefghi'[file++]}${rank}`, ch);
    }
  });
  return board;
}

/**
 * Would a piece dropped on `square` become the screen between one of the
 * mover's cannons and the enemy general? Only then is a refused drop refused
 * for a reason the dropped piece itself has nothing to do with.
 */
function isScreenCheck(board, square, moverIsRed) {
  const general = [...board].find(([, p]) => p === (moverIsRed ? 'k' : 'K'))?.[0];
  if (!general) return false;
  const g = { f: general.charCodeAt(0) - 97, r: Number(general.slice(1)) };
  const s = { f: square.charCodeAt(0) - 97, r: Number(square.slice(1)) };
  if (g.f !== s.f && g.r !== s.r) return false;
  const df = Math.sign(s.f - g.f);
  const dr = Math.sign(s.r - g.r);
  let f = g.f + df;
  let r = g.r + dr;
  const occupied = [];
  while (f >= 0 && f <= 8 && r >= 1 && r <= 10 && occupied.length < 2) {
    const sq = `${'abcdefghi'[f]}${r}`;
    if (sq === square || board.has(sq)) occupied.push(sq);
    f += df;
    r += dr;
  }
  return (
    occupied.length === 2 &&
    occupied[0] === square &&
    board.get(occupied[1]) === (moverIsRed ? 'C' : 'c')
  );
}

// ── Collect ─────────────────────────────────────────────────────────────────

const games = [];
for (const source of SOURCES) {
  const data = JSON.parse(readFileSync(join(GAMES_DIR, source.file), 'utf8'));
  data.games.forEach((game, index) => {
    games.push({
      id: `${source.name}#${index}`,
      every: source.every,
      moves: game.moveList,
      result: { winner: game.winner, reason: game.reason },
    });
  });
}

const all = [];
for (const [gameIndex, game] of games.entries()) {
  for (let ply = 0; ply <= game.moves.length; ply += 1) {
    all.push({
      gameIndex,
      ply,
      command: `position startpos moves ${game.moves.slice(0, ply).join(' ')}`,
    });
  }
}
console.log(`walking ${all.length} plies of ${games.length} games`);
const commands = all.map((p) => p.command);
const shown = displayPositions(VARIANT, commands);
const stockPerft = perftPositions(VARIANT, commands, 1);
const withChecks = perftPositions(VARIANT_DROP_CHECKS, commands, 1);

const records = all.map((p, i) => {
  const s = { ...shown[i], moves: stockPerft[i].moves };
  const legal = new Set(s.moves);
  const blocked = withChecks[i].moves.filter((m) => !legal.has(m));
  for (const m of blocked) {
    if (!m.includes('@')) throw new Error(`dropChecks changed a board move: ${m} at ${s.fen}`);
  }
  const moverIsRed = s.fen.split(' ')[1] === 'w';
  const board = parseBoard(s.fen);
  const pocket = /\[([^\]]*)\]/.exec(s.fen)?.[1] ?? '';
  const hand = [...pocket].filter((ch) => (ch === ch.toUpperCase()) === moverIsRed);
  return {
    ...p,
    fen: s.fen,
    checkers: s.checkers,
    moves: [...s.moves].sort(),
    blocked: [...blocked].sort(),
    screenBlocked: blocked.filter((m) => isScreenCheck(board, m.split('@')[1], moverIsRed)),
    hand: hand.map((ch) => ch.toUpperCase()),
  };
});

// ── Select ──────────────────────────────────────────────────────────────────

const chosen = new Map();
const choose = (record, why) => {
  const existing = chosen.get(record.fen);
  if (existing) {
    if (!existing.why.includes(why)) existing.why.push(why);
    return;
  }
  chosen.set(record.fen, { record, why: [why] });
};
for (const record of records) {
  if (record.ply === 0 || record.ply % games[record.gameIndex].every === 0)
    choose(record, 'sample');
}
const spread = (list, n) =>
  list.length <= n
    ? list
    : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
for (const record of spread(
  records.filter((r) => r.checkers && r.hand.length > 0 && !chosen.has(r.fen)),
  EXTRA_IN_CHECK_WITH_HAND,
)) {
  choose(record, 'check-with-hand');
}
for (const record of spread(
  records.filter((r) => r.screenBlocked.length > 0 && !chosen.has(r.fen)),
  EXTRA_SCREEN_BLOCKED,
)) {
  choose(record, 'screen-blocked');
}
const selected = [...chosen.values()].sort(
  (a, b) => a.record.gameIndex - b.record.gameIndex || a.record.ply - b.record.ply,
);

// ── Perft 2 ─────────────────────────────────────────────────────────────────

const perft2 = perftPositions(
  VARIANT,
  selected.map(({ record }) => `position fen ${record.fen}`),
  2,
);

// ── Write ───────────────────────────────────────────────────────────────────

const versionLine =
  spawnSync(FSF, { input: 'quit\n', encoding: 'utf8' }).stdout.split('\n')[0]?.trim() ?? '';
const positions = selected.map(({ record, why }, i) => ({
  game: record.gameIndex,
  ply: record.ply,
  why: why.join(','),
  fen: record.fen,
  ...(record.checkers ? { checkers: record.checkers } : {}),
  moves: record.moves.join(' '),
  ...(record.blocked.length ? { checkBlockedDrops: record.blocked.join(' ') } : {}),
  perft2: perft2[i].nodes,
}));
const fixture = {
  about:
    'Fairy-Stockfish legal moves and perft-2 counts for crazyhousexiangqi over real game positions. Generated by scripts/generate-crazyhouse-xiangqi-parity-fixture.mjs; do not edit by hand.',
  engine: versionLine,
  ini: 'apps/server/src/crazyhouse-xiangqi.ini',
  games: games.map((g) => ({ id: g.id, result: g.result, moves: g.moves.join(' ') })),
  positions,
};
const json = `${JSON.stringify(fixture, null, 2)}\n`;
writeFileSync(OUT, json);
rmSync(tmp, { recursive: true, force: true });

// ── Report ──────────────────────────────────────────────────────────────────

const roles = ['R', 'N', 'B', 'A', 'C', 'P'];
const withRole = Object.fromEntries(
  roles.map((role) => [role, selected.filter(({ record }) => record.hand.includes(role)).length]),
);
console.log(`wrote ${OUT}`);
console.log(`  ${positions.length} positions, ${(json.length / 1024).toFixed(0)} KB`);
console.log(`  side to move holds (positions): ${JSON.stringify(withRole)}`);
console.log(`  in check: ${selected.filter(({ record }) => record.checkers).length}`);
console.log(
  `  with a check-blocked drop: ${selected.filter(({ record }) => record.blocked.length).length} positions, ${selected.reduce((n, { record }) => n + record.blocked.length, 0)} drops`,
);
console.log(
  `  with a cannon-screen-blocked drop: ${selected.filter(({ record }) => record.screenBlocked.length).length} positions, ${selected.reduce((n, { record }) => n + record.screenBlocked.length, 0)} drops`,
);
