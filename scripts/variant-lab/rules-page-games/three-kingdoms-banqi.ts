// node --import tsx scripts/variant-lab/rules-page-games/three-kingdoms-banqi.ts --assets DIR --scratch DIR
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyThreeKingdomsBanqiReplayMove,
  banqiPieceLetter,
  createInitialThreeKingdomsBanqiReplayState,
  getThreeKingdomsBanqiForbiddenChaseMoves,
  getThreeKingdomsBanqiLegalMoves,
  parseThreeKingdomsBanqiReplayMove,
  THREE_KINGDOMS_BANQI_PUBLIC_REPLAY,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiReplayState,
  threeKingdomsBanqiStateToEngineFen,
} from '@mistboard/game';
import type { BanqiDecision } from '../../../apps/server/src/banqi-analysis.ts';
import { THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID } from '../../../apps/server/src/three-kingdoms-banqi-analysis.ts';
import {
  evaluateThreeKingdomsBanqiPublicFlipDecision,
  THREE_KINGDOMS_BANQI_DECISION_MOVETIME_CAP_MS,
  THREE_KINGDOMS_BANQI_DECISION_NODES,
  THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID,
} from '../../../apps/server/src/three-kingdoms-banqi-decisions.ts';
import {
  type ThreeKingdomsBanqiEngineRequest,
  threeKingdomsBanqiEngineTierFor,
  threeKingdomsBanqiLiveEngineMove,
} from '../../../apps/server/src/three-kingdoms-banqi-engine.ts';
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

