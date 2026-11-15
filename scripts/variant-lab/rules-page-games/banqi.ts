// node --import tsx scripts/variant-lab/rules-page-games/banqi.ts --assets DIR --scratch DIR
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALL_BANQI_SQUARES,
  applyBanqiMove,
  BANQI_CHASE_RULE,
  type BanqiMove,
  type BanqiSetup,
  banqiMoveToEngineUci,
  banqiNoProgressLimitOf,
  DEFAULT_NO_PROGRESS_PLY_LIMIT,
  engineUciToBanqiMove,
  getBanqiForbiddenChaseMoves,
  getBanqiLegalMoves,
  parseBanqiFen,
} from '@mistboard/game';
import {
  analyzeBanqiDecisions,
  analyzeBanqiPostgame,
  BANQI_ANALYSIS_ENGINE_ID,
  BANQI_ANALYSIS_MOVETIME_CAP_MS,
  BANQI_DECISION_BASELINE_NODES,
  BANQI_DECISION_CANDIDATES,
  BANQI_DECISION_MIN_NODES,
  BANQI_DECISION_RANK_NODES,
  BANQI_DECISIONS_ENGINE_ID,
} from '../../../apps/server/src/banqi-analysis.ts';
import { runBanqiAnalysisQuery } from '../../../apps/server/src/banqi-analysis-runner.ts';
import {
  banqiEnginePath,
  banqiEngineTierFor,
  banqiNetPath,
  buildBanqiGoCommand,
  buildBanqiOptionCommands,
  buildBanqiPositionCommand,
  evaluateBanqiFenNodes,
} from '../../../apps/server/src/banqi-engine.ts';
import { UciEnginePool } from '../../../apps/server/src/uci-engine-harness.ts';
import type { EngineSideline } from '../../study-annotate.ts';
import {
  argumentsForBuild,
  artifactKey,
  assertResult,
  checkpoint,
  isMain,
  makePlan,
  pinnedAssets,
  type RecordGame,
  readGame,
  type StudyEval,
  token,
  writeStudy,
} from './hidden-study.ts';

