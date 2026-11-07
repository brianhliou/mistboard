// Per-ply uniqueness audit for the live standard-xiangqi puzzle corpus.
//
// Independent re-verification of the gated miner (#180): for each solver ply
// it re-judges the position via the SHARED analyzeXiangqiSolverPly
// (scripts/variant-lab/xiangqi-pikafish-uci.ts) — the same history-free
// `position fen` load, the same MultiPV-2 search shape, the same score
// normalization (xiangqiUciScoreToCp), and the same winning-floor gate
// (isXiangqiSolverMoveUnique) the miner's verify pass enforces. Verdicts are
// therefore definitionally consistent with the miner (#185); what this tool
// adds is independence in TIME and BUDGET (it can re-run at a deeper depth
// floor than the mine did) plus the shipped-move comparison. It does not
// mutate the corpus.
//
// Scores are reported from the side-to-move (solver) POV, so a positive gap
// means the shipped move beats the runner-up. Mate scores fold onto the cp
// axis near XIANGQI_MATE_SCORE_CP. A depth floor (not just a node cap) is used
// because too-low search mis-orders best vs second and makes the gap lie.
//
// Run (needs the local Pikafish binary + NNUE net; auto-resolved via
// xiangqi-pikafish-engine.ts, or set MISTBOARD_PIKAFISH_XIANGQI_PATH/_NET):
//   node_modules/.bin/tsx scripts/variant-lab/xiangqi-puzzle-uniqueness-audit.ts \
//     --depth 22 --out scripts/variant-lab/out/xiangqi-uniqueness-audit.jsonl
//   # quick smoke on a handful first:
//   node_modules/.bin/tsx scripts/variant-lab/xiangqi-puzzle-uniqueness-audit.ts --limit 3 --depth 16

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  pikafishXiangqiNetPath,
  pikafishXiangqiPath,
} from '../../apps/server/src/xiangqi-pikafish-engine.ts';
import {
  applyStandardXiangqiMove,
  pikafishUciToXiangqiSquares,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPuzzle,
  xiangqiWinRate,
} from '../../packages/game/src/index.ts';
import { loadSeedPuzzleRegistry } from '../../packages/game/src/puzzle-seed.ts';
import {
  analyzeXiangqiSolverPly,
  PikafishEngine,
  XIANGQI_SOLVER_GATE_DEFAULTS,
} from './xiangqi-pikafish-uci.ts';

export type XiangqiPuzzleAuditOptions = {
  depth: number;
  nodes: number | null;
  winHi: number;
  winLo: number;
  minGapCp: number;
  limit: number;
  ids: Set<string> | null;
  out: string | null;
};

