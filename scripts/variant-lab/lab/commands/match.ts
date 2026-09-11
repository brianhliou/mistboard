// Engine vs random, seats alternating: is the engine above noise at all?
//
// Cheap and coarse. 20-0 in a handful of moves says the eval is pointed the
// right way; the ladder says whether more search buys more. Seats alternate
// so an engine-strength effect and a first-mover effect cannot be confused
// for one another. This command never reports a first-mover figure.

import type { LabContext } from '../context.js';
import { enginePolicy, playGame, randomPolicy } from '../play.js';
import { mulberry32 } from '../rng.js';
import { pct, summarizeLengths, waldInterval } from '../stats.js';
import type { GameRecord } from '../types.js';

export type MatchArgs = { games: number; nodes: number };
export type MatchResult = {
  nodes: number;
  engineWins: number;
  randomWins: number;
  undecided: number;
  engineScore: ReturnType<typeof waldInterval>;
  lengths: ReturnType<typeof summarizeLengths>;
  games: GameRecord[];
};

export async function match(ctx: LabContext, args: MatchArgs): Promise<MatchResult> {
  const startedAt = new Date();
  const engine = await ctx.openEngine();
  try {
    const rng = mulberry32(ctx.seed);
    const random = randomPolicy(ctx.kernel, rng);
    const rootFen = ctx.kernel.fen(ctx.kernel.initial('root'));
    const enginePlays = enginePolicy(ctx.kernel, engine, args.nodes, rootFen);
    const games: GameRecord[] = [];
    let engineWins = 0;
    let randomWins = 0;
    let undecided = 0;
    for (let i = 0; i < args.games; i += 1) {
      const engineSeat = i % 2 === 0 ? 'red' : 'black';
      engine.newGame();
      const policies =
        engineSeat === 'red'
          ? { red: enginePlays, black: random }
          : { red: random, black: enginePlays };
      const played = await playGame(ctx.kernel, policies, {
        plyCap: ctx.plyCap,
        gameId: `match-${i}`,
      });
      if (played.winner === engineSeat) engineWins += 1;
      else if (played.winner) randomWins += 1;
      else undecided += 1;
      games.push({
        moves: played.moves,
        plies: played.plies,
        winner: played.winner,
        reason: played.reason,
        engineSeat,
      });
      process.stderr.write(played.winner === engineSeat ? 'E' : played.winner ? 'r' : '.');
    }
    process.stderr.write('\n');
    const result: MatchResult = {
      nodes: args.nodes,
      engineWins,
      randomWins,
      undecided,
      engineScore: waldInterval(engineWins, engineWins + randomWins),
      lengths: summarizeLengths(games.map((g) => g.plies)),
      games,
    };
    const file = ctx.finish('match', { ...args }, engine.identity, result, startedAt);
    console.log(
      `${ctx.variant.title}: engine (${args.nodes} nodes) vs random, ${args.games} games, seats alternating`,
    );
    console.log(
      `  ENGINE ${engineWins}  random ${randomWins}  undecided ${undecided}   score ${pct(result.engineScore)}`,
    );
    console.log(
      `  plies min ${result.lengths.min} median ${result.lengths.median} max ${result.lengths.max}`,
    );
    console.log(`  artifact ${file}`);
    return result;
  } finally {
    await engine.close();
  }
}
