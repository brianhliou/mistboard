import { duckTreeBoardSvg, duckTreeThumbnailSvg } from '../../duck-xiangqi-tree-diagrams.js';
import type { Article } from '../types.js';

// How much wider the duck makes xiangqi's game tree, how much of that width is
// the same position, and what is left costs an engine. The two boards are live
// diagrams (duck-xiangqi-tree-diagrams.ts) computed from the rules kernel and
// pinned to the prose by its test, so they follow the reader's piece set and
// board theme. The two charts are static SVGs written by
// scripts/duck-tree-figures.mjs, which recomputes the opening counts quoted
// here from the kernel (1,920 / 2,554 / 1,268 / 1,310, the h3e3 table) and
// throws if any of them moves, so the prose and the figures cannot drift apart. The whole-game chart and the search depths come from 64
// Fairy-Stockfish self-play games per variant at 100k nodes a move, NNUE off,
// and depth at fixed node budgets over three positions (median); the per-ply
// medians behind the chart are committed in scripts/data/duck-tree-figures.json.
// The card is the second board alone (duckTreeThumbnailSvg), so it follows the
// reader's piece set like the figures do.

const fig = (name: string) => ({
  src: `/article-thumbs/duck-tree-${name}.svg`,
  darkSrc: `/article-thumbs/duck-tree-${name}-dark.svg`,
  className: 'article-figure-full',
});

