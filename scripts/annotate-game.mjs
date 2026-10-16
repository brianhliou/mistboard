#!/usr/bin/env node
// Run a harvested game through the REAL postgame analysis path (persistent
// Pikafish session, node budget per ply) and print it annotated, so the output
// can be judged as content before any of it is written up.
//
//   node scripts/annotate-game.mjs docs-private/games/dpxq/m_141507.json
//   node scripts/annotate-game.mjs <file> --nodes 2000000 --json out.json
//
// Uses the same evaluator, thresholds and accuracy maths the review page uses;
// nothing here is a bespoke second opinion.

import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeXiangqiPostgame } from '../apps/server/dist/routes/xiangqi-games.js';
import { analyzeXiangqiGame } from '../apps/server/dist/xiangqi-analysis.js';
import {
  pikafishXiangqiPath,
  XIANGQI_ANALYSIS_NODES,
} from '../apps/server/dist/xiangqi-pikafish-engine.js';
import {
  accuracyPercent,
  gameAccuracy,
  moveJudgment,
  winPercent,
} from '../packages/game/dist/analysis.js';
import { createInitialXiangqiState } from '../packages/game/dist/variants-xiangqi.js';
import { applyStandardXiangqiMove } from '../packages/game/dist/variants-xiangqi-standard.js';
import { formatXiangqiMoves } from '../packages/game/dist/xiangqi-notation-format.js';
import {
  pikafishUciToXiangqiSquares,
  xiangqiMoveToPikafishUci,
} from '../packages/game/dist/xiangqi-uci.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const nodes = Number(args[args.indexOf('--nodes') + 1]) || undefined;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (!file) {
  console.error('usage: annotate-game.mjs <harvested-game.json> [--nodes N] [--json out.json]');
  process.exit(1);
}

const game = JSON.parse(readFileSync(file, 'utf8'));
const movesUci = game.moves.map((m) => xiangqiMoveToPikafishUci(m));
const wxf = formatXiangqiMoves(game.moves, 'wxf');
const zh = formatXiangqiMoves(game.moves, 'chinese-simplified');

// A PV in raw Pikafish UCI ("d4e6 g7e6 e2e6") is unreadable in an article.
// formatXiangqiMoves always starts from the initial position, so notate the game
// prefix PLUS the line and keep only the tail: same public API, no mid-game
// state to thread, and an illegal continuation cannot be silently notated.
function notatePv(prefixMoves, pvUci) {
  let state = createInitialXiangqiState('pv');
  for (const move of prefixMoves) state = applyStandardXiangqiMove(state, move);

  const line = [];
  for (const uci of pvUci) {
    const squares = pikafishUciToXiangqiSquares(uci);
    if (!squares) break;
    const next = applyStandardXiangqiMove(state, squares);
    // Rules reject it (apply is a no-op): stop rather than emit a fake line.
    if (next === state) break;
    line.push(squares);
    state = next;
  }
  if (line.length === 0) return { wxf: [], chinese: [] };

  const all = [...prefixMoves, ...line];
  const skip = prefixMoves.length;
  return {
    wxf: formatXiangqiMoves(all, 'wxf').slice(skip),
    chinese: formatXiangqiMoves(all, 'chinese-simplified').slice(skip),
  };
}

// --evals-from <site.json>: take the site's stored analysis (fetched by
// scripts/player-analysis.mjs) instead of running the engine. The site's rows are
// in our square notation (ranks 1-10); the rows below want Pikafish UCI (0-9).
const evalsFromIdx = args.indexOf('--evals-from');
const evalsFrom =
  evalsFromIdx === -1 ? null : JSON.parse(readFileSync(args[evalsFromIdx + 1], 'utf8'));
const toPikafish = (uci) =>
  typeof uci === 'string'
    ? uci.replace(
        /^([a-i])(\d+)([a-i])(\d+)$/,
        (_, f1, r1, f2, r2) => `${f1}${r1 - 1}${f2}${r2 - 1}`,
      )
    : uci;

const started = Date.now();
// `moves` switches on the offered-piece pass (#315), as the site's own
// postgame path does; without it the rows would lack `offerLine`.
const evals = evalsFrom
  ? evalsFrom.plies.map((p) => ({
      ...p,
      best: toPikafish(p.best),
      pv: (p.pv ?? []).map(toPikafish),
    }))
  : await analyzeXiangqiGame(movesUci, { ...(nodes ? { nodes } : {}), moves: game.moves });
if (evals.length !== movesUci.length + 1) {
  console.error(
    `analysis has ${evals.length} positions for ${movesUci.length} moves; not this game`,
  );
  process.exit(1);
}
const elapsedMs = Date.now() - started;