export function replayBanqiGame(game: RecordGame = readGame('banqi')) {
  if (game.variant !== 'banqi' || !game.deal_fen)
    throw new Error('Banqi export needs its dealt root');
  const parsed = parseBanqiFen(game.deal_fen);
  if (!parsed.ok || parsed.sampled) throw new Error('Banqi export must not sample a deal');
  const setup: BanqiSetup = {
    deal: ALL_BANQI_SQUARES.map((square) => {
      const piece = parsed.state.board[square]!;
      return { color: piece.color, role: piece.role };
    }),
    chaseRule: BANQI_CHASE_RULE,
    noProgressLimit: DEFAULT_NO_PROGRESS_PLY_LIMIT,
  };
  const states = [parsed.state];
  const moves = game.plies.map((ply, i) => {
    const t = token(ply.uci);
    const move = { from: t.slice(0, 2), to: t.slice(2) } as BanqiMove;
    const before = states.at(-1)!;
    if (ply.ply !== i + 1 || before.status.type !== 'playing' || before.status.turn !== ply.mover)
      throw new Error(`invalid recorded mover at ply ${i + 1}`);
    const next = applyBanqiMove(before, move);
    if (next === before) throw new Error(`illegal recorded ply ${i + 1}`);
    if (
      ply.revealed &&
      (next.board[move.to]?.role !== ply.revealed.role ||
        next.board[move.to]?.color !== ply.revealed.color)
    )
      throw new Error('export flip disagrees with deal');
    states.push(next);
    return move;
  });
  assertResult(game, states.at(-1)!.status);
  return { game, setup, states, moves };
}
export function banqiPublicLine(
  state: ReturnType<typeof replayBanqiGame>['states'][number],
  pv: readonly string[],
) {
  const line: string[] = [];
  for (const uci of pv) {
    const move = engineUciToBanqiMove(uci);
    if (
      !move ||
      move.from === move.to ||
      state.board[move.from]?.faceDown ||
      state.board[move.to]?.faceDown
    )
      break;
    const next = applyBanqiMove(state, move);
    if (next === state) break;
    line.push(`${move.from}${move.to}`);
    state = next;
    if (line.length === 6 || state.status.type !== 'playing') break;
  }
  return line;
}
export async function buildBanqi(assets: string, scratch: string) {
  const replay = replayBanqiGame(); // Assert recorded result before any engine search.
  const { game, setup, moves, states } = replay;
  const provenance = pinnedAssets('banqi', assets);
  const grading = {
    analysis: {
      engineId: BANQI_ANALYSIS_ENGINE_ID,
      nodes: banqiEngineTierFor('misty-banqi-level-8')!.nodes,
      movetimeCapMs: BANQI_ANALYSIS_MOVETIME_CAP_MS,
    },
    decisions: {
      engineId: BANQI_DECISIONS_ENGINE_ID,
      nodes: {
        rank: BANQI_DECISION_RANK_NODES,
        baseline: BANQI_DECISION_BASELINE_NODES,
        minimum: BANQI_DECISION_MIN_NODES,
      },
      movetimeCapMs: BANQI_ANALYSIS_MOVETIME_CAP_MS,
      candidates: BANQI_DECISION_CANDIDATES,
    },
  };
  const key = artifactKey(game, provenance, grading);
  const { movetimeCapMs } = grading.analysis;
  type Evaluate = (
    fen: string,
    opts: { moves: readonly string[]; noProgressLimit: number; searchMoves?: readonly string[] },
  ) => ReturnType<typeof evaluateBanqiFenNodes>;
  // One whole-game read: every position from the side to move, signed to red.
  const sweep = async (path: string, label: string, evaluate: Evaluate) => {
    const store = checkpoint<StudyEval>(path);
    const extra = new Map<number, { pv: string[]; nodes?: number }>();
    await analyzeBanqiPostgame(
      moves,
      setup,
      async (state, window) => {
        const evaluation = await evaluate(window!.fen, {
          moves: window!.moves,
          noProgressLimit: banqiNoProgressLimitOf(state),
          searchMoves: getBanqiForbiddenChaseMoves(state).length
            ? getBanqiLegalMoves(state).map(banqiMoveToEngineUci)
            : undefined,
        });
        extra.set(state.ply, { pv: evaluation.pv ?? [], nodes: evaluation.nodes });
        const sign = state.status.type === 'playing' && state.status.turn === 'black' ? -1 : 1;
        return {
          cp: evaluation.cp === null ? null : evaluation.cp * sign,
          mate: evaluation.mate === null ? null : evaluation.mate * sign,
          best: evaluation.best,
        };
      },
      {
        load: store.load,
        save: async (progress) => {
          const items = progress.items.map((row) => ({
            ...row,
            pv: (row as StudyEval).pv ?? [],
            ...extra.get(row.ply),
          }));
          await store.save({ ...progress, items });
          console.log(`Banqi ${label} position ${items.length - 1}/${moves.length}`);
        },
      },
    );
    return (await store.load())!.items.map((row) => {
      const best = row.best ? engineUciToBanqiMove(row.best) : null;
      return {
        ...row,
        best: best ? `${best.from}${best.to}` : null,
        pv: banqiPublicLine(states[row.ply]!, row.pv),
      };
    });
  };
  const { nodes } = grading.analysis;
  const analysis = await sweep(resolve(scratch, `banqi.${key}.sweep.json`), 'Level 8', (fen, o) =>
    evaluateBanqiFenNodes(fen, { ...o, nodes, movetimeCapMs }),
  );
  // Level 7's own read: the served classical evaluation (no EvalFile) at its node
  // budget, no noise, under the same 30s analysis cap as Level 8's line.
  const level7 = banqiEngineTierFor('misty-banqi')!;
  if (level7.level !== 7 || level7.evaluation !== 'classical')
    throw new Error('misty-banqi is no longer classical Level 7');
  const level7EngineId = BANQI_ANALYSIS_ENGINE_ID.replace(
    /\+nnue-nodes-\d+/,
    `+classical-nodes-${level7.nodes}`,
  );
  if (level7EngineId === BANQI_ANALYSIS_ENGINE_ID) throw new Error('Level 7 id did not change');
  const level7Key = artifactKey(game, provenance, {
    ...grading,
    analysis: { engineId: level7EngineId, nodes: level7.nodes, movetimeCapMs },
  });
  const pool = new UciEnginePool({
    name: 'banqi-level7-read',
    maxProcessesEnvVar: 'MISTBOARD_BANQI_RULES_L7_MAX_PROCESSES',
    queueTimeoutEnvVar: 'MISTBOARD_BANQI_RULES_L7_QUEUE_TIMEOUT_MS',
    defaultMaxProcesses: 1,
    defaultQueueTimeoutMs: 30_000,
    queueTimeoutMessage: 'banqi Level 7 read queue timed out',
  });
  const net = banqiNetPath();
  if (net === null) throw new Error('Banqi net is not available');
  const level7Analysis = await sweep(
    resolve(scratch, `banqi.${level7Key}.level7.sweep.json`),
    'Level 7',
    (fen, o) =>
      runBanqiAnalysisQuery({
        binaryPath: banqiEnginePath(),
        // Stamped by the runner's cache only; no EvalFile is set, so it is not loaded.
        modelPath: net,
        initCommands: [
          'uci',
          ...buildBanqiOptionCommands(o.noProgressLimit),
          'ucinewgame',
          'isready',
        ],
        positionCommand: buildBanqiPositionCommand(fen, o.moves),
        goCommand: buildBanqiGoCommand(level7.nodes, movetimeCapMs, o.searchMoves),
        nodes: level7.nodes,
        movetimeCapMs,
        pool,
      }),
  );
  const decisions = await analyzeBanqiDecisions(
    moves,
    setup,
    undefined,
    checkpoint(resolve(scratch, `banqi.${key}.decisions.json`)),
  );
  const notesPath = new URL('plans/banqi.notes.json', import.meta.url);
  const comments = existsSync(notesPath)
    ? JSON.parse(readFileSync(notesPath, 'utf8')).comments
    : {};
  const sidelines: EngineSideline[] = analysis
    .slice(0, -1)
    .flatMap((row) =>
      row.pv.length && row.pv[0] !== token(game.plies[row.ply]!.uci)
        ? [{ ply: row.ply, moves: row.pv, redScoreEnd: null }]
        : [],
    );
  const output = makePlan({
    game,
    title: 'Banqi',
    treeRoot: { rootFen: game.deal_fen! },
    moves: game.plies.map((ply) => token(ply.uci)),
    analysis,
    decisions,
    engineId: BANQI_ANALYSIS_ENGINE_ID,
    decisionEngineId: BANQI_DECISIONS_ENGINE_ID,
    sidelines,
    lineName: 'Level 8',
    compare: { name: 'Level 7', engineId: level7EngineId, analysis: level7Analysis },
    notes: {
      intro:
        'Level 7 moves first and plays black; Level 8 plays red. The graph has a line for each level: its own estimate of Level 7’s winning chances at every position. Grades use Level 8’s. A flip’s grade compares it with the average over every piece still face down; the die shows whether the piece that turned up was a lucky draw.',
      comments,
      evidence: {
        ...provenance,
        engineId: BANQI_ANALYSIS_ENGINE_ID,
        decisionEngineId: BANQI_DECISIONS_ENGINE_ID,
        nodes,
        analysis,
        level7: { engineId: level7EngineId, nodes: level7.nodes, analysis: level7Analysis },
      },
    },
  });
  writeStudy('banqi', output);
  return output;
}
if (isMain(import.meta.url)) {
  const args = argumentsForBuild();
  await buildBanqi(args.assets, args.scratch);
}
