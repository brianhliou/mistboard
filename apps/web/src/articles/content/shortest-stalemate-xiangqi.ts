import {
  applyStandardXiangqiMove,
  parseStandardXiangqiFen,
  type XiangqiGameState,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardGrid,
  xqPiecesLayer,
  xqSvg,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The shortest stalemate from the opening that our cooperative search found:
// Black stalemated after 21 plies. It is chapter hedraozx of the study
// "Shortest stalemates in xiangqi" (prod study ls3xEcX3), beside the 22-ply Red
// line (DD5Zk33u, only linked here) and Nanao Okumura's 136-ply game (36PazYZl,
// Zhihu, 2019). shortest-stalemate-xiangqi.test.ts replays the line and checks
// the stalemate. It is kept in 0-based ICCS (ranks 0-9), the form the analysis
// board's ?moves= sniffer reads, and converted to the site's 1-based squares
// for the card art. Loyd's game is its own plain-chess study (peM4ujrr), so its
// embed has no fog seat picker.
const STUDY_ID = 'ls3xEcX3';
const STUDY = `/study/${STUDY_ID}`;
const BLACK_CHAPTER_ID = 'hedraozx';
const NANAO_CHAPTER_ID = '36PazYZl';
const FOG_STUDY_ID = 'Yj0X1pDy';
const LOYD_STUDY_ID = 'peM4ujrr';
const LOYD_CHAPTER_ID = 'E0EQ89xy';

export const BLACK_STALEMATE_ICCS =
  'h2i2 a6a5 b2b9 b7e7 i2i6 i9i8 i6e6 i8e8 h0i2 h7h8 i0h0 a5a4 h0h8 a4a3 a0a3 a9a5 a3a5 g6g5 a5g5 c6c5 g5c5';

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

// 0-based ICCS square (e0) to the site's 1-based square (e1).
function siteSquare(square: string): XiangqiSquare {
  return `${square[0]}${Number(square.slice(1)) + 1}` as XiangqiSquare;
}

export function replayStalemate(iccs: string): XiangqiGameState {
  const start = parseStandardXiangqiFen(START_FEN, 'shortest-stalemate');
  if (!start.ok) throw new Error(`shortest stalemate: ${start.error}`);
  return iccs.split(' ').reduce((state, move) => {
    const squares = /^([a-i]\d)([a-i]\d)$/.exec(move);
    if (!squares) throw new Error(`shortest stalemate: bad move ${move}`);
    const next = applyStandardXiangqiMove(state, {
      from: siteSquare(squares[1]),
      to: siteSquare(squares[2]),
    });
    if (next === state) throw new Error(`shortest stalemate: illegal ${move}`);
    return next;
  }, start.state);
}

function wholeBoard(state: XiangqiGameState, label: string): string {
  return xqSvg(
    XQ_BOARD_W,
    XQ_BOARD_H,
    [xqBoardGrid(0, 0, 'red'), xqPiecesLayer(state, null, 0, 0, 'red')].join(''),
  ).replace('role="img"', `role="img" aria-label="${label}"`);
}

// Card art: Black's final position.
export const BLACK_STALEMATE_SVG = (): string =>
  wholeBoard(
    replayStalemate(BLACK_STALEMATE_ICCS),
    'Black to move and stalemated after 21 plies: eight black pieces, none with a legal move',
  );

export const shortestStalemateXiangqiArticle: Article = {
  slug: 'shortest-stalemate-xiangqi',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'The Shortest Xiangqi Stalemate We Know',
  seoTitle: 'The Shortest Known Stalemate in Xiangqi (Chinese Chess): 21 Plies',
  summary:
    'In xiangqi a side with no legal move loses. The shortest stalemate we know takes 21 plies: after Red’s 11th move, Black has eight pieces and none of them can move.',
  showSummaryOnPage: false,
  thumbnail: { kind: 'svg', svg: BLACK_STALEMATE_SVG },
  status: 'published',
  publishedAt: '2026-10-27',
  audience:
    'Xiangqi players who like problems, and chess players who know stalemate as a draw and want to see it win a game.',
  readNext: ['helpmates-in-xiangqi', 'longest-forced-mates-xiangqi'],
  tldr: [
    'In xiangqi a side with no legal move loses. The shortest stalemate we know takes 21 plies: after Red’s 11th move, Black has eight pieces and none of them can move.',
    'Black’s own pieces and one red chariot wall in most of its army, and two red cannons pin the three pieces that could still move.',
    'A computer search found it, and it can miss shorter lines. No stalemate is possible in under 9 plies, so 9 to 20 is still open.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'In chess, a player who is not in check and has no legal move is stalemated, and the game is drawn. In [xiangqi](/rules/xiangqi) that player has lost, the same as if mated. So how quickly can a game end that way? We count in plies, one move by one side, so 21 plies ends on Red’s 11th move.',
    },
  ],
  sections: [
    {
      heading: 'Sam Loyd stalemated Black on the tenth move in chess',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Chess has a famous answer. In Sam Loyd’s ten-move game, Black still has ten pieces, the queen and both rooks among them, and none of them can move. [Oz Problems](https://www.ozproblems.com/walkabout/walkabout2021/feb27) has the history.',
        },
        {
          kind: 'embed',
          path: `/embed/study/${LOYD_STUDY_ID}/${LOYD_CHAPTER_ID}`,
          title: 'Sam Loyd’s ten-move stalemate',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: `Fog of war is harder. There you see only the squares your pieces reach, and a king may step into check, so a side is stuck only when nothing can move at all. In Sven’s 2011 TalkChess game, Black ran out of moves after 63 plies; we found a route to the same final position in 35. Both are in [this study](/study/${FOG_STUDY_ID}).`,
        },
      ],
    },
    {
      heading: 'Nanao Okumura stalemated Red with all sixteen pieces on the board',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Nanao Okumura posted an earlier xiangqi stalemate on Zhihu in 2019, built for a different record: after 136 plies Red still has all sixteen pieces, and none of them can move. Black lost nine and took nothing. Chinese-language sites mostly blocked our search, so shorter published games may exist.',
        },
        {
          kind: 'embed',
          path: `/embed/study/${STUDY_ID}/${NANAO_CHAPTER_ID}`,
          title: 'Nanao Okumura’s 136-ply stalemate',
          aspect: [702, 700],
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Black is stalemated after 21 plies, held mostly by its own pieces',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Two red cannons hold the pieces that could move. The one on e7 looks at the general through Black’s chariot and cannon, and the one on b10 through an elephant and an advisor. The chariot, the cannon and that elephant each have a move, and each of those moves leaves the general in check. Everything else is boxed in by its own pieces or by the red chariot on h9. Red took eight pieces on the way, Black one.',
        },
        {
          kind: 'embed',
          path: `/embed/study/${STUDY_ID}/${BLACK_CHAPTER_ID}`,
          title: 'Black stalemated in 21 plies',
          aspect: [702, 700],
        } as ArticleBlock,
      ],
    },
    {
      heading: 'A computer search found it by keeping the most cramped positions',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Both sides play toward one goal, stalemating Black, as in a [helpmate](/blog/helpmates-in-xiangqi). Every line is far too many to search past a few moves, so after each move the search keeps a fixed number of positions, the ones where Black has the fewest legal moves, and drops the rest. Each black piece that can still move counts heavily against a position. The search stops at the first position where Black is to move, has no legal move and is not in check.',
        },
        {
          kind: 'paragraph',
          text: `Dropping positions is what makes it fast, and it is also why it can miss a shorter line. Run the other way, it stalemated Red in 22 plies, which is in [the study](${STUDY}) with the others.`,
        },
      ],
    },
    {
      heading: 'No stalemate is possible in under 9 plies',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A search of every line proves that no game stalemates Black within 7 plies, and none stalemates Red within 8. So a stalemate shorter than ours, if one exists, takes 9 to 20 plies. Find one, or prove there is none, and post it in the forum.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Shortest stalemates in xiangqi', href: STUDY, emphasis: 'primary' },
            { label: 'Post a shorter one', href: '/forum', emphasis: 'secondary' },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
