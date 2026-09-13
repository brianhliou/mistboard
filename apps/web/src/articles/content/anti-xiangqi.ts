import {
  ANTI_XIANGQI_DEAD,
  ANTI_XIANGQI_DECISION,
  ANTI_XIANGQI_SURVIVORS,
  ANTI_XIANGQI_THUMBNAIL,
} from '../../anti-xiangqi-article-diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The short account. The full analysis, every game, every proof and the
// evidence repository live on brianhliou.com, which is the canonical page
// for the numbers; this one says what was found and why there is no play
// page, and sends the reader on. Diagrams are kernel-checked positions from
// the generator that made the deep dive's boards.
const DEEP_DIVE = 'https://brianhliou.com/posts/anti-xiangqi/';
const EVIDENCE = 'https://github.com/brianhliou/anti-xiangqi';

export const antiXiangqiArticle: Article = {
  slug: 'anti-xiangqi',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Antichess on the Xiangqi Board Is a Draw',
  seoTitle: 'Anti Xiangqi: Antichess on the Xiangqi Board Is a Draw',
  summary:
    'We put antichess on the xiangqi board and measured it before designing anything. Black has two moves to find in the opening, Red cannot go wrong, and then the palace keeps five pieces a side out of reach. Every other opening loses, 63 of them provably. We are publishing the measurement, not the variant.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-13',
  audience:
    'Chess players who know antichess and wonder what it does on the xiangqi board, and xiangqi players curious why a variant was measured and then not built.',
  thumbnail: { kind: 'svg', svg: ANTI_XIANGQI_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Antichess is chess with two rules changed: if you can capture you must, and you win by losing every piece you have. The king is an ordinary piece. Lichess plays it, and it was solved in 2016. We put the same two rules on the xiangqi board, with the general an ordinary piece and no facing rule, and measured what came out before designing anything.',
    },
    {
      kind: 'paragraph',
      text: 'It is a draw. Black has two moves to find in the opening and Red cannot go wrong; after that, the pieces you must lose sit in the palace where nothing can reach them. Every other opening loses, and 63 of those losses are proven. The full analysis, with every engine game, every proof and a viewer for all of it, is on brianhliou.com; this page is the short account and the reason there is no play button.',
    },
  ],
  sections: [
    {
      heading: 'The opening has one safe path',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Red’s first move is a cannon taking a horse through the enemy cannon; the two choices are mirror images, so call it 1. Cxb10. Black must capture and has two ways. Taking the cannon back with the chariot loses by force: Red gives its pieces away one at a time, the chariot has to take every one, and Red is out of pieces in 34 plies. That is proven, a certificate of 1,864 positions replayed by a checker that knows only the rules. Firing the other cannon into Red’s back rank, 1...Cxh1, holds.',
        },
        {
          kind: 'raw-svg',
          svg: ANTI_XIANGQI_DECISION,
          caption:
            'Black’s two captures after 1. Cxb10. The chariot recapture on b10 is a proven loss; the cannon shot to h1, over Red’s own h3 cannon, is the only move.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Red then has two replies and both hold: take the cannon quietly, 2. Rxh1, and the exchange is over; or keep firing with 2. Cxd10, which sets Black a second trap, since only 2...Kxd10, the general taking the cannon, holds. The chain of forced captures has 166 possible endings and we played a game from every distinct one. Two survive. Every other branch loses for the side that took it.',
        },
        {
          kind: 'raw-svg',
          svg: ANTI_XIANGQI_SURVIVORS,
          caption:
            'The two endings that survive the chain. Fourteen pieces each, no capture on the board, and the game is open.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Then the palace makes it a draw',
      blocks: [
        {
          kind: 'paragraph',
          text: 'To win you must lose your general, both advisors and both elephants, and none of them can leave home. Each can only be taken by an enemy piece that comes to it, and both players are trying to get rid of exactly those pieces. Once neither side has a chariot, horse, cannon or soldier left, no capture is possible ever again, and the rules score that a draw.',
        },
        {
          kind: 'raw-svg',
          svg: ANTI_XIANGQI_DEAD,
          caption:
            'The engine’s own game at two million nodes a move, ply 35. Nothing on the board can ever capture anything again.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'In every engine game, the side that wanted the game to stop could feed its mobile pieces to the opponent, who had to take them, or park a lone chariot on lines nothing of the opponent’s could ever enter. At one and five million nodes the chariots stayed on and the game became a hundred plies of soldiers traded in pairs, ending the same way. That is evidence for a draw rather than a proof of one: no search we ran found a win from either surviving position, and the reason it could not is a property of the board.',
        },
      ],
    },
    {
      heading: 'Four repairs and two siblings, none a game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Scoring every stall for the side with fewer pieces removes the free draw but cannot be tested without an engine that plays for the count. Codrus, the 1844 ancestor where you win by losing the general, draws through the same opening lines, faster. Losers, where the general stays royal, is decisive the wrong way: a forced win for Black at every strength we tried, because a check suspends the obligation to capture and that tempo lands with the second player. Letting the palace pieces out is a different board.',
        },
      ],
    },
    {
      heading: 'What we are publishing instead of a play page',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The rule kernel with the three rule sets written out, the Fairy-Stockfish stanzas, all 166 endings of the opening chain, one engine game from each at two search depths, every proof certificate, a checker that replays them against the rules in a few seconds, and every game in a viewer. If you can show a third surviving opening, a defence in any certificate, or a win for either side from the positions above, open an issue there; the write-up will say so.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Read the full analysis', href: DEEP_DIVE, emphasis: 'primary', external: true },
            { label: 'Check the proofs yourself', href: EVIDENCE, emphasis: 'secondary', external: true },
            { label: 'Learn xiangqi', href: '/rules/xiangqi', emphasis: 'secondary' },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
