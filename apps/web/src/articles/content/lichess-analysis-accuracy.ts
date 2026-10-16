import { boardToPieces } from '@mistboard/board-render';
import { parseStandardChessFen } from '@mistboard/game';
import type { Article, ArticleBlock } from '../types.js';

// Moved from the brianhliou.com post of 2026-09-20 (/posts/lichess-analysis-accuracy/,
// "What Lichess Analysis Misses") on 2026-10-16, with the reframe written for the
// Lichess blog version (content/surfaces/lichess/drafts/lichess-analysis-accuracy.md):
// a report on what the analysis budget buys, not a list of misses. From that draft:
// the title, summary, the two opening paragraphs, the budget section, the three
// findings and the closing section. From the blog post, unchanged: the data, the
// titled-player table, the five positions, the method and its table. The chart is
// the post's own SVG with a dark twin. The five boards were already this site's
// study embeds (study fhC7BCG7, same chapters).

const STUDY_ID = 'fhC7BCG7';
const STUDY_HREF = `/study/${STUDY_ID}`;
const FIGURES = '/article-thumbs/lichess-analysis-accuracy';
const ADVICE_SCALA = 'https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala';
const WORK_SCALA = 'https://github.com/lichess-org/lila/blob/master/modules/fishnet/src/main/Work.scala';

