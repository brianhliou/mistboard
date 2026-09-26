import { XIANGQI_GLYPH_PATHS } from '@mistboard/board-render';
import type { XiangqiColor, XiangqiPieceRole } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { renderXiangqiPiece, xiangqiCharacter } from './xiangqi-pieces.js';

const ROLES: XiangqiPieceRole[] = [
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'soldier',
];

describe('xiangqi piece sprites', () => {
  it('returns the traditional red/black character for every piece', () => {
    const expected: Record<XiangqiColor, Record<XiangqiPieceRole, string>> = {
      red: {
        general: '帥',
        advisor: '仕',
        elephant: '相',
        horse: '傌',
        chariot: '俥',
        cannon: '炮',
        soldier: '兵',
      },
      black: {
        general: '將',
        advisor: '士',
        elephant: '象',
        horse: '馬',
        chariot: '車',
        cannon: '砲',
        soldier: '卒',
      },
    };
    for (const color of ['red', 'black'] as const) {
      for (const role of ROLES) {
        expect(xiangqiCharacter(color, role)).toBe(expected[color][role]);
      }
    }
  });

  it('renders a complete inline <svg> for every piece', () => {
    for (const color of ['red', 'black'] as const) {
      for (const role of ROLES) {
        const svg = renderXiangqiPiece({ color, role }, { pieceSet: 'traditional' });
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        // Pieces draw the shared baked glyph path, not literal <text>.
        expect(svg).toContain(XIANGQI_GLYPH_PATHS[xiangqiCharacter(color, role)]);
        expect(svg).toContain('viewBox="0 0 100 100"');
        expect(svg).toContain(`aria-label="${color} ${role}"`);
      }
    }
  });

  it('uses red ink for red pieces and dark ink for black pieces', () => {
    const red = renderXiangqiPiece({ color: 'red', role: 'general' }, { pieceSet: 'traditional' });
    const black = renderXiangqiPiece(
      { color: 'black', role: 'general' },
      { pieceSet: 'traditional' },
    );
    expect(red).toContain('#b91c1c');
    expect(black).toContain('#1f2937');
  });

  it('can render the international image set through the legacy entry point', () => {
    const svg = renderXiangqiPiece(
      { color: 'red', role: 'general' },
      { pieceSet: 'international' },
    );
    expect(svg).toContain('/piece-sets/xiangqi/international/red-general.png?v=15');
    expect(svg).toContain('stroke="#c30d0d"');
    expect(svg).not.toContain(XIANGQI_GLYPH_PATHS.帥);
  });

  it('replaces the character with "?" when rendered as shrouded', () => {
    const svg = renderXiangqiPiece({ color: 'black', role: 'horse' }, { shrouded: true });
    expect(svg).toContain('>?<');
    expect(svg).not.toContain(XIANGQI_GLYPH_PATHS.馬);
  });

  it('supports overriding the accessible label for hidden live pieces', () => {
    const svg = renderXiangqiPiece(
      { color: 'black', role: 'soldier' },
      { ariaLabel: 'black hidden piece', shrouded: true },
    );
    expect(svg).toContain('aria-label="black hidden piece"');
    expect(svg).not.toContain('aria-label="black soldier"');
  });

  it('applies the className when provided', () => {
    const svg = renderXiangqiPiece({ color: 'red', role: 'cannon' }, { className: 'xq-piece' });
    expect(svg).toContain('class="xq-piece"');
  });

  it('escapes quotes / angle brackets in className so attribute injection is blocked', () => {
    const svg = renderXiangqiPiece(
      { color: 'red', role: 'cannon' },
      { className: 'bad" onload="alert(1)<script>' },
    );
    // The raw quote that would break out of the class attribute must be escaped.
    expect(svg).not.toContain('"bad" onload');
    // Raw < that would open a new tag must be escaped.
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;');
    expect(svg).toContain('&lt;');
  });
});
