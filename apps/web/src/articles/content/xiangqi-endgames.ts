import {
  type EndgameEntry,
  endgameEntryFen,
  endgameEntryState,
  endgameHubEntry,
  endgamePracticeSetup,
  XIANGQI_ENDGAME_HUB,
  XIANGQI_ENDGAME_HUB_GROUPS,
} from '@mistboard/game';
import { XQ_BOARD_H, XQ_BOARD_W, xqBoardGrid, xqBoardSvg, xqPiecesLayer, xqSvg } from '../diagrams.js';
import { practicePositionHref } from '../../practice-position-params.js';
import type { Article, ArticleBlock, ArticleSection } from '../types.js';
import {
  ENDGAME_GRADE_LABEL,
  ENDGAME_GROUP_HEADING,
  ENDGAME_PAGE_TEXT as T,
  endgameContrastParagraph,
  endgameRowParagraph,
  endgameRowText,
} from '../xiangqi-endgames-text.js';

// 象棋残局: the standard endgame results, each one a position you can play out.
//
// Which positions, in which order, under which grade: packages/game
// xiangqi-endgame-hub.ts. What the page says about them, in all three scripts:
// ../xiangqi-endgames-text.ts. Every verdict here is backed by a row in the
// committed chessdb checks file, and xiangqi-endgame-hub.test.ts fails if a
// grade and its check disagree, so this module adds no claims of its own.

/** Practice from this exact position: a win as Red to mate, a draw as Black. */
export function endgamePracticeHref(entry: EndgameEntry): string {
  const { side, goal } = endgamePracticeSetup(entry);
  return practicePositionHref(endgameEntryFen(entry), goal, side);
}

function analysisHref(entry: EndgameEntry): string {
  return `/analysis/xiangqi?fen=${encodeURIComponent(endgameEntryFen(entry))}`;
}

// One board per position, drawn from the same kernel state the practice page
// starts from. No label: the sub-heading above it names the position.
function board(entry: EndgameEntry): () => string {
  const state = endgameEntryState(entry);
  return () =>
    xqSvg(
      XQ_BOARD_W,
      XQ_BOARD_H,
      xqBoardSvg({ state, x: 0, y: 0, label: '', perspective: 'red', boardOffset: 0 }),
    );
}

function positionBlocks(id: string, paragraph: string): ArticleBlock[] {
  const entry = endgameHubEntry(id);
  return [
    { kind: 'paragraph', text: paragraph },
    { kind: 'raw-svg', svg: board(entry) },
    {
      kind: 'cta',
      layout: 'single-row',
      buttons: [
        { label: T.play.en, href: endgamePracticeHref(entry), emphasis: 'primary' },
        { label: T.analyse.en, href: analysisHref(entry), emphasis: 'secondary' },
      ],
    },
  ];
}

const groupSections: ArticleSection[] = XIANGQI_ENDGAME_HUB_GROUPS.map((group) => ({
  heading: ENDGAME_GROUP_HEADING[group].en,
  blocks: XIANGQI_ENDGAME_HUB.filter((row) => row.group === group).flatMap((row) => [
    { kind: 'sub-heading', text: endgameRowText(row.id).name.en } as ArticleBlock,
    ...positionBlocks(row.id, endgameRowParagraph(row.id, row.grade).en),
    ...(row.contrasts ?? []).flatMap((contrast) =>
      positionBlocks(contrast, endgameContrastParagraph(contrast).en),
    ),
  ]),
}));

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
    { kind: 'paragraph', text: T.introGrades.en },
    { kind: 'paragraph', text: T.introSource.en },
    { kind: 'paragraph', text: T.introPractice.en },
  ],
  sections: [
    {
      heading: T.glanceHeading.en,
      blocks: [
        {
          kind: 'table',
          headers: [T.glanceEnding.en, T.glanceGrade.en],
          rows: XIANGQI_ENDGAME_HUB.map((row) => [
            endgameRowText(row.id).name.en,
            ENDGAME_GRADE_LABEL[row.grade].en,
          ]),
          wrap: true,
        },
      ],
    },
    ...groupSections,
    {
      heading: T.ownHeading.en,
      blocks: [
        { kind: 'paragraph', text: T.ownText.en },
        {
          kind: 'cta',
          buttons: [{ label: T.ownButton.en, href: '/editor/xiangqi', emphasis: 'primary' }],
        },
      ],
    },
    {
      heading: T.faqHeading.en,
      blocks: [
        {
          kind: 'faq',
          items: [
            { question: T.faqDrawQ.en, answer: T.faqDrawA.en },
            { question: T.faqTrickyQ.en, answer: T.faqTrickyA.en },
            { question: T.faqChariotQ.en, answer: T.faqChariotA.en },
            { question: T.faqCheckQ.en, answer: T.faqCheckA.en },
          ],
        },
      ],
    },
  ],
};