export function replayThreeKingdomsGame(game: RecordGame = readGame('three-kingdoms-banqi')) {
  if (game.variant !== 'three-kingdoms-banqi' || game.deal_fen !== undefined)
    throw new Error('Three Kingdoms export must be a public replay without a deal');
  const states = [createInitialThreeKingdomsBanqiReplayState(game.game_id)];
  const tokens: string[] = [];
  const moves = game.plies.map((ply, i) => {
    const recorded = ply.revealed ? `${ply.uci}:${banqiPieceLetter(ply.revealed)}` : ply.uci;
    const move = parseThreeKingdomsBanqiReplayMove(recorded);
    const state = states.at(-1)!;
    if (
      !move ||
      ply.ply !== i + 1 ||
      state.status.type !== 'playing' ||
      state.status.turn !== ply.mover
    )
      throw new Error(`invalid recorded ply ${i + 1}`);
    states.push(applyThreeKingdomsBanqiReplayMove(state, move));
    tokens.push(recorded);
    return move;
  });
  assertResult(game, states.at(-1)!.status);
  return { game, states, moves, tokens };
}
// Same quiet-window and chase semantics as the live request, with public replay
// frames in place of a room-created event that would require a secret deal.
export function publicRequest(
  states: readonly ThreeKingdomsBanqiReplayState[],
  moves: readonly ThreeKingdomsBanqiMove[],
  nodes: number,
  movetimeCapMs: number,
  /** Level 7 reads with the classical evaluation: no EvalFile, as served. */
  evaluation: 'nnue' | 'classical' = 'nnue',
): ThreeKingdomsBanqiEngineRequest {
  const state = states.at(-1)!;
  const start = Math.max(0, states.length - 1 - state.noProgressClock);
  const tier = threeKingdomsBanqiEngineTierFor('misty-three-kingdoms-banqi-level-8')!;
  return {
    fen: threeKingdomsBanqiStateToEngineFen(states[start]!),
    moves: moves.slice(start).map((move) => `${move.from}${move.to}`),
    ...(getThreeKingdomsBanqiForbiddenChaseMoves(state).length
      ? {
          searchMoves: getThreeKingdomsBanqiLegalMoves(state).map(
            (move) => `${move.from}${move.to}`,
          ),
        }
      : {}),
    nodes,
    movetimeCapMs,
    chance: tier.chance,
    ...(evaluation === 'nnue' ? { evalFile: process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET } : {}),
  };
}
export function threeKingdomsPublicLine(
  state: ThreeKingdomsBanqiReplayState,
  pv: readonly string[],
) {
  const line: string[] = [];
  for (const token of pv) {
    const move = parseThreeKingdomsBanqiReplayMove(token);
    if (
      !move ||
      move.from === move.to ||
      state.board[move.from]?.faceDown ||
      state.board[move.to]?.faceDown
    )
      break;
    try {
      state = applyThreeKingdomsBanqiReplayMove(state, move);
    } catch {
      break;
    }
    line.push(token);
    if (line.length === 6 || state.status.type !== 'playing') break;
  }
  return line;
}
export function threeKingdomsGradingOptions() {
  const tier = threeKingdomsBanqiEngineTierFor('misty-three-kingdoms-banqi-level-8')!;
  return {
    analysis: { ...tier, engineId: THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID },
    decisions: {
      engineId: THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID,
      nodes: THREE_KINGDOMS_BANQI_DECISION_NODES,
      movetimeCapMs: THREE_KINGDOMS_BANQI_DECISION_MOVETIME_CAP_MS,
      chance: tier.chance,
    },
  };
}
export async function buildThreeKingdoms(assets: string, scratch: string) {
  const { game, states, moves, tokens } = replayThreeKingdomsGame();
  const provenance = pinnedAssets('three-kingdoms-banqi', assets);
  const grading = threeKingdomsGradingOptions();
  const key = artifactKey(game, provenance, grading);
  const tier = grading.analysis;
  // One whole-game read: every position from the side to move, signed to red.
  const sweep = async (path: string, label: string, evaluation: 'nnue' | 'classical') => {
    const store = checkpoint<StudyEval>(path);
    const rows = (await store.load())?.items ?? [];
    for (let ply = rows.length; ply < states.length; ply++) {
      const state = states[ply]!;
      if (state.status.type === 'finished')
        rows.push({
          ply,
          cp:
            state.status.winner === 'red' ? 30_000 : state.status.winner === 'black' ? -30_000 : 0,
          mate: null,
          best: null,
          pv: [],
        });
      else {
        const result = await threeKingdomsBanqiLiveEngineMove(
          publicRequest(
            states.slice(0, ply + 1),
            moves.slice(0, ply),
            tier.nodes,
            tier.movetimeCapMs,
            evaluation,
          ),
        );
        const sign = state.status.type === 'playing' && state.status.turn === 'black' ? -1 : 1;
        rows.push({
          ply,
          cp: result.cp === null ? null : result.cp * sign,
          mate: result.mate === null ? null : result.mate * sign,
          best: result.best,
          pv: threeKingdomsPublicLine(state, result.pv ?? []),
          nodes: result.nodes,
        });
      }
      await store.save({ nextIndex: ply + 1, items: rows });
      console.log(`Three Kingdoms ${label} position ${ply}/${moves.length}`);
    }
    return rows;
  };
  const analysis = await sweep(
    resolve(scratch, `three-kingdoms-banqi.${key}.sweep.json`),
    'Level 8',
    'nnue',
  );
  // Level 7 differs from Level 8 only in evaluation: same nodes and chance mode,
  // classical in place of the net.
  const level7 = threeKingdomsBanqiEngineTierFor('misty-three-kingdoms-banqi-level-7')!;
  if (level7.level !== 7 || level7.evaluation !== 'classical' || level7.nodes !== tier.nodes)
    throw new Error('Three Kingdoms Level 7 is no longer Level 8 without the net');
  const level7EngineId = THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID.replace('+l8-', '+l7-').replace(
    '-nnue-',
    '-classical-',
  );
  if (!/\+l7-.*-classical-/.test(level7EngineId)) throw new Error('Level 7 id did not change');
  const level7Key = artifactKey(game, provenance, {
    ...grading,
    analysis: { ...grading.analysis, engineId: level7EngineId, evaluation: 'classical' },
  });
  const level7Analysis = await sweep(
    resolve(scratch, `three-kingdoms-banqi.${level7Key}.level7.sweep.json`),
    'Level 7',
    'classical',
  );
  const decStore = checkpoint<BanqiDecision>(
    resolve(scratch, `three-kingdoms-banqi.${key}.decisions.json`),
  );
  const resumed = await decStore.load();
  const decisions = resumed?.items ?? [];
  for (let i = resumed?.nextIndex ?? 0; i < moves.length; i++) {
    const move = moves[i]!;
    if (move.from !== move.to) continue;
    decisions.push(
      await evaluateThreeKingdomsBanqiPublicFlipDecision(states[i]!, move, i + 1, (post, action) =>
        publicRequest(
          action ? [...states.slice(0, i + 1), post] : states.slice(0, i + 1),
          action ? [...moves.slice(0, i), action] : moves.slice(0, i),
          grading.decisions.nodes,
          grading.decisions.movetimeCapMs,
        ),
      ),
    );
    await decStore.save({ nextIndex: i + 1, items: decisions });
    console.log(`Three Kingdoms flip ${i + 1}`);
  }
  const notesPath = new URL('plans/three-kingdoms-banqi.notes.json', import.meta.url);
  const comments = existsSync(notesPath)
    ? JSON.parse(readFileSync(notesPath, 'utf8')).comments
    : {};
  const output = makePlan({
    game,
    title: 'Three Kingdoms Banqi',
    treeRoot: { replay: THREE_KINGDOMS_BANQI_PUBLIC_REPLAY },
    moves: tokens,
    analysis,
    decisions,
    engineId: THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID,
    decisionEngineId: THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID,
    lineName: 'Level 8',
    compare: { name: 'Level 7', engineId: level7EngineId, analysis: level7Analysis },
    sidelines: analysis
      .slice(0, -1)
      .flatMap((row) =>
        row.pv.length && row.pv[0] !== token(game.plies[row.ply]!.uci)
          ? [{ ply: row.ply, moves: row.pv, redScoreEnd: null, always: row.ply === 12 }]
          : [],
      ),
    notes: {
      intro:
        'Level 8 moves first and plays red; Level 7 plays black and wins on points. The graph has a line for each level: its own estimate of red’s winning chances at every position. Grades use Level 8’s. A flip’s grade compares it with the average over every piece still face down; the die shows whether the piece that turned up was a lucky draw. Pieces still face down stay unknown throughout.',
      comments,
      evidence: {
        ...provenance,
        engineId: THREE_KINGDOMS_BANQI_ANALYSIS_ENGINE_ID,
        decisionEngineId: THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID,
        nodes: tier.nodes,
        analysis,
        level7: { engineId: level7EngineId, nodes: level7.nodes, analysis: level7Analysis },
      },
    },
  });
  writeStudy('three-kingdoms-banqi', output);
  return output;
}
if (isMain(import.meta.url)) {
  const args = argumentsForBuild();
  await buildThreeKingdoms(args.assets, args.scratch);
}
