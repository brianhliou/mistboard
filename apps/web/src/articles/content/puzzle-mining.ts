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
// article's table cannot drift: near-tie 35.7, too short 24.9, mate not
// reached 8.0, not unique 25.7, survived 5.6 (v3 mine, ElephantChess subset,
// 2026-10-28; see the note above updatedAt).
const PM_FUNNEL_SHARES: [share: number, fill: string][] = [
  [35.7, '#c96f62'],
  [24.9, '#cf8479'],
  [8.0, '#d69a91'],
  [25.7, '#ddb0a9'],
  [5.6, '#5da271'],
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
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" aria-label="One bar of blunders found: four red bands of rejection reasons and a green band, about one eighteenth wide, for the ones that became puzzles">',
    '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
    // Rounded ends on the bar as a whole, not per segment: a clipped group keeps
    // the joins square in the middle where a gap would read as a sixth category.
    '<defs><clipPath id="pm-thumb-bar"><rect x="28" y="88" width="264" height="26" rx="3"/></clipPath></defs>',
    `<g clip-path="url(#pm-thumb-bar)">${segments.join('')}</g>`,
    '<text x="28" y="142" font-family="Roboto, system-ui, sans-serif" font-size="15" font-weight="600" fill="#5a4626">6% of blunders become puzzles</text>',
    '<text x="28" y="166" font-family="Roboto, system-ui, sans-serif" font-size="12" letter-spacing="1.6" fill="#5a4626" opacity="0.72">AND WHY THE REST ARE NOT</text>',
    '</svg>',
  ].join('');
})();

