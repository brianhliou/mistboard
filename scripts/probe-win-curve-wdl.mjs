#!/usr/bin/env node
// Probe the engine's OWN win model against the one analysis.ts computes, on real
// positions. Answers two questions the 2026-08-27 calibration could not:
//
//   1. Does Pikafish's WDL model agree with the chess logistic in the 200-400cp
//      band, where the 70-game fit wanted a 1.69x steeper curve?
//   2. Would reading WDL instead of deriving win% from cp widen the measurable
//      zone in won positions (the conversion-grading question)?
//
// Answers, as of 2026-09-01: (1) the engine's model is far more confident, in the
// same direction the outcome fit pointed -- but DO NOT read that as corroboration.
// A chess control (Stockfish 18 vs lichess's own chess constant) reproduces the
// same divergence at equal or larger size, so it is a property of engine WDL
// models, not a fact about xiangqi. See the analysis.ts note before citing this
// script as evidence about WIN_PCT_K. (2) no -- WDL saturates HARDER than the
// clamped curve, pinning at W100.0 from about +5.5 material onward.
//
//   node scripts/probe-win-curve-wdl.mjs                  # default sample
//   node scripts/probe-win-curve-wdl.mjs --nodes 1000000  # one budget
//   node scripts/probe-win-curve-wdl.mjs --fen '<fen>'    # your own position
//
// DELIBERATELY SELF-CONTAINED. It spawns the binary directly and takes FENs as
// literals: no dist/ imports, no corpus directory. `calibrate-win-curve.mjs` is
// unrunnable today because it depends on both -- a worktree that was deleted and
// a scratchpad that was cleared. Do not add those dependencies here. The one
// import is the server's dependency-free path resolver, read from source, so the
// probe runs the patched pikafish.ref build on the CC0 net like the site (#989).
import { spawn } from 'node:child_process';
import {
  pikafishXiangqiNetPath,
  pikafishXiangqiPath,
} from '../apps/server/src/xiangqi-pikafish-paths.ts';

// Keep in sync with packages/game/src/analysis.ts: PIKAFISH_CC0_WIN_PCT_K, the
// curve for pikafish-xiangqi-analysis@6 (this engine). The 2026-09-01 answers
// above were read on the old net with @5's 0.00368208.
const WIN_PCT_CLAMP_CP = 1000;
const WIN_PCT_K = 0.00465696;
const clampedWinPercent = (cp) => {
  const c = Math.max(-WIN_PCT_CLAMP_CP, Math.min(WIN_PCT_CLAMP_CP, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_PCT_K * c)) - 1);
};

// Plies from xq_4a6da01c (guest, Black, flagged in a won position). Chosen to walk
// the material edge from level to +21 so saturation is visible as it happens.
const DEFAULT_POSITIONS = [
  {
    ply: 6,
    edge: 0.0,
    fen: 'rnbakabr1/9/1c2c1n2/p1p1p1p1p/9/9/P1P1P1PCP/4C4/R8/1NBAKABNR w - - 0 4',
  },
  {
    ply: 14,
    edge: 5.5,
    fen: '1rbakab2/9/1cn1c1n2/p1p1p1p1p/9/9/P1P1P1r1P/4C1N2/3RA4/1NB1KAB1R w - - 0 8',
  },
  {
    ply: 20,
    edge: 9.5,
    fen: '1rbak1b2/4a4/1cn1c1n2/p1p3p1p/4p4/1NP6/P3P3P/4C1r2/3RA4/2B1KAB1R w - - 0 11',
  },
  {
    ply: 28,
    edge: 14.5,
    fen: '1rbak1b2/4a4/4c1n2/p5p1p/1n2p4/Pcp6/3RP3P/4C1r2/4A4/2B1KABR1 w - - 0 15',
  },
  {
    ply: 34,
    edge: 18.0,
    fen: '1rbak1b2/4a4/4c1n2/p5p1p/P8/1cpn5/3RP3P/6r2/4A4/2B1KABR1 w - - 0 18',
  },
  { ply: 40, edge: 21.0, fen: '2bak1b2/4a4/6n2/p5p1p/1r7/c1pnP4/3R4P/4c1r2/4A4/4KABR1 w - - 0 21' },
];

