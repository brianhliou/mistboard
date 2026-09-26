#!/usr/bin/env node
// Shortlist a player page from a directory of annotate-game.mjs --json output:
// one row per game (the numbers a board pick is made from) and the season
// numbers the "How he plays" section quotes, so neither is computed by hand in
// a scratchpad again. Step 4 of docs-private/players/README.md.
//
//   node scripts/player-shortlist.mjs --dir docs-private/players/cao-yanlei/annot500k --player 曹岩磊
//   node scripts/player-shortlist.mjs ... --since 2026-08-17 --until 2026-09-17 --year-fix 2029=2026
//   node scripts/player-shortlist.mjs ... --event 甲级联赛 --json out.json
//
// Everything here is from the player's seat. `winAfter` in annotate-game JSON is
// mover-POV, so the player's chances after the opponent's move are 100 minus it.
// Sources: `result` is from red's side; dpxq's `A 负 B` titles read red first.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (k, d = '') => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : (args[i + 1] ?? d);
};
const DIR = argOf('dir');
const PLAYER = argOf('player');
const SINCE = argOf('since', '0000');
const UNTIL = argOf('until', '9999');
const EVENT = argOf('event');
const JSON_OUT = argOf('json');
const YEAR_FIX = Object.fromEntries(
  args.flatMap((a, i) => (a === '--year-fix' ? [String(args[i + 1]).split('=')] : [])),
);
if (!DIR || !PLAYER) {
  console.error(
    'usage: player-shortlist.mjs --dir <annotate-json dir> --player <zh name> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--event <substring>] [--year-fix 2029=2026] [--json out.json]',
  );
  process.exit(1);
}

const fixDate = (d) => {
  const y = d.slice(0, 4);
  return YEAR_FIX[y] ? YEAR_FIX[y] + d.slice(4) : d;
};
const BAD = new Set(['mistake', 'blunder']);
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const lastToken = (s) => String(s).trim().split(/\s+/).pop();

/** The red first move as an opening family, by the WXF of ply 1. */
function openingFamily(wxf) {
  if (/^C[28]\.5$/.test(wxf)) return 'central cannon';
  if (/^P[37]\+1$/.test(wxf)) return 'soldier (仙人指路)';
  if (/^E[37]\+5$/.test(wxf)) return 'elephant (飞相)';
  if (/^H[28]\+[37]$/.test(wxf)) return 'horse (起马)';
  if (/^C[28]\.[46]$/.test(wxf)) return 'palace-crossing cannon (过宫炮)';
  return `other (${wxf})`;
}

const games = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.json'))) {
  const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const g = d.game;
  const isRed = g.red.includes(PLAYER);
  if (!isRed && !g.black.includes(PLAYER)) continue;
  const date = fixDate(g.date.slice(0, 10));
  if (date < SINCE || date > UNTIL) continue;
  if (EVENT && !g.event.includes(EVENT)) continue;
  const side = isRed ? 'red' : 'black';
  const rows = d.rows;
  // The player's winning chances after every ply, from his seat.
  const mine = rows.map((x) => (x.side === side ? x.winAfter : 100 - x.winAfter));
  const low = Math.min(...mine);
  const swing = rows.reduce((a, x) => (Math.abs(x.lost) > Math.abs(a.lost) ? x : a), rows[0]);
  const firstBad = rows.find((x) => BAD.has(x.judgment));
  const count = (who, js) =>
    rows.filter((x) => (x.side === side) === who && js.includes(x.judgment)).length;
  const result = g.result === '1/2-1/2' ? 'D' : (g.result === '1-0') === isRed ? 'W' : 'L';
  games.push({
    key: g.key,
    date,
    event: g.event,
    side,
    opponent: lastToken(isRed ? g.black : g.red),
    result,
    plies: rows.length,
    moves: Math.ceil(rows.length / 2),
    acc: r1(isRed ? d.accuracy.first : d.accuracy.second),
    oppAcc: r1(isRed ? d.accuracy.second : d.accuracy.first),
    low: r1(low),
    lowPly: mine.indexOf(low) + 1,
    swing: r1(Math.abs(swing.lost)),
    swingPly: swing.ply,
    swingWho: swing.side === side ? 'him' : 'opp',
    firstBad: firstBad ? { ply: firstBad.ply, who: firstBad.side === side ? 'him' : 'opp' } : null,
    blunders: count(true, ['blunder']),
    mistakes: count(true, ['mistake']),
    inaccuracies: count(true, ['inaccuracy']),
    oppBlunders: count(false, ['blunder']),
    oppMistakes: count(false, ['mistake']),
    unmarked: rows.every((x) => x.side !== side || !x.judgment),
    opening: side === 'red' ? openingFamily(rows[0]?.wxf ?? '') : null,
    open: g.open ?? '',
  });
}
games.sort((a, b) =>
  a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date),
);
if (games.length === 0) {
  console.error(`no games for ${PLAYER} in ${DIR} with those filters`);
  process.exit(1);
}