// A bare line embed for a position the site does not serve as a puzzle.
function pmLinePath(
  fen: string,
  moves: string[],
  event: string,
  orientation: 'red' | 'black',
): string {
  const query = new URLSearchParams({
    fen: fen.replace(/ /g, '_'),
    moves: moves.join(','),
    red: orientation === 'red' ? 'Solver' : 'Defence',
    black: orientation === 'black' ? 'Solver' : 'Defence',
    event,
  });
  if (orientation === 'black') query.set('orientation', 'black');
  return `/embed/line/xiangqi?${query.toString()}`;
}

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
// Every example is an embed the reader can play, not a stepper (2026-10-28,
// Brian: new-style embeds). Three keeps are still served on prod and frame the
// real trainer at /embed/puzzle/<id>, found by matching each FEN's board
// against /api/puzzles/<id>. The quiet-key puzzle is no longer in the served
// set, and the two rejects never were, so those three frame the same line as a
// bare /embed/line/xiangqi with the solution covered until the reader asks.
// Line moves are 1-based coordinates (the old stepper's iccs tokens, rank + 1).
// Local pairs hold only the seed puzzles, so the three puzzle frames preview
// only against prod data.
//
// All six are real production rows. The four keeps were served puzzles; the two
// rejects are rejected candidates rebuilt by replaying their source game to the
// post-blunder ply. Every line was replayed through applyStandardXiangqiMove
// before anything was written about it, and both rejects' mating moves came
// from getStandardXiangqiLegalMoves rather than being read off the board.
//
// The 'two answers' reject is from the not-unique-or-not-winning bucket (26%),
// NOT the near-tie bucket (36%). Near-tie rejects exit in buildGatedLine, whose
// evidence carries only an eval count, so their two tying moves cannot be shown
// without re-running Pikafish. Two mates in one is provable from the kernel,
// which is why it is the one on the page. Do not relabel it as near-tie.
export const puzzleMiningArticle: Article = {
  slug: 'how-puzzle-mining-works',
  kind: 'article',
  publisher: 'mistboard',
  topic: 'engineering',
  title: 'Mining puzzles from real games',
  seoTitle: 'How Mistboard mines xiangqi puzzles from real games',
  summary:
    'A miner that reads real xiangqi games, finds the moves people got wrong, and keeps the positions where exactly one move wins. About one blunder in twenty survives. Here is the algorithm, the code, and what it kept and threw away.',
  thumbnail: { kind: 'svg', svg: PUZZLE_MINING_THUMBNAIL },
  status: 'published',
  publishedAt: '2026-09-02',
  // Merged in the brianhliou.com twin (2026-09-02 post): licence gate, audit,
  // cost line and the rating section. The post's classifySolverMove snippet was
  // stale and stays out; the withheld threshold is AHEAD_CP=300 in
  // scripts/hide-xiangqi-puzzles.mjs (the post's "more than a horse" was wrong).
  // 2026-10-28: the material-gap exception (runner-up still winning but 250cp
  // or more behind => unique) was dropped from the gate on Brian's call (#712).
  // The funnel shares, the thumbnail bar and the "one in twenty" rate are
  // re-measured on the v3 mine (xiangqi-corpus/forge/v3/ec.log metrics line +
  // ec.jsonl): 13,897 candidates from 4,115 ElephantChess games. Survivors
  // count verified lines of 3+ plies, as the August table did (v3 itself
  // kept only 5+; its 3-ply lines are the verified-short records). Shares:
  // near-tie 4958, too short 3460 (1-ply verified-short 3453 + after-trim 7),
  // mate not reached 1116, not unique 3573, survived 781 (189 + 592 3-ply).
  // "One in twenty" = 781 less the August audit's 6% over 13,897 (1 in 19).
  // NOT re-measured on v3: the 6% audit rate (August, 80 of 1,294), the
  // August cost line, and the served-corpus shares (two thirds quiet, 40%
  // winning-advantage; v3's 5+ set alone is 80% quiet, 21% winning-advantage).
  updatedAt: '2026-10-28',
  updateNote:
    'Dropped the 250-centipawn exception from the gate: a position whose second-best move still wins is now rejected, however much less it wins by. The funnel figures are re-measured under the new gate, the six examples are now playable boards (three are the puzzles as served), and the text is shorter.',
  audience:
    'Developers curious how an automated puzzle pipeline decides what counts as a puzzle, and players who want to know where the puzzles on this site come from.',
  boardFamily: 'xiangqi',
  intro: [
    {
      kind: 'paragraph',
      text: 'Mistboard needed xiangqi puzzles and I could not find a corpus to use, so I wrote a miner.',
    },
    {
      kind: 'paragraph',
      text: 'About one blunder in twenty makes it through. The reasons the other nineteen fail turn out to be a working definition of a puzzle, and most of this article is about them.',
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
          text: 'A run freezes its game list before any engine time is spent, sampled across ratings, time controls, results and lengths so it is not all blitz. Nothing is added to a run once it starts.',
        },
        {
          kind: 'paragraph',
          text: 'Every source carries a licence status, and publishing refuses any puzzle whose source has not been cleared.',
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
          text: 'The cheap pass replays a game and stops at every position after ply 8, asking Pikafish for its top two moves at 60,000 nodes, roughly depth 10 to 14. It is shallow on purpose, because it runs everywhere.',
        },
        {
          kind: 'paragraph',
          text: 'A position becomes a candidate when the move played loses at least 250 centipawns against the engine’s best and leaves the other side winning by at least 250. A blunder that leaves the game equal has nothing to find.',
        },
        {
          kind: 'paragraph',
          text: 'A centipawn is a hundredth of a soldier, the unit engines use for material. Xiangqi has no pawn, so the name comes from chess along with the scale. This site puts a horse or a cannon at 450 and a chariot at 900, so 250 centipawns is about half a horse.',
        },
        {
          kind: 'paragraph',
          text: 'Two filters narrow it. Positions already decided by 800 centipawns are skipped, because winning a won game harder is not a tactic. No game gives up more than three candidates, so one collapse cannot flood the corpus with variations on itself.',
        },
        {
          kind: 'paragraph',
          text: 'The expensive pass sends each candidate back to the engine at depth 20 and 600,000 nodes, ten times the budget, as a bare FEN with no move history, so the engine cannot lean on the search it just did.',
        },
        {
          kind: 'paragraph',
          text: 'Then the line is built one solver move at a time, and every move has to be uniquely best on its own. A principal variation is one line the engine liked from one search. It says nothing about whether move three was forced, and a solver who finds a different move three and is told they are wrong has been lied to.',
        },
        {
          kind: 'paragraph',
          text: 'Uniqueness is not a centipawn gap. Two moves 50 centipawns apart are both fine, and demanding one punishes a solver for choosing correctly. A move is **the** answer when every alternative gives the win away. A second move that still wins, even by a whole piece less, is a second answer. The test is a hand-tuned cascade, and it fails closed: anything it cannot separate is thrown away.',
        },
        {
          kind: 'raw-svg',
          svg: PM_GATE_LADDER,
          caption:
            'The gate in evaluation order. Green passes the move, grey rejects it, and the label on the right is the reason stored on the candidate.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'What survives goes to an audit. A separate process, knowing nothing of what the first pass decided, searches every solution again at depth 22 with no node ceiling and drops the roughly 6% that do not hold up.',
        },
      ],
    },
    {
      heading: 'The code',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The cheap pass, condensed. One detail halves the searches: judging a move needs the position’s value before and after, and if the scans stay in order both are already there, because the move played is worth the negation of the next position’s score.',
        },
        {
          kind: 'code',
          language: 'typescript',
          text: PM_SCAN_LOOP,
        },
        {
          kind: 'paragraph',
          text: 'In August 2026 mining cost about six core-hours per thousand games, or about one core-minute per published puzzle.',
        },
        {
          kind: 'paragraph',
          text: 'And the gate. Every branch that returns false is a way a real blunder fails to be a puzzle.',
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
          text: '**Two thirds of the puzzles open with a move that captures nothing.** If you hunt for tactics by scanning the captures first, as most of us do, you start in the wrong place two times in three.',
        },
        {
          kind: 'embed',
          path: pmLinePath(
            '2ba2N2/4ak3/6N2/8p/9/3n5/n8/1R7/4A4/2c1K4 r - - 0 43',
            ['b3h3', 'a4c3', 'h3h9'],
            'Mined puzzle, mate in two',
            'red',
          ),
          title: 'A quiet key move',
          aspect: [702, 700],
          hideSolution: true,
          caption:
            'Red plays the chariot the length of the board, taking nothing. Black brings the horse back to c3 to cover the mate, and it does not cover it.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Only about a tenth involve giving material away.** Sacrifices are the tactics people remember, so I had expected more. In real games the winning move is usually just a move. In this one the solver is already a horse and a cannon down, and gives more away.',
        },
        {
          kind: 'embed',
          // FEN 3ak1b2/4a4/2n1b4/3R4p/p3C2r1/3R3c1/2P1c3P/r8/4A4/2BK1AB2 r, d7d10 c8d10 d5d10.
          path: '/embed/puzzle/xq-mined-hxq_ecd6351bc9fa68d90a4e9a96-44',
          title: 'Behind, and giving more away',
          caption:
            'Red gives a chariot for an advisor and a horse, going from 900 to 1,150 centipawns down. The mate arrives first.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Not every puzzle ends in mate.** About 40% end with the solver simply winning, and a mate-shaped intuition misses those. This one opens with a quiet move, hands a soldier back, and collects an advisor and both horses for it.',
        },
        {
          kind: 'embed',
          // FEN 2b1ka3/4a4/4b4/9/9/3R5/4prn2/B4NN2/2p2K3/5A3 b, seven plies.
          path: '/embed/puzzle/xq-mined-hxq_397031ca3e4e2e53dcb3709e-81',
          title: 'Winning, not mating',
          caption:
            'Black ends a thousand centipawns up, with no mate and no threat of one. It is still a puzzle.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'And one that takes nothing for four plies. Red starts 150 centipawns down, and the engine calls the position level.',
        },
        {
          kind: 'embed',
          // FEN Rn3a3/3ka4/b8/9/9/4P1P2/P8/6R2/1r2A4/2rAK1B2 r, five plies.
          path: '/embed/puzzle/xq-mined-hxq_ba5fd3c9dcb4fb0dabe497c1-62',
          title: 'Level, then winning',
          caption:
            'The chariot steps quietly to d3, the general is walked to the back rank, and the advisor on d8 falls. Red goes from 150 down to an engine score of +917, and Black has two legal moves left.',
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
            ['Rejected: near-tie', '36%'],
            ['Rejected: too short', '25%'],
            ['Rejected: promised mate not reached', '8%'],
            ['Rejected: not unique, or not winning', '26%'],
            ['Survived to the audit', '6%'],
          ],
          highlightRows: [0],
          caption:
            'Measured over 13,897 candidates from 4,115 games in October 2026, counting lines of three plies or more as survivors. Under the old gate in August, not unique was 9% and survivors 12%; the totals will not survive the next run.',
        },
        {
          kind: 'paragraph',
          text: '**Near-tie is the biggest, about a third.** The position had two winning moves, so there is no single answer to check against, even though the blunder was real.',
        },
        {
          kind: 'paragraph',
          text: '**Too short is another quarter**, and it gives the clearest example of what the miner is for. In this rejected position Black is to move, the engine scores a forced mate against a second-best line of +1407, and exactly one of Black’s twenty legal moves does it.',
        },
        {
          kind: 'embed',
          path: pmLinePath(
            '3a1ab2/4k4/9/9/8p/p8/4n1N1P/3p5/9/3K1A3 b - - 0 35',
            ['e4c3'],
            'Mate in one, thrown away',
            'black',
          ),
          title: 'Rejected: too short',
          aspect: [702, 700],
          hideSolution: true,
          caption:
            'The horse drops to c3 and it is mate. Unique, crushing, correct, and rejected: a win that takes one move is a spot-check, not a puzzle.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The other way to fail is too many answers. Below, Red is to move and the horse on e8 mates two ways, c9 or g9, and the board plays one of them. Either wins, so there is nothing to check a solver against.',
        },
        {
          kind: 'embed',
          path: pmLinePath(
            '3ak4/4a4/4N4/9/9/9/9/9/9/2pA1KB2 r - - 0 35',
            ['e8c9'],
            'Two mates in one, thrown away',
            'red',
          ),
          title: 'Rejected: two answers',
          aspect: [702, 700],
          hideSolution: true,
          caption:
            'The horse mates on c9. It also mates on g9. Two answers is not one answer, so this is not a puzzle.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Promised mate not reached** is the narrow one, and it is not a rule against non-mate puzzles. It fires only when the engine returned a mate score and replaying the line inside the seven-ply cap never reached the mate. A position with an ordinary winning evaluation never enters that branch, and ships as a winning-advantage puzzle like the ones above.',
        },
      ],
    },
    {
      // packages/game/src/puzzles-xiangqi-difficulty.ts (clamp 1000..2600,
      // sacrifice bonus 200, free-capture penalty = MATERIAL_CP capped at 900,
      // guarded by status 'playing'); migration 129 + hide-xiangqi-puzzles.mjs
      // for the withheld class. 1,415 / 479 are the post's 2026-09-02 figures.
      heading: 'A rating scores what makes the line hard to see',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every puzzle needs a rating before anyone has solved it, so the trainer can pick problems near your level. Rating by mate depth gives four distinct values across the corpus. The rating walks the solution instead: a quiet first move adds, a capture subtracts, a sacrifice the solver never wins back adds up to 200, and the number of replies the defender has pushes it either way. On 2 September 2026 the 1,415 puzzles served had 479 distinct ratings between 1000 and 2600.',
        },
        {
          kind: 'paragraph',
          text: 'The largest penalty goes to a first move that takes a piece nothing can take back, scaled by that piece and capped at a chariot’s 900, because a hanging piece is the easiest thing on a board to spot. The check runs only while the game is still going: a capture that mates also leaves no legal reply, and counted naively it would look like a free piece and mark down every mating capture in the corpus.',
        },
        {
          kind: 'paragraph',
          text: 'One kind of position is withheld: the solver is already at least 300 centipawns ahead and the answer takes something undefended. It teaches nothing at any rating, and a rating can only decide who gets shown a problem. That rule hid 12% of the corpus.',
        },
      ],
    },
    {
      heading: 'What a puzzle turns out to be',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Most winning positions have several winning moves, and a third of everything found died on that alone. A puzzle is a position with one answer, deep enough that finding it takes work, and stable enough that a stronger engine still agrees an hour later. Nineteen mistakes in twenty do not qualify.',
        },
        {
          kind: 'paragraph',
          text: 'One caveat: the gate has never been checked against human solvers. Its three thresholds came from reading rejected positions; nobody has measured whether the puzzles they admit are any good, and the win-rate curve they act on comes from chess. Solve and reveal rates are recorded per puzzle, so the data to grade it exists.',
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
