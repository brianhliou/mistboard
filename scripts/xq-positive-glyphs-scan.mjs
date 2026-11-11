#!/usr/bin/env node
// Measure what the positive-glyph classifier (packages/game/src/
// xiangqi-move-classification.ts) would mark over annotated games, and print
// every hit with enough context to hand-check it.
//
//   node scripts/xq-positive-glyphs-scan.mjs --games <dir> --anno <dir> [--keys k1,k2] [--no-engine]
//
// <games dir>: dpxq-archive-harvest.mjs output. <anno dir>: annotate-game.mjs
// --json output for the same keys (1M-node evals, PV 1). `!!` needs only those.
// `!` needs the second-best move, which the persisted analysis does not carry, so
// the scan runs a MultiPV 2 search (same node budget) on the plies that pass
// every other test first; --no-engine skips that and reports `!` as unknown.
//
// Read-only. Prints a report; changes nothing.

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pikafishXiangqiNetPath,
  pikafishXiangqiPath,
  XIANGQI_ANALYSIS_NODES,
} from '../apps/server/dist/xiangqi-pikafish-engine.js';
import { winPercent } from '../packages/game/dist/analysis.js';
import { createInitialXiangqiState } from '../packages/game/dist/variants-xiangqi.js';
import { applyXiangqiRecordMove } from '../packages/game/dist/variants-xiangqi-standard.js';
import {
  classifyXiangqiMove,
  XIANGQI_POSITIVE_GLYPH_SYMBOL,
} from '../packages/game/dist/xiangqi-move-classification.js';
import {
  pikafishUciToXiangqiSquares,
  xiangqiMoveToPikafishUci,
} from '../packages/game/dist/xiangqi-uci.js';

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const gamesDir = argOf('games');
const annoDir = argOf('anno');
const onlyKeys = argOf('keys', '').split(',').filter(Boolean);
const useEngine = !args.includes('--no-engine');
if (!gamesDir || !annoDir) {
  console.error('--games <dir> and --anno <dir> are required');
  process.exit(1);
}

// --- minimal persistent MultiPV driver ---------------------------------------
// The server's UciEngineSession keeps one score per search (PV 1 only), so the
// second line needs its own reader. Bounded rows are aborted iterations, not
// results, and are skipped (the 2026-08-27 uci-engine-harness fix).
function engine(bin, net) {
  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      for (const w of [...waiters]) w(line);
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
      send('setoption name MultiPV value 2');
      send('ucinewgame');
      send('isready');
      await until((l) => l === 'readyok' || undefined);
    },
    /** Side-to-move POV table: index -> { cp, mate, move }. */
    async multipv(moves, nodes) {
      send(`position startpos moves ${moves.join(' ')}`);
      const table = new Map();
      send(`go nodes ${nodes}`);
      await until(
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
          if (move) table.set(idx, { cp, mate, move, pv: t.slice(t.indexOf('pv') + 1) });
        },
      );
      return table;
    },
    close: () => child.kill('SIGKILL'),
  };
}

let eng = null;
if (useEngine) {
  const bin = pikafishXiangqiPath();
  eng = engine(bin, pikafishXiangqiNetPath(bin));
  await eng.init();
}

const files = readdirSync(annoDir)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => onlyKeys.length === 0 || onlyKeys.includes(f.replace('.json', '')));

const reasons = new Map();
const hits = [];
let plies = 0;
let secondSearches = 0;
let captureSearches = 0;

