// Node-budget ladder: does more search actually win?
//
// The test that says whether the engine UNDERSTANDS the game or is shuffling.
// If a 10x budget scores ~50%, the evaluation is noise and no number the
// engine produces about this variant means anything.
//
// Paired design: each random opening is played twice with the seats swapped,
// so opening bias and first-mover advantage both cancel. A random opening is
// legitimate HERE and not in a balance measurement: two players face an
// identical distribution of openings and are compared to each other, not to
// the tempo. The same technique in `bestplay` would be the Benedict error.

import type { LabContext } from '../context.js';
import { enginePolicy, playGame, randomPolicy } from '../play.js';
import { mulberry32 } from '../rng.js';
import { eloFromScore, type Interval, pct, summarizeLengths, waldInterval } from '../stats.js';
import type { GameRecord, LabColor } from '../types.js';

export type LadderArgs = { pairs: number; hi: number; lo: number; openingPlies: number };
export type LadderResult = {
  hi: number;
  lo: number;
  pairs: number;
  hiWins: number;
  loWins: number;
  undecided: number;
  hiScore: Interval;
  eloForBudget: number;
  lengths: ReturnType<typeof summarizeLengths>;
  games: (GameRecord & { hiSeat: LabColor; opening: string[] })[];
};

export async function ladder(ctx: LabContext, args: LadderArgs): Promise<LadderResult> {
  const startedAt = new Date();
  const engine = await ctx.openEngine();
  try {
    const rng = mulberry32(ctx.seed);
    const random = randomPolicy(ctx.kernel, rng);
    const rootFen = ctx.kernel.fen(ctx.kernel.initial('root'));
    // One process plays both seats, so each move starts from a cleared hash:
    // the budgets must not share a transposition table.
    const hiPolicy = enginePolicy(ctx.kernel, engine, args.hi, rootFen, { fresh: true });
    const loPolicy = enginePolicy(ctx.kernel, engine, args.lo, rootFen, { fresh: true });
    const games: LadderResult['games'] = [];
    let hiWins = 0;
    let loWins = 0;
    let undecided = 0;

    for (let pair = 0; pair < args.pairs; pair += 1) {
      // The opening is drawn once per pair, so both seats see the same line.
      // biome-ignore lint/suspicious/noExplicitAny: generic over the adapter's move type
      const opening: any[] = [];
      let probe = ctx.kernel.initial('opening');
      for (let ply = 0; ply < args.openingPlies; ply += 1) {
        const move = await random(probe, []);
        if (move === null) break;
        opening.push(move);
        probe = ctx.kernel.apply(probe, move);
      }
      for (const hiSeat of ['red', 'black'] as const) {
        engine.newGame();
        const policies =
          hiSeat === 'red'
            ? { red: hiPolicy, black: loPolicy }
            : { red: loPolicy, black: hiPolicy };
        const played = await playGame(ctx.kernel, policies, {
          plyCap: ctx.plyCap,
          opening,
          gameId: `ladder-${pair}-${hiSeat}`,
        });
        if (played.winner === hiSeat) hiWins += 1;
        else if (played.winner) loWins += 1;
        else undecided += 1;
        games.push({
          moves: played.moves,
          plies: played.plies,
          winner: played.winner,
          reason: played.reason,
          hiSeat,
          opening: opening.map((m) => ctx.kernel.toUci(m)),
        });
        process.stderr.write(played.winner === hiSeat ? 'H' : played.winner ? 'l' : '.');
      }
    }
    process.stderr.write('\n');

    const hiScore = waldInterval(hiWins, hiWins + loWins);
    const result: LadderResult = {
      hi: args.hi,
      lo: args.lo,
      pairs: args.pairs,
      hiWins,
      loWins,
      undecided,
      hiScore,
      eloForBudget: eloFromScore(hiScore.p),
      lengths: summarizeLengths(games.map((g) => g.plies)),
      games,
    };
    const file = ctx.finish('ladder', { ...args }, engine.identity, result, startedAt);
    console.log(
      `${ctx.variant.title}: ${args.hi} vs ${args.lo} nodes, ${args.pairs} paired openings (${args.pairs * 2} games)`,
    );
    console.log(`  stronger budget ${hiWins}  weaker ${loWins}  undecided ${undecided}`);
    console.log(
      `  score ${pct(hiScore)}  ~${Number.isFinite(result.eloForBudget) ? Math.round(result.eloForBudget) : '>400'} Elo for ${(args.hi / args.lo).toFixed(0)}x nodes`,
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
