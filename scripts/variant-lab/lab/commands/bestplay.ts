// Best play: the engine chooses everything for both sides from the start
// array, no forced opening, no randomness. One game per node budget. This is
// the number an opening sweep cannot give, because a sweep forces Red away
// from its choice, and it is the only engine figure allowed to be called a
// first-mover result: a randomised first ply samples the whole distribution
// of openings and throws away the one best play finds (Benedict's 77% and the
// duck's withdrawn 58.3% were the same mistake at six plies and one).

import type { LabContext } from '../context.js';
import { enginePolicy, playGame } from '../play.js';
import type { EngineTelemetry, GameRecord } from '../types.js';

export type BestplayArgs = { nodes: number[] };

function describe(game: GameRecord): string {
  if (game.winner) return `${game.winner} wins by ${game.reason}`;
  return game.reason === 'ply-cap' || game.reason === 'no-move'
    ? `unfinished (${game.reason})`
    : `draw by ${game.reason}`;
}
export type BestplayResult = { games: (GameRecord & { nodes: number; opening: string | null })[] };

export async function bestplay(ctx: LabContext, args: BestplayArgs): Promise<BestplayResult> {
  const startedAt = new Date();
  const engine = await ctx.openEngine();
  try {
    const rootFen = ctx.kernel.fen(ctx.kernel.initial('root'));
    const games: BestplayResult['games'] = [];
    for (const nodes of args.nodes) {
      engine.newGame();
      const telemetry: EngineTelemetry = { depth: [], scoreCp: [] };
      const policy = enginePolicy(ctx.kernel, engine, nodes, rootFen, { telemetry });
      const played = await playGame(
        ctx.kernel,
        { red: policy, black: policy },
        { plyCap: ctx.plyCap, gameId: `best-${nodes}` },
      );
      const depths = telemetry.depth.filter((d): d is number => d !== null).sort((a, b) => a - b);
      const medianDepth = depths.length ? depths[Math.floor(depths.length / 2)] : null;
      games.push({
        moves: played.moves,
        plies: played.plies,
        winner: played.winner,
        reason: played.reason,
        engineSeat: 'both',
        nodes,
        opening: played.moves[0] ?? null,
        engineDepth: Array.from(telemetry.depth, (d) => d ?? null),
        engineScoreCp: Array.from(telemetry.scoreCp, (c) => c ?? null),
      });
      console.log(
        `  ${String(nodes).padStart(9)} nodes: ${describe(played)} in ${played.plies} plies, opening ${played.moves[0] ?? '-'}${medianDepth !== null ? `, median depth ${medianDepth}` : ''}`,
      );
    }
    const result: BestplayResult = { games };
    const file = ctx.finish(
      'bestplay',
      { nodes: args.nodes.join(',') },
      engine.identity,
      result,
      startedAt,
    );
    console.log(`${ctx.variant.title}: best play at ${args.nodes.length} budget(s)`);
    console.log(`  artifact ${file}`);
    return result;
  } finally {
    await engine.close();
  }
}
