import {
  verifyXiangqiSolverTurn,
  XIANGQI_PUZZLE_VERIFICATION_PROFILE,
} from './xiangqi-puzzle-verification.ts';
// Per-ply uniqueness audit for the live standard-xiangqi puzzle corpus.
//
// Independent re-verification of the gated miner (#180): for each solver ply
// it re-judges the position via the SHARED analyzeXiangqiSolverPly
// (scripts/variant-lab/xiangqi-pikafish-uci.ts) — the same history-free
// `position fen` load, the same adaptive MultiPV search, the same score
// normalization (xiangqiUciScoreToCp), and the same separation gate
// (isXiangqiSolverMoveUnique) the miner's verify pass enforces. Verdicts are
// therefore definitionally consistent with the miner (#185); what this tool
// adds is an independent run plus the shipped-move comparison. It does not
// mutate the corpus.
//
// Scores are reported from the side-to-move (solver) POV, so a positive gap
// means the shipped move beats the runner-up. Mate scores fold onto the cp
// axis near XIANGQI_MATE_SCORE_CP. Verification uses 5M/25M nodes and selective
// 100M escalation; every earlier disagreement remains unresolved.
//
// Run (needs the local Pikafish binary + NNUE net; auto-resolved via
// xiangqi-pikafish-engine.ts, or set MISTBOARD_PIKAFISH_XIANGQI_PATH/_NET):
//   node_modules/.bin/tsx scripts/variant-lab/xiangqi-puzzle-uniqueness-audit.ts \
//     --out scripts/variant-lab/out/xiangqi-uniqueness-audit.jsonl
//   # quick smoke on a handful first:
//   node_modules/.bin/tsx scripts/variant-lab/xiangqi-puzzle-uniqueness-audit.ts --limit 3

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
  XIANGQI_PUZZLE_ADMISSION_PROFILE,
  XIANGQI_SOLVER_GATE_VERSION,
  XIANGQI_SOLVER_SCORE_PROFILE,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPuzzle,
  xiangqiPuzzleHasStartingChoice,
  xiangqiPuzzleSolutionEndpoint,
  xiangqiSolverLineWinRate,
  xiangqiSolverMoveCoverage,
} from '../../packages/game/src/index.ts';
import { loadSeedPuzzleRegistry } from '../../packages/game/src/puzzle-seed.ts';
import type { XiangqiMateGoalEvidence } from '../../packages/game/src/puzzles-xiangqi-mate.ts';
import { PikafishEngine, XIANGQI_SOLVER_GATE_DEFAULTS } from './xiangqi-pikafish-uci.ts';

export type XiangqiPuzzleAuditOptions = {
  depth: number;
  nodes: number | null;
  winHi: number;
  minWinRateGap: number;
  mateInOneMaxWinRate: number;
  winRateK: number;
  limit: number;
  ids: Set<string> | null;
  out: string | null;
};

