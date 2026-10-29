import {
  withXiangqiBoardLayout,
  XQ_BOARD_H,
  XQ_BOARD_W,
  XQ_START,
  xqBoardSvg,
  xqSvg,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// An evergreen player post on the board and piece settings (Brian, 2026-10-29:
// "we have nice UI for both flat and 3D pieces, and we even animate the flip.
// We even support both intersections and grid."). Every setting name below is
// the shipped label in theme-settings-panel.ts and i18n/catalogs/shell.ts.
//
// Article diagrams cannot draw 3D pieces, so the flat and 3D comparisons are
// stills from a local web pair forced with ?tile=flat|3d and ?edge=thick
// (public/article-thumbs/board-looks/). The two layouts and the river text are
// live diagrams that force their look, so they read the same for every reader.
// The flip is shown in motion by the real board: study embeds forced to 3D with
// ?tile=3d, which honour the reader's own Speed setting.
//
// 3D is off by default everywhere. It draws on xiangqi, jieqi, banqi and Flip
// Jungle; plain Jungle has no 3D renderer (jungle-render.ts), so the article
// does not name it.

const BANQI_STUDY = '/embed/study/FsA5sowX/F8fezAhm?ply=0&tile=3d';
const JIEQI_STUDY = '/embed/study/wd6c7qvG/FqAeRJhD?ply=0&tile=3d';

// One start board in the layout given, whatever the reader picked in Settings.
// The nested withXiangqiBoardLayout wins over the renderer's stored-layout
// wrapper, and the thunk re-runs on a piece-set change.
const startBoard = (layout: 'intersection' | 'cell', label: string) => () =>
  withXiangqiBoardLayout(layout, () =>
    xqSvg(XQ_BOARD_W, XQ_BOARD_H + 52, xqBoardSvg({ state: XQ_START, x: 0, y: 0, label, perspective: 'red' })),
  );

// The lined board with the 楚河 漢界 river text on, whatever the reader's River
// text setting: the setting only flips two CSS variables, so the diagram sets
// them on its own svg.
const brushRiverBoard = () =>
  startBoard('intersection', 'RIVER TEXT ON')().replace(
    'style="--xq-svg-width',
    'style="--xq-river-label-display: inline; --xq-river-brand-display: none; --xq-svg-width',
  );

export const setUpYourBoardArticle: Article = {
  slug: 'set-up-your-board',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Set Up Your Board: Flat or 3D Pieces, Lines or Squares',
  cardTitle: 'Set Up Your Board',
  seoTitle: 'Xiangqi Board Settings: 3D Pieces, Square Grid and River Text',
  summary:
    'Mistboard pieces can be flat or 3D, and the xiangqi board can be lined or a square grid. Pieces glide when you step through a game and turn over when a hidden piece is revealed. Here is what each look is and where to set it.',
  showSummaryOnPage: false,
  // Draft until Brian signs off the English: article-i18n.coverage.test.ts
  // fails a published article with no zh, and zh is translated only after the
  // English is final. Then translate, add the slug to TRANSLATED_ARTICLE_SLUGS
  // and flip this to 'published' (it goes live 2026-11-06 09:00 Pacific).
  status: 'draft',
  publishedAt: '2026-11-06',
  audience: 'Anyone who plays on Mistboard and wants the board to look the way they like it.',
  thumbnail: {
    kind: 'image',
    src: '/article-thumbs/board-looks/thumbnail.webp',
    alt: 'Xiangqi pieces drawn in 3D on the lined board',
  },
  readNext: ['jieqi', 'banqi', 'jungle-flip'],
  tldr: [
    'Pieces are flat until you switch them to 3D under Pieces in Settings. 3D works on xiangqi, jieqi, banqi and Flip Jungle, and a Thick edge makes the rim deeper.',
    'The xiangqi board is lined, with pieces on the points, or a square grid, with pieces inside the squares. Pick it under Board.',
    'A hidden piece in banqi, jieqi or Flip Jungle turns over when it is revealed, spinning on its edge in 3D. Speed sets how fast pieces move and turn, and Off stops the motion.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'Mistboard can draw xiangqi, jieqi, banqi and Flip Jungle pieces flat or in 3D, and the xiangqi board lined or as a square grid. Pieces move and turn over on screen, and the river can carry its traditional name. Each look is shown below, with where to set it at the end.',
    },
  ],
  sections: [
    {
      heading: 'Pieces can be flat or 3D',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Flat pieces are the default: a disc with the piece drawn on it. In 3D each piece gets a rim, so it stands on the board like a wooden piece on a table. Once 3D is on, the Edge choice appears beside it. Standard is a shallow rim, and Thick makes it half again as deep while the piece keeps its size on the board.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/board-looks/xiangqi-flat-3d-thick.webp',
          alt: 'The same corner of a xiangqi board three times: flat pieces, 3D pieces, and 3D pieces with the thick edge',
          caption: 'Flat, 3D, and 3D with the Thick edge.',
          className: 'article-figure-full',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The same look reaches the hidden-piece games. In [jieqi](/rules/jieqi) the face-down pieces stand in 3D with the rest, and in [banqi](/rules/banqi) and [Flip Jungle](/rules/jungle-flip) so does every tile.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/board-looks/jieqi-flat-3d.webp',
          alt: 'A jieqi position with face-down and revealed pieces, flat on the left and 3D on the right',
          caption: 'Jieqi, flat and 3D. The plain discs are pieces still face down.',
          className: 'article-figure-full',
        } as ArticleBlock,
        {
          kind: 'image-figure',
          src: '/article-thumbs/board-looks/flip-jungle-flat-3d.webp',
          alt: 'Flip Jungle tiles, flat on the left and 3D on the right, with a rat and an elephant face up',
          caption: 'Flip Jungle, flat and 3D.',
          className: 'article-figure-full',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The xiangqi board can be lined or a square grid',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The lined board is the traditional one. Pieces sit on the points where the lines cross, the palaces have their diagonals, and the river runs across the middle. The square grid puts each piece inside a square, the way a chessboard does, with light and dark squares, the river as a blue band and each palace as a shaded block. The rules are the same on both.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: startBoard('intersection', 'LINED') },
            { svg: startBoard('cell', 'SQUARE GRID') },
          ],
          caption: 'The starting position on each board, drawn with your piece set.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Both boards work with flat and 3D pieces. Board color offers the same woods and paper on both, and the green Jungle color only on the square grid.',
        },
      ],
    },
    {
      heading: 'Pieces glide and turn over',
      blocks: [
        {
          kind: 'paragraph',
          text: 'When you step through a game in a review, a study or a replay, each move slides from its square to the next, so you can follow it without hunting for what changed. A hidden piece turns over when it is revealed, in banqi, jieqi and Flip Jungle. A 3D piece spins over on its edge like a real one. A flat piece narrows to a thin line and widens again showing its other face.',
        },
        {
          kind: 'paragraph',
          text: 'Press the forward arrow under each board to see it. The first move in the banqi game flips a tile where it lies. In jieqi a face-down piece moves and turns over as it lands. Both boards are shown in 3D whatever your own setting is.',
        },
        {
          kind: 'embed',
          path: BANQI_STUDY,
          title: 'Banqi game with 3D tiles: step forward to see a tile turn over',
          caption: 'Banqi: the first move turns a tile over.',
          aspect: [702, 446],
        } as ArticleBlock,
        {
          kind: 'embed',
          path: JIEQI_STUDY,
          title: 'Jieqi game with 3D pieces: step forward to see a piece flip as it lands',
          caption: 'Jieqi: a hidden piece flips as it lands.',
          aspect: [702, 692],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Speed, under Pieces, sets how fast all of this runs: Fast, Normal or Slow. Off moves pieces straight to their squares and reveals a piece without the turn. If your device is set to reduce motion, Mistboard skips the motion too.',
        },
      ],
    },
    {
      heading: 'The river can name Chu and Han',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Printed xiangqi boards often write four characters in the river: 楚河 (chǔ hé, "Chu river") on one side and 漢界 (hàn jiè, "Han border") on the other. They name the border between Chu and Han, the two states that fought for China after the Qin dynasty fell. Mistboard draws them in brush-style characters, one pair on each half of the river, each pair facing the player on its side.',
        },
        {
          kind: 'raw-svg',
          svg: brushRiverBoard,
          caption: 'The lined board with River text set to 楚河 漢界 (Chu river, Han border).',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'River text starts Off. You can turn on the four characters or the Mistboard name instead. It is a lined-board setting, so the square grid leaves its river band blank.',
        },
      ],
    },
    {
      heading: 'Everything is in Settings',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Signed out, open the gear in the top bar. Signed in, open your account menu. Board and Pieces are rows in that menu, and each opens its own page of choices. A change applies to the boards you play and review on.',
        },
        {
          kind: 'table',
          headers: ['Setting', 'Where', 'Choices'],
          rows: [
            ['Board style', 'Board', 'Lined or Square grid'],
            ['Board color', 'Board', 'International, Traditional, Paper, Birch, Oak, Grey, Slate, and Jungle on the square grid'],
            ['River text', 'Board', 'Off, 楚河 漢界, or Mistboard (lined board only)'],
            ['Piece set', 'Pieces', 'International, Traditional, Brush and six more'],
            ['Pieces', 'Pieces, under Look', 'Flat or 3D'],
            ['Edge', 'Pieces, under Look', 'Standard or Thick (3D only)'],
            ['Speed', 'Pieces, under Motion', 'Off, Fast, Normal or Slow'],
          ],
          keyColumn: true,
          wrap: true,
        } as ArticleBlock,
        {
          kind: 'cta',
          buttons: [
            { label: 'Play xiangqi', href: '/?play=computer&gameSpecId=xiangqi', emphasis: 'primary' },
            { label: 'Play jieqi', href: '/?play=computer&gameSpecId=jieqi', emphasis: 'secondary' },
            { label: 'Play banqi', href: '/?play=computer&gameSpecId=banqi', emphasis: 'secondary' },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
