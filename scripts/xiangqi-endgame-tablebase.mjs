#!/usr/bin/env node
/**
 * Walk a corpus position through chessdb.cn and emit the line, in the shape
 * seed-xiangqi-endgame-study.ts already reads (--json).
 *
 *   node scripts/xiangqi-endgame-tablebase.mjs --id three-soldiers-vs-full-defence
 *   node scripts/xiangqi-endgame-tablebase.mjs --all --out /tmp/verify.json
 *   node scripts/xiangqi-endgame-tablebase.mjs --hub [--pikafish verify.json]
 *
 * --hub regenerates packages/game/src/xiangqi-endgame-hub-checks.ts: one row per
 * position the 象棋残局 page shows (xiangqi-endgame-hub.ts), with the database's
 * result and, for a win, the line walked to the end. A position the database
 * does not hold takes its row from a Pikafish run of verify-xiangqi-endgames.ts
 * (--json), and only when that run found a forced mate or a drawish read;
 * otherwise it gets no row and the page test fails until it is dropped.
 *
 * Why this exists next to verify-xiangqi-endgames.ts rather than inside it: that
 * script ASKS AN ENGINE what it thinks and prints the two verdicts side by side,
 * which needs a Pikafish binary. This one asks the cloud database, which answers
 * exactly for small material and needs nothing installed. When the two disagree
 * the database is right and the engine is searching; when the database has no
 * row it says so rather than guessing.
 *
 * `querypv` returns ONE move, not a variation, so a line has to be walked: ask,
 * apply the move through the real kernel, ask again. Every move is replayed
 * through `isStandardXiangqiLegalMove` on the way, so a move the database offers
 * that our rules reject stops the walk instead of producing a line that cannot
 * be played back.
 *
 * A drawn position yields no line, and that is correct rather than a failure:
 * there is no principal variation to show for "this holds".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  applyStandardXiangqiMove,
  endgameEntryEngineFen,
  endgameEntryState,
  endgameHubEntry,
  endgameHubPositionIds,
  isStandardXiangqiLegalMove,
  pikafishUciToXiangqiSquares,
  standardXiangqiEngineFen,
  XIANGQI_ENDGAME_CORPUS,
} from '@mistboard/game';

const args = process.argv.slice(2);
const argOf = (flag, fallback = '') => {
  const at = args.indexOf(`--${flag}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const ENDPOINT = 'http://www.chessdb.cn/chessdb.php';
const MAX_PLIES = args.includes('--hub') ? 160 : 60;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One request at a time, with backoff. The database throttles concurrency and
 * answers "rate limit exceeded" (or drops the connection) rather than queueing,
 * and other sessions on this machine query it too.
 */
async function ask(action, fen) {
  const url = `${ENDPOINT}?action=${action}&board=${encodeURIComponent(fen)}`;
  let wait = 2_000;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(250);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const text = (await response.text()).trim();
      if (response.ok && !/rate limit/i.test(text)) return text;
    } catch {
      // fall through to the backoff
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 60_000);
  }
  throw new Error(`chessdb did not answer ${action} for ${fen}`);
}