function parseOptions(): XiangqiPuzzleAuditOptions {
  const { values } = parseArgs({
    options: {
      depth: { type: 'string', default: '22' },
      nodes: { type: 'string' },
      // Winning-floor gate knobs: defaults come from the module shared with
      // the miner, so this audit stays an apples-to-apples re-verification of
      // the mined corpus rather than a second, drifting definition.
      'win-hi': { type: 'string', default: String(XIANGQI_SOLVER_GATE_DEFAULTS.winHi) },
      'win-lo': { type: 'string', default: String(XIANGQI_SOLVER_GATE_DEFAULTS.winLo) },
      'min-gap-cp': {
        type: 'string',
        default: String(XIANGQI_SOLVER_GATE_DEFAULTS.minGapCp),
      },
      limit: { type: 'string', default: '0' },
      ids: { type: 'string' },
      out: { type: 'string' },
    },
  });
  return {
    depth: parsePositiveInt(values.depth, 22),
    nodes: values.nodes ? parsePositiveInt(values.nodes, 0) || null : null,
    winHi: Number.parseFloat(values['win-hi'] ?? String(XIANGQI_SOLVER_GATE_DEFAULTS.winHi)),
    winLo: Number.parseFloat(values['win-lo'] ?? String(XIANGQI_SOLVER_GATE_DEFAULTS.winLo)),
    minGapCp: parsePositiveInt(values['min-gap-cp'], XIANGQI_SOLVER_GATE_DEFAULTS.minGapCp),
    limit: parsePositiveInt(values.limit, 0),
    ids: values.ids
      ? new Set(
          values.ids
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : null,
    out: values.out ?? null,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export type XiangqiPuzzleAuditPlyReport = {
  solutionPly: number;
  shippedMove: string;
  engineBestMove: string;
  matchesShipped: boolean;
  bestCp: number;
  secondCp: number | null;
  bestMate: number | null;
  secondMate: number | null;
  gapCp: number | null;
  gapWinrate: number | null;
  unique: boolean;
  uniquenessReason: string;
};

export type XiangqiPuzzleAuditReport = {
  id: string;
  goal: string;
  solverPlies: number;
  plies: XiangqiPuzzleAuditPlyReport[];
  allMatch: boolean;
  firstNonUniquePly: number | null; // solution index of the first non-unique solver ply
  verdict: 'clean' | 'non-unique-followups' | 'engine-disagrees';
};

function moveLabel(move: XiangqiMove): string {
  return `${move.from}-${move.to}`;
}

export async function auditXiangqiPuzzle(
  engine: PikafishEngine,
  puzzle: XiangqiPuzzle,
  opts: XiangqiPuzzleAuditOptions,
): Promise<XiangqiPuzzleAuditReport> {
  const gate = {
    winHi: opts.winHi,
    winLo: opts.winLo,
    minGapCp: opts.minGapCp,
  };
  const limits = { depth: opts.depth, ...(opts.nodes ? { nodes: opts.nodes } : {}) };
  const plies: XiangqiPuzzleAuditPlyReport[] = [];
  let state: XiangqiGameState = puzzle.initial;
  for (let ply = 0; ply < puzzle.solution.length; ply += 1) {
    const move = puzzle.solution[ply] as XiangqiMove;
    if (ply % 2 === 0 && state.status.type === 'playing') {
      const { lines, best, second, unique, reason } = await analyzeXiangqiSolverPly(
        engine,
        state,
        limits,
        gate,
      );
      const bestTok = lines[0]?.pvUci[0];
      const engineBest = bestTok ? pikafishUciToXiangqiSquares(bestTok) : null;
      const engineBestMove = engineBest ? `${engineBest.from}-${engineBest.to}` : (bestTok ?? '?');
      const matchesShipped = engineBest?.from === move.from && engineBest?.to === move.to;
      const bestCp = best?.scoreCp ?? 0;
      const secondCp = second?.scoreCp ?? null;
      const gapCp = secondCp === null ? null : bestCp - secondCp;
      const gapWinrate =
        secondCp === null ? null : xiangqiWinRate(bestCp) - xiangqiWinRate(secondCp);
      plies.push({
        solutionPly: ply,
        shippedMove: moveLabel(move),
        engineBestMove,
        matchesShipped,
        bestCp,
        secondCp,
        bestMate: best?.mate ?? null,
        secondMate: second?.mate ?? null,
        gapCp,
        gapWinrate,
        unique,
        uniquenessReason: reason,
      });
    }
    if (state.status.type !== 'playing') break;
    state = applyStandardXiangqiMove(state, move);
  }

  const allMatch = plies.every((p) => p.matchesShipped);
  const firstBad = plies.find((p) => !p.matchesShipped || !p.unique) ?? null;
  const verdict: XiangqiPuzzleAuditReport['verdict'] = !allMatch
    ? 'engine-disagrees'
    : plies.every((p) => p.unique)
      ? 'clean'
      : 'non-unique-followups';
  return {
    id: puzzle.id,
    goal: puzzle.goal.type,
    solverPlies: plies.length,
    plies,
    allMatch,
    firstNonUniquePly: firstBad ? firstBad.solutionPly : null,
    verdict,
  };
}

async function main(opts: XiangqiPuzzleAuditOptions): Promise<void> {
  const bin = pikafishXiangqiPath();
  const net = pikafishXiangqiNetPath(bin);
  const engine = new PikafishEngine(bin, net);
  await engine.init();

  let corpus = loadSeedPuzzleRegistry('xiangqi') as readonly XiangqiPuzzle[];
  if (opts.ids) corpus = corpus.filter((p) => opts.ids?.has(p.id));
  if (opts.limit > 0) corpus = corpus.slice(0, opts.limit);

  const reports: XiangqiPuzzleAuditReport[] = [];
  const summary = { clean: 0, nonUnique: 0, engineDisagrees: 0, singleMove: 0, multiMove: 0 };
  for (let i = 0; i < corpus.length; i += 1) {
    const puzzle = corpus[i] as XiangqiPuzzle;
    const report = await auditXiangqiPuzzle(engine, puzzle, opts);
    reports.push(report);
    if (report.solverPlies <= 1) summary.singleMove += 1;
    else summary.multiMove += 1;
    if (report.verdict === 'clean') summary.clean += 1;
    else if (report.verdict === 'non-unique-followups') summary.nonUnique += 1;
    else summary.engineDisagrees += 1;
    process.stderr.write(
      `[${i + 1}/${corpus.length}] ${report.id} ${report.goal} plies=${report.solverPlies} ` +
        `${report.verdict}${report.firstNonUniquePly !== null ? ` @ply ${report.firstNonUniquePly}` : ''}\n`,
    );
  }

  engine.quit();

  if (opts.out) {
    const outPath = resolve(opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${reports.map((r) => JSON.stringify(r)).join('\n')}\n`);
    process.stderr.write(`\nwrote ${reports.length} reports to ${outPath}\n`);
  }

  process.stdout.write(
    `\n=== audit summary (depth=${opts.depth} win-hi=${opts.winHi} win-lo=${opts.winLo} min-gap-cp=${opts.minGapCp}) ===\n` +
      `puzzles:            ${reports.length}\n` +
      `  single solver move: ${summary.singleMove}\n` +
      `  multi solver move:  ${summary.multiMove}\n` +
      `clean:              ${summary.clean}\n` +
      `non-unique followup:${summary.nonUnique}\n` +
      `engine-disagrees:   ${summary.engineDisagrees}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(parseOptions()).catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
