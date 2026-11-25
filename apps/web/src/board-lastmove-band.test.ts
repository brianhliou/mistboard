import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  XIANGQI_BOARD_COLOR_PRESETS,
  type XiangqiBoardColor,
  xiangqiBoardColorPalette,
} from './xiangqi-board-color.js';

// The destination band is a 2.5-unit line on the board fill, so whether a
// player can find the last move is a contrast question. The colour lives in
// board-lastmove.css as a token with one override for a dark board; this reads
// both out of the stylesheet and holds them against every board colour a player
// can pick.
//
// Known blind spot: it measures the band against the flat fill. The grain
// texture, a river band under the piece and a neighbouring piece's outline are
// not modelled.

const css = readFileSync(resolve(__dirname, 'board-lastmove.css'), 'utf-8');

/** The lowest contrast the band may have against any board fill. Amber reaches
 *  2.24:1 on Oak, its weakest light board. */
const MIN_BAND_CONTRAST = 2;

const BOARD_COLORS: readonly XiangqiBoardColor[] = [
  ...XIANGQI_BOARD_COLOR_PRESETS.map((preset) => preset.id),
  'grain',
];

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** A colour at `opacity` over `fill`, as the player sees it. */
function over(color: string, fill: string, opacity: number): Rgb {
  const top = parseHex(color);
  const under = parseHex(fill);
  return top.map((c, i) => Math.round(c * opacity + (under[i] as number) * (1 - opacity))) as Rgb;
}

function bandToken(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} block in board-lastmove.css`).toBeGreaterThanOrEqual(0);
  const block = css.slice(at, css.indexOf('}', at));
  const match = block.match(/--board-lastmove-band:\s*(#[0-9a-f]{6})\s*;/i);
  expect(match, `--board-lastmove-band in the ${selector} block`).not.toBeNull();
  return (match as RegExpMatchArray)[1] as string;
}

function ringRule(): string {
  const at = css.indexOf('\n.xq-live-lastmove-ring {');
  expect(at).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

/** The boards whose band, drawn as `light` on light fills and `dark` on dark
 *  ones at `opacity`, falls under the floor. */
function boardsUnderFloor(light: string, dark: string, opacity: number): string[] {
  return BOARD_COLORS.filter((color) => {
    const palette = xiangqiBoardColorPalette(color);
    const band = over(palette.dark ? dark : light, palette.bg, opacity);
    return contrastRatio(band, palette.bg) < MIN_BAND_CONTRAST;
  });
}

describe('last-move destination band colour', () => {
  it('draws the band from the token at full opacity', () => {
    const rule = ringRule();
    expect(rule).toMatch(/stroke:\s*var\(--board-lastmove-band,\s*#[0-9a-f]{6}\)/i);
    expect(rule).toMatch(/stroke-opacity:\s*1;/);
  });

  it('holds the contrast floor on every board colour', () => {
    const light = bandToken(':root');
    const dark = bandToken(':root[data-xiangqi-board-tone="dark"]');
    expect(boardsUnderFloor(light, dark, 1)).toEqual([]);
  });

  it('covers a dark board, so the override is exercised', () => {
    expect(BOARD_COLORS.some((color) => xiangqiBoardColorPalette(color).dark)).toBe(true);
  });

  // Planted failures: the check has to reject the colours it replaced.
  it('rejects the gold band this replaced on the light boards', () => {
    const failing = boardsUnderFloor('#d6af4e', '#d6af4e', 0.8);
    expect(failing).toContain('international');
    expect(failing).toContain('traditional');
  });

  it('rejects the light-board amber on the dark board', () => {
    expect(boardsUnderFloor('#b45309', '#b45309', 1)).toEqual(['slate']);
  });
});
