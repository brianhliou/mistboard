import type { XiangqiPlayerView } from '@mistboard/game';
import { parseJieqiFen, type XiangqiSquare } from '@mistboard/game';
import { XQ_CELL, xqBoardSvg, xqPoint, xqStaticView, xqVisionDemoState } from '../diagrams.js';
import type { Article } from '../types.js';

// Card art and the post's first example: jq_23d2a761 after 26 plies, Red (the
// bot, full-strength Pikafish) to move, as the bot saw it. Pikafish turned over
// the piece on b3 and moved it to d3, rating the game above +10; three of the
// five identities it could have been lose at once to the cannon's mate on h1, and
// Black mated next move. AB-JChess plays the advisor e2-f3 and rates it about
// +1. Rebuilt from the game's own records (api/jieqi/games, the red seat's view);
// ab-jchess-thumbnail.test.ts asserts both moves are legal here.
export const AB_JCHESS_TRAP_FEN =
  'x2k1xxA1/9/px2c4/x1x1C1B2/7c1/2P3n2/9/1X2N3P/4Ab3/XXX1KX3 w R2A0C0P2N0B1r0a2c0p2n1b1 3 14';

// 16:10 to match the card media box (.articles-index-card-media, 16/10).
const THUMB_ASPECT = 16 / 10;

const AB_JCHESS_THUMBNAIL = (): string => {
  const parsed = parseJieqiFen(AB_JCHESS_TRAP_FEN);
  if (!parsed.ok) throw new Error(`ab-jchess thumbnail: ${parsed.error}`);
  const board: XiangqiPlayerView['board'] = {};
  for (const [square, piece] of Object.entries(parsed.state.board)) {
    if (!piece) continue;
    board[square as XiangqiSquare] = {
      piece: { color: piece.color, role: piece.role },
      shrouded: piece.faceDown,
    };
  }
  const boardY = 28; // xqBoardSvg draws the grid 28 below its y, under the title row.
  // Ranks 1 to 6: Red's camp and the black cannon on h6 that mates on h1.
  // Half a cell above rank 6, so the rank-7 pieces stay out of frame.
  const top = xqPoint(4, 6, 'red', 0, boardY).y - XQ_CELL * 0.5;
  const bottom = xqPoint(4, 1, 'red', 0, boardY).y + XQ_CELL * 0.8;
  const h = bottom - top;
  const w = h * THUMB_ASPECT;
  const left = xqPoint(4, 1, 'red', 0, boardY).x - w / 2;
  const svg = xqBoardSvg({
    state: xqVisionDemoState('ab-jchess-thumb', {}),
    view: xqStaticView('ab-jchess-thumb', board),
    x: 0,
    y: 0,
    label: '',
    perspective: 'red',
    shroudedStyle: 'back',
    arrows: [{ from: 'e2' as XiangqiSquare, to: 'f3' as XiangqiSquare }],
    dots: [{ square: 'd3' as XiangqiSquare, blocked: true }],
  });
  return `<svg class="xq-article-svg" viewBox="${left} ${top} ${w} ${h}" role="img" aria-label="AB-JChess moves the advisor to f3; the bot's reveal to d3 lost to mate in one" xmlns="http://www.w3.org/2000/svg"><rect class="xq-diagram-bg" x="${left}" y="${top}" width="${w}" height="${h}"/>${svg}</svg>`;
};

const REPO = 'https://github.com/lxsgx23/AB-JChess';

export const abJchessArticle: Article = {
  slug: 'ab-jchess',
  kind: 'article',
  publisher: 'mistboard',
  title: 'AB-JChess, a stronger jieqi bot',
  seoTitle: 'AB-JChess: the open-source jieqi engine that beat Pikafish 248 to 136',
  summary:
    'An open-source jieqi engine with its own neural network now sits above Pikafish Level 8. It beat full-strength Pikafish 248 to 136 in 400 games.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-02',
  thumbnail: { kind: 'svg', svg: AB_JCHESS_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'People who play jieqi against the bot on Mistboard.',
  intro: [
    {
      kind: 'paragraph',
      text: `[Jieqi](/rules/jieqi) on Mistboard has a new top bot. [AB-JChess](${REPO}) is an open-source jieqi engine by Huorongrong and Laoxu (Kouza), and we play it here with their permission. It sits above Pikafish Level 8, the bot people have been playing since August.`,
    },
    {
      kind: 'paragraph',
      text: "In late September, before putting it on the site, we played it against that bot: 400 games at 4 seconds a move, on the same settings the site uses, with AB-JChess's network of September 11. AB-JChess won 248, lost 136 and drew 16, a 64% score. It won as Red and as Black.",
    },
    {
      kind: 'paragraph',
      text: 'All 400 games are on the site, each with its own review page: [browse the match](/games/search?variant=jieqi&source=engine-match).',
    },
    {
      kind: 'cta',
      layout: 'single-row',
      buttons: [
        { label: 'Play AB-JChess', href: '/bot/ab-jchess', emphasis: 'primary' },
        { label: 'See all levels', href: '/bots', emphasis: 'secondary' },
      ],
    },
  ],
  sections: [
    {
      heading: 'Two ways to be strong',
      blocks: [
        {
          kind: 'paragraph',
          text: `[Pikafish](https://github.com/official-pikafish/Pikafish) is built for speed. It looks at more than a million positions a second and judges each one by rules written by hand. AB-JChess is built from Pikafish too, but it judges positions with a neural network trained on about a billion jieqi positions. It looks at about fifty times fewer positions, and understands each one better. Its training code is public in the same repository, under [abjchess-nnue-pytorch](${REPO}/tree/main/abjchess-nnue-pytorch).`,
        },
      ],
    },
    {
      heading: 'Where it sits',
      blocks: [
        {
          kind: 'paragraph',
          text: 'AB-JChess is at the top of the jieqi bot list, above Level 8. Levels 1 to 8 stay Pikafish, and Level 4 is still where a new player starts. It does not take a level number: the top place holds the strongest jieqi engine we have measured, under its own name. Its rating on the [bots page](/bots), 2354 against Level 8\'s 2226, comes from the same bot-against-bot games that rate the levels. Its authors are training stronger networks; when one is released, we will play it against this one and switch if it wins.',
        },
        {
          kind: 'paragraph',
          text: 'While writing this post we found a bug in how our Pikafish bot scored reveals. It is fixed; [a follow-up post](/blog/pikafish-reveal-bug) covers what it was and what it cost.',
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        {
          kind: 'paragraph',
          text: `AB-JChess is open source under the GPL-3.0 licence, at [github.com/lxsgx23/AB-JChess](${REPO}). Its authors let us use the engine and its network on Mistboard. The network is downloaded from their own release each time we build the site, never copied. Thank you, Huorongrong and Laoxu.`,
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play AB-JChess', href: '/bot/ab-jchess', emphasis: 'primary' },
            { label: 'Jieqi rules', href: '/rules/jieqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