/** The exact verdict and distance, from the side to move. */
async function verdictOf(fen) {
  const text = await ask('queryall', fen);
  const best = text.split('|')[0] ?? '';
  const note = /note:[^(]*\((W|D|L)-M-(\d+)\)/.exec(best);
  if (!note) return { verdict: 'not-in-db', plies: null };
  return {
    verdict: note[1] === 'W' ? 'win' : note[1] === 'L' ? 'loss' : 'draw',
    plies: Number(note[2]),
  };
}

/**
 * The database's BEST move for a position, as our squares, or null.
 *
 * From `queryall` and not `querypv`, because querypv returns a winning move
 * rather than the shortest one: on the chariot-and-cannon counterexample it
 * walked 41 plies for a position the database calls mate in 34, and a chapter
 * that announces one number while showing a longer line teaches the wrong thing.
 * queryall ranks every move with its own distance, so picking the smallest
 * reproduces the line the announced distance refers to.
 *
 * chessdb speaks the rank-0 dialect Pikafish does, so `a4f4` is a5->f5 here.
 * Reusing pikafishUciToXiangqiSquares rather than redoing the arithmetic: the
 * first version skipped the conversion and every move came back illegal at ply
 * 0, which reads exactly like "the database has no line".
 */
async function bestMove(fen) {
  const text = await ask('queryall', fen);
  let best = null;
  for (const part of text.split('|')) {
    const uci = /move:([a-i]\d[a-i]\d)/.exec(part)?.[1];
    if (!uci) continue;
    const note = /note:[^(]*\((W|D|L)-M-(\d+)\)/.exec(part);
    // Prefer a win, and among wins the shortest. A move with no distance is a
    // fallback only, so a position the database ranks but cannot resolve still
    // produces a line rather than stopping.
    const rank = note?.[1] === 'W' ? Number(note[2]) : Number.POSITIVE_INFINITY;
    if (!best || rank < best.rank) best = { uci, rank };
  }
  return best ? pikafishUciToXiangqiSquares(best.uci) : null;
}

async function walk(entry) {
  const { verdict, plies } = await verdictOf(endgameEntryEngineFen(entry));
  // Nothing to walk: a draw has no winning line, and a position the database
  // does not hold has no answer at all.
  if (verdict !== 'win') return { verdict, plies, pv: [] };

  let state = endgameEntryState(entry);
  const pv = [];
  for (let ply = 0; ply < MAX_PLIES; ply += 1) {
    if (state.status.type !== 'playing') break;
    const move = await bestMove(standardXiangqiEngineFen(state));
    if (!move) break;
    // The database and our kernel must agree, or the line is not playable here.
    if (!isStandardXiangqiLegalMove(state, move)) break;
    state = applyStandardXiangqiMove(state, move);
    // Emitted in OUR notation: the seeder replays it with the same parser.
    pv.push(`${move.from}${move.to}`);
  }
  return { verdict, plies, pv, ended: state.status.type };
}

/** Walk every hub position and write the committed checks module. */
async function hub() {
  const pikafishPath = argOf('pikafish');
  const pikafish = pikafishPath ? JSON.parse(readFileSync(pikafishPath, 'utf8')) : [];
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const id of endgameHubPositionIds()) {
    const entry = endgameHubEntry(id);
    const fen = endgameEntryEngineFen(entry);
    const { verdict, plies, pv, ended } = await walk(entry);
    if (verdict !== 'not-in-db') {
      rows.push({
        id,
        fen,
        source: 'chessdb',
        result: verdict,
        distance: plies,
        pv,
        checkedAt: today,
      });
      console.log(
        `${id.padEnd(44)} db=${verdict} ${plies ?? ''} pv=${pv.length} end=${ended ?? ''}`,
      );
      continue;
    }
    // No database row: accept a Pikafish forced mate (with its line) or a
    // drawish read. Anything else is left out, so the page test fails loudly.
    const read = pikafish.find((row) => row.id === id && row.fen === fen);
    if (read && read.mate != null && read.mate > 0 && read.pv?.length) {
      rows.push({
        id,
        fen,
        source: 'pikafish',
        result: 'win',
        distance: read.mate,
        pv: read.pv,
        checkedAt: today,
      });
      console.log(`${id.padEnd(44)} pikafish mate ${read.mate}`);
    } else if (read && read.mate == null && read.read === 'drawish') {
      rows.push({
        id,
        fen,
        source: 'pikafish',
        result: 'draw',
        distance: null,
        pv: [],
        checkedAt: today,
      });
      console.log(`${id.padEnd(44)} pikafish drawish cp=${read.cp} depth=${read.depth}`);
    } else {
      console.log(`${id.padEnd(44)} UNCHECKED (not in db, no usable Pikafish read)`);
    }
  }
  const body = rows.map((row) => `  ${JSON.stringify(row)},`).join('\n');
  const out = `// GENERATED by scripts/xiangqi-endgame-tablebase.mjs --hub. Do not edit by hand.
//
// One row per position the 象棋残局 page shows. \`result\` is from the side to
// move. chessdb rows are exact lookups; \`pv\` is the database's shortest win
// walked through our kernel, in our square notation. pikafish rows exist only
// for positions the database does not hold: a forced mate with its line, or a
// drawish read at the depth the run used (evidence for a draw, not proof).
export type EndgameHubCheck = {
  id: string;
  fen: string;
  source: 'chessdb' | 'pikafish';
  result: 'win' | 'draw' | 'loss';
  distance: number | null;
  pv: readonly string[];
  checkedAt: string;
};

export const XIANGQI_ENDGAME_HUB_CHECKS: readonly EndgameHubCheck[] = [
${body}
];
`;
  const target = new URL('../packages/game/src/xiangqi-endgame-hub-checks.ts', import.meta.url);
  writeFileSync(target, out);
  console.log(`\nwrote ${target.pathname} (${rows.length} rows)`);
}

async function main() {
  if (args.includes('--hub')) return hub();
  const only = argOf('id');
  const entries = args.includes('--all')
    ? XIANGQI_ENDGAME_CORPUS
    : XIANGQI_ENDGAME_CORPUS.filter((e) => e.id === only);
  if (!entries.length)
    throw new Error(only ? `no corpus entry ${only}` : 'pass --id <id> or --all');

  const rows = [];
  for (const entry of entries) {
    const { verdict, plies, pv, ended } = await walk(entry);
    const agrees = verdict === 'not-in-db' ? false : verdict === entry.verdict;
    rows.push({
      id: entry.id,
      cp: null,
      // The distance OF THE LINE THIS EMITS, in moves, so the "mate in N" the
      // chapter prints matches the mainline beside it. Deliberately not the
      // database's own figure: that is a move count under best play by both
      // sides, the walk takes the database's preferred defence rather than the
      // most stubborn one, and the two differ (34 vs the 41 plies walked).
      mate: verdict === 'win' && pv.length ? Math.ceil(pv.length / 2) : null,
      depth: 0,
      pv,
      read: `tablebase:${verdict}`,
      agrees,
      expected: entry.verdict === 'win',
      unresolved: verdict === 'not-in-db',
    });
    console.log(
      `${entry.id.padEnd(46)} corpus=${entry.verdict.padEnd(5)} db=${verdict.padEnd(10)} ` +
        `${plies == null ? '' : `${plies}ply `}pv=${pv.length}${ended ? ` end=${ended}` : ''}` +
        `${agrees ? '' : '   <-- DISAGREES'}`,
    );
  }

  const out = argOf('out');
  if (out) {
    writeFileSync(out, JSON.stringify(rows, null, 2));
    console.log(`\nwrote ${out} (${rows.length} rows)`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
