import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  boardSize,
  CARD_BOARD_HEIGHT,
  CARD_BOARD_MAX_WIDTH,
  CARD_BOARD_X,
  cardArtPaths,
  loadCardArt,
  renderBoardCard,
  resetCardArt,
} from './og-card-board.js';
import { resolvePositionOg, startPositionFen } from './og-position.js';

// The web's public/ dir carries the same piece art dist does (Vite copies it),
// so the tests can load the real files without a build.
const WEB_PUBLIC = resolve(import.meta.dirname, '../../web/public');

function board(variant: Parameters<typeof startPositionFen>[0], fen = startPositionFen(variant)) {
  const resolved = resolvePositionOg(variant, fen);
  assert.ok(resolved, `${variant} resolves`);
  return resolved.board;
}

/** Every <text> element's x, so a caption can be checked against the column. */
function textXs(svg: string): number[] {
  return [...svg.matchAll(/<text x="([\d.]+)"/g)].map((m) => Number(m[1]));
}

test('the board takes the full card height and the caption sits beside it, never under it', () => {
  const b = board('xiangqi');
  const { width, height } = boardSize(b);
  assert.equal(height, CARD_BOARD_HEIGHT, 'a 9x10 board is height-bound');
  const svg = renderBoardCard(b, new Map(), { title: ['Xiangqi'], subtitle: 'Red to move' });
  assert.match(
    svg,
    new RegExp(`<svg x="${CARD_BOARD_X}" y="24" width="${width}" height="${height}"`),
  );
  // Every caption <text> starts to the right of the board.
  const xs = textXs(svg.slice(svg.lastIndexOf('</svg>', svg.length - 7)));
  assert.ok(xs.length >= 3, 'title, subtitle, brand');
  for (const x of xs) assert.ok(x > CARD_BOARD_X + width, `caption x ${x} is beside the board`);
  assert.match(svg, />Xiangqi<\/text>/);
  assert.match(svg, />Red to move<\/text>/);
  assert.match(svg, />mistboard\.com<\/text>/);
});

test('a wide board is width-bound and still leaves the caption column', () => {
  const { width, height } = boardSize(board('banqi'));
  assert.equal(width, CARD_BOARD_MAX_WIDTH);
  assert.ok(height < CARD_BOARD_HEIGHT);
});

test('grid tiles land inside the board: rank 1 at the bottom row, the top rank at the top', () => {
  // The banqi start has all 32 tiles face-down: 32 jade discs, every one with
  // a centre inside the board's own viewBox.
  const b = board('banqi');
  const { width, height } = boardSize(b);
  const svg = renderBoardCard(b, new Map(), { title: ['Banqi'] });
  const discs = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="#2f8f6b"/g)];
  assert.equal(discs.length, 32);
  const cell = width / 8;
  for (const m of discs) {
    const cy = Number(m[2]);
    assert.ok(cy > 0 && cy < height, `disc at cy ${cy} inside ${height}`);
  }
  const rows = new Set(discs.map((m) => Math.round(Number(m[2]) / cell - 0.5)));
  assert.deepEqual([...rows].sort(), [0, 1, 2, 3], 'four rows drawn');
});

test('with the site art loaded, the international set draws; without it, the glyphs do', async () => {
  resetCardArt();
  const art = await loadCardArt(WEB_PUBLIC);
  assert.equal(art.size, cardArtPaths().length, 'every art file the cards need is in web/public');
  const withArt = renderBoardCard(board('xiangqi'), art, { title: ['Xiangqi'] });
  assert.ok(withArt.includes('data:image/png;base64,'), 'PNG art embedded');
  assert.ok(withArt.includes('fill="#fef0d7" stroke="#c30d0d"'), 'international red disc');
  const glyphs = renderBoardCard(board('xiangqi'), new Map(), { title: ['Xiangqi'] });
  assert.ok(!glyphs.includes('data:image/png'), 'no art, no image');
  assert.ok(glyphs.includes('<path d='), 'baked glyph paths instead');
  resetCardArt();
});

test('a jieqi face-down piece is the live back disc with no art and no glyph', async () => {
  const art = await loadCardArt(WEB_PUBLIC);
  const svg = renderBoardCard(board('jieqi'), art, { title: ['Jieqi'] });
  // 30 backs (15 red, 15 black), two revealed generals.
  assert.equal((svg.match(/fill="#a95f4a" stroke="#6f342c"/g) ?? []).length, 15);
  assert.equal((svg.match(/fill="#2f7d62" stroke="#174536"/g) ?? []).length, 15);
  assert.equal(
    (svg.match(/<image href="data:image\/png/g) ?? []).length,
    2,
    'only the generals carry art',
  );
  resetCardArt();
});

test('a chess game card seats black at the top and white at the bottom behind their kings', async () => {
  const { renderChessGameCard } = await import('./og-image.js');
  const { ARTICLE_OG_POSITIONS } = await import('@mistboard/board-render');
  const record = {
    roomId: 'r',
    variant: 'dark-chess',
    mode: 'pvp',
    result: 'white-wins',
    termination: 'king-captured',
    plyCount: 20,
    startedAt: new Date(),
    endedAt: new Date(),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: [
      {
        color: 'white',
        displayName: 'alice',
        subjectType: 'user',
        subjectId: 'a',
        visibility: 'public',
      },
      {
        color: 'black',
        displayName: 'bob',
        subjectType: 'user',
        subjectId: 'b',
        visibility: 'public',
      },
    ],
  } as unknown as import('./persistence.js').GameRecord;
  const svg = renderChessGameCard(record, ARTICLE_OG_POSITIONS.chess!.pieces);
  assert.ok(svg.indexOf('>bob</text>') < svg.indexOf('>alice</text>'), 'black above white');
  assert.match(svg, />1<\/text>/);
  assert.match(svg, />0<\/text>/);
  assert.match(svg, />Fog Chess<\/text>/);
  // Two kings in the column (cburnett paths), not xiangqi generals.
  assert.ok(!svg.includes('international/'), 'no xiangqi art on a chess card');
});