const wdl = (gs) => {
  const n = (r) => gs.filter((g) => g.result === r).length;
  return { W: n('W'), D: n('D'), L: n('L'), n: gs.length };
};
const byEvent = [];
for (const g of games) {
  let e = byEvent.find((x) => x.event === g.event);
  if (!e) {
    e = { event: g.event, from: g.date, games: [] };
    byEvent.push(e);
  }
  e.to = g.date;
  e.games.push(g);
}
const colour = (s) => {
  const gs = games.filter((g) => g.side === s);
  return {
    ...wdl(gs),
    medianAcc: r1(median(gs.map((g) => g.acc))),
    blunders: gs.reduce((a, g) => a + g.blunders, 0),
    mistakes: gs.reduce((a, g) => a + g.mistakes, 0),
  };
};
const openings = {};
for (const g of games.filter((x) => x.opening))
  openings[g.opening] = (openings[g.opening] ?? 0) + 1;
const wins = games.filter((g) => g.result === 'W');
const draws = games.filter((g) => g.result === 'D');
const losses = games.filter((g) => g.result === 'L');
const lowest = games.reduce((a, g) => (g.low < a.low ? g : a), games[0]);
const summary = {
  player: PLAYER,
  window: `${games[0].date} .. ${games.at(-1).date}`,
  ...wdl(games),
  accuracy: {
    median: r1(median(games.map((g) => g.acc))),
    min: Math.min(...games.map((g) => g.acc)),
    max: Math.max(...games.map((g) => g.acc)),
  },
  lowestWinChance: { value: lowest.low, key: lowest.key, ply: lowest.lowPly },
  red: colour('red'),
  black: colour('black'),
  openingsAsRed: openings,
  medianMovesWin: median(wins.map((g) => g.moves)),
  medianMovesDraw: median(draws.map((g) => g.moves)),
  drawsUnder30Moves: draws.filter((g) => g.moves <= 30).length,
  winsOppErredFirst: wins.filter((g) => g.firstBad?.who === 'opp').length,
  winsNoOppError: wins.filter((g) => !g.firstBad || g.oppBlunders + g.oppMistakes === 0).length,
  lossesHeErredFirst: losses.filter((g) => g.firstBad?.who === 'him').length,
  gamesUnmarked: games.filter((g) => g.unmarked).length,
  events: byEvent.map((e) => ({
    event: e.event,
    from: e.from,
    to: e.to,
    ...wdl(e.games),
    medianAcc: r1(median(e.games.map((g) => g.acc))),
  })),
};

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
console.log(
  `${pad('key', 9)} ${pad('date', 10)} ${pad('side', 5)} ${pad('opponent', 8)} r ${lpad('mv', 3)} ${lpad('acc', 5)} ${lpad('opp', 5)} ${lpad('low', 5)} ${lpad('@', 4)} ${lpad('swing', 5)} ${lpad('@', 4)} ${pad('who', 4)} ${pad('1st', 8)} b/m/i  ob/om`,
);
for (const e of byEvent) {
  const s = wdl(e.games);
  console.log(`\n# ${e.event}  ${e.from}..${e.to}  ${s.W}W ${s.D}D ${s.L}L`);
  for (const g of e.games) {
    const first = g.firstBad ? `${g.firstBad.who}@${g.firstBad.ply}` : '-';
    console.log(
      `${pad(g.key, 9)} ${pad(g.date, 10)} ${pad(g.side, 5)} ${pad(g.opponent, 8)} ${g.result} ${lpad(g.moves, 3)} ${lpad(g.acc, 5)} ${lpad(g.oppAcc, 5)} ${lpad(g.low, 5)} ${lpad(g.lowPly, 4)} ${lpad(g.swing, 5)} ${lpad(g.swingPly, 4)} ${pad(g.swingWho, 4)} ${pad(first, 8)} ${g.blunders}/${g.mistakes}/${g.inaccuracies}  ${g.oppBlunders}/${g.oppMistakes}${g.unmarked ? '  unmarked' : ''}`,
    );
  }
}
console.log('\n', JSON.stringify(summary, null, 2));
if (JSON_OUT) writeFileSync(JSON_OUT, `${JSON.stringify({ summary, games }, null, 2)}\n`);