// Zhigalko, Black to move before 20...Qd7: the first of the five positions.
const ZHIGALKO_QD7 = (() => {
  const parsed = parseStandardChessFen(
    '2rr2k1/p1q1bppp/bp2pn2/4B3/1Pp5/6P1/PQ1NPPBP/3RR1K1 b - - 0 20',
    'lichess-analysis-accuracy',
  );
  if (!parsed.ok) throw new Error(`lichess-analysis-accuracy: ${parsed.error}`);
  return parsed.state.board;
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

export const lichessAnalysisAccuracyArticle: Article = {
  slug: 'lichess-analysis-accuracy',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Lichess Analysis: What a Million Nodes a Move Buys',
  // Homepage card only (the full title wraps at the 186px card budget).
  cardTitle: 'What a Million Nodes Buys',
  summary:
    'Lichess analyses each move at a million nodes, about a second of one core. I re-ran 300 games at twenty times that to see what the budget trades away: the blunders hold, the inaccuracies move.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-20',
  updatedAt: '2026-10-16',
  thumbnail: {
    pieces: boardToPieces(ZHIGALKO_QD7),
    orientation: 'black',
  },
  audience:
    'Chess players who read their Lichess analysis reports, and anyone curious what a deeper engine search would change.',
  tldr: [
    'Lichess analyses each position at a million nodes, about a second of one Stockfish core. I re-ran 300 random games at twenty times that budget and compared every label.',
    'The budget holds where it matters most: blunders keep their label 84% of the time, and the totals in the game summary barely move.',
    'One move in ten gets a different label, mostly inaccuracies: 57% hold, 28% are nothing at depth, 15% are worse. The changes concentrate between half a pawn and three pawns.',
    "Thirteen of the 300 games have a mistake with no mark. Thirty-two unmarked mistakes from titled players' games are a puzzle study.",
  ],
  intro: [
    p(
      'Lichess analyses each position in a requested game at **1,000,000 nodes**, about a second of one Stockfish core. The analysis runs on [fishnet](https://github.com/lichess-org/fishnet), CPUs that volunteers donate, so every extra node is donated time, and a longer wait for the person who pressed the button. A deeper search would be more accurate. The useful questions are how much more, and what it would cost.',
    ),
    p(
      'I re-analysed 300 rated games at twenty times the budget to put a size on it. The budget holds where it matters most. Blunders keep their label 84% of the time, and the totals in the game summary barely move. What changes is concentrated in one label, the inaccuracy, and in one range of positions, between half a pawn and three pawns.',
    ),
  ],
  sections: [
    {
      heading: 'The budget and what it costs to raise',
      blocks: [
        p(
          `The budgets are in lila's source ([\`Work.Origin\`](${WORK_SCALA})): a million nodes for a requested analysis, five million for official broadcasts, 300,000 and 100,000 for the automatic passes. It is a deliberate scale, with the most compute where the most people are watching.`,
        ),
        p(
          'Search time grows with the node count. The average game in my sample had 67 positions to evaluate (20,227 moves over 300 games), and twenty times the nodes is twenty times the search on every one of them. For every game anyone asks about, the difference is a longer wait or twenty times the volunteers.',
        ),
        p(
          `Each label compares two evaluations, the position before your move and the position after, converted to winning chances so that a half-pawn slip at 0.00 counts for more than one at +5. A drop of 0.1 in winning chances is an inaccuracy, 0.2 a mistake, 0.3 a blunder ([\`Advice.scala\`](${ADVICE_SCALA})). So a label is as good as the search on both ends. If a million nodes do not find what a position holds, a move that gives it up loses nothing against the number.`,
        ),
        {
          kind: 'image-figure',
          src: `${FIGURES}/eval-overlay.svg`,
          darkSrc: `${FIGURES}/eval-overlay-dark.svg`,
          alt: 'Two evaluation lines over 71 half-moves of one blitz game, Lichess at one million nodes and Stockfish at twenty million. They track each other for nineteen moves and split at move 20.',
          caption:
            'One of my blitz games from September, evaluated at both budgets. The blue line is the Lichess graph and the dots are the moves it marked. The rings are three moves the deeper search calls mistakes, at 20, 24 and 26. Before 20.Qd1 the server had +1.2, and +0.9 after, too small a drop to mark; at 20M it is +2.0 and +0.7.',
          className: 'article-figure-full',
        },
        p(
          'My 20.Qd1 was that case: the better square was one file over, and the punishment starts three moves later than a one-second search looks.',
        ),
      ],
    },
    {
      heading: 'What twenty times the budget changes',
      blocks: [
        p(
          'On 300 random rated games (1600 to 2400, from the August 2026 database), re-evaluated at 20,000,000 nodes with the same formula, and setting aside the 842 moves with a forced mate at either end, 19,385 moves compared:',
        ),
        p(
          '**What holds.** Blunders keep their label 84% of the time. Labels change in both directions in nearly equal numbers (930 harsher, 885 kinder), so a game\'s totals barely move. At equality, and once the game is decided (six pawns or more), the two passes agree.',
        ),
        p(
          '**What moves.** One move in ten gets a different label, mostly inaccuracies. Of 1,805 Lichess inaccuracies, 57% are still inaccuracies at 20M, 28% are nothing, and 15% are mistakes or blunders.',
        ),
        p(
          '**Where it moves.** Thirteen of the 300 games have a mistake with no mark, and 29 have a marked mistake or blunder that is nothing at depth. Most sit where the evaluation is between half a pawn and three pawns, where the two passes agree least (82–87% against 94% near equality).',
        ),
        p(
          "A cheaper 4M-node pass over nine titled players' recent games (804 in all: about a hundred each for seven, 61 for Gürel, 20 for Giri), on their own moves: a quarter of the mistakes Lichess pins on Magnus Carlsen are not mistakes at depth, and for everyone else it runs the other way, with one real mistake in five carrying a softer label than it deserves.",
        ),
        {
          kind: 'table',
          headers: ['player', 'games', 'Lichess mistakes+blunders', 'under-labelled', 'over-labelled'],
          rows: [
            ['Magnus Carlsen', '104', '195', '18 (11%)', '**50 (26%)**'],
            ['Alireza Firouzja', '104', '215', '45 (20%)', '35 (16%)'],
            ['Eric Rosen', '102', '225', '45 (20%)', '43 (19%)'],
            ['Jerry (ChessNetwork)', '104', '287', '45 (16%)', '46 (16%)'],
            ['Oleksandr Bortnyk', '102', '184', '51 (25%)', '30 (16%)'],
            ['Sergei Zhigalko', '103', '218', '53 (22%)', '29 (13%)'],
            ['Dmitry Andreikin', '104', '165', '33 (19%)', '26 (16%)'],
            ['Ediz Gürel', '61', '117', '37 (27%)', '15 (13%)'],
            ['Anish Giri', '20', '12', '3', '1'],
          ],
        },
      ],
    },
    {
      heading: 'Five positions where depth changes the verdict',
      blocks: [
        p(
          'Each position is from one of those games. The player made the move shown, the analysis gave it no mark, and a 20-million-node search calls it a mistake or worse against a best move that is unique. The board opens on the position before the move, so you can look for the better move first; step forward and you get the game move with the mark it should have had, and the refutation is the sideline in the study, one click under each board.',
        ),
        p(
          '**Zhigalko, Black to move.** White has just played Be5, hitting the queen on c7, and Black did the natural thing: 20...Qd7, out of the attack. The analysis had it −1.38 before and −1.30 after, nothing lost. But the queen did not need saving. 20...Rxd2! gives up the exchange, and after 21.Rxd2 the pawn move 21...c3! forks the queen on b2 and the rook on d2 at once. White gets the queen back (22.Bxc7 cxb2 23.Rxb2 Rxc7) and is left with a rook against Black\'s two bishops and knight: −3.2 at depth, against −1.3 for the retreat. The refutation starts with a move that loses material, which is why a one-second search never sees it.',
        ),
        position('RRlzQDpH', 'Zhigalko: 20...Qd7 got no mark at 1M; Rxd2 and c3 win'),
        p(
          '**Bortnyk, Black to move.** 20...b5 attacks the bishop on c4, and the analysis moved from −0.63 to −0.41. The bishop on f5 could simply have taken the knight: 20...Bxe4! 21.dxe4, and now the other knight lands on f4, with ...e5 to follow to push the bishop off d4. Black wins material inside five moves, −2.7 at depth; the second-best move, 20...Nf4 at once, is only −0.6.',
        ),
        position('SaKQ9lAL', 'Bortnyk: 20...b5 got no mark at 1M; Bxe4 wins material'),
        p(
          "**Bortnyk, Black to move, a queen ending.** Queen and knight against queen and rook, and White's a-pawn is the only thing White has going. Black played 54...Qf6; the analysis said −1.58 to −1.03. At depth the position after Qf6 is a dead draw. 54...Qa7+! 55.Kg3 Qxa4 picks up that pawn with check, and the ending is −2.1 and winning.",
        ),
        position('k6SvHLlk', 'Bortnyk: 54...Qf6 got no mark at 1M; Qa7+ and Qxa4 win a pawn'),
        p(
          '**Carlsen, Black to move.** The white queen sits on g4 and the knight on e4. Carlsen played 15...Ne5, hitting the queen, and the analysis went from −0.94 to −0.43. The pawn move 15...f5! hits both: after 16.Qh3 fxe4 17.Bxe4 Black has won a knight for a pawn and stands −1.9, with the second-best move (15...g6) a pawn and a half behind. A shallow search reads ...f5 as loosening the king and the knight retreat as safe, and both readings are wrong.',
        ),
        position('hBy0MKin', 'Carlsen: 15...Ne5 got no mark at 1M; f5 forks queen and knight'),
        p(
          "**Gürel, White to move.** A rook ending with a knight each; Black's knight on a3 is loose, and White's d-pawn is on d5. White played 31.Nd4, +1.42 to +1.06 by the analysis. 31.d6! is the move: the rook has to stop the pawn (31...Rxd6), and then 32.Nxa3 takes the knight for nothing. +3.9 at depth, against +0.9 after the game move.",
        ),
        position('HLcPbqbJ', 'Gürel: 31.Nd4 got no mark at 1M; d6 deflects the rook and wins the knight'),
        p(
          `All 32 are in [the study](${STUDY_HREF}), set as puzzles: the position first, the game move marked, the refutation as a sideline with the engine's numbers, and every later move of the game that the 20M search judges carries its own mark and the engine's line beside it. Forcing solutions come first, since a long tactic past the shallow horizon is something a person can find; the quiet ones are after.`,
        ),
      ],
    },
    {
      heading: 'Reading your own report',
      blocks: [
        p(
          '"Zero mistakes" means zero visible at a million nodes. The blunders are real, the inaccuracies are half real, and the moves that let an opponent back into a game you were winning by a pawn or two are the ones most likely to carry no mark. If a game matters, put your own engine on it and let it sit past depth 25 on the positions between +0.5 and +3.',
        ),
      ],
    },
    {
      heading: 'How this was measured',
      blocks: [
        p(
          "The random sample is every tenth analysed game in the [August 2026 Lichess database](https://database.lichess.org/) with both players between 1600 and 2400: 300 games, 20,227 moves with server evaluations. Each position went through Stockfish 18, the major version fishnet runs, at 20,000,000 nodes on one thread, and lila's own formula (`Advice.scala`: winning-chance deltas of 0.1, 0.2, 0.3) produced a second set of labels. On 222,183 moves from titled players' games, where Lichess stores its labels, that formula reproduces them from Lichess's own evaluations 99.08% of the time, so both sides of the comparison use it. The 842 moves with a forced mate at either end are excluded; lila judges those by separate rules.",
        ),
        {
          kind: 'table',
          headers: ['Lichess label', 'none at 20M', 'inaccuracy', 'mistake', 'blunder'],
          rows: [
            ['none', '15,281', '496', '13', '2'],
            ['inaccuracy', '504', '1,033', '233', '35'],
            ['mistake', '27', '190', '367', '151'],
            ['blunder', '12', '18', '134', '889'],
          ],
        },
        p(
          "The nine players' games are up to their most recent hundred analysed rated blitz and rapid games (61 for Gürel, 20 for Giri) from the public API (the active seven in 2026; Carlsen and Firouzja have no analysed Lichess games this year, so theirs run back to 2021 and 2023), at a cheaper 4,000,000-node pass. On the random sample, 4M finds a little over half of what 20M finds, so the player rates are floors. A puzzle survives when the move played loses at least 0.2 winning chances at 20M against a best move that beats the second line by 0.1 or more, with three lines searched, and then again when a second, independent 20M search of the position still calls the game move a mistake: 35 passed the first gate, 32 the second. That is the size of the noise in a 20M search, and it is why the deeper pass is treated as twenty times closer to the truth rather than as the truth.",
        ),
      ],
    },
    {
      heading: 'Is a million the right number?',
      blocks: [
        p(
          'This measures one point on the curve. Whether a million is the right budget depends on the points in between: how much agreement each doubling buys at 2M, 4M and 8M, and whether extra search spent only where labels are unstable, on the inaccuracies and the half-pawn-to-three-pawn band, would get most of the twenty-times result at a fraction of the cost. On these numbers, the current budget gets the label people act on, the blunder, right five times in six.',
        ),
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Solve the 32 puzzles', href: STUDY_HREF, emphasis: 'primary' },
            { label: 'Try xiangqi puzzles', href: '/puzzles', emphasis: 'secondary' },
            { label: 'Xiangqi for chess players', href: '/rules/xiangqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
