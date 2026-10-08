import { createInitialXiangqiState, type XiangqiGameState } from '@mistboard/game';
import { XQ_CELL, xqBoardSvg, xqPoint } from '../diagrams.js';
import type { Article } from '../types.js';

// A bug write-up (fe26e31c). Facts and where they come from:
// - The old xiangqi key wrote `${sq}${color[0]}${role[0]}`, so chariot and
//   cannon were both `c`; the fix writes `${sq}:${color[0]}.${role}`
//   (packages/game/src/variants-xiangqi.ts). Fog Chess (variants.ts, king and
//   knight both `k`) and Duck Xiangqi had the same shortcut.
// - The fourteen plies are SWAP_THEN_SHUFFLE in
//   packages/game/src/repetition-key-roles.test.ts: red b3-a3, a1-a2, a2-b2,
//   b2-b3, a3-a1 while black's a10 chariot loops home, then h1-g3-h1 and
//   h10-g8-h10. True counts: opening 1, swapped 2.
// - Prod replay under the corrected key: 29 xiangqi repetition draws,
//   2 perpetual-check losses, 2 Duck Xiangqi draws, 19 Fog Chess draws; none
//   changed.
// - Puzzles: the publication guard also matches legacyPositionRepetitionKey.
// Found the day jieqi got its repetition rule (fb197525, the commit before the fix).

const OLD_KEY = `function repetitionKey(position):
    parts = []
    for sq, p in position.pieces (sorted by sq):
        # red chariot on a1: "a1" + "r" + "c"
        parts.append(sq + p.color[0] + p.role[0])
    return position.turn + "|" + join(parts, ",")

after every move:
    seen[repetitionKey(position)] += 1
    if it reaches 3: draw (or a perpetual-check loss)`;

const NEW_KEY = `# red chariot on a1: "a1:r.chariot"
parts.append(sq + ":" + p.color[0] + "." + p.role)`;

// 16:10 to match the card media box (.articles-index-card-media, 16/10).
const THUMB_ASPECT = 16 / 10;

// Card art: red's corner after the swap, a cannon on a1 and a chariot on b3,
// both ringed as in the article's figure.
const SWAP_THUMBNAIL = (): string => {
  const start = createInitialXiangqiState('chariot-cannon-thumb');
  const swapped: XiangqiGameState = {
    ...start,
    board: { ...start.board, a1: start.board.b3, b3: start.board.a1 },
  };
  const boardY = 28; // xqBoardSvg draws the grid 28 below its y, under the title row.
  const a1 = xqPoint(0, 1, 'red', 0, boardY);
  const b3 = xqPoint(1, 3, 'red', 0, boardY);
  const top = xqPoint(0, 4, 'red', 0, boardY).y - XQ_CELL * 0.6;
  const bottom = a1.y + XQ_CELL * 0.6;
  const h = bottom - top;
  const w = h * THUMB_ASPECT;
  const left = a1.x - XQ_CELL * 0.7;
  const ring = (p: { x: number; y: number }) =>
    `<circle cx="${p.x}" cy="${p.y}" r="${XQ_CELL * 0.52}" fill="none" stroke="#d99a1e" stroke-width="3"/>`;
  const svg = xqBoardSvg({
    state: swapped,
    x: 0,
    y: 0,
    label: '',
    perspective: 'red',
    overlay: ring(a1) + ring(b3),
  });
  return `<svg class="xq-article-svg" viewBox="${left} ${top} ${w} ${h}" role="img" aria-label="Red's chariot and cannon have traded squares: a cannon on a1 and a chariot on b3" xmlns="http://www.w3.org/2000/svg"><rect class="xq-diagram-bg" x="${left}" y="${top}" width="${w}" height="${h}"/>${svg}</svg>`;
};

export const chariotCannonRepetitionKeyArticle: Article = {
  slug: 'chariot-cannon-repetition-key',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Chariot and cannon both start with C',
  cardTitle: 'Chariot and cannon, both C',
  seoTitle: 'A xiangqi threefold repetition bug: the chariot and the cannon shared a key',
  summary:
    "A one-character bug in Mistboard's xiangqi repetition key let a game end in a threefold draw after a position had occurred only twice.",
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-07',
  thumbnail: { kind: 'svg', svg: SWAP_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'People who play xiangqi and its variants on Mistboard, and people who write game code.',
  readNext: ['pikafish-reveal-bug'],
  intro: [
    {
      kind: 'paragraph',
      text: 'Our xiangqi repetition key labelled each piece by the first letter of its role, so the chariot and the cannon were both `c`. Swapping a chariot and a cannon left the key unchanged, so a game could be drawn by threefold repetition after only two.',
    },
    {
      kind: 'paragraph',
      text: 'The fix writes out the role name. Fog Chess had the same bug with the king and the knight. No finished game changes result.',
    },
  ],
  sections: [
    {
      heading: 'The key used the first letter of each role',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Threefold repetition needs a way to say "this is the same position." Mistboard turns each position into a string and counts how often each one comes up.',
        },
        { kind: 'code', language: 'text', text: OLD_KEY },
        {
          kind: 'paragraph',
          text: "`role[0]` is the first letter of the role, and two of xiangqi's seven roles start with `c`. A red chariot on a1 and cannon on b3 write `a1rc` and `b3rc`. Swap them and they still write `a1rc` and `b3rc`.",
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/chariot-cannon-swap.png',
          alt: "The opening position next to the same position with red's a1 chariot and b3 cannon swapped",
          caption:
            "Left: the opening. Right: red's a1 chariot and b3 cannon have traded places. The old key cannot tell them apart.",
        },
      ],
    },
    {
      heading: 'Fourteen legal plies drew a game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Red makes the swap in five moves while Black walks a chariot out and home, then each side moves a horse out and back:',
        },
        {
          kind: 'table',
          headers: ['After', 'Old count', 'Real count'],
          rows: [
            ['the start', '1', 'opening: 1'],
            ['the swap, 5 moves a side', '2', 'swapped: 1'],
            ['a horse out and back', '3, draw', 'swapped: 2'],
          ],
          highlightRows: [2],
        },
        {
          kind: 'paragraph',
          text: 'Fourteen legal plies, and the site scored a draw. No player reported it; it turned up in a read of this code while jieqi was getting a repetition rule.',
        },
      ],
    },
    {
      heading: 'The fix writes the role out in full',
      blocks: [
        { kind: 'code', language: 'text', text: NEW_KEY },
        {
          kind: 'paragraph',
          text: 'A test plays those fourteen plies and checks the game goes on. The same shortcut was in Fog Chess (king and knight both `k`) and Duck Xiangqi; both are fixed.',
        },
      ],
    },
    {
      heading: 'What it means on the site',
      blocks: [
        {
          kind: 'paragraph',
          text: '**Finished games:** none change. Replayed under the corrected key, all 29 xiangqi repetition draws, 2 perpetual-check losses, 2 Duck Xiangqi draws and 19 Fog Chess draws end the same way.',
        },
        {
          kind: 'paragraph',
          text: '**New games:** xiangqi, Fog Xiangqi, Fog Chess and Duck Xiangqi end on repetition only when a position has really occurred three times.',
        },
        {
          kind: 'paragraph',
          text: "**Puzzles:** the miner's duplicate check reads both spellings, so no published puzzle comes back as new.",
        },
        {
          kind: 'paragraph',
          text: 'A key built from abbreviations needs one check that no single abbreviation shows: that no two names shorten to the same thing. A letter table written by hand makes that check when someone picks `r` for the chariot. `role[0]` never did.',
        },
      ],
    },
  ],
};
