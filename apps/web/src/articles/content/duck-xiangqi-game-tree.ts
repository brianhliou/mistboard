import type { Locale } from '../../i18n/locale.js';
import { textCard } from '../text-card.js';
import type { Article } from '../types.js';

// How much wider the duck makes xiangqi's game tree, and how much of that width
// changes anything. The figures are static SVGs written by
// scripts/duck-tree-figures.mjs, which recomputes the opening counts quoted here
// from the rules kernel (1,920 / 2,554 / 1,268 / 1,310 / 364, the e8 point, the
// h3e3 board) and throws if any of them moves, so the prose and the figures
// cannot drift apart. The whole-game medians (41 / 20, about 2,150 / 2,240 /
// 1,875) and the search depths come from 64 Fairy-Stockfish self-play games per
// variant at 100k nodes a move, NNUE off, and depth at fixed node budgets over
// three positions (median); the per-ply medians behind the chart are committed
// in scripts/data/duck-tree-figures.json. Game outcomes are left out on purpose.
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
  title: 'What the duck does to xiangqi’s game tree',
  cardTitle: 'Duck Xiangqi’s game tree',
  seoTitle: 'Duck Xiangqi’s Game Tree, Measured Against Xiangqi',
  summary:
    'One Duck Xiangqi move reaches more positions than two xiangqi moves, and the gap grows as pieces come off. About half the duck placements change nothing for the opponent, and the same engine search reaches 14 turns deep where xiangqi gets 25.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-07',
  audience: 'Xiangqi and Duck Xiangqi players curious how much the duck adds, and anyone who writes game engines.',
  thumbnail: { kind: 'svg', svg: DUCK_TREE_THUMBNAIL },
  readNext: ['duck-xiangqi-strategy', 'duck-xiangqi'],
  intro: [
    {
      kind: 'paragraph',
      text: '[Duck Xiangqi](/rules/duck-xiangqi) is xiangqi with one extra piece that both players share. After every move, the player who moved puts the duck on an empty point, where it blocks everything and cannot be captured. So every turn is two choices. We counted how much wider that makes the game, how much of the extra width changes anything, and what it costs an engine.',
    },
  ],
  sections: [
    {
      heading: 'One Duck Xiangqi move covers as much ground as two xiangqi moves',
      blocks: [
        {
          kind: 'paragraph',
          text: 'From the starting position red has the same 44 moves in both games. In xiangqi, black has 1,920 replies across those 44 moves, so the tree two moves deep holds 1,920 positions. In Duck Xiangqi, red’s move is not over until the duck lands, and it can land on any of the 58 empty points (59 after one of the two cannon captures). That makes 2,554 positions after red’s first turn alone.',
        },
        {
          kind: 'image-figure',
          ...fig('trees'),
          alt: 'Four radial trees. Top left: xiangqi two moves deep, 44 red moves fanning out to 1,920 positions. Top right: Duck Xiangqi one move deep, 2,554 positions colored by what the duck does to black. Bottom left: the same tree with placements that change nothing merged, 1,310 situations. Bottom right: the same move without the duck, 44 positions.',
          caption:
            'Each dark dot on the inner ring is one of red’s 44 first moves, and the dots behind it are the positions that follow it. In the bottom left, the duck placements that leave black the same replies are merged into one dot, sized by how many it stands for.',
        },
        {
          kind: 'paragraph',
          text: 'Over whole games the gap grows. We had Fairy-Stockfish play 64 games of each variant against itself and counted the legal turns at every ply. In the first 20 plies the median xiangqi position has 41 legal moves and the median Duck Xiangqi position about 2,150 legal turns, around 50 times as many.',
        },
        {
          kind: 'paragraph',
          text: 'Xiangqi narrows as pieces come off, and after ply 60 its median is 20. Duck Xiangqi barely narrows, because each capture also frees a point for the duck. Its median goes from about 2,240 in the middlegame to about 1,875 after ply 60. By ply 200 a Duck Xiangqi turn has about 100 times the choices of a xiangqi turn.',
        },
        {
          kind: 'image-figure',
          ...fig('branching'),
          alt: 'A line chart on a log scale. Duck Xiangqi stays between about 1,500 and 2,500 legal turns from ply 0 to ply 220. Xiangqi starts at 44 legal moves and falls to around 20 after ply 120. The gap is marked as about 50 times at ply 10 and about 100 times at ply 200.',
          caption:
            'Legal turns at each ply in 64 self-play games per variant, on a log scale. A Duck Xiangqi turn counts every piece move with every duck placement. Games end at different lengths, so fewer games feed the right side of the chart.',
        },
      ],
    },
    {
      heading: 'Half the duck placements change nothing for black',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The 2,554 overstates the choice. In 1,268 of those positions black has exactly the replies it would have with no duck on the board, because the duck sits where no black piece was going to move to, through or over. Those positions differ only in where the duck is. Merge them and red’s first turn comes to 1,310 distinct situations, between 26 and 31 for each red move.',
        },
        {
          kind: 'paragraph',
          text: 'The points where the duck matters are few and predictable. On red’s own half of the board, only the eight points on the two cannon files, b2 to b5 and h2 to h5, ever change black’s first reply, by blocking a black cannon’s capture or giving it a screen. A duck anywhere else on red’s half does nothing.',
        },
        {
          kind: 'paragraph',
          text: 'Black’s cannon row, rank 8, is where the duck does the most. A duck on e8 stops both black cannons sliding across the middle and takes the point both elephants could step to. Black loses 8 replies there after every one of red’s 44 first moves.',
        },
        {
          kind: 'image-figure',
          ...fig('board'),
          alt: 'A xiangqi board after red plays cannon h3 to e3. Orange discs on black’s half mark duck points that take replies away, up to 8 on e8. Violet rings on the b and h files mark points where the duck also gives a black cannon a screen. Grey dots mark points where the duck changes nothing.',
          caption:
            'After cannon h3 to e3. The number on a point is how many of black’s 45 replies a duck there takes away. Of the 58 empty points, 30 change black’s replies and 28 do nothing.',
        },
        {
          kind: 'paragraph',
          text: 'Giving black something is rarer than taking it away. 364 of the 2,554 placements add a reply, and in every one of them the duck becomes the screen a black cannon needs to capture.',
        },
      ],
    },
    {
      heading: 'The same search reaches 14 turns in Duck Xiangqi and 25 in xiangqi',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A wider tree costs search depth. We gave Fairy-Stockfish the same number of nodes in both games and read how deep it got. Depth is in turns in both columns; a Duck Xiangqi turn is a piece move plus a duck placement.',
        },
        {
          kind: 'table',
          headers: ['Nodes per search', 'Xiangqi depth', 'Duck Xiangqi depth'],
          rows: [
            ['100,000', '12', '8'],
            ['1,000,000', '16', '10'],
            ['10,000,000', '25', '14'],
          ],
          caption: 'Median of three positions: the start, and positions two and four turns in.',
        },
        {
          kind: 'paragraph',
          text: 'Each tenfold increase in nodes buys xiangqi 4 to 9 more turns of depth and Duck Xiangqi 2 to 4.',
        },
      ],
    },
    {
      heading: 'How we counted',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The site’s own rules engine, the code that checks every move played here, counted the opening positions. Fairy-Stockfish played the games: 64 self-play games per variant at 100,000 nodes a move, with NNUE off. Xiangqi counts are strictly legal, so a move that leaves your own general capturable does not count. Duck Xiangqi has no check rule (you win by capturing the general), so every piece move counts.',
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
