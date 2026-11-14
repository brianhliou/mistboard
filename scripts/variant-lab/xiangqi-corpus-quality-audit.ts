// Read-only, snapshot-based corpus audit. No database or serving-state writes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  validateStandardXiangqiPuzzle,
  type XiangqiPuzzle,
} from '../../packages/game/src/puzzles-xiangqi.ts';
import {
  decideXiangqiPuzzleAudit,
  XIANGQI_PUZZLE_ENDPOINT_VERSION,
  XIANGQI_PUZZLE_REVIEW_VERSION,
  type XiangqiPuzzleSolverJudgment,
} from '../../packages/game/src/puzzles-xiangqi-endpoint.ts';
import {
  XIANGQI_MATE_GOAL_PROFILE,
  type XiangqiMateGoalEvidence,
} from '../../packages/game/src/puzzles-xiangqi-mate.ts';
import {
  XIANGQI_PUZZLE_MINIMUM_ROOT_MOVES,
  XIANGQI_PUZZLE_ROOT_CHOICE_VERSION,
  XIANGQI_SOLVER_GATE_DEFAULTS,
  XIANGQI_SOLVER_GATE_VERSION,
  XIANGQI_SOLVER_SCORE_PROFILE,
  xiangqiPuzzleHasStartingChoice,
} from '../../packages/game/src/puzzles-xiangqi-mining.ts';
import { applyStandardXiangqiMove } from '../../packages/game/src/variants-xiangqi-standard.ts';
import { PikafishEngine, type XiangqiSolverPlyAnalysis } from './xiangqi-pikafish-uci.ts';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

export {
  judgeXiangqiSearchEvidence,
  verifyXiangqiSearchPvs,
} from './xiangqi-puzzle-verification.ts';

import {
  verifyXiangqiSolverTurn,
  XIANGQI_PUZZLE_VERIFICATION_PROFILE,
} from './xiangqi-puzzle-verification.ts';

