import type { XiangqiPlayerView } from '@mistboard/game';
import { parseJieqiFen, type XiangqiSquare } from '@mistboard/game';
import { XQ_CELL, xqBoardSvg, xqPoint, xqStaticView, xqVisionDemoState } from '../diagrams.js';
import { moveCostChartSvg } from '../move-cost-chart.js';
import type { Article, ArticleBlock } from '../types.js';
import { COSTS_MATCH_108, COSTS_STALEMATE, COSTS_TRAP } from './ab-jchess-costs.js';

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

// Finished rooms, so /embed/game shows every piece. Each opens at `ply` (plies
// played, 0 = start) with the bot to move, the positions both engines were
// given. Sized like the jieqi-bot-wins embeds.
function gameEmbed(roomId: string, ply: number, title: string): ArticleBlock {
  return {
    kind: 'embed',
    path: `/embed/game/${roomId}?ply=${ply}`,
    title,
    aspect: [702, 696],
  } as ArticleBlock;
}

// What each of Pikafish's moves cost it, by AB-JChess (ab-jchess-costs.ts).
type CostSeries = typeof COSTS_TRAP | typeof COSTS_STALEMATE | typeof COSTS_MATCH_108;
function costChart(
  data: CostSeries,
  callout: { moveNo: number; label: string },
  ariaLabel: string,
  lastMove: number = data.lastMove,
  caption?: string,
): ArticleBlock {
  return {
    kind: 'raw-svg',
    caption,
    className: 'article-figure-move-cost',
    // Phone width shrinks the axis text below reading size; a tap opens it full screen.
    zoomable: true,
    svg: moveCostChartSvg({
      id: `move-cost-${data.roomId}`,
      ariaLabel,
      heading: 'Winning chances Pikafish gave away, move by move (by AB-JChess)',
      lastMove,
      moves: data.moves.filter((m) => m.moveNo <= lastMove),
      callout,
    }),
  };
}

const REPO = 'https://github.com/lxsgx23/AB-JChess';

