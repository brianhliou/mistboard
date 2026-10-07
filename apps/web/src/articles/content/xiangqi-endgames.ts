import { endgameEntryState, endgameHubEntry } from '@mistboard/game';
import { XQ_BOARD_H, XQ_BOARD_W, xqBoardGrid, xqBoardSvg, xqPiecesLayer, xqSvg } from '../diagrams.js';
import type { Article } from '../types.js';
import { ENDGAME_PAGE_TEXT as T } from '../xiangqi-endgames-text.js';

// 象棋残局: what decides an endgame, the three grades with one position each,
// and one way in to /practice, whose piece-by-piece sets hold all 26 (seeded
// from packages/game xiangqi-endgame-practice.ts). The page used to list every
// position with its own Play link to a bare single-exercise page; the study
// player already gives the rail, the progress and Next, so the page links there
// once. Every verdict is held to the committed chessdb checks by
// xiangqi-endgame-hub.test.ts; this module adds no claims of its own.

/** The practice shelf: the 26 are spread over its sets, one per piece. */
export const XIANGQI_ENDGAMES_PRACTICE_HREF = '/practice';

// A board drawn from the same kernel state the practice chapter starts from.
function board(id: string): () => string {
  const state = endgameEntryState(endgameHubEntry(id));
  return () =>
    xqSvg(
      XQ_BOARD_W,
      XQ_BOARD_H,
      xqBoardSvg({ state, x: 0, y: 0, label: '', perspective: 'red', boardOffset: 0 }),
    );
}

// The card art: the chariot-against-horse-and-elephants fortress, the page's
// best-known draw.
const THUMBNAIL_STATE = endgameEntryState(endgameHubEntry('chariot-vs-horse-two-elephants-fortress'));

export const XIANGQI_ENDGAMES_THUMBNAIL = () => {
  const scale = 192 / (XQ_BOARD_H + 8);
  const width = XQ_BOARD_W * scale;
  const tx = (320 - width) / 2;
  const body = [
    `<rect x="0" y="0" width="${XQ_BOARD_W}" height="${XQ_BOARD_H}" rx="10" class="xq-diagram-bg"/>`,
    xqBoardGrid(0, 0, 'red'),
    xqPiecesLayer(THUMBNAIL_STATE, null, 0, 0, 'red'),
  ].join('');
  return `<svg class="xq-article-svg" viewBox="0 0 320 200" role="img" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto"><g transform="translate(${tx.toFixed(1)} 4) scale(${scale.toFixed(4)})">${body}</g></svg>`;
};

export const xiangqiEndgamesArticle: Article = {
  slug: 'xiangqi-endgames',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: T.title.en,
  seoTitle: T.seoTitle.en,
  cardTitle: T.cardTitle.en,
  summary: T.summary.en,
  status: 'published',
  publishedAt: '2026-10-08',
  thumbnail: { kind: 'svg', svg: XIANGQI_ENDGAMES_THUMBNAIL },
  audience:
    'Xiangqi players learning which endgames win and which draw, and anyone who wants to practise the standard positions against the computer.',
  intro: [
    { kind: 'paragraph', text: T.introDecides.en },
    { kind: 'paragraph', text: T.introPractice.en },
    {
      kind: 'cta',
      buttons: [{ label: T.practiceButton.en, href: XIANGQI_ENDGAMES_PRACTICE_HREF, emphasis: 'primary' }],
    },
  ],
  sections: [
    {
      heading: T.gradesHeading.en,
      blocks: [
        { kind: 'paragraph', text: T.introGrades.en },
        {
          kind: 'svg-row',
          items: [
            { svg: board('three-soldiers-vs-full-defence'), caption: T.captionStandardWin.en },
            { svg: board('horse-vs-elephant-zugzwang'), caption: T.captionTrickyWin.en },
            {
              svg: board('chariot-vs-horse-two-elephants-fortress'),
              caption: T.captionStandardDraw.en,
            },
          ],
        },
        { kind: 'paragraph', text: T.oneStep.en },
        { kind: 'paragraph', text: T.introSource.en },
      ],
    },
    {
      heading: T.ownHeading.en,
      blocks: [
        { kind: 'paragraph', text: T.ownText.en },
        {
          kind: 'cta',
          buttons: [{ label: T.ownButton.en, href: '/editor/xiangqi', emphasis: 'secondary' }],
        },
      ],
    },
  ],
};