export async function auditXiangqiCorpusPuzzle(
  engine: Pick<PikafishEngine, 'newGame' | 'analyzeFen'> &
    Partial<Pick<PikafishEngine, 'lastSearch'>>,
  puzzle: XiangqiPuzzle,
) {
  const judgments: XiangqiPuzzleSolverJudgment[] = [];
  const evidence: {
    solutionPly: number;
    searches: XiangqiSolverPlyAnalysis[];
    elapsedMs: number;
    transcripts: NonNullable<PikafishEngine['lastSearch']>[];
    budgets: number[];
    escalationReasons: string[];
    mateGoalEvidence?: XiangqiMateGoalEvidence;
    mateGoalAttempts?: XiangqiMateGoalEvidence[];
  }[] = [];
  const validation = validateStandardXiangqiPuzzle(puzzle);
  if (!validation.ok)
    return {
      id: puzzle.id,
      puzzleHash: sha(JSON.stringify(puzzle)),
      judgments,
      evidence,
      decision: {
        disposition: 'needs-review',
        reason: 'invalid-stored-puzzle',
        firstProblemPly: null,
      },
    };
  if (!xiangqiPuzzleHasStartingChoice(puzzle.initial))
    return {
      id: puzzle.id,
      puzzleHash: sha(JSON.stringify(puzzle)),
      judgments,
      evidence,
      decision: {
        disposition: 'withhold-candidate',
        reason: 'no-choice-at-root',
        firstProblemPly: 0,
      },
    };
  let state = puzzle.initial;
  for (const [ply, move] of puzzle.solution.entries()) {
    if (ply % 2 === 0) {
      const started = Date.now();
      let searches: XiangqiSolverPlyAnalysis[] = [];
      let transcripts: NonNullable<PikafishEngine['lastSearch']>[] = [];
      let budgets: number[] = [];
      let escalationReasons: string[] = [];
      let judgment: XiangqiPuzzleSolverJudgment;
      let mateGoalEvidence: XiangqiMateGoalEvidence | undefined;
      let mateGoalAttempts: XiangqiMateGoalEvidence[] = [];
      try {
        const verified = await verifyXiangqiSolverTurn(
          engine,
          state,
          ply,
          move,
          puzzle.goal,
          XIANGQI_SOLVER_GATE_DEFAULTS,
          puzzle.goal.type === 'checkmate' ? (puzzle.solution.length - ply + 1) / 2 : undefined,
        );
        ({
          searches,
          transcripts,
          budgets,
          escalationReasons,
          judgment,
          mateGoalEvidence,
          mateGoalAttempts,
        } = verified);
      } catch (error) {
        judgment = {
          solutionPly: ply,
          verdict: 'unresolved',
          reason: error instanceof Error ? error.message : 'search-error',
        };
      }
      evidence.push({
        solutionPly: ply,
        searches,
        transcripts,
        budgets,
        escalationReasons,
        mateGoalEvidence,
        mateGoalAttempts,
        elapsedMs: Date.now() - started,
      });
      judgments.push(judgment);
      // Once a stored line fails, later moves cannot make it admissible. The
      // verified prefix is sufficient to plan a shorter replacement separately.
      if (judgment.verdict !== 'pass') break;
    }
    state = applyStandardXiangqiMove(state, move);
  }
  return {
    id: puzzle.id,
    puzzleHash: sha(JSON.stringify(puzzle)),
    judgments,
    evidence,
    decision: decideXiangqiPuzzleAudit(puzzle, judgments),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      binary: { type: 'string' },
      net: { type: 'string' },
      'expected-net-sha256': { type: 'string' },
    },
  });
  if (
    !values.binary ||
    !values.net ||
    values['expected-net-sha256'] !== XIANGQI_SOLVER_SCORE_PROFILE.networkSha256
  )
    throw new Error('Pinned CC0 binary/net arguments required');
  if (sha(readFileSync(values.net)) !== XIANGQI_SOLVER_SCORE_PROFILE.networkSha256)
    throw new Error('Network does not match the solver score profile');
  const input = JSON.parse(readFileSync(values.input ?? 0, 'utf8')) as {
    rows: { id: string; puzzle: XiangqiPuzzle }[];
  };
  if (!Array.isArray(input.rows) || input.rows.length > 500)
    throw new Error('A shard must contain at most 500 puzzles');
  const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  emit({
    type: 'policy-profile',
    rootChoiceVersion: XIANGQI_PUZZLE_ROOT_CHOICE_VERSION,
    minimumRootLegalMoves: XIANGQI_PUZZLE_MINIMUM_ROOT_MOVES,
    solverGateVersion: XIANGQI_SOLVER_GATE_VERSION,
    endpointVersion: XIANGQI_PUZZLE_ENDPOINT_VERSION,
    reviewVersion: XIANGQI_PUZZLE_REVIEW_VERSION,
    scoreProfile: XIANGQI_SOLVER_SCORE_PROFILE,
    gateOptions: XIANGQI_SOLVER_GATE_DEFAULTS,
    budgets: XIANGQI_PUZZLE_VERIFICATION_PROFILE,
    mateGoalProfile: XIANGQI_MATE_GOAL_PROFILE,
  });
  let engine = new PikafishEngine(
    values.binary,
    values.net,
    XIANGQI_PUZZLE_VERIFICATION_PROFILE.hashMb,
  );
  await engine.init();
  const started = Date.now();
  try {
    for (const row of input.rows) {
      if (row.id !== row.puzzle.id) throw new Error('Snapshot id mismatch');
      if (Date.now() - started > 7_000_000) {
        emit({ type: 'budget-stop' });
        return;
      }
      const result = await auditXiangqiCorpusPuzzle(engine, row.puzzle);
      emit({ type: 'puzzle', ...result });
      if (
        result.judgments.some(
          (p) => p.verdict === 'unresolved' && /timeout|exited|search-error/i.test(p.reason),
        )
      ) {
        engine.kill();
        engine = new PikafishEngine(
          values.binary,
          values.net,
          XIANGQI_PUZZLE_VERIFICATION_PROFILE.hashMb,
        );
        await engine.init();
      }
    }
    emit({
      type: 'complete',
      puzzles: input.rows.length,
      wallSeconds: (Date.now() - started) / 1000,
    });
  } finally {
    engine.quit();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
