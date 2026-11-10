#!/usr/bin/env node
// The FITTING half of the win-curve calibration. `calibrate-win-curve.mjs`
// collects samples (position eval + the result of the game it came from); this
// turns them into the numbers quoted in the packages/game/src/analysis.ts header:
// the best-fit K, its ratio to the chess constant, the log-loss both ways, the
// by-game bootstrap CI, and the near-equality band check.
//
//   node scripts/calibrate-win-curve.mjs 70      # writes tmp/win-curve-samples.json
//   node scripts/fit-win-curve.mjs               # reads it, prints the report
//   node scripts/fit-win-curve.mjs --in tmp/x.json --boot 2000
//
// WHY THIS FILE EXISTS. Before 2026-09-01 it did not, and that was the real gap:
// the 2026-08-27 note quoted K = 0.00623, a 1.69x ratio, log-loss 0.6219 ->
// 0.6124 and a CI of 0.0033-0.0114, but the only committed code stopped at
// sample collection. The headline numbers were computed off to one side and
// never shipped, so "the script reproduces it" was never true of the result --
// only of the inputs. A number in a comment that no code can regenerate is a
// number that will be re-derived by hand, differently, by whoever needs it next.
//
// BOOTSTRAP BY GAME, NOT BY SAMPLE. Positions inside one game share that game's
// result, so they are not independent observations; ~856 samples is closer to 70.
// Resampling rows instead of games understates the CI by roughly the average
// number of samples per game, which is exactly the error that would make a
// 1.69x point estimate look decisive.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors packages/game/src/analysis.ts. Kept as literals rather than imported so
// this runs without a built dist -- but it must track that file.
const WIN_PCT_CLAMP_CP = 1000;
const CHESS_K = 0.00368208;
const mateToCp = (mate) => (21 - Math.min(10, Math.abs(mate))) * 100 * Math.sign(mate);
/** Red-POV win probability in [0,1] for a candidate K. */
function predict(sample, k) {
  const cp =
    sample.mate != null
      ? mateToCp(sample.mate)
      : Math.max(-WIN_PCT_CLAMP_CP, Math.min(WIN_PCT_CLAMP_CP, sample.cp));
  return 1 / (1 + Math.exp(-k * cp));
}

/** Log-loss against soft targets: draws are y = 0.5, not a third class. */
function logLoss(samples, k) {
  const EPS = 1e-12;
  let total = 0;
  for (const s of samples) {
    const p = Math.min(1 - EPS, Math.max(EPS, predict(s, k)));
    total += -(s.redScore * Math.log(p) + (1 - s.redScore) * Math.log(1 - p));
  }
  return total / samples.length;
}

/** Ternary search: log-loss in K is unimodal over this range for a logistic link. */
function fitK(samples, lo = 0.0002, hi = 0.03, iters = 80) {
  let a = lo;
  let b = hi;
  for (let i = 0; i < iters; i += 1) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (logLoss(samples, m1) < logLoss(samples, m2)) b = m2;
    else a = m1;
  }
  return (a + b) / 2;
}

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const inPath = resolve(REPO_ROOT, argValue('--in', 'tmp/win-curve-samples.json'));
const bootN = Number(argValue('--boot', '2000'));
// Fixed by default so two runs on one corpus agree. Vary it deliberately to see
// how much of a borderline result is seed noise.
const seed = Number(argValue('--seed', '20260901'));

const raw = JSON.parse(readFileSync(inPath, 'utf8'));
const samples = (raw.samples ?? raw).filter(
  (s) => s.redScore != null && (s.cp != null || s.mate != null),
);
if (!samples.length) throw new Error(`no usable samples in ${inPath}`);

// Group by game once: every bootstrap replicate draws whole games.
const byGame = new Map();
for (const s of samples) {
  const g = byGame.get(s.key) ?? [];
  g.push(s);
  byGame.set(s.key, g);
}
const games = [...byGame.values()];

const bestK = fitK(samples);
const lossChess = logLoss(samples, CHESS_K);
const lossBest = logLoss(samples, bestK);

console.log(`samples: ${samples.length} from ${games.length} games  (${inPath})`);
console.log('');
console.log(`chess constant K = ${CHESS_K.toFixed(8)}   log-loss ${lossChess.toFixed(4)}`);
console.log(
  `best fit       K = ${bestK.toFixed(8)}   log-loss ${lossBest.toFixed(4)}   (${(bestK / CHESS_K).toFixed(2)}x steeper)`,
);

