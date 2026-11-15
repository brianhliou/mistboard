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
  BANQI_DECISIONS_ENGINE_ID,
} from '../../../apps/server/src/banqi-analysis.ts';
import {
  banqiEngineTierFor,
  evaluateBanqiFenNodes,
} from '../../../apps/server/src/banqi-engine.ts';
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
  const key = artifactKey(game, provenance);
  const path = resolve(scratch, `banqi.${key}.sweep.json`);
  const store = checkpoint<StudyEval>(path);
  const extra = new Map<number, { pv: string[]; nodes?: number }>();
  const nodes = banqiEngineTierFor('misty-banqi-level-8')!.nodes;
  await analyzeBanqiPostgame(
    moves,
    setup,
    async (state, window) => {
      const evaluation = await evaluateBanqiFenNodes(window!.fen, {
        nodes,
        movetimeCapMs: 30_000,
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
        console.log(`Banqi position ${items.length - 1}/${moves.length}`);
      },
    },
  );
  const analysis = (await store.load())!.items.map((row) => {
    const best = row.best ? engineUciToBanqiMove(row.best) : null;
    return {
      ...row,
      best: best ? `${best.from}${best.to}` : null,
      pv: banqiPublicLine(states[row.ply]!, row.pv),
    };
  });
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
    notes: {
      intro:
        'Level 7 moves first and plays black; Level 8 plays red. The graph shows Level 7’s winning chances. A flip’s grade compares it with the average over every piece still face down; the die shows whether the piece that turned up was a lucky draw.',
      comments,
      evidence: {
        ...provenance,
        engineId: BANQI_ANALYSIS_ENGINE_ID,
        decisionEngineId: BANQI_DECISIONS_ENGINE_ID,
        nodes,
        analysis,
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
