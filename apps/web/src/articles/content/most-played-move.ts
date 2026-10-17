import { boardToPieces } from '@mistboard/board-render';
import { parseStandardChessFen } from '@mistboard/game';
import type { Article, ArticleBlock } from '../types.js';

// Moved from the brianhliou.com post of 2026-09-21 (/posts/most-played-move/),
// text word for word as published there, except the method (now a table) and
// the resources folded into one closing paragraph (2026-10-15). The ten boards
// were already this site's study embeds (same study, same chapters, same titles). Links to
// the Lichess analysis post point at its page here (moved 2026-10-16).

const STUDY_ID = 'ibFQtGAL';
const STUDY_HREF = `/study/${STUDY_ID}`;
const LICHESS_ANALYSIS_POST = '/blog/lichess-analysis-accuracy';

// After 1.e4 e5 2.f4 d6: the King's Gambit position, the biggest miss by games.
const KINGS_GAMBIT_D6 = (() => {
  const parsed = parseStandardChessFen(
    'rnbqkbnr/ppp2ppp/3p4/4p3/4PP2/8/PPPP2PP/RNBQKBNR w KQkq - 0 3',
    'most-played-move-thumb',
  );
  if (!parsed.ok) throw new Error(`most-played-move: ${parsed.error}`);
  return parsed.state;
})();

function position(chapter: string, title: string): ArticleBlock {
  return {
    kind: 'embed',
    path: `/embed/study/${STUDY_ID}/${chapter}?ply=0`,
    title,
    // Width-bound at the 702px column: the 8x8 board gets the column minus
    // the move sheet, plus seat rows, controls, header and credit.
    aspect: [702, 645],
  } as ArticleBlock;
}

function p(text: string): ArticleBlock {
  return { kind: 'paragraph', text };
}

