/**
 * How one mahjong tile is drawn.
 *
 * Ported from the prototype table, and the reason it is its own module is that
 * a tile face is the whole readability problem of this variant for the audience
 * Mistboard is for. A player who already reads 萬筒索 recognises a tile by its
 * pattern at a glance; somebody meeting mahjong through an English-language
 * site does not, and a row of thirteen unfamiliar glyphs is where they give up.
 *
 * So the pips are DRAWN rather than spelled out. The arrangements below are the
 * ones on a real tile, top row to bottom, because that shape is what a player
 * eventually recognises instead of counting: nine circles in a three-by-three
 * block is not "nine", it is 九筒. Getting the arrangement wrong would teach
 * somebody to read a tile that does not exist.
 *
 * Markup, not DOM, so it can be asserted on in a test without a browser.
 */

import { rankOf, suitOf, type TileIndex } from '@mistboard/mahjong';

/** 一through 九, for the 萬 suit, which is written rather than drawn. */
const CHINESE_NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** Winds then dragons, in tile-index order (27-33). */
const HONOUR_GLYPHS = ['東', '南', '西', '北', '白', '發', '中'] as const;

const SUIT_NAMES: Record<string, string> = { m: '萬', p: '筒', s: '索' };

/**
 * Pip rows on a real tile, top to bottom.
 *
 * Load-bearing, not decorative. 4 is two rows of two and 5 is two-one-two with
 * the odd pip centred; drawing either as a straight line would be a tile no set
 * has ever contained.
 */
const PIP_ROWS: Record<number, readonly number[]> = {
  1: [1],
  2: [1, 1],
  3: [1, 1, 1],
  4: [2, 2],
  5: [2, 1, 2],
  6: [2, 2, 2],
  7: [3, 2, 2],
  8: [2, 2, 2, 2],
  9: [3, 3, 3],
};

const FACE_WIDTH = 24;
const FACE_HEIGHT = 30;

function round(value: number): string {
  return value.toFixed(2);
}

/** Circles for 筒, canes for 索. */
export function mahjongPipFace(suit: 'p' | 's', rank: number): string {
  const rows = PIP_ROWS[rank] ?? [];
  const rowHeight = FACE_HEIGHT / rows.length;
  const colour = suit === 'p' ? 'var(--mj-tong)' : 'var(--mj-faat)';
  const parts: string[] = [`<svg viewBox="0 0 ${FACE_WIDTH} ${FACE_HEIGHT}" aria-hidden="true">`];

  rows.forEach((count, rowIndex) => {
    const colWidth = FACE_WIDTH / count;
    const cy = rowHeight * (rowIndex + 0.5);
    for (let column = 0; column < count; column += 1) {
      const cx = colWidth * (column + 0.5);
      if (suit === 'p') {
        const r = Math.min(colWidth, rowHeight) * 0.44;
        parts.push(
          `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="none" stroke="${colour}" stroke-width="1.7"/>`,
          `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r * 0.34)}" fill="${colour}"/>`,
        );
      } else {
        const caneWidth = Math.min(colWidth * 0.52, 6.2);
        const caneHeight = rowHeight * 0.74;
        const x = cx - caneWidth / 2;
        const y = cy - caneHeight / 2;
        parts.push(
          `<rect x="${round(x)}" y="${round(y)}" width="${round(caneWidth)}" height="${round(caneHeight)}" rx="${round(caneWidth / 2)}" fill="${colour}"/>`,
        );
        // The node across the middle is what makes a cane read as bamboo, but
        // only where the cane is wide enough to survive being cut by it.
        if (caneWidth >= 4.2) {
          parts.push(
            `<rect x="${round(x - 0.4)}" y="${round(cy - 0.45)}" width="${round(caneWidth + 0.8)}" height="0.9" rx="0.45" fill="var(--mj-tile-face)"/>`,
          );
        }
      }
    }
  });
  return `${parts.join('')}</svg>`;
}

/** The name a screen reader and a tooltip both use. */
export function mahjongTileName(tile: TileIndex): string {
  const suit = suitOf(tile);
  const rank = rankOf(tile);
  if (suit === 'z') return HONOUR_GLYPHS[rank - 1] ?? '?';
  return `${rank}${SUIT_NAMES[suit] ?? suit}`;
}

export type MahjongTileFace = {
  /** Extra classes describing the tile, for the stylesheet to colour. */
  readonly classes: readonly string[];
  readonly inner: string;
  readonly label: string;
};

/**
 * The face of one tile, or a face-down back when `tile` is null.
 *
 * A back carries no label beyond "face-down tile": naming the tile it happens
 * to be would put the other three hands in the page source, which is the same
 * leak the server view is careful to avoid.
 */
export function mahjongTileFace(tile: TileIndex | null): MahjongTileFace {
  if (tile === null) {
    return { classes: ['mj-tile-back'], inner: '', label: 'face-down tile' };
  }
  const suit = suitOf(tile);
  const rank = rankOf(tile);
  if (suit === 'z') {
    const glyph = HONOUR_GLYPHS[rank - 1] ?? '?';
    const classes = ['mj-tile-honour'];
    // 中 and 發 are the two coloured honours; 白 is deliberately blank-faced.
    if (tile === 33) classes.push('mj-tile-red-dragon');
    if (tile === 32) classes.push('mj-tile-green-dragon');
    return { classes, inner: `<span class="mj-tile-glyph">${glyph}</span>`, label: glyph };
  }
  if (suit === 'm') {
    return {
      classes: ['mj-tile-wan'],
      inner: `<span class="mj-tile-numeral">${CHINESE_NUMERALS[rank]}</span><span class="mj-tile-wan-mark">萬</span>`,
      label: `${rank}萬`,
    };
  }
  return {
    classes: [`mj-tile-${suit}`],
    inner: mahjongPipFace(suit as 'p' | 's', rank),
    label: mahjongTileName(tile),
  };
}
