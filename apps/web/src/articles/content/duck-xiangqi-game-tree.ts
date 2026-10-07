import type { Locale } from '../../i18n/locale.js';
import { textCard } from '../text-card.js';
import type { Article } from '../types.js';

// How much wider the duck makes xiangqi's game tree, how much of that width is
// the same position, and what is left costs an engine. The figures are static
// SVGs written by scripts/duck-tree-figures.mjs, which recomputes the opening
// counts quoted here from the rules kernel (1,920 / 2,554 / 1,268 / 1,310, the
// h3e3 board) and throws if any of them moves, so the prose and the figures
// cannot drift apart. The whole-game chart and the search depths come from 64
// Fairy-Stockfish self-play games per variant at 100k nodes a move, NNUE off,
// and depth at fixed node budgets over three positions (median); the per-ply
// medians behind the chart are committed in scripts/data/duck-tree-figures.json.
// English only until the wording is final; zh follows in one pass.
const DUCK_TREE_THUMBNAIL = (locale: Locale): string =>
  textCard(
    {
      palette: 'xiangqi',
      eyebrow: 'DUCK XIANGQI',
      lead: { text: '2,554', name: true },
      tagline: 'POSITIONS AFTER ONE MOVE',
      footer: 'XIANGQI HAS 44',
      ariaLabel: 'A card reading 2,554 positions after one Duck Xiangqi move, against 44 in xiangqi',
    },
    locale,
  );

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
  title: 'How much the duck adds to xiangqi’s game tree',
  cardTitle: 'Duck Xiangqi’s game tree',
  seoTitle: 'Duck Xiangqi’s Game Tree, Measured Against Xiangqi',
  summary:
    'One Duck Xiangqi move reaches more positions than two xiangqi moves. About half of them leave the opponent exactly the same choices, so a search can skip them. What is left still cuts how far an engine sees almost in half.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-07',
  audience: 'Xiangqi and Duck Xiangqi players curious how much the duck adds, and anyone who writes game engines.',
  thumbnail: { kind: 'svg', svg: DUCK_TREE_THUMBNAIL },
  readNext: ['duck-xiangqi-strategy', 'duck-xiangqi'],
  intro: [
    {
      kind: 'paragraph',
      text: 'A turn in [Duck Xiangqi](/rules/duck-xiangqi) has two parts. You move a piece, then you put the duck on any empty point, where it blocks everything until your opponent moves it. We counted what that second choice does to the game tree, the map of every position the game can reach.',
    },
  ],
  sections: [
    {
      heading: 'One Duck Xiangqi move reaches more positions than two xiangqi moves',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Red has 44 moves from the starting position in both games. In xiangqi, black’s replies to them make 1,920 positions. In Duck Xiangqi, red’s turn is not over until the duck lands on one of about 58 empty points, so red’s first turn alone makes 2,554.',
        },
        {
          kind: 'image-figure',
          ...fig('trees'),
          alt: 'Two radial trees. Left: xiangqi after red and black have each moved, 44 spokes adding up to 1,920 positions. Right: Duck Xiangqi after red’s first turn, 44 longer spokes adding up to 2,554 positions, colored by what the duck does to black.',
          caption:
            'Every dot is a position. The dark ring is red’s 44 first moves, and the spoke behind each one is what can follow it, so a longer spoke means more positions.',
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
          kind: 'image-figure',
          ...fig('board'),
          alt: 'A xiangqi board after red plays cannon h3 to e3. Orange discs on black’s half mark duck points that take replies away, up to 8 on e8. Violet rings on the b and h files mark points where the duck also gives a black cannon a screen. Grey dots mark points where the duck changes nothing.',
          caption:
            'After red’s central cannon, h3 to e3. The number on a point is how many of black’s 45 replies a duck there takes away. Violet rings mark points where the duck gives a black cannon something to jump over. Grey points change nothing.',
        },
        {
          kind: 'paragraph',
          text: 'On this board, 28 of the 58 points change nothing. Put the duck on any of them and black faces the same choices, then moves the duck somewhere new, so the game that follows is the same game. Two small things differ: black cannot leave the duck where it is, and repetitions count the duck’s square.',
        },
        {
          kind: 'paragraph',
          text: 'So a search can look at one of them and skip the rest. Merge every duck placement that leaves black the same replies, and red’s 2,554 first turns come down to 1,310. Take the duck away entirely and what is left is ordinary xiangqi, 44 moves.',
        },
        {
          kind: 'image-figure',
          ...fig('collapse'),
          alt: 'Three radial trees. Left: Duck Xiangqi after red’s first turn, 2,554 positions. Middle: the same tree with placements that change nothing for black merged into one dot each, 1,310 positions. Right: the duck taken away, 44 positions.',
          caption:
            'In the middle, each dot stands for all the placements that leave black the same replies, sized by how many it replaces. The large grey dot on each spoke is every placement that changes nothing.',
        },
      ],
    },
    {
      heading: 'The same search sees 25 turns ahead in xiangqi and 14 in Duck Xiangqi',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Later in the game the duck widens the tree even more. Xiangqi’s choices shrink as pieces come off the board. In Duck Xiangqi each capture also frees a point for the duck, so a turn stays nearly as wide as it was in the opening.',
        },
        {
          kind: 'image-figure',
          ...fig('branching'),
          alt: 'A line chart on a log scale. Duck Xiangqi stays between about 1,500 and 2,500 legal turns from ply 0 to ply 220. Xiangqi starts at 44 legal moves and falls to around 20 after ply 120. The gap is marked as about 50 times at ply 10 and about 100 times at ply 200.',
          caption:
            'Legal turns at each ply in 64 games per variant that Fairy-Stockfish played against itself, on a log scale. Games end at different lengths, so fewer games feed the right side of the chart.',
        },
        {
          kind: 'paragraph',
          text: 'That width costs search depth. Given the same number of positions to look at, Fairy-Stockfish sees a little over half as far ahead in Duck Xiangqi. We counted depth in turns in both games, and a Duck Xiangqi turn includes the duck.',
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
          text: 'The site’s own rules engine, the code that checks every move played here, counted the opening positions. Fairy-Stockfish played the games at 100,000 positions a move, with its neural network off. Xiangqi counts are strictly legal, so a move that leaves your own general capturable does not count. Duck Xiangqi has no check rule (you win by capturing the general), so every piece move counts.',
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