// By-game bootstrap. SEEDED: an unseeded run of this is not reproducible, and
// reproducibility is the entire point of the file. mulberry32, seed via --seed.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = makeRng(seed);
const boots = [];
for (let i = 0; i < bootN; i += 1) {
  const pick = [];
  for (let g = 0; g < games.length; g += 1) pick.push(...games[(rand() * games.length) | 0]);
  boots.push(fitK(pick, 0.0002, 0.03, 50));
}
boots.sort((x, y) => x - y);
const pct = (p) => boots[Math.min(boots.length - 1, Math.floor(p * boots.length))];
const [lo, hi] = [pct(0.025), pct(0.975)];
// Where the chess constant actually sits in the bootstrap distribution. Report
// THIS, not a bare in/out verdict: on this corpus the constant lands within a
// point or two of the 2.5% edge, so a binary CONTAINS/EXCLUDES flips with the
// seed and the replicate count -- it read CONTAINS at 2000 and EXCLUDES at 300
// on the same data. A percentile is stable and says the same thing honestly.
const below = boots.filter((k) => k < CHESS_K).length;
const rank = (100 * below) / boots.length;
const marginal = rank < 5 || rank > 95;
console.log('');
console.log(
  `by-game bootstrap (${bootN} replicates, seed ${seed}): 95% CI ${lo.toFixed(4)} - ${hi.toFixed(4)}`,
);
console.log(
  `  chess constant ${CHESS_K.toFixed(5)} sits at the ${rank.toFixed(1)} percentile of the bootstrap distribution`,
);
if (marginal) {
  console.log(
    '  -> MARGINAL: within the outer 5% tail, so an in/out verdict is not stable across seeds.',
  );
  console.log(
    '     Do not refit on this. A constant the corpus can neither confirm nor exclude is a',
  );
  console.log('     constant this corpus is too small to change -- that is the finding.');
} else {
  console.log(
    `  -> the corpus is consistent with the chess constant; refitting on it would be fitting noise.`,
  );
}

// Band table. The near-equality band is the one that decides whether the curve is
// right where judgments actually happen -- most of the corpus lives there.
const BANDS = [75, 150, 250, 400, 600, 1000, Infinity];
console.log('');
console.log('                        --- Red POV ---   --- folded ---');
console.log(
  `${'band (|cp|)'.padEnd(14)} ${'n'.padStart(5)} ${'observed'.padStart(9)} ${'predicted'.padStart(10)} ${'observed'.padStart(10)} ${'predicted'.padStart(11)}`,
);
let prev = 0;
for (const edge of BANDS) {
  const inBand = samples.filter((s) => {
    const v = Math.abs(s.mate != null ? mateToCp(s.mate) : s.cp);
    return v >= prev && v < edge;
  });
  if (inBand.length) {
    const mean = (f) => inBand.reduce((a, s) => a + f(s), 0) / inBand.length;
    const favoursRed = (s) => (s.mate != null ? mateToCp(s.mate) : s.cp) >= 0;
    // RED-POV is the primary pair, because it is the statistic the analysis.ts
    // note quotes ("the -75..+75cp band scored 0.500 observed against 0.511
    // predicted") and this script exists to regenerate those numbers.
    const obsRed = mean((s) => s.redScore);
    const predRed = mean((s) => predict(s, CHESS_K));
    // FOLDED to the better side is the more sensitive read -- Red-POV averages
    // the two signs against each other and hides slope error. But it is NOT
    // comparable to the note: at low |cp| the favoured side is picked by eval
    // noise, which pushes folded-observed above 0.5 on its own. Read the two
    // columns for different questions, never as the same measurement.
    const obsFold = mean((s) => (favoursRed(s) ? s.redScore : 1 - s.redScore));
    const predFold = mean((s) => {
      const p = predict(s, CHESS_K);
      return favoursRed(s) ? p : 1 - p;
    });
    const label = edge === Infinity ? `${prev}+` : `${prev}-${edge}`;
    console.log(
      `${label.padEnd(14)} ${String(inBand.length).padStart(5)} ${obsRed.toFixed(3).padStart(9)} ${predRed.toFixed(3).padStart(10)} ${obsFold.toFixed(3).padStart(10)} ${predFold.toFixed(3).padStart(11)}`,
    );
  }
  prev = edge;
}

const outPath = resolve(REPO_ROOT, argValue('--out', 'tmp/win-curve-fit.json'));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      samples: samples.length,
      games: games.length,
      chessK: CHESS_K,
      bestK,
      lossChess,
      lossBest,
      ci: [lo, hi],
      chessKPercentile: rank,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nwrote ${outPath}`);