/** Spawn one engine and keep it for every search: startup dominates otherwise. */
function openEngine(bin, nnue) {
  const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buffer = '';
  const waiters = [];
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl < 0) break;
      const line = buffer.slice(0, nl).trimEnd();
      buffer = buffer.slice(nl + 1);
      for (const w of waiters) w.lines.push(line);
      if (waiters.length && line.startsWith(waiters[0].token)) waiters.shift().done();
    }
  });
  const send = (s) => proc.stdin.write(`${s}\n`);
  const until = (token) =>
    new Promise((done) => {
      const w = { token, lines: [], done: () => done(w.lines) };
      waiters.push(w);
    });
  return {
    async init() {
      send('uci');
      await until('uciok');
      if (nnue) send(`setoption name EvalFile value ${nnue}`);
      send('setoption name UCI_ShowWDL value true');
      send('setoption name Threads value 1'); // deterministic: run-to-run variance is not the question
      send('isready');
      await until('readyok');
    },
    async go(fen, nodes) {
      send(`position fen ${fen}`);
      send(`go nodes ${nodes}`);
      return until('bestmove');
    },
    close() {
      send('quit');
    },
  };
}

/** Last complete `info ... score` line. Aborted iterations carry lower/upperbound. */
function parseFinal(lines) {
  let cp = null;
  let mate = null;
  let wdl = null;
  for (const line of lines) {
    if (!line.startsWith('info ') || !line.includes(' score ')) continue;
    const t = line.split(/\s+/);
    if (t.includes('lowerbound') || t.includes('upperbound')) continue;
    const i = t.indexOf('score');
    if (t[i + 1] === 'cp') {
      cp = Number(t[i + 2]);
      mate = null;
    } else if (t[i + 1] === 'mate') {
      mate = Number(t[i + 2]);
      cp = null;
    }
    const j = t.indexOf('wdl');
    if (j >= 0) wdl = [Number(t[j + 1]), Number(t[j + 2]), Number(t[j + 3])];
  }
  return { cp, mate, wdl };
}

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const budgets = (argValue('--nodes') ?? '250000,1000000,4000000').split(',').map(Number);
const ownFen = argValue('--fen');
const positions = ownFen ? [{ ply: null, edge: null, fen: ownFen }] : DEFAULT_POSITIONS;

const bin = pikafishXiangqiPath();
const engine = openEngine(bin, pikafishXiangqiNetPath(bin));
await engine.init();

const pad = (s, n) => String(s).padStart(n);
console.log(
  `${pad('ply', 4)} ${pad('edge', 7)} ${pad('nodes', 9)} ${pad('eval(stm)', 10)} ${pad('clampWP%', 9)}  engine WDL (better side)`,
);
for (const pos of positions) {
  for (const nodes of budgets) {
    const { cp, mate, wdl } = parseFinal(await engine.go(pos.fen, nodes));
    // Score and WDL are both side-to-move POV. Report from the side the ENGINE
    // favours, not the side material favours: at ply 6 those differ, and keying
    // off material printed that row from the losing seat under a "better side"
    // header. The eval sign is also the only signal available under --fen.
    const flip = mate !== null ? mate < 0 : cp !== null && cp < 0;
    const evalText = cp !== null ? String(cp) : `mate ${mate}`;
    const clamped =
      cp !== null
        ? (flip ? 100 - clampedWinPercent(cp) : clampedWinPercent(cp)).toFixed(2)
        : '(mate)';
    let wdlText = '(none)';
    if (wdl) {
      const [w, d, l] = wdl;
      const [win, loss] = flip ? [l, w] : [w, l];
      wdlText = `W${pad((win / 10).toFixed(1), 5)} D${pad((d / 10).toFixed(1), 5)} L${pad((loss / 10).toFixed(1), 5)}`;
    }
    console.log(
      `${pad(pos.ply ?? '-', 4)} ${pad(pos.edge === null ? '-' : pos.edge.toFixed(1), 7)} ${pad(nodes, 9)} ${pad(evalText, 10)} ${pad(clamped, 9)}  ${wdlText}`,
    );
  }
}
engine.close();
