import { renderXiangqiPieceGlyphed, XIANGQI_PIECE_SETS } from '../../xiangqi-piece-sets.js';
import {
  withXiangqiBoardLayout,
  withXiangqiPieceSet,
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

// An empty lined board with River text set as given, whatever the reader's own
// setting: the setting only flips two CSS variables, so the diagram sets them
// on its own svg. No pieces, so the river is the only thing to look at.
const riverBoard = (river: 'classic' | 'off', label: string) => () => {
  const board = withXiangqiBoardLayout('intersection', () =>
    xqBoardSvg({ state: { ...XQ_START, board: {} }, x: 0, y: 0, label, perspective: 'red' }),
  );
  const display = river === 'classic' ? 'inline' : 'none';
  return xqSvg(XQ_BOARD_W, XQ_BOARD_H + 52, board).replace(
    /style="--xq-svg-width: \d+px"/,
    `style="--xq-river-label-display: ${display}; --xq-river-brand-display: none"`,
  );
};

// Every piece set in one diagram, four pieces each, named. Each cell forces its
// own set, so the reader's pick does not change it.
const SET_CELL_W = 196;
const SET_CELL_H = 88;
const SET_PIECE = 40;
const SET_STEP = 46;
const SET_PIECES = [
  { color: 'red', role: 'general' },
  { color: 'red', role: 'horse' },
  { color: 'black', role: 'chariot' },
  { color: 'black', role: 'cannon' },
] as const;
const pieceSetsGrid = () => {
  const cols = 3;
  const rows = Math.ceil(XIANGQI_PIECE_SETS.length / cols);
  const cells = XIANGQI_PIECE_SETS.map(({ id, label }, index) => {
    const x = (index % cols) * SET_CELL_W;
    const y = Math.floor(index / cols) * SET_CELL_H;
    const left = x + (SET_CELL_W - (SET_STEP * (SET_PIECES.length - 1) + SET_PIECE)) / 2;
    const pieces = withXiangqiPieceSet(id, () =>
      SET_PIECES.map((piece, i) =>
        renderXiangqiPieceGlyphed(piece, id, { x: left + i * SET_STEP, y: y + 34, size: SET_PIECE }),
      ).join(''),
    );
    return [
      `<rect x="${x + 4}" y="${y + 4}" width="${SET_CELL_W - 8}" height="${SET_CELL_H - 8}" rx="10" class="xq-diagram-bg"/>`,
      // Keyed, because the bare word is already a dictionary key in another
      // sense ("Book" is a source column in the problems audit, 书, where the
      // zh menu calls this set 棋书).
      `<text x="${x + SET_CELL_W / 2}" y="${y + 24}" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-ink" text-anchor="middle" data-i18n-key="Piece set: ${label}">${label}</text>`,
      pieces,
    ].join('');
  });
  return xqSvg(SET_CELL_W * cols, SET_CELL_H * rows, cells.join(''));
};

export const setUpYourBoardArticle: Article = {
  slug: 'set-up-your-board',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'How to Change Your Board and Pieces',
  cardTitle: 'Change Your Board and Pieces',
  seoTitle: 'Xiangqi Piece Sets and Board Settings: 3D, Square Grid, River Text',
  summary:
    'Mistboard has nine xiangqi piece sets, pieces can be flat or 3D, and the xiangqi board can be lined or a square grid. Pieces glide when you step through a game and turn over when a hidden piece is revealed. Here is what each look is and where to set it.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-11-06',
  audience: 'Anyone who plays on Mistboard and wants the board to look the way they like it.',
  thumbnail: {
    kind: 'image',
    src: '/article-thumbs/board-looks/thumbnail.webp',
    alt: 'Xiangqi pieces drawn in 3D on the lined board',
  },
  readNext: ['jieqi', 'banqi', 'jungle-flip'],
  tldr: [
    'Mistboard has nine piece sets: pictures, Chinese characters, cartoon animals, and five art sets in traditional styles. Pick one under Pieces in Settings.',
    'Pieces are flat until you switch them to 3D under Pieces in Settings. 3D works on xiangqi, jieqi, banqi and Flip Jungle, and a Thick edge makes the rim deeper.',
    'The xiangqi board is lined, with pieces on the points, or a square grid, with pieces inside the squares. Pick it under Board.',
    'A hidden piece in banqi, jieqi or Flip Jungle turns over when it is revealed, spinning on its edge in 3D. Speed sets how fast pieces move and turn, and Off stops the motion.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'Mistboard draws xiangqi pieces in nine sets, flat or in 3D, and the xiangqi board lined or as a square grid. Pieces move and turn over on screen, and the river can carry its traditional name.',
    },
  ],
  sections: [
    {
      heading: 'Nine piece sets',
      blocks: [
        {
          kind: 'paragraph',
          text: 'International draws each piece as a picture of what it is, so you can play without reading Chinese. Traditional and Simplified write the piece’s Chinese character, in the traditional or the simplified form. Animal Dobutsu swaps in cartoon animals. The last five are art sets in traditional styles: Lacquer, Wood, Book, Brush and Clerical. Every set works in xiangqi, jieqi and banqi, flat or in 3D.',
        },
        {
          kind: 'raw-svg',
          svg: pieceSetsGrid,
          caption: 'The red general and horse and the black chariot and cannon in each set.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Pieces can be flat or 3D',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Flat pieces are the default: a disc with the piece drawn on it. In 3D each piece gets a rim, so it stands on the board like a wooden piece on a table. Once 3D is on, the Edge choice appears beside it. Standard is a shallow rim, and Thick makes it half again as deep while the piece keeps its size on the board.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/board-looks/xiangqi-3up.webp',
          alt: 'The same corner of a xiangqi board three times: flat pieces, 3D pieces, and 3D pieces with the thick edge',
          caption: 'Flat, 3D, and 3D with the Thick edge.',
          className: 'article-figure-full article-figure-panels',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The same look reaches the hidden-piece games. In [jieqi](/rules/jieqi) the face-down pieces stand in 3D with the rest, and in [banqi](/rules/banqi) and [Flip Jungle](/rules/jungle-flip) so does every tile.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/board-looks/jieqi-3up.webp',
          alt: 'A jieqi position with face-down and revealed pieces three times: flat, 3D, and 3D with the thick edge',
          caption: 'Jieqi: flat, 3D, and 3D with the Thick edge. The plain discs are pieces still face down.',
          className: 'article-figure-full article-figure-panels',
        } as ArticleBlock,
        {
          kind: 'image-figure',
          src: '/article-thumbs/board-looks/flipjungle-3up.webp',
          alt: 'A Flip Jungle board three times: flat tiles, 3D tiles, and 3D tiles with the thick edge',
          caption: 'Flip Jungle: flat, 3D, and 3D with the Thick edge. The green tiles are still face down.',
          className: 'article-figure-full article-figure-panels',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The xiangqi board can be lined, or a square grid like chess',
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
          className: 'article-figure-row--full-boards',
          caption: 'The starting position on each board, drawn with your piece set.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'If you come to xiangqi from chess, try the square grid first. The pieces sit in squares on a checkered board, so a move looks the way you already picture one, and the lined board is one setting away when you want it. Both boards work with flat and 3D pieces. Board color offers the same woods and paper on both, and the green Jungle color only on the square grid.',
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
          text: 'Printed xiangqi boards often write four characters in the river: 楚河 (chǔ hé, "Chu river") on one side and 漢界 (hàn jiè, "Han border") on the other. They name the border between Chu and Han, the two states that fought for China after the Qin dynasty fell, from 206 to 202 BC. In 203 BC Xiang Yu of Chu and Liu Bang of Han agreed to split the country along the Hong Canal; the truce broke within months, Liu Bang won the next year, and he founded the Han dynasty. The river on the board stands for that line. River text has three choices. 楚河 漢界 draws the characters, one pair on each half of the river, each pair facing the player on its side. Off leaves the river blank. Mistboard writes the site name.',
        },
        {
          kind: 'svg-row',
          items: [{ svg: riverBoard('classic', '楚河 漢界') }, { svg: riverBoard('off', 'OFF') }],
          className: 'article-figure-row--small-boards',
          caption: 'River text: 楚河 漢界 (Chu river, Han border), and Off.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'River text starts Off, or with 楚河 漢界 on for players who read Chinese. It is a lined-board setting, so the square grid leaves its river band blank.',
        },
      ],
    },
    {
      heading: 'Start markers show where the cannons and soldiers began',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The small crosses on a printed xiangqi board are start marks: corner brackets on the points where each side’s two cannons and five soldiers begin, so the pieces can be set out without a diagram. Mistboard draws them too. At the start of a game the pieces cover them, so they show only once a cannon or soldier has moved. Start markers, on the Board page, turns them off.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/board-looks/markers-2up.webp',
          alt: 'The red half of a xiangqi middlegame twice: with start markers on the empty cannon and soldier points, and without them',
          caption: 'Start markers on, then off.',
          className: 'article-figure-full article-figure-panels',
        } as ArticleBlock,
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
            ['Board color', 'Board', 'Seven colors, plus Jungle on the square grid'],
            ['River text', 'Board', 'Off, 楚河 漢界 or Mistboard (lined board only)'],
            ['Start markers', 'Board', 'On or Off'],
            ['Piece set', 'Pieces', 'Any of the nine sets above'],
            ['Pieces', 'Pieces, under Look', 'Flat or 3D'],
            ['Edge', 'Pieces, under Look', 'Standard or Thick (3D only)'],
            ['Speed', 'Pieces, under Motion', 'Off, Fast, Normal or Slow'],
          ],
          keyColumn: true,
          wrap: true,
          nowrapColumns: [1],
        } as ArticleBlock,
        {
          kind: 'note',
          label: 'As of November 6, 2026',
          text: 'The menus, sets and choices as they are on this date. When a setting moves or a set is added, this article is updated and says so at the top.',
        },
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
