#!/usr/bin/env node
// Prototype: can we compute POSITIVE move annotations (! !? !!) for xiangqi?
//
// Our classifier has only the negative classes (blunder / mistake / inaccuracy),
// because that is all lichess computes and ours is a port of theirs. chess.com
// has positive ones but is closed; the useful public work is arXiv 2406.11895,
// which finds that brilliance is PERCEPTUAL: their signal comes from the gap
// between a superhuman engine and a HUMAN-strength one (Maia). A move is
// brilliant when it is strong and a human would not find it.
//
// We have no Maia for xiangqi. We do have one engine at two budgets, which is a
// serviceable stand-in for the same gap. This measures four features per
// candidate ply and reports what a rule built on them would actually mark.
//
//   node scripts/xq-positive-annotations.mjs --games <dir> --anno <dir> [--limit N]
//
// Read-only. Prints a table; changes nothing.

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pikafishXiangqiNetPath,
  pikafishXiangqiPath,
} from '../apps/server/src/xiangqi-pikafish-paths.ts';
import {
  applyMove,
  createInitialXiangqiState,
  getStandardXiangqiLegalMoves,
} from '../packages/game/dist/index.js';
import { xiangqiMoveToPikafishUci } from '../packages/game/dist/xiangqi-uci.js';

const STRONG_NODES = 1_000_000;
const WEAK_NODES = 20_000; // stands in for "what a strong human would see"
const MULTIPV = 3;

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const gamesDir = argOf('games');
const annoDir = argOf('anno');
const limit = Number(argOf('limit', '0')) || 0;
if (!gamesDir || !annoDir) {
  console.error('--games <dir> and --anno <dir> are required');
  process.exit(1);
}

// The server's engine: the patched pikafish.ref build on the CC0 net (#989); the
// two MISTBOARD_PIKAFISH_XIANGQI_* env vars still override it.
const bin = pikafishXiangqiPath();
const net = pikafishXiangqiNetPath(bin);

// --- minimal persistent UCI driver ------------------------------------------
// Skips `lowerbound`/`upperbound` rows: those are aborted iterations, not
// results (see the 2026-08-27 fix in uci-engine-harness).
function engine() {
  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      for (const w of waiters) w(line);
      nl = buf.indexOf('\n');
    }
  });
  const send = (s) => child.stdin.write(`${s}\n`);
  const until = (predicate, onLine) =>
    new Promise((resolve) => {
      const w = (line) => {
        onLine?.(line);
        const done = predicate(line);
        if (done !== undefined && done !== false) {
          waiters.splice(waiters.indexOf(w), 1);
          resolve(done);
        }
      };
      waiters.push(w);
    });
  return {
    async init() {
      send('uci');
      await until((l) => l === 'uciok' || undefined);
      send(`setoption name EvalFile value ${net}`);
      send('ucinewgame');
      send('isready');
      await until((l) => l === 'readyok' || undefined);
    },
    async go(moves, { nodes, multipv }) {
      send(`setoption name MultiPV value ${multipv}`);
      send(`position startpos moves ${moves.join(' ')}`);
      const table = new Map();
      send(`go nodes ${nodes}`);
      const best = await until(
        (l) => (l.startsWith('bestmove') ? l.split(/\s+/)[1] : undefined),
        (l) => {
          if (!l.startsWith('info ') || !l.includes(' score ') || !l.includes(' pv ')) return;
          if (l.includes('lowerbound') || l.includes('upperbound')) return;
          const t = l.split(/\s+/);
          let idx = 1;
          let cp = null;
          let mate = null;
          let move = null;
          for (let i = 1; i < t.length; i += 1) {
            if (t[i] === 'multipv') idx = Number(t[i + 1]);
            else if (t[i] === 'score') {
              if (t[i + 1] === 'cp') cp = Number(t[i + 2]);
              else if (t[i + 1] === 'mate') mate = Number(t[i + 2]);
            } else if (t[i] === 'pv') {
              move = t[i + 1];
              break;
            }
          }
          if (move) table.set(idx, { cp, mate, move });
        },
      );
      return { best, table };
    },
    close: () => child.kill('SIGKILL'),
  };
}

const VALUE = {
  chariot: 9,
  cannon: 4.5,
  horse: 4,
  advisor: 2,
  elephant: 2,
  soldier: 1,
  general: 0,
};
const material = (board, color) =>
  Object.values(board).reduce((t, p) => t + (p.color === color ? (VALUE[p.role] ?? 0) : 0), 0);