for (const file of files) {
  const key = file.replace('.json', '');
  const anno = JSON.parse(readFileSync(join(annoDir, file), 'utf8'));
  const game = JSON.parse(readFileSync(join(gamesDir, file), 'utf8'));
  const uci = game.moves.map((m) => xiangqiMoveToPikafishUci(m));

  let state = createInitialXiangqiState(key);
  const gameHits = [];
  for (const row of anno.rows) {
    const move = game.moves[row.ply - 1];
    const before = state;
    if (before.status.type !== 'playing') break;
    const next = applyXiangqiRecordMove(before, move);
    if (next === before) {
      console.log(`   (${key}: ply ${row.ply} rejected by the kernel; stopping here)`);
      break;
    }
    state = next;
    plies += 1;

    // The opponent's previous row holds their POV win% two plies back.
    const prior = anno.rows[row.ply - 2];
    const base = {
      before,
      move,
      winBefore: row.winBefore,
      winAfter: row.winAfter,
      playedBest: row.best === row.uci,
      winTwoPliesAgo: prior ? 100 - prior.winBefore : null,
      // The next row's pv is the engine's line from the position after this move.
      pvAfter: (anno.rows[row.ply]?.pv ?? [])
        .map((u) => pikafishUciToXiangqiSquares(u))
        .filter(Boolean),
    };
    let result = classifyXiangqiMove(base);
    let second = null;
    // A declined offer needs the capture line to be settled: search it.
    if (result.reason === 'sacrifice-unverified' && eng && result.material.offeredPiece) {
      captureSearches += 1;
      const { capturer, square } = result.material.offeredPiece;
      const captureUci = xiangqiMoveToPikafishUci({ from: capturer, to: square });
      const table = await eng.multipv(
        [...uci.slice(0, row.ply), captureUci],
        XIANGQI_ANALYSIS_NODES,
      );
      const line = (table.get(1)?.pv ?? [])
        .map((u) => pikafishUciToXiangqiSquares(u))
        .filter(Boolean);
      base.pvAfterCapture = line;
      result = classifyXiangqiMove(base);
    }
    if (result.reason === 'no-second-best' && eng) {
      secondSearches += 1;
      const table = await eng.multipv(uci.slice(0, row.ply - 1), XIANGQI_ANALYSIS_NODES);
      const first = table.get(1);
      second = table.get(2);
      if (first && second) {
        // Both lines come from ONE search, so the gap is consistent; the
        // persisted winBefore came from a different one.
        const winFirst = winPercent(first.cp, first.mate);
        const winSecond = winPercent(second.cp, second.mate);
        result = classifyXiangqiMove({
          ...base,
          winBefore: winFirst,
          playedBest: first.move === row.uci,
          secondBestWin: winSecond,
        });
        second = {
          ...second,
          win: winSecond,
          gap: winFirst - winSecond,
          punish: base.winTwoPliesAgo == null ? null : winFirst - base.winTwoPliesAgo,
        };
      } else {
        result = { ...result, reason: 'no-second-line' };
      }
    }
    reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
    if (result.glyph) {
      const hit = {
        key,
        ply: row.ply,
        move: `${row.moveNumber}${row.side === 'red' ? '.' : '...'} ${row.wxf}`,
        chinese: row.chinese,
        glyph: XIANGQI_POSITIVE_GLYPH_SYMBOL[result.glyph],
        reason: result.reason,
        winBefore: row.winBefore,
        winAfter: row.winAfter,
        offered: result.material.offered,
        sacrifice: result.sacrifice,
        evidence: result.sacrificeEvidence,
        captured: result.material.captured,
        offeredPiece: result.material.offeredPiece,
        second,
        legal: result.legalMoves,
      };
      hit.key = key;
      hits.push(hit);
      gameHits.push(hit);
    }
  }
  console.log(
    `${key.padEnd(10)} ${game.title}  ${game.result}  ${anno.rows.length} plies  hits ${gameHits.length}`,
  );
  for (const h of gameHits) {
    const detail =
      h.glyph === '!!'
        ? `offers ${h.offeredPiece?.role}@${h.offeredPiece?.square} (net ${h.sacrifice} by ${h.evidence}, taker ${h.offeredPiece?.capturer}${h.captured ? `, took ${h.captured}` : ''})`
        : `2nd ${h.second?.move} at ${h.second?.win?.toFixed(1)}% (gap ${h.second?.gap?.toFixed(1)}, punishes ${h.second?.punish?.toFixed(1)})`;
    console.log(
      `   ${h.glyph.padEnd(2)} ply ${String(h.ply).padStart(3)}  ${h.move.padEnd(12)} ${(h.chinese ?? '').padEnd(6)} win ${h.winBefore}->${h.winAfter}  legal ${h.legal}  ${detail}`,
    );
  }
}
eng?.close();

console.log(
  `\n${files.length} games, ${plies} plies, ${secondSearches} second-best searches, ${captureSearches} capture-line searches`,
);
console.log(`marked !! : ${hits.filter((h) => h.glyph === '!!').length}`);
console.log(`marked !  : ${hits.filter((h) => h.glyph === '!').length}`);
// Emit the hits so a seeder can attach the NAGs without running an engine of
// its own: the inputs this needs (second-best win, the capture line) are not in
// the persisted analysis, so the scan is the only place they exist.
const outPath = process.argv[process.argv.indexOf('--out') + 1];
if (process.argv.includes('--out') && outPath) {
  const byKey = {};
  for (const hit of hits) {
    byKey[hit.key] ??= [];
    byKey[hit.key].push(hit);
  }
  writeFileSync(
    outPath,
    `${JSON.stringify({ schema: 'mistboard.xiangqi.positive-glyphs.v1', byKey }, null, 2)}\n`,
  );
  console.log(`\nwrote ${hits.length} hits to ${outPath}`);
}
console.log('\nwhy plies were not marked:');
for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(28)} ${n}`);
}