export const abJchessArticle: Article = {
  slug: 'ab-jchess',
  kind: 'article',
  publisher: 'mistboard',
  title: 'AB-JChess, a stronger jieqi bot',
  seoTitle: 'AB-JChess: the open-source jieqi engine that beat Pikafish 248 to 136',
  summary:
    'An open-source jieqi engine with its own neural network now sits above Pikafish Level 8. It beat full-strength Pikafish 248 to 136 in 400 games, and it reads the positions people beat Pikafish in very differently.',
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
      heading: 'Where the difference shows',
      blocks: [
        // The 71 and the 54: mistboard-engine lab/jieqi-abjchess-2026-09-29/
        // post-graphs/decisive_reveals.py over run7.
        {
          kind: 'paragraph',
          text: "Pikafish's weak spot is the reveal, and the match games show it. In 71 of AB-JChess's 248 wins, Pikafish at some point after the opening rated itself at least six pawns ahead. In 54 of those, the move that cost it the most was a reveal, though reveals were under a third of its moves. In this game it rated itself about twenty pawns up on every move from its seventh to its twelfth, while AB-JChess, playing Red, thought it was a little behind, about two chances in five. Pikafish's twelfth move turned over the piece on d10. AB-JChess rates that reveal as throwing away most of Black's chances, and mated on the next move.",
        },
        // A run7 game (mistboard-engine lab/jieqi-abjchess-2026-09-29, game 108),
        // imported as a public room; it opens with Pikafish to move at its first
        // +18 claim.
        gameEmbed(
          'jq_ab-jchess-vs-pikajieqi-4s-2026-09-108',
          13,
          'Jieqi: AB-JChess mates Pikafish, which rated itself twenty pawns ahead',
        ),
        costChart(
          COSTS_MATCH_108,
          { moveNo: 12, label: 'Reveal on d10' },
          "What each of Pikafish's moves cost it in match game 108, by AB-JChess",
          undefined,
          "Each bar is one of Pikafish's moves: the winning chances it gave away against AB-JChess's choice. A dot is a move that cost nothing. The colours are the review page's marks: red ??, orange ?, yellow ?!.",
        ),
        {
          kind: 'paragraph',
          text: "[AB-JChess's marks on this game](/jieqi/game/jq_ab-jchess-vs-pikajieqi-4s-2026-09-108)",
        },
        {
          kind: 'paragraph',
          text: 'People found the same weak spot first. Our post on the [fourteen wins against Pikafish](/blog/jieqi-bot-wins) showed the moments where people beat it, and many of them came right after the bot turned over one of its own face-down pieces. We gave the same positions to AB-JChess, each exactly as the bot saw it, with 4 seconds to think.',
        },
        {
          kind: 'paragraph',
          text: 'In this game the bot is Red and rates itself more than ten pawns ahead, a won game by its count. It turns over the piece on b3 and moves it to d3. Three of the five pieces it could turn out to be lose at once to the black cannon dropping to h1, and Black mated on the next move. AB-JChess also likes Red here, about three wins in four, but it plays the advisor from e2 to f3 instead. By its count, the reveal gives away about a third of Red\'s chances before the piece even turns over.',
        },
        gameEmbed(
          'jq_23d2a761-b37d-4bf0-a786-3ce7edf7e0fd',
          26,
          'Jieqi: the bot reveals on d3 and is mated next move',
        ),
        costChart(
          COSTS_TRAP,
          { moveNo: 14, label: 'Reveal, b3 to d3' },
          "What each of the bot's moves cost it, by AB-JChess",
        ),
        {
          kind: 'paragraph',
          text: "[AB-JChess's marks on this game](/jieqi/game/jq_23d2a761-b37d-4bf0-a786-3ce7edf7e0fd)",
        },
        {
          kind: 'paragraph',
          text: "In the stalemate game from that post, the bot turned over the piece on b3 and sent it up the file to b9, rating the game eight pawns in its favour. AB-JChess also has Red better, nearly three wins in four, but it turns over the piece on i1 instead and marks the move to b9 as a blunder. On the bot's next turn, by AB-JChess's count, Red's chances were down to under one in three.",
        },
        gameEmbed(
          'jq_53ead5f3-3c1b-4e7d-8b30-896cce9ab8ff',
          20,
          'Jieqi: the bot reveals on b9, rating itself eight pawns ahead',
        ),
        costChart(
          COSTS_STALEMATE,
          { moveNo: 11, label: 'Reveal, b3 to b9' },
          "What each of the bot's moves cost it in the stalemate game, by AB-JChess",
          30,
        ),
        {
          kind: 'paragraph',
          text: "[AB-JChess's marks on this game](/jieqi/game/jq_53ead5f3-3c1b-4e7d-8b30-896cce9ab8ff)",
        },
        {
          kind: 'paragraph',
          text: 'One move is not a game, so this does not show AB-JChess would have won these. The 400 games show that it is stronger; these positions show where.',
        },
      ],
    },
    {
      heading: 'Pikafish lost to its own bets',
      blocks: [
        {
          kind: 'paragraph',
          text: 'All three games turned on a reveal. A reveal is a bet on a piece nobody can see yet, and AB-JChess prices the bet before the piece turns over, averaged over every piece it could be. Whatever Pikafish lost beyond that price was the draw. At d10 and b9 nearly all the damage was the bet itself. At d3 the bet was about half, and still a bad one: three of the five pieces lost on the spot. Pikafish prices a reveal as if the piece will turn out well.',
        },
        {
          kind: 'table',
          headers: ['Reveal', 'Chances lost', 'To the bet', 'To the draw'],
          rows: [
            ['d10', '59%', '51%', '8%'],
            ['b3 to d3', '72%', '34%', '38%'],
            ['b3 to b9', '40%', '33%', '7%'],
          ],
          keyColumn: true,
          caption:
            'Winning chances Pikafish lost at each reveal, by AB-JChess. The bet is the reveal averaged over every piece it could have been; the draw is the rest.',
        },
        {
          kind: 'paragraph',
          text: "All three games are in [a study](/study/a4mO6ldd), with AB-JChess's marks on the moves that cost the most. [All 400 match games](/games/search?variant=jieqi&source=engine-match) can be replayed on the site.",
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