export const duckXiangqiGameTreeArticle: Article = {
  slug: 'duck-xiangqi-game-tree',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'One Duck Xiangqi move is worth two xiangqi moves',
  cardTitle: 'Duck Xiangqi’s game tree',
  seoTitle: 'Duck Xiangqi’s Game Tree, Measured Against Xiangqi',
  summary:
    'Red’s first Duck Xiangqi turn reaches more positions than a full xiangqi move by each side. About half of them leave the opponent exactly the same choices, so a search can skip them. What is left still cuts how far an engine sees almost in half.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-07',
  audience: 'Xiangqi and Duck Xiangqi players curious how much the duck adds, and anyone who writes game engines.',
  thumbnail: { kind: 'svg', svg: duckTreeThumbnailSvg },
  readNext: ['duck-xiangqi-strategy', 'duck-xiangqi'],
  intro: [
    {
      kind: 'paragraph',
      text: 'A turn in [Duck Xiangqi](/rules/duck-xiangqi) has two parts. You move a piece, then you put the duck on any empty point, where it blocks everything until your opponent moves it. We counted what that second choice does to the game tree, the map of every position the game can reach.',
    },
  ],
  sections: [
    {
      heading: 'Red’s first turn alone makes 2,554 positions',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Red has 44 moves from the starting position in both games. In xiangqi, black’s replies to them make 1,920 positions. In Duck Xiangqi, red’s turn is not over until the duck lands on one of the empty points, about 58 of them, so red’s first turn alone makes 2,554.',
        },
        {
          kind: 'raw-svg',
          svg: () =>
            duckTreeBoardSvg(
              'all',
              'A xiangqi board after red plays cannon h3 to e3, with a yellow dot on each of the 58 empty points where the duck could land.',
            ),
          className: 'article-figure-xq--large-board',
          caption:
            'One of red’s 44 first moves. In xiangqi, black would reply next. In Duck Xiangqi, red first puts the duck on one of these points, and each choice is a different position.',
        },
        {
          kind: 'paragraph',
          text: 'The gap compounds with every turn. After one turn each, Duck Xiangqi already has more positions than xiangqi has after two turns each.',
        },
        {
          kind: 'table',
          headers: ['Positions after', 'Xiangqi', 'Duck Xiangqi'],
          rows: [
            ['Red’s first turn', '44', '2,554'],
            ['One turn each', '1,920', '6,166,242'],
            ['Two turns each', '3,290,240', 'Not counted'],
          ],
          caption: 'Every legal sequence from the starting position, counted by Fairy-Stockfish.',
        },
      ],
    },
    {
      heading: 'Half of those positions are the same position',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The duck matters when it lands where black’s next move goes: a point a black piece moves to, slides through, or jumps over. Anywhere else, black has exactly the replies it would have with no duck on the board.',
        },
        {
          kind: 'raw-svg',
          svg: () =>
            duckTreeBoardSvg(
              'matter',
              'The same board. 30 points carry an orange disc with the number of black replies a duck there takes away, up to 8 on e8 in front of black’s palace. The other 28 points are small grey dots.',
            ),
          className: 'article-figure-xq--large-board',
          caption:
            'Most of the points that matter sit on black’s side, in the paths of black’s pieces. On some of them the duck also gives a black cannon something to jump over, which adds a reply.',
        },
        {
          kind: 'paragraph',
          text: 'The busiest point is e8, in front of black’s palace: a duck there takes 8 replies away whatever red played first. The 28 grey points change nothing. Put the duck on any of them and black faces the same choices, then moves the duck somewhere new, so the game that follows is the same game. Two small things differ: black cannot leave the duck where it is, and repetitions count the duck’s square.',
        },
        {
          kind: 'paragraph',
          text: 'So a search can look at one of them and skip the rest. Count every duck placement that leaves black the same replies once, and at the first move red’s 2,554 turns come down to 1,310.',
        },
        {
          kind: 'image-figure',
          ...fig('counts'),
          alt: 'Four bars. Xiangqi after red moves: 44. Xiangqi after red and black have both moved: 1,920. Duck Xiangqi after red moves and places the duck: 2,554. Duck Xiangqi counting placements that leave black the same replies once: 1,310.',
          caption: 'Positions from the start, counted by the site’s own rules engine.',
        },
      ],
    },
    {
      heading: 'A duck away from your opponent’s pieces wastes half your turn',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The same board is a rule of thumb for players. Put the duck on a grey point and your opponent’s choices are exactly what they would be without it, so you have played a xiangqi move and passed on the rest of your turn. The duck earns its place in the paths of your opponent’s pieces: on the files their chariots and cannons use, and in front of their horses and elephants. At the start, the points that take the most away are on your opponent’s cannon row, where one duck cuts across both cannons at once.',
        },
      ],
    },
    {
      heading: 'The duck’s share of the tree grows as pieces come off',
      blocks: [
        {
          kind: 'paragraph',
          text: 'To see past the opening, we had Fairy-Stockfish play 64 games of each against itself and counted the choices at every move. Xiangqi’s choices shrink as pieces come off the board. In Duck Xiangqi each capture also frees a point for the duck, so a turn stays nearly as wide as it was in the opening, and 200 half-moves in it has about 100 times the choices of a xiangqi move.',
        },
        {
          kind: 'image-figure',
          ...fig('branching'),
          alt: 'A line chart on a log scale. Duck Xiangqi stays between about 1,500 and 2,500 legal turns from ply 0 to ply 220. Xiangqi starts at 44 legal moves and falls to around 20 after ply 120. The gap is marked as about 50 times at ply 10 and about 100 times at ply 200.',
          caption:
            'Legal turns at each ply in 64 games per variant that Fairy-Stockfish played against itself, on a log scale. Games end at different lengths, so fewer games feed the right side of the chart.',
        },
      ],
    },
    {
      heading: 'The same search sees 25 turns ahead in xiangqi and 14 in Duck Xiangqi',
      blocks: [
        {
          kind: 'paragraph',
          text: 'That width costs search depth. Given the same number of positions to look at, Fairy-Stockfish sees a little over half as far ahead in Duck Xiangqi. We counted depth in turns in both games, and a Duck Xiangqi turn includes the duck. A search that counted each set of equivalent duck placements once would win some of that depth back. We have not measured how much.',
        },
        {
          kind: 'table',
          headers: ['Positions searched', 'Xiangqi depth', 'Duck Xiangqi depth'],
          rows: [
            ['100,000', '12', '8'],
            ['1,000,000', '16', '10'],
            ['10,000,000', '25', '14'],
          ],
          caption: 'Median of three positions: the start, and two and four turns in.',
        },
      ],
    },
    {
      heading: 'How we counted',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The site’s own rules engine, the code that checks every move played here, counted the first move’s positions, and Fairy-Stockfish counted the deeper ones. Fairy-Stockfish also played the 64 games per variant, at 100,000 positions a move, with its neural network off. Xiangqi counts are strictly legal, so a move that leaves your own general capturable does not count. Duck Xiangqi has no check rule (you win by capturing the general), so every piece move counts.',
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play Duck Xiangqi', href: '/?play=computer&gameSpecId=duck-xiangqi', emphasis: 'primary' },
            { label: 'Read the rules', href: '/rules/duck-xiangqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