// Red-POV win% for every position 0..N.
const wins = evals.map((e) => winPercent(e.cp ?? null, e.mate ?? null));
const SYMBOL = { blunder: '??', mistake: '?', inaccuracy: '?!' };

const rows = [];
for (let i = 0; i < game.moves.length; i += 1) {
  const moverIsRed = i % 2 === 0;
  // Judgment is always from the MOVER's point of view, so flip for black.
  const before = moverIsRed ? wins[i] : 100 - wins[i];
  const after = moverIsRed ? wins[i + 1] : 100 - wins[i + 1];
  const judgment = moveJudgment(before, after);
  rows.push({
    ply: i + 1,
    moveNumber: Math.floor(i / 2) + 1,
    side: moverIsRed ? 'red' : 'black',
    wxf: wxf[i],
    chinese: zh[i],
    uci: movesUci[i],
    cp: evals[i + 1]?.cp ?? null,
    mate: evals[i + 1]?.mate ?? null,
    winBefore: Number(before.toFixed(1)),
    winAfter: Number(after.toFixed(1)),
    lost: Number((before - after).toFixed(1)),
    judgment,
    symbol: judgment ? SYMBOL[judgment] : '',
    accuracy: Number(accuracyPercent(before, after).toFixed(1)),
    // What the engine wanted instead, and the line it saw.
    best: evals[i]?.best ?? null,
    pv: evals[i]?.pv ?? [],
    pvNotated: notatePv(game.moves.slice(0, i), evals[i]?.pv ?? []),
  });
}

const acc = gameAccuracy(wins);
const counts = rows.reduce((all, r) => {
  if (r.judgment) all[r.judgment] = (all[r.judgment] ?? 0) + 1;
  return all;
}, {});

console.log(`${game.title}`);
console.log(`${game.event}  ${game.date}  ${game.result}  ${game.plies} plies`);
console.log(
  `engine: pikafish, ${nodes ?? 1_000_000} nodes/ply, ${(elapsedMs / 1000).toFixed(1)}s total ` +
    `(${(elapsedMs / evals.length).toFixed(0)}ms/position)`,
);
console.log(
  `accuracy: red ${acc.first?.toFixed(1) ?? '-'}  black ${acc.second?.toFixed(1) ?? '-'}`,
);
console.log(
  `judged: ${counts.blunder ?? 0} blunder(??)  ${counts.mistake ?? 0} mistake(?)  ${counts.inaccuracy ?? 0} inaccuracy(?!)`,
);
console.log('');
console.log(' ply  move        notation      eval    win%   lost  mark  engine preferred');
for (const r of rows) {
  const num = `${r.moveNumber}${r.side === 'red' ? '.' : '...'}`;
  const ev = r.mate != null ? `#${r.mate}` : r.cp != null ? (r.cp / 100).toFixed(2) : '-';
  const mark = r.symbol.padEnd(4);
  const alt =
    r.judgment && r.best && r.best !== r.uci
      ? `${r.best}  ${(r.pv ?? []).slice(0, 6).join(' ')}`
      : '';
  console.log(
    `${String(r.ply).padStart(4)}  ${num.padEnd(10)} ${(r.wxf ?? '').padEnd(6)}${(r.chinese ?? '').padEnd(6)} ${ev.padStart(7)} ${String(r.winAfter).padStart(6)} ${String(r.lost).padStart(6)}  ${mark} ${alt}`,
  );
}

// At the site's own budget the run IS the site's analysis: the same function
// the postgame route caches, fed the evals above, so the row can be stored in
// game_analysis and served instead of recomputed (scripts/upload-game-analysis.mjs).
// Any other budget would be mislabelled under the site's key, so it gets none.
const budget = nodes ?? XIANGQI_ANALYSIS_NODES;
const site = evalsFrom
  ? { engineId: evalsFrom.engineId, depth: evalsFrom.depth, plies: evalsFrom.plies }
  : budget === XIANGQI_ANALYSIS_NODES
    ? await analyzeXiangqiPostgame(
        { timeline: game.moves.map((move) => ({ type: 'move-played', move })) },
        async () => evals,
      )
    : null;

if (jsonOut) {
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ game: { ...game, moves: undefined }, engine: { nodes: budget, binary: evalsFrom ? `site:${evalsFrom.engineId}` : pikafishXiangqiPath(), elapsedMs }, accuracy: acc, counts, rows, ...(site ? { site } : {}) }, null, 2)}\n`,
  );
  console.log(`\nwrote ${jsonOut}`);
}
