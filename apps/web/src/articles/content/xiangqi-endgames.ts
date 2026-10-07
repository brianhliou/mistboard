import { endgameEntryState, endgameHubEntry } from '@mistboard/game';
import { XQ_BOARD_H, XQ_BOARD_W, xqBoardGrid, xqBoardSvg, xqPiecesLayer, xqSvg } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';
import {
  ENDGAME_TABLE_GROUP_HEADING,
  ENDGAME_TABLE_GROUPS,
  endgameStudyHref,
  endgameTableRows,
  ENDGAME_PAGE_TEXT as T,
} from '../xiangqi-endgames-text.js';

// 象棋残局, an evergreen reference: what decides an endgame, a win-or-draw
// table of 33 common endings by attacking piece (each name links to the
// position in the practice sets), one exercise drawn from the kernel with a
// link to play it in its study chapter (the study embed only replays, so the
// page links out), the fortress pair, and how to set up or look up any other
// ending. Every result is held to a chessdb check by xiangqi-endgames.test.ts
// and xiangqi-endgame-hub.test.ts; the words and links live in
// ../xiangqi-endgames-text.ts.

/** The practice shelf: the 33 are spread over its sets, one per piece. */
export const XIANGQI_ENDGAMES_PRACTICE_HREF = '/practice';

/** The position the page asks the reader to play. */
export const XIANGQI_ENDGAMES_EXERCISE_ID = 'horse-vs-elephant-zugzwang';

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


// One sub-heading and one table per attacking piece.
const tableBlocks: ArticleBlock[] = ENDGAME_TABLE_GROUPS.flatMap((group): ArticleBlock[] => [
  { kind: 'sub-heading', text: ENDGAME_TABLE_GROUP_HEADING[group].en },
  {
    kind: 'table',
    headers: [T.headerMaterial.en, T.headerResult.en, T.headerIdea.en],
    rows: endgameTableRows(group),
    wrap: true,
  },
]);

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
      heading: T.tableHeading.en,
      blocks: [
        { kind: 'paragraph', text: T.tableIntro.en },
        ...tableBlocks,
        { kind: 'paragraph', text: T.introSource.en },
      ],
    },
    {
      heading: T.exerciseHeading.en,
      blocks: [
        { kind: 'paragraph', text: T.exerciseText.en },
        { kind: 'raw-svg', svg: board(XIANGQI_ENDGAMES_EXERCISE_ID), caption: T.exerciseCaption.en },
        {
          kind: 'cta',
          buttons: [
            {
              label: T.exerciseButton.en,
              href: endgameStudyHref(XIANGQI_ENDGAMES_EXERCISE_ID),
              emphasis: 'primary',
            },
          ],
        },
      ],
    },
    {
      heading: T.fortressHeading.en,
      blocks: [
        {
          kind: 'svg-row',
          items: [
            { svg: board('chariot-vs-horse-two-elephants-fortress'), caption: T.captionFortress.en },
            { svg: board('chariot-vs-horse-two-elephants-broken'), caption: T.captionBroken.en },
          ],
        },
        { kind: 'paragraph', text: T.oneStep.en },
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
    {
      heading: T.tablebaseHeading.en,
      blocks: [{ kind: 'paragraph', text: T.tablebaseText.en }],
    },
  ],
};
