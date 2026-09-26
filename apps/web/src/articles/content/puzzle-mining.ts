import type { Article, ArticleBlock } from '../types.js';
import {
  PM_GATE_LADDER,
  PM_SCAN_LOOP,
  PM_UNIQUENESS_GATE,
} from '../puzzle-mining-diagrams.js';

// Card art: the funnel as one bar, because the funnel IS the argument. Four
// reject reasons in red and the survivors in green, reusing the vocabulary the
// match-fixing card established (red struck out, green kept) rather than
// inventing a second one. Shares are the measured ones, so the bar and the
// article's table cannot drift: near-tie 35, too short 32, mate not reached
// 12, not unique 9, survived 12.
const PM_FUNNEL_SHARES: [share: number, fill: string][] = [
  [35, '#c96f62'],
  [32, '#cf8479'],
  [12, '#d69a91'],
  [9, '#ddb0a9'],
  [12, '#5da271'],
];

const PUZZLE_MINING_THUMBNAIL = ((): string => {
  const x0 = 28;
  const width = 264;
  let cursor = x0;
  const segments = PM_FUNNEL_SHARES.map(([share, fill]) => {
    const w = (share / 100) * width;
    const rect = `<rect x="${cursor.toFixed(1)}" y="88" width="${w.toFixed(1)}" height="26" fill="${fill}"/>`;
    cursor += w;
    return rect;
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" aria-label="One bar of blunders found: four red bands of rejection reasons and a green band, one eighth wide, for the ones that became puzzles">',
    '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
    // Rounded ends on the bar as a whole, not per segment: a clipped group keeps
    // the joins square in the middle where a gap would read as a sixth category.
    '<defs><clipPath id="pm-thumb-bar"><rect x="28" y="88" width="264" height="26" rx="3"/></clipPath></defs>',
    `<g clip-path="url(#pm-thumb-bar)">${segments.join('')}</g>`,
    '<text x="28" y="142" font-family="Roboto, system-ui, sans-serif" font-size="15" font-weight="600" fill="#5a4626">12% of blunders become puzzles</text>',
    '<text x="28" y="166" font-family="Roboto, system-ui, sans-serif" font-size="12" letter-spacing="1.6" fill="#5a4626" opacity="0.72">AND WHY THE REST ARE NOT</text>',
    '</svg>',
  ].join('');
})();

// Restructured 2026-09-01 on Brian's brief: "we built a puzzle miner, this is
// how it works. games. core alg. some code. then a few examples showing the
// puzzles. even showing bad reject puzzles." The previous version ran 3,100
// words over eight sections and spent most of them on things the reader did not
// ask for: an ingest deduplication saga, run reproducibility, cost and scaling,
// the publication transaction, and the entire serving path. All cut, along with
// the landscape claim about what other xiangqi puzzle sites do, which was an
// unverified universal about competitors.
//
// Numbers are rates wherever a rate says the same thing, because absolute counts
// go stale the next time the miner runs. The funnel table carries the absolutes
// once, dated, and that is the only place they appear.
//
// Every example is an xq-replay stepper rather than a pair of static boards:
// one compact widget the reader steps through, which is what made room for six
// examples instead of two. startFen comes from standardXiangqiFen(puzzle
// .initial) and the iccs tokens are the solution with rank - 1, so any served
// puzzle converts mechanically.
//
// All six are real production rows. The four keeps are served puzzles; the two
// rejects are rejected candidates rebuilt by replaying their source game to the
// post-blunder ply. Every line was replayed through applyStandardXiangqiMove
// before anything was written about it, and both rejects' mating moves came
// from getStandardXiangqiLegalMoves rather than being read off the board.
//
// The 'two answers' reject is from the not-unique-or-not-winning bucket (9%),
// NOT the near-tie bucket (35%). Near-tie rejects exit in buildGatedLine, whose
// evidence carries only an eval count, so their two tying moves cannot be shown
// without re-running Pikafish. Two mates in one is provable from the kernel,
// which is why it is the one on the page. Do not relabel it as near-tie.
export const puzzleMiningArticle: Article = {
  slug: 'how-puzzle-mining-works',
  kind: 'article',
  publisher: 'mistboard',
  title: 'I built a xiangqi puzzle miner',
  seoTitle: 'How Mistboard mines xiangqi puzzles from real games',
  summary:
    'A miner that reads real xiangqi games, finds the moves people got wrong, and keeps the positions where exactly one move wins. About one blunder in nine survives it. Here is the algorithm, the code, and some of what it kept and threw away.',
  thumbnail: { kind: 'svg', svg: PUZZLE_MINING_THUMBNAIL },
  status: 'published',
  publishedAt: '2026-09-02',
  audience:
    'Developers curious how an automated puzzle pipeline decides what counts as a puzzle, and players who want to know where the puzzles on this site come from.',
  boardFamily: 'xiangqi',
  intro: [
    {
      kind: 'paragraph',
      text: 'Mistboard needed xiangqi puzzles and I could not find a corpus to use, so I wrote a miner. It reads real games, finds the moments somebody threw the game away, and keeps the positions where exactly one move wins.',
    },
    {
      kind: 'paragraph',
      text: 'About one blunder in nine makes it through. The reasons the other eight fail turn out to be a working definition of a puzzle, which is the interesting part and most of what is below.',
    },
  ],
  sections: [
    {
      heading: 'The games',
      blocks: [
        {
          kind: 'paragraph',
          text: 'They come from [ElephantChess](https://elephantchess.io/about/datasets), which publishes its own site’s games as anonymised monthly dumps under GPL-3.0. Amateur games, which matters: strong players do not blunder often enough to be a supply.',
        },
        {
          kind: 'paragraph',
          text: 'A run freezes its game list before any engine time is spent, sampled across ratings, time controls, results and lengths so it does not turn out to be all blitz. Nothing is added to a run once it starts.',
        },
      ],
    },
    {
      heading: 'The algorithm',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Two passes: a cheap one over every position of every game, and an expensive one over the few that survive it.',
        },
        {
          kind: 'paragraph',
          text: 'The cheap pass replays a game and stops at every position after ply 8, asking Pikafish for its top two moves at 60,000 nodes. That is roughly depth 10 to 14, and it is shallow on purpose, because it runs everywhere.',
        },
        {
          kind: 'paragraph',
          text: 'A position becomes a candidate when the move actually played loses at least 250 centipawns against the engine’s best, and the position it leaves behind is winning by at least 250 centipawns for the other side. A blunder that leaves the game equal is not a puzzle. There is nothing to find.',
        },
        {
          kind: 'paragraph',
          text: 'A centipawn is a hundredth of a soldier, the unit engines use for material. Xiangqi has no pawn, so the name comes from chess along with the scale. The values this site uses put a horse or a cannon at 450 and a chariot at 900, which makes a 250-centipawn swing about half a horse.',
        },
        {
          kind: 'paragraph',
          text: 'Two filters keep that pass honest. Positions already decided by 800 centipawns are skipped, because winning a won game harder is not a tactic. And no game gives up more than three candidates, so one collapse cannot flood the corpus with variations on itself.',
        },
        {
          kind: 'paragraph',
          text: 'The expensive pass takes each candidate back to the engine at depth 20 and 600,000 nodes, ten times the budget, handed over as a bare FEN with no move history. Same position, no context, so the engine cannot lean on the search it just did.',
        },
        {
          kind: 'paragraph',
          text: 'Then the line is built one solver move at a time, and every move has to be uniquely best on its own. That is what separates a puzzle from a plausible sequence. A principal variation is one line the engine liked from one search. It says nothing about whether move three was forced, and a solver who finds a different move three and is told they are wrong has been lied to.',
        },
        {
          kind: 'paragraph',
          text: 'Uniqueness is not a centipawn gap. Two moves 50 centipawns apart are both fine, and demanding one punishes a solver for choosing correctly. What makes a move **the** answer is that every alternative is wrong: it gives the win away, or it wins materially less. The test is a hand-tuned cascade rather than anything principled, and it fails closed, so anything it cannot separate is thrown away.',
        },
        {
          kind: 'raw-svg',
          svg: PM_GATE_LADDER,
          caption:
            'The gate in evaluation order. Green passes the move, grey rejects it, and the label on the right is the reason stored on the candidate.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The code',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The cheap pass, condensed. One detail halves it: judging a move needs the position’s value before and after, and both are already there if the scans stay in order, because the move played is worth the negation of the next position’s score. One search per position, not two.',
        },
        {
          kind: 'code',
          language: 'typescript',
          text: PM_SCAN_LOOP,
        },
        {
          kind: 'paragraph',
          text: 'And the gate. Every branch that returns false here is a way a real blunder fails to be a puzzle.',
        },
        {
          kind: 'code',
          language: 'typescript',
          text: PM_UNIQUENESS_GATE,
        },
      ],
    },
    {
      heading: 'What it keeps',
      blocks: [
        {
          kind: 'paragraph',
          text: '**Two thirds of the puzzles open with a move that captures nothing.** If you hunt for tactics by scanning the captures first, which is what most of us do, you are looking at the wrong third of the board most of the time. Step through this one: the chariot goes the length of the board and takes nothing on the way.',
        },
        {
          kind: 'xq-replay',
          spec: {
            startFen: '2ba2N2/4ak3/6N2/8p/9/3n5/n8/1R7/4A4/2c1K4 r - - 0 43',
            iccs: 'b2h2 a3c2 h2h8',
            title: 'A quiet key move',
            event: 'Mined puzzle, mate in two',
            perspective: 'red',
            red: 'Solver',
            black: 'Defence',
            resultText: 'Mate in two.',
          },
          caption:
            'Red plays the chariot the length of the board, taking nothing. Black brings the horse back to c3 to cover the mate, and it does not cover it.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Only about a tenth involve giving material away.** Sacrifices are the tactics people remember, so I had assumed they would be a larger slice. In real games between real players, the winning move is usually just a move. Here is one of the tenth, and the solver is the one behind: a horse and a cannon down before it starts.',
        },
        {
          kind: 'xq-replay',
          spec: {
            startFen: '3ak1b2/4a4/2n1b4/3R4p/p3C2r1/3R3c1/2P1c3P/r8/4A4/2BK1AB2 r - - 0 23',
            iccs: 'd6d9 c7d9 d4d9',
            title: 'Behind, and giving more away',
            event: 'Mined puzzle, mate in two',
            perspective: 'red',
            red: 'Solver',
            black: 'Defence',
            resultText: 'Mate in two.',
          },
          caption:
            'Red gave a chariot for an advisor and a horse, so it finishes 1,150 centipawns down instead of 900. The material never comes back. The mate just arrives first.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Not every puzzle ends in mate.** About 40% end with the solver simply winning, and those are the ones a mate-shaped intuition misses. This one opens with a move that takes nothing, hands a soldier back, and collects an advisor and both horses for it.',
        },
        {
          kind: 'xq-replay',
          spec: {
            startFen: '2b1ka3/4a4/4b4/9/9/3R5/4prn2/B4NN2/2p2K3/5A3 b - - 0 41',
            iccs: 'e3e2 f0e1 e2e1 f1e1 f3f2 e1e0 f2g2',
            title: 'Winning, not mating',
            event: 'Mined puzzle, winning advantage',
            perspective: 'black',
            red: 'Defence',
            black: 'Solver',
            resultText: 'Winning advantage, no mate.',
          },
          caption:
            'Black ends a thousand centipawns up, an advisor and both horses against one soldier. There is no mate here and no threat of one. It is still a puzzle.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'And one that takes nothing for four plies. Red is 150 centipawns down here and the engine calls the position level.',
        },
        {
          kind: 'xq-replay',
          spec: {
            startFen: 'Rn3a3/3ka4/b8/9/9/4P1P2/P8/6R2/1r2A4/2rAK1B2 r - - 0 32',
            iccs: 'g2d2 e8d7 a9a8 d8d9 d2d7',
            title: 'Level, then winning',
            event: 'Mined puzzle, winning advantage',
            perspective: 'red',
            red: 'Solver',
            black: 'Defence',
            resultText: 'Winning advantage, no mate.',
          },
          caption:
            'The chariot steps quietly to d3, the general is walked to the back rank, and the advisor on d8 falls. Red goes from 150 down to an engine score of +917, with Black left holding two legal moves.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'What it throws out',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The rejects define a puzzle better than the keeps do, because each one is a real blunder that failed for exactly one reason.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['Outcome', 'Share of candidates'],
          rows: [
            ['Rejected: near-tie', '35%'],
            ['Rejected: too short', '32%'],
            ['Rejected: promised mate not reached', '12%'],
            ['Rejected: not unique, or not winning', '9%'],
            ['Survived to the audit', '12%'],
          ],
          highlightRows: [0],
          caption:
            'Measured over 10,503 candidates from 3,500 games in August 2026. The shares have held within about two points across three runs; the totals will not survive the next one.',
        },
        {
          kind: 'paragraph',
          text: '**Near-tie is the biggest, about a third.** The player had a winning move and so did something else. Both work, so there is no answer to check against and no puzzle, even though the blunder was real and the position was winning.',
        },
        {
          kind: 'paragraph',
          text: '**Too short is another third**, and it gives the clearest example in the corpus of what the miner is for. Below is a position it rejected. Black is to move, the engine scores it as a forced mate against a second-best line of +1407, and exactly one of Black’s twenty legal moves does it.',
        },
        {
          kind: 'xq-replay',
          spec: {
            startFen: '3a1ab2/4k4/9/9/8p/p8/4n1N1P/3p5/9/3K1A3 b - - 0 35',
            iccs: 'e3c2',
            title: 'Rejected: too short',
            event: 'Mate in one, thrown away',
            perspective: 'black',
            red: 'Defence',
            black: 'Solver',
            resultText: 'Rejected: too short.',
          },
          caption:
            'The horse drops to c3 and it is mate. Unique, crushing, correct, and rejected, because the whole win is one move and one move is a spot-check rather than a puzzle.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The other way to fail is to have too many answers rather than too few. Red is to move below and the horse on e8 mates two different ways, c9 or g9. The stepper plays one of them. Either wins, so there is nothing to check a solver against, and the candidate is thrown out.',
        },
        {
          kind: 'xq-replay',
          spec: {
            startFen: '3ak4/4a4/4N4/9/9/9/9/9/9/2pA1KB2 r - - 0 35',
            iccs: 'e7c8',
            title: 'Rejected: two answers',
            event: 'Two mates in one, thrown away',
            perspective: 'red',
            red: 'Solver',
            black: 'Defence',
            resultText: 'Rejected: two winning answers.',
          },
          caption:
            'The horse mates on c9. It also mates on g9. Two answers is not one answer, so this is not a puzzle.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Promised mate not reached** is the narrow one, and it is not a rule against non-mate puzzles. It fires only when the engine returned a mate score, so the line promised a mate, and replaying it inside the seven-ply cap never got there. The promise could not be checked, so the candidate goes. A position with an ordinary winning evaluation never enters that branch at all, and ships as one of the winning-advantage puzzles above.',
        },
      ],
    },
    {
      heading: 'What a puzzle turns out to be',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Most winning positions have several winning moves, and that is what disqualifies them: a third of everything found died on that alone. A puzzle is a position with one answer, deep enough that finding it takes work, and stable enough that a stronger engine still agrees an hour later.',
        },
        {
          kind: 'paragraph',
          text: 'That is a much narrower thing than a mistake. Nine out of ten mistakes do not qualify.',
        },
        {
          kind: 'paragraph',
          text: 'One caveat I would rather say than hide: the gate has never been checked against a human. Its four thresholds came from reading rejected positions, not from measuring whether the puzzles they admit are any good, and the win-rate curve they act on is inherited from chess. Solve rates and reveal rates are recorded per puzzle, so the data to grade it exists.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Solve xiangqi puzzles', href: '/puzzles', emphasis: 'primary' },
            // Twelve mined positions with the solution as the mainline, chosen
            // to span what the corpus contains rather than which puzzles score
            // highest. Public, so it is readable without an account.
            { label: 'Play twelve of them', href: '/study/E63eGK5V', emphasis: 'secondary' },
          ],
          layout: 'single-row',
        },
      ],
    },
  ],
};