export const mostPlayedMoveArticle: Article = {
  slug: 'most-played-move',
  kind: 'article',
  publisher: 'mistboard',
  title: 'When the Most Played Move Is an Inaccuracy',
  // Homepage card only (the full title wraps at the 186px card budget).
  cardTitle: 'The Most Played Move',
  summary:
    'In 144 of 4,121 common opening positions, the move club players choose most often loses winning chances against the engine at twenty million nodes. Ten of them, with what the masters played in each era, and a study holding all 144.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-21',
  updatedAt: '2026-10-15',
  thumbnail: {
    pieces: boardToPieces(KINGS_GAMBIT_D6.board),
    orientation: 'white',
  },
  audience:
    'Club chess players who build their openings from the Lichess explorer and want to know when the crowd is wrong.',
  tldr: [
    'In 144 of 4,121 common opening positions, the move 1600 to 2200 Lichess players choose most often loses winning chances against Stockfish at twenty million nodes. One in 29.',
    "Half are gambits and sidelines the masters never play. Where masters reach the position, most already play the engine's move; only four share the club's mistake.",
    'The biggest by games: after 1.e4 e5 2.f4 d6, 85% of club players play 3.Nf3, and 3.d3 is nearly a pawn better.',
    "The fix is in the explorer's settings: the masters database, 2018 onward. All 144 are in a study.",
  ],
  intro: [
    p(
      'The opening explorer on Lichess shows you, for any position, what people played next and how it went. It can show you three databases (every rated game on Lichess, the masters, or one player), filtered by rating band, speed and year, and the masters filtered by era is the best free opening book there is. But the table a club player sees by default is the Lichess database at their own rating, and its top row is the most played move at their level. That row is the move most of us play, because everyone else did. I asked how often it is an inaccuracy.',
    ),
    p(
      "The answer, over 4,121 positions that 1600 to 2200 players reach 500,000 times or more: **144 of them, one in 29.** In those positions the most played move loses at least a tenth of a winning chance against the engine's move at twenty million nodes, and a second, independent search agrees. Some are gambit lines only the club plays. Some are main lines where the masters have played the engine's move for a century. Four are positions where the masters make the same mistake the club does.",
    ),
  ],
  sections: [
    {
      heading: 'Where "most played" comes from',
      blocks: [
        p(
          'The Lichess database is every rated game on the site, filtered by rating band and speed. I took blitz, rapid and classical between 1600 and 2200, walked the tree from the start position as far as it stays above 500,000 games (14 plies at most), and kept every position on the way: 4,121 of them. For each one the explorer gives the move table, so "most played" is a fact about that band, not about chess.',
        ),
        p(
          `Then every position went through Stockfish 18 at 20,000,000 nodes with three lines. The most played move is judged against the best move from the same search, by lila's own winning-chance formula, the one that decides what gets a \`?!\` on a Lichess report. A gap of 0.1 or more is an inaccuracy, 0.2 a mistake, 0.3 a blunder. Every flagged position then got a second 20M search with a different thread count, and 24 of 168 did not survive it; 144 did. That is the same noise floor the [last post](${LICHESS_ANALYSIS_POST}) found, and it is why one search is never the verdict here.`,
        ),
        p(
          'For each of the 144 I also pulled the masters database by era (before 2010, 2010 to 2017, since 2018), which is where the shapes come from.',
        ),
      ],
    },
    {
      heading: 'Four shapes',
      blocks: [
        {
          kind: 'table',
          wrap: true,
          headers: ['shape', 'positions', 'what it means'],
          rows: [
            [
              'club only',
              '69',
              "masters have no games there, or fewer than twenty; the line is the club's alone",
            ],
            ['masters always knew', '51', "the masters' top move is the engine's move in every era"],
            [
              'masters play a third move',
              '12',
              "the masters avoid both the club move and the engine's first choice",
            ],
            ['masters switched', '8', "the masters' top move became the engine's move in a later era"],
            ['everyone plays it', '4', "the masters' top move is the club move too"],
          ],
        },
        p(
          "The club's book is mostly a book the masters never opened: 69 positions are gambits and sidelines with no masters games worth counting. Where the masters do play the position, they already agree with the engine in 51 cases, and moved toward it in 8 more. In only four of 144 do masters and club share the mistake. Theory is not lagging the engine much; the club is lagging theory.",
        ),
      ],
    },
    {
      heading: 'Ten positions',
      blocks: [
        p(
          "Each has a board below. The most played move is on the mainline with its mark; the engine's line is the sideline with the numbers; the comment holds the club share and the masters' history. The strips first: how often the club move and the engine move are played, by 1600 to 2200 players and by masters in each era.",
        ),
        {
          kind: 'image-figure',
          src: '/article-thumbs/most-played-move-era-strips.svg',
          darkSrc: '/article-thumbs/most-played-move-era-strips-dark.svg',
          alt: 'For ten opening positions, bars showing how often the club move and the engine move are played by 1600 to 2200 players on Lichess, and by masters before 2010, in 2010 to 2017, and since 2018.',
          caption:
            "Rust is the club's favourite, blue the engine's move. Masters cells with fewer than twenty games are left blank.",
          className: 'article-figure-full',
        },
        p(
          "**King's Gambit, 2...d6.** After 1.e4 e5 2.f4 d6, 85% of club players play 3.Nf3, and so did half the masters who reached it. At 20M it is −0.67; 3.d3 is +0.25, because after 3.Nf3 exf4 Black takes the pawn and keeps it (the next position in the tree agrees: 44% then play 3...Nc6?! instead of taking). Everyone plays it, and it is the biggest miss on the list by games.",
        ),
        position('DIavcvsA', "King's Gambit 2...d6: 3.Nf3 is the club move, 3.d3 the engine's"),
        p(
          '**Petrov, 3.Bc4.** 1.e4 e5 2.Nf3 Nf6 3.Bc4 reaches ten million club games, and a third of Black players answer 3...Nc6, turning it into a Two Knights. 3...Nxe4 takes the pawn: −0.54 against +0.15. The masters have taken it in every era, seven times in ten.',
        ),
        position('NhUfoSo5', 'Petrov 3.Bc4: the club plays Nc6, the engine takes on e4'),
        p(
          "**Four Knights, Spanish, 4...d6.** 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.Nc3, and 31% of the club plays 4...d6, +0.69. Rubinstein's 4...Nd4 is 0.00, and it is the one line on this list where you can watch theory move: the masters' top choice was 4...Bb4 before 2018 and is 4...Nd4 now (39% of 2,666 games). The club never played either.",
        ),
        position(
          '93DmCHif',
          "Four Knights Spanish 4.Nc3: the club plays d6, the engine plays Rubinstein's Nd4",
        ),
        p(
          '**Vienna Gambit, 3...exf4.** 1.e4 e5 2.Nc3 Nf6 3.f4, and 30% take the pawn. It is +0.63 for White; 3...d5, the move 97% of masters have played in every era, is −0.31. Taking is the natural move and the losing one, which is what the gambit is for.',
        ),
        position('aQ7aPIVS', "Vienna Gambit: exf4 is the club move, d5 the engine's and the masters'"),
        p(
          "**Stafford Gambit, move 6.** 1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nc6 4.Nxc6 dxc6 5.Nc3 Bc5, the internet's favourite trap, 1.2 million club games. A quarter of White players play 6.Bc4, which walks into 6...Ng4 and the whole point of the gambit: −0.79. 6.h3 first is +1.74, a full piece's worth of difference, and the largest gap among the ten. Masters have played this position three times.",
        ),
        position('XDY656F3', "Stafford Gambit: 6.Bc4 is the club move, 6.h3 the engine's"),
        p(
          '**Busch-Gass, 2...Bc5.** 1.e4 e5 2.Nf3 Bc5 offers the e-pawn, and 48% of White players decline it with 3.Bc4. Just take it: 3.Nxe5 is +1.60 against +0.24, and after 3...d6 4.Nf3 the pawn stays. Seven million club games, five masters games in total.',
        ),
        position('OqEGIRgy', "Busch-Gass Gambit: 3.Bc4 is the club move, 3.Nxe5 the engine's"),
        p(
          "**Falkbeer, 3.exd5.** 1.e4 e5 2.f4 d5 3.exd5, and 43% of the club plays the textbook 3...e4, the move the Falkbeer was named for. It is +0.52. 3...exf4 is −0.19, and the masters found that out in public: their share of 3...exf4 went from 36% before 2010 to 73% to 82%. The club's book is the old one.",
        ),
        position(
          'dNSTkDfl',
          "Falkbeer: 3...e4 is the club move, 3...exf4 the engine's and now the masters'",
        ),
        p(
          "**London, 2...g6 3.Nc3.** 1.d4 Nf6 2.Bf4 g6 3.Nc3 and 73% of the club plays 3...Bg7, the move you play in every other London. Here it is +0.62 and 3...d5 is 0.00, because 3.Nc3 is there to play 4.e4, and the bishop move lets it happen while 3...d5 stops it. The masters' share of 3...d5 went 48%, 66%, 77% by era.",
        ),
        position('lEWB4sEx', "London 2...g6 3.Nc3: Bg7 is the club move, d5 the engine's"),
        p(
          '**Scandinavian, 3.Ng5 line.** 1.e4 d5 2.Nf3 dxe4 3.Ng5 Nf6 4.d3 exd3 5.Bxd3, a million club games, and 31% of Black players play 5...h6 to ask the knight. The answer is 6.Nxf7 Kxf7 7.Bg6+ and the queen on d8 goes: +2.70 for White against −1.12 for 5...Nc6. No master has ever been in this position.',
        ),
        position('0R1VQKGt', 'Scandinavian 3.Ng5 line: 5...h6 is the club move and loses the queen'),
        p(
          "**Queen's Gambit Accepted, 3.e4 e5.** 1.d4 d5 2.c4 dxc4 3.e4 e5, and 63% of White players push 4.d5. It is −1.02; 4.Nf3 is +0.43, and the masters have played 4.Nf3 in 97 to 100% of their games in every era. The push looks like it wins space and hands Black the centre.",
        ),
        position('wwmGBmci', "QGA 3.e4 e5: 4.d5 is the club move, 4.Nf3 the engine's and the masters'"),
        p(
          `All 144 are in [the study](${STUDY_HREF}), these ten first, the rest ranked by how many games they touch times how much the move gives up.`,
        ),
      ],
    },
    {
      heading: 'Reading the explorer',
      blocks: [
        p(
          "The most played move in your rating band is the move most people at your rating play, which is not a recommendation, and the explorer never said it was. The filters that fix most of this list are already in the gear menu. Switch to the masters database and set the years to 2018 on, not the all-time table: the masters' book moves, and the all-time table is an average of eras. And when the most played move takes a pawn or declines one, check the engine before trusting the crowd; four of the ten above are a capture or a declined capture.",
        ),
      ],
    },
    {
      heading: 'How this was measured',
      blocks: [
        {
          kind: 'table',
          keyColumn: true,
          wrap: true,
          headers: ['', ''],
          rows: [
            [
              '**Positions**',
              'The [Lichess opening explorer](https://lichess.org/analysis#explorer), database "Lichess", ratings 1600, 1800, 2000 and 2200, blitz, rapid and classical',
            ],
            [
              '**Walk**',
              'From the start position to 14 plies, keeping every position with at least 500,000 games; stopped at 4,000 expanded nodes, with 55 left in the queue',
            ],
            [
              '**Engine**',
              'Stockfish 18 at 20,000,000 nodes, MultiPV 3, one search per position, on Modal',
            ],
            [
              '**Judged against**',
              'The best move from that search. The most played move is scored by its own line when the search ranked it among the three, else by a 20M search of the position after it',
            ],
            [
              '**Miss**',
              "A gap of 0.1 or more by lila's winning-chance formula, `2 / (1 + e^(−0.00368·cp)) − 1`",
            ],
            [
              '**Second search**',
              'Every flagged position again at 20M, MultiPV 3, on a different machine and thread count, same rule; 144 of 168 survive',
            ],
            [
              '**Masters eras**',
              'The masters database with `until=2009`, `since=2010&until=2017` and `since=2018`; a cell under twenty games counts as no data',
            ],
          ],
        },
        p(
          `The harness is the one from [Lichess Analysis: What a Million Nodes a Move Buys](${LICHESS_ANALYSIS_POST}), the previous post, on how the labels are made.`,
        ),
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Open the 144 positions', href: STUDY_HREF, emphasis: 'primary' },
            { label: 'The deep puzzles', href: '/study/fhC7BCG7', emphasis: 'secondary' },
            { label: 'Xiangqi for chess players', href: '/rules/xiangqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
