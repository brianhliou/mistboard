// Random-vs-random control: the only measurement that is about the RULES
// rather than about an engine. Both sides play uniformly at random; if Red's
// score is not ~50% the ruleset itself is asymmetric and no later number
// means anything. It is also a kernel shakedown: millions of plies through
// move generation find the geometry bug that the hand-written tests do not.

import type { LabContext } from '../context.js';
import { playGame, randomPolicy } from '../play.js';
import { mulberry32 } from '../rng.js';
import { pct, type Tally, tally } from '../stats.js';
import type { GameRecord } from '../types.js';

export type RandomplayArgs = { games: number; keepGames: boolean };
export type RandomplayResult = Tally & { plyCap: number; games_: GameRecord[] | null };

export async function randomplay(ctx: LabContext, args: RandomplayArgs): Promise<RandomplayResult> {
  const startedAt = new Date();
  const rng = mulberry32(ctx.seed);
  const random = randomPolicy(ctx.kernel, rng);
  const games: GameRecord[] = [];
  for (let i = 0; i < args.games; i += 1) {
    const played = await playGame(
      ctx.kernel,
      { red: random, black: random },
      { plyCap: ctx.plyCap, gameId: `rp-${i}` },
    );
    games.push({
      moves: played.moves,
      plies: played.plies,
      winner: played.winner,
      reason: played.reason,
    });
    if ((i + 1) % 500 === 0) process.stderr.write(`  ${i + 1}/${args.games}\n`);
  }
  const summary = tally(games);
  const result: RandomplayResult = {
    ...summary,
    plyCap: ctx.plyCap,
    games_: args.keepGames ? games : null,
  };
  const file = ctx.finish(
    'randomplay',
    { games: args.games, plyCap: ctx.plyCap },
    null,
    result,
    startedAt,
  );

  console.log(`${ctx.variant.title}: random vs random, ${summary.games} games, seed ${ctx.seed}`);
  console.log(`  red ${summary.red}  black ${summary.black}  undecided ${summary.undecided}`);
  console.log(
    `  RED SCORE ${pct(summary.redScore)}  (decided games; 50% means the rules are symmetric)`,
  );
  console.log(
    `  plies min ${summary.lengths.min} median ${summary.lengths.median} max ${summary.lengths.max}`,
  );
  console.log(
    `  ends ${Object.entries(summary.endReasons)
      .map(([r, n]) => `${r}=${n}`)
      .join('  ')}`,
  );
  console.log(`  artifact ${file}`);
  return result;
}