function parseOptions(): XiangqiPuzzleAuditOptions {
  const { values } = parseArgs({
    options: {
      depth: { type: 'string', default: '22' },
      nodes: { type: 'string' },
      // Separation gate knobs: defaults come from the module shared with
      // the miner, so this audit stays an apples-to-apples re-verification of
      // the mined corpus rather than a second, drifting definition.
      'win-rate-k': { type: 'string', default: String(XIANGQI_SOLVER_GATE_DEFAULTS.winRateK) },
      'win-hi': { type: 'string', default: String(XIANGQI_SOLVER_GATE_DEFAULTS.winHi) },
      'min-win-rate-gap': {
        type: 'string',
        default: String(XIANGQI_SOLVER_GATE_DEFAULTS.minWinRateGap),
      },
      'mate-in-one-max-win-rate': {
        type: 'string',
        default: String(XIANGQI_SOLVER_GATE_DEFAULTS.mateInOneMaxWinRate),
      },
      limit: { type: 'string', default: '0' },
      ids: { type: 'string' },
      out: { type: 'string' },
    },
  });
  return {
    depth: parsePositiveInt(values.depth, 22),
    nodes: values.nodes ? parsePositiveInt(values.nodes, 0) || null : null,
    winRateK: Number.parseFloat(
      values['win-rate-k'] ?? String(XIANGQI_SOLVER_GATE_DEFAULTS.winRateK),
    ),
    winHi: Number.parseFloat(values['win-hi'] ?? String(XIANGQI_SOLVER_GATE_DEFAULTS.winHi)),
    minWinRateGap: Number.parseFloat(
      values['min-win-rate-gap'] ?? String(XIANGQI_SOLVER_GATE_DEFAULTS.minWinRateGap),
    ),
    mateInOneMaxWinRate: Number.parseFloat(
      values['mate-in-one-max-win-rate'] ??
        String(XIANGQI_SOLVER_GATE_DEFAULTS.mateInOneMaxWinRate),
    ),
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
  bestCp: number | null;
  mateGoalEvidence?: XiangqiMateGoalEvidence;
  secondCp: number | null;
  bestMate: number | null;
  secondMate: number | null;
  gapCp: number | null;
  gapWinrate: number | null;
  unique: boolean;
  uniquenessReason: string;
};

export type XiangqiPuzzleAuditReport = {
  solverGateVersion: typeof XIANGQI_SOLVER_GATE_VERSION;
  scoreProfileId: string;
  verificationProfile: typeof XIANGQI_PUZZLE_VERIFICATION_PROFILE;
  id: string;
  goal: string;
  solverPlies: number;
  plies: XiangqiPuzzleAuditPlyReport[];
  allMatch: boolean;
  firstNonUniquePly: number | null; // solution index of the first non-unique solver ply
  endpointVersion: string;
  endpoint: ReturnType<typeof xiangqiPuzzleSolutionEndpoint>;
  verdict:
    | 'clean'
    | 'non-unique-followups'
    | 'engine-disagrees'
    | 'invalid-endpoint'
    | 'invalid-start';
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
    winRateK: opts.winRateK,
    minWinRateGap: opts.minWinRateGap,
    mateInOneMaxWinRate: opts.mateInOneMaxWinRate,
  };
  if (!xiangqiPuzzleHasStartingChoice(puzzle.initial)) {
    return {
      ...XIANGQI_PUZZLE_ADMISSION_PROFILE,
      verificationProfile: XIANGQI_PUZZLE_VERIFICATION_PROFILE,
      ...gate,
      id: puzzle.id,
      goal: puzzle.goal.type,
      solverPlies: 0,
      plies: [],
      allMatch: false,
      firstNonUniquePly: 0,
      verdict: 'invalid-start',
      endpoint: xiangqiPuzzleSolutionEndpoint(puzzle.initial, puzzle.solution, puzzle.goal),
    };
  }
  if (opts.nodes !== null || opts.depth !== XIANGQI_PUZZLE_VERIFICATION_PROFILE.minimumFinalDepth)
    throw new Error(
      'Custom audit depth/node caps are retired; use the shared verification profile',
    );
  const plies: XiangqiPuzzleAuditPlyReport[] = [];
  let state: XiangqiGameState = puzzle.initial;
  for (let ply = 0; ply < puzzle.solution.length; ply += 1) {
    const move = puzzle.solution[ply] as XiangqiMove;
    if (ply % 2 === 0 && state.status.type === 'playing') {
      const verified = await verifyXiangqiSolverTurn(
        engine,
        state,
        ply,
        move,
        puzzle.goal,
        gate,
        puzzle.goal.type === 'checkmate' ? (puzzle.solution.length - ply + 1) / 2 : undefined,
      );
      const last = verified.searches.at(-1);
      const lines = last?.lines ?? [];
      const best = last?.best;
      const second = last?.second;
      const unique = verified.judgment.verdict === 'pass';
      const reason = verified.judgment.reason;
      const bestTok = lines[0]?.pvUci[0];
      const engineBest = bestTok ? pikafishUciToXiangqiSquares(bestTok) : null;
      const engineBestMove = engineBest ? `${engineBest.from}-${engineBest.to}` : (bestTok ?? '?');
      const coverage = xiangqiSolverMoveCoverage(state);
      const matchesShipped =
        verified.judgment.reason === 'kernel-mate-goal-completed' ||
        (verified.mateGoalEvidence?.verdict === 'unique' &&
          verified.mateGoalEvidence.winningMoves[0]?.from === move.from &&
          verified.mateGoalEvidence.winningMoves[0]?.to === move.to) ||
        (engineBest?.from === move.from && engineBest?.to === move.to) ||
        (best?.mate === 1 &&
          coverage.immediateWins.some((win) => win.from === move.from && win.to === move.to));
      const bestCp = best?.scoreCp ?? null;
      const secondCp = second?.scoreCp ?? null;
      const gapCp = secondCp === null || bestCp === null ? null : bestCp - secondCp;
      const gapWinrate =
        best && second
          ? xiangqiSolverLineWinRate(best, opts.winRateK) -
            xiangqiSolverLineWinRate(second, opts.winRateK)
          : null;
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
        mateGoalEvidence: verified.mateGoalEvidence,
      });
    }
    if (state.status.type !== 'playing') break;
    state = applyStandardXiangqiMove(state, move);
  }

  const allMatch = plies.every((p) => p.matchesShipped);
  const firstBad = plies.find((p) => !p.matchesShipped || !p.unique) ?? null;
  const endpoint = xiangqiPuzzleSolutionEndpoint(puzzle.initial, puzzle.solution, puzzle.goal);
  const endpointMatches = endpoint.ok && endpoint.moves.length === puzzle.solution.length;
  const verdict: XiangqiPuzzleAuditReport['verdict'] = !endpointMatches
    ? 'invalid-endpoint'
    : !allMatch
      ? 'engine-disagrees'
      : plies.every((p) => p.unique)
        ? 'clean'
        : 'non-unique-followups';
  return {
    ...XIANGQI_PUZZLE_ADMISSION_PROFILE,
    verificationProfile: XIANGQI_PUZZLE_VERIFICATION_PROFILE,
    ...gate,
    endpoint,
    solverGateVersion: XIANGQI_SOLVER_GATE_VERSION,
    scoreProfileId: XIANGQI_SOLVER_SCORE_PROFILE.id,
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
  const engine = new PikafishEngine(bin, net, XIANGQI_PUZZLE_VERIFICATION_PROFILE.hashMb);
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
    `\n=== audit summary (profile=${XIANGQI_PUZZLE_VERIFICATION_PROFILE.version} win-hi=${opts.winHi} min-win-rate-gap=${opts.minWinRateGap} mate-in-one-max-win-rate=${opts.mateInOneMaxWinRate}) ===\n` +
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