// A sacrifice in chess.com's sense: after the exchange SETTLES, the mover is
// down material that never came back.
//
// Two wrong versions preceded this one, both caught by hand-checking a claimed
// hit. Measuring the mover's own material marks every even trade as a sacrifice.
// Measuring the MINIMUM balance over a fixed window is worse: it picks up a
// trough several plies later from an unrelated exchange, which is how
// `9... R6+4` in m_23400 -- a chariot CAPTURE -- scored as a 9-point sacrifice.
// Compare the settled balance instead, and settle by waiting for captures to
// stop rather than by counting plies.
function settledBalance(states, from, mover) {
  const other = mover === 'red' ? 'black' : 'red';
  const bal = (i) => material(states[i].board, mover) - material(states[i].board, other);
  const pieces = (i) => Object.keys(states[i].board).length;
  let quiet = 0;
  let i = from;
  while (i + 1 < states.length && quiet < 2 && i - from < 8) {
    quiet = pieces(i + 1) === pieces(i) ? quiet + 1 : 0;
    i += 1;
  }
  return bal(i);
}

function sacrificeSize(states, ply, mover) {
  const other = mover === 'red' ? 'black' : 'red';
  const before = material(states[ply - 1].board, mover) - material(states[ply - 1].board, other);
  return Math.max(0, before - settledBalance(states, ply, mover));
}

const files = readdirSync(annoDir).filter((f) => f.endsWith('.json'));
const eng = engine();
await eng.init();
const found = [];
let scanned = 0;

for (const file of files) {
  const key = file.replace('.json', '');
  const anno = JSON.parse(readFileSync(join(annoDir, file), 'utf8'));
  const game = JSON.parse(readFileSync(join(gamesDir, file), 'utf8'));
  const uci = game.moves.map((m) => xiangqiMoveToPikafishUci(m));

  const states = [createInitialXiangqiState(key)];
  for (const m of game.moves) states.push(applyMove(states[states.length - 1], m));

  for (const row of anno.rows) {
    if (row.judgment) continue; // a marked error is not a candidate
    if (!row.best || row.best !== row.uci) continue; // must be the engine's choice
    if (limit && scanned >= limit) break;
    scanned += 1;

    const prefix = uci.slice(0, row.ply - 1);
    const mover = row.side;
    const legal = getStandardXiangqiLegalMoves(states[row.ply - 1]).length;
    const sac = sacrificeSize(states, row.ply, mover);

    const strong = await eng.go(prefix, { nodes: STRONG_NODES, multipv: MULTIPV });
    const first = strong.table.get(1);
    const second = strong.table.get(2);
    const gap =
      first && second && first.cp != null && second.cp != null ? first.cp - second.cp : null;

    const weak = await eng.go(prefix, { nodes: WEAK_NODES, multipv: 1 });
    const weakAgrees = weak.best === row.uci;

    found.push({
      key,
      ply: row.ply,
      move: `${row.moveNumber}${mover === 'red' ? '.' : '...'} ${row.wxf}`,
      chinese: row.chinese,
      gap,
      sac: Number(sac.toFixed(1)),
      legal,
      weakAgrees,
    });
  }
  if (limit && scanned >= limit) break;
}
eng.close();

// --- what a rule built on these features would mark --------------------------
// The first draft required the move to be CLEAR of the second-best AND missed
// by the weak budget. Over 920 candidates those two fire together once and with
// a sacrifice never: a wide gap means the move is obvious, which is precisely
// when a weak search also finds it. They are opposite ends of one axis, not
// independent evidence. chess.com does not use the gap either -- it leans on the
// sacrifice, which is a move that LOOKS wrong while being right, i.e. the
// perceptual gap encoded without needing a human-model engine.
const SAC_MIN = 2; // an advisor or elephant, never recovered
const NOT_FORCED = 5; // a real choice existed
const rate = (f) => found.filter(f).length;
const bang = (r) => r.legal >= NOT_FORCED && !r.weakAgrees;
const bangbang = (r) => r.legal >= NOT_FORCED && r.sac >= SAC_MIN;

console.log(`scanned ${scanned} candidate plies across ${files.length} games\n`);
console.log(`weak engine (${WEAK_NODES} nodes) disagrees      : ${rate((r) => !r.weakAgrees)}`);
console.log(
  `clear of 2nd best by >=60cp              : ${rate((r) => r.gap != null && r.gap >= 60)}  (reported, not used)`,
);
console.log(
  `unrecovered sacrifice >=${SAC_MIN}                 : ${rate((r) => r.sac >= SAC_MIN)}`,
);
console.log(`\nwould mark "!"  : ${rate(bang)}`);
console.log(`would mark "!!" : ${rate(bangbang)}`);
if (process.env.XQPA_DUMP) {
  console.log('\nall candidates (feature dump):');
  for (const r of found) {
    console.log(
      `  ${r.key.padEnd(10)} ${r.move.padEnd(12)} gap ${String(r.gap ?? '-').padStart(6)}  sac ${String(r.sac).padStart(5)}  legal ${String(r.legal).padStart(3)}  weakAgrees ${r.weakAgrees}`,
    );
  }
}
console.log('\ncandidates the rule marks:');
for (const r of found.filter(bang)) {
  console.log(
    `  ${bangbang(r) ? '!!' : '! '} ${r.key.padEnd(10)} ${r.move.padEnd(12)} ${(r.chinese ?? '').padEnd(6)} gap ${String(r.gap).padStart(5)}cp  sac ${r.sac}  legal ${r.legal}`,
  );
}
