// Open-seek cards draw the variant's starting position (start-position-board.ts).
// Every board there must come from the variant's own kernel, and no fog variant
// may draw one: the seek card keeps its plain tile for those.
import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  createInitialCrazyhouseXiangqiState,
  maybeGameSpecForId,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { renderStartPositionSvg } from './start-position-board.js';

// Every piece glyph a xiangqi-family board draws carries this class.
const pieceCount = (svg: string): number => (svg.match(/class="xq-piece[ "]/g) ?? []).length;

describe('renderStartPositionSvg', () => {
  it('draws a board for every open or face-down variant a seek can be posted in', async () => {
    for (const id of CORRESPONDENCE_ELIGIBLE_SPEC_IDS) {
      const spec = maybeGameSpecForId(id);
      const svg = await renderStartPositionSvg(id);
      if (spec?.visibility === 'dark') {
        expect(svg, id).toBeNull();
        continue;
      }
      expect(svg, id).toMatch(/^\s*<svg/);
    }
  });

  it('starts Crazyhouse Xiangqi from its kernel, advisors and elephants in hand', async () => {
    const xiangqi = await renderStartPositionSvg('xiangqi');
    const crazyhouse = await renderStartPositionSvg('crazyhouse-xiangqi');
    const onBoard = Object.keys(createInitialCrazyhouseXiangqiState('t').board).length;
    expect(pieceCount(xiangqi!)).toBe(32);
    expect(pieceCount(crazyhouse!)).toBe(onBoard);
    expect(onBoard).toBe(24);
  });

  it('returns null for an unknown id instead of guessing a board', async () => {
    expect(await renderStartPositionSvg('not-a-variant')).toBeNull();
  });
});
