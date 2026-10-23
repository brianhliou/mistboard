// Illustrative close-ups, drawn by the same piece/badge renderers as review.
// They explain the visual scale; they are not extra analysed game positions.
import { svgBoardLuckMark } from '../../board-luck-mark.js';
import { svgBoardGlyphMarker } from '../../svg-board-marker.js';
import { readStoredXiangqiPieceSet } from '../../xiangqi-appearance-storage.js';
import { renderXiangqiPieceGlyphed } from '../../xiangqi-piece-sets.js';
import type { SvgRowBlock } from '../types.js';

function closeUp(title: string, mark: string): string {
  const piece = renderXiangqiPieceGlyphed(
    { color: 'red', role: 'cannon' },
    readStoredXiangqiPieceSet(),
    { x: 22, y: 17, size: 96, shadow: false },
  );
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140" width="140" height="140" role="img">',
    `<title>${title}</title>`,
    '<rect width="140" height="140" rx="12" fill="var(--xq-diagram-bg, #f4dca6)"/>',
    '<path d="M0 65H140M70 0V140" fill="none" stroke="#6a5735" stroke-width="1"/>',
    piece,
    mark,
    '</svg>',
  ].join('');
}

export const JIEQI_LUCK_EXAMPLES: SvgRowBlock = {
  kind: 'svg-row',
  className: 'article-piece-marks article-piece-marks--luck',
  items: [
    { luck: -40, caption: 'Very unlucky' },
    { luck: -7, caption: 'Unlucky' },
    { luck: 0, caption: 'About average' },
    { luck: 7, caption: 'Lucky' },
    { luck: 40, caption: 'Very lucky' },
  ].map(({ luck, caption }) => ({
    caption,
    svg: () =>
      closeUp(
        caption,
        svgBoardLuckMark({ luck }, { x: 70, y: 65 }, { piece: 96, cell: 104 }, 'e5'),
      ),
  })),
  caption:
    'Illustrative examples. The same revealed piece can be lucky or unlucky depending on the position.',
};

export const JIEQI_GRADE_EXAMPLES: SvgRowBlock = {
  kind: 'svg-row',
  className: 'article-piece-marks article-piece-marks--grades',
  items: [
    { glyph: '', tone: '', caption: 'No warning' },
    { glyph: '?!', tone: 'inaccuracy', caption: 'Inaccuracy' },
    { glyph: '?', tone: 'mistake', caption: 'Mistake' },
    { glyph: '??', tone: 'blunder', caption: 'Blunder' },
  ].map(({ glyph, tone, caption }) => ({
    caption,
    svg: () =>
      closeUp(
        caption,
        svgBoardGlyphMarker(
          { text: glyph, className: `xq-marker--${tone}` },
          { x: 70, y: 65 },
          104 * 0.2,
          104 * 0.33,
        ),
      ),
  })),
  caption: 'Move-quality marks grade the choice, independently of the reveal.',
};
