import { XIANGQI_GLYPH_PATHS } from '@mistboard/board-render';
import type { XiangqiPiece } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_XIANGQI_PIECE_SET,
  internationalFlatTreasureMarks,
  internationalTreasureMarks,
  renderXiangqiPieceGlyphed,
  xiangqiGlyph,
  xiangqiPieceTilePreview,
  xiangqiPreviewGlyph,
} from './xiangqi-piece-sets.js';

describe('default piece set', () => {
  it('falls back to the international image art outside Chinese-reading regions', () => {
    expect(DEFAULT_XIANGQI_PIECE_SET).toBe('international');
  });
});

describe('xiangqiGlyph', () => {
  it('uses distinct red/black characters for the traditional set', () => {
    expect(xiangqiGlyph('traditional', 'red', 'general')).toBe('帥');
    expect(xiangqiGlyph('traditional', 'black', 'general')).toBe('將');
    expect(xiangqiGlyph('traditional', 'red', 'horse')).toBe('傌');
    expect(xiangqiGlyph('traditional', 'black', 'horse')).toBe('馬');
  });

  it('covers the full xiangqi roles, including advisor and elephant', () => {
    expect(xiangqiGlyph('traditional', 'red', 'advisor')).toBe('仕');
    expect(xiangqiGlyph('traditional', 'black', 'advisor')).toBe('士');
    expect(xiangqiGlyph('traditional', 'red', 'elephant')).toBe('相');
    expect(xiangqiGlyph('traditional', 'black', 'elephant')).toBe('象');
    expect(xiangqiGlyph('western', 'red', 'advisor')).toBe('A');
    expect(xiangqiGlyph('western', 'red', 'elephant')).toBe('E');
  });

  it('uses shared modern characters for the simplified set', () => {
    expect(xiangqiGlyph('simplified', 'red', 'general')).toBe('帅');
    expect(xiangqiGlyph('simplified', 'black', 'general')).toBe('将');
    expect(xiangqiGlyph('simplified', 'red', 'horse')).toBe('马');
    expect(xiangqiGlyph('simplified', 'black', 'horse')).toBe('马');
  });

  it('uses color-agnostic Latin initials for the western set', () => {
    expect(xiangqiGlyph('western', 'red', 'chariot')).toBe('R');
    expect(xiangqiGlyph('western', 'black', 'cannon')).toBe('C');
    expect(xiangqiGlyph('western', 'red', 'soldier')).toBe('S');
  });

  it('keeps an initial fallback for the image sets', () => {
    expect(xiangqiGlyph('international', 'red', 'general')).toBe('G');
    expect(xiangqiGlyph('international-flat', 'red', 'general')).toBe('G');
    expect(xiangqiGlyph('international', 'black', 'elephant')).toBe('E');
    expect(xiangqiGlyph('animal-dobutsu', 'red', 'general')).toBe('G');
    expect(xiangqiGlyph('animal-dobutsu', 'black', 'elephant')).toBe('E');
  });
});

describe('renderXiangqiPieceGlyphed', () => {
  const redGeneral: XiangqiPiece = { color: 'red', role: 'general' };

  it('renders the traditional character as the shared baked glyph path', () => {
    const svg = renderXiangqiPieceGlyphed(redGeneral, 'traditional', {});
    // Unified rendering: the live board draws the same baked Noto outline the OG
    // cards and variant mini-boards use, not a system-serif <text> glyph.
    expect(svg).toContain(`<path d="${XIANGQI_GLYPH_PATHS.帥}"`);
    expect(svg).not.toContain('<text');
    expect(svg).toContain('aria-label="red general"');
  });

  it('renders the western initial', () => {
    expect(renderXiangqiPieceGlyphed(redGeneral, 'western', {})).toContain('>G<');
  });

  it('renders stroked line-art (no character text) for the symbols set', () => {
    const svg = renderXiangqiPieceGlyphed(redGeneral, 'symbols', {});
    expect(svg).toContain('<path');
    expect(svg).not.toContain(XIANGQI_GLYPH_PATHS.帥);
  });

  it('renders the international set from figure cutouts on a deterministic token', () => {
    const general = renderXiangqiPieceGlyphed(redGeneral, 'international', {});
    const cannon = renderXiangqiPieceGlyphed({ color: 'black', role: 'cannon' }, 'international', {
      className: 'xq-piece',
    });
    expect(general).toContain('/piece-sets/xiangqi/international/red-general.png?v=14');
    expect(cannon).toContain('/piece-sets/xiangqi/international/black-cannon.png?v=14');
    expect(general).toContain('x="-7" y="-7" width="114" height="114"');
    expect(cannon).toContain('x="-11" y="-11" width="122" height="122"');
    expect(cannon).toContain('class="xq-piece"');
    expect(general).toContain('fill="#fef0d7"');
    expect(general).toContain('stroke="#c30d0d"');
    expect(cannon).toContain('stroke="#202427"');
    expect(general).not.toContain('<text');
  });

  it('renders the Chess-style prototype from the international art without a disc', () => {
    const general = renderXiangqiPieceGlyphed(redGeneral, 'international-flat', {});
    expect(general).toContain('/piece-sets/xiangqi/international-flat/red-general.png?v=2');
    expect(general).toContain('x="-26.38" y="-26.38" width="152.76" height="152.76"');
    expect(general).toContain('style="filter:none"');
    expect(general).not.toContain('<circle');
    expect(general).not.toContain('fill="#fef0d7"');
  });

  it('fits the Chess-style elephant and cannon to their silhouettes', () => {
    const elephant = renderXiangqiPieceGlyphed(
      { color: 'red', role: 'elephant' },
      'international-flat',
      {},
    );
    const cannon = renderXiangqiPieceGlyphed(
      { color: 'red', role: 'cannon' },
      'international-flat',
      {},
    );

    expect(elephant).toContain('x="-23.7" y="-26.7" width="147.4" height="147.4"');
    expect(cannon).toContain('x="-35.4" y="-35.4" width="170.8" height="170.8"');
  });

  it('aligns the Chess-style advisor/soldier/chariot bases and enlarges the chariot', () => {
    const flat = (role: 'advisor' | 'soldier' | 'chariot') =>
      renderXiangqiPieceGlyphed({ color: 'red', role }, 'international-flat', {});

    // advisor: default 1.34 scale, nudged up 1.2 units so its base meets the
    // general's (~y=90). Same box as the general, shifted in y only.
    expect(flat('advisor')).toContain('x="-26.38" y="-27.58" width="152.76" height="152.76"');
    // soldier: native-framed art pulled down 3.6 units onto the shared baseline.
    expect(flat('soldier')).toContain('x="-17" y="-13.4" width="134" height="134"');
    // chariot: the smallest figure, scaled up to 1.46 so it carries similar
    // visual weight to its neighbours, with a yOffset that keeps its base on the
    // shared baseline despite the larger box.
    expect(flat('chariot')).toContain('x="-31.03" y="-29.82" width="162.06" height="166.44"');
  });

  it('keeps the international soldier at native size while larger art fills more of the disc', () => {
    const soldier = renderXiangqiPieceGlyphed(
      { color: 'red', role: 'soldier' },
      'international',
      {},
    );
    const advisor = renderXiangqiPieceGlyphed(
      { color: 'red', role: 'advisor' },
      'international',
      {},
    );
    expect(soldier).toContain('x="0" y="0" width="100" height="100"');
    expect(advisor).toContain('x="-7" y="-7" width="114" height="114"');
  });

  it('uses the promoted-soldier art after crossing the river in both international sets', () => {
    const piece = { color: 'red', role: 'soldier' } as const;
    const international = renderXiangqiPieceGlyphed(piece, 'international', { crossed: true });
    const chessStyle = renderXiangqiPieceGlyphed(piece, 'international-flat', { crossed: true });

    expect(international).toContain(
      '/piece-sets/xiangqi/international/red-crossed-soldier.png?v=14',
    );
    expect(chessStyle).toContain(
      '/piece-sets/xiangqi/international-flat/red-crossed-soldier.png?v=2',
    );
  });

  it('renders the international Fortress treasure from the generated cutout art', () => {
    const red = internationalTreasureMarks('red');
    const black = internationalTreasureMarks('black');
    expect(red).toContain('/piece-sets/xiangqi/international/red-treasure.png?v=14');
    expect(black).toContain('/piece-sets/xiangqi/international/black-treasure.png?v=14');
    expect(red).toContain('x="-7" y="-7" width="114" height="114"');
    expect(red).toContain('fill="#fef0d7"');
    expect(red).toContain('stroke="#c30d0d"');
    expect(black).toContain('stroke="#202427"');
    expect(red).not.toContain('M38 38 L62 38');
  });

  it('renders the Chess-style Fortress treasure without a disc', () => {
    const treasure = internationalFlatTreasureMarks('red');
    expect(treasure).toContain('/piece-sets/xiangqi/international-flat/red-treasure.png?v=2');
    expect(treasure).toContain('width="152.76" height="152.76"');
    expect(treasure).not.toContain('<circle');
  });

  it('renders a distinct symbol for advisor and elephant', () => {
    const advisor = renderXiangqiPieceGlyphed({ color: 'red', role: 'advisor' }, 'symbols', {});
    const elephant = renderXiangqiPieceGlyphed({ color: 'red', role: 'elephant' }, 'symbols', {});
    expect(advisor).toContain('<path');
    expect(elephant).toContain('<path');
    expect(advisor).not.toBe(elephant);
  });

  it('renders the Dobutsu animal set from the full seven-role fitted image assets', () => {
    const advisor = renderXiangqiPieceGlyphed(
      { color: 'red', role: 'advisor' },
      'animal-dobutsu',
      {},
    );
    const elephant = renderXiangqiPieceGlyphed(
      { color: 'black', role: 'elephant' },
      'animal-dobutsu',
      {},
    );
    expect(advisor).toContain('/piece-sets/xiangqi/animal-dobutsu/red-advisor.png');
    expect(elephant).toContain('/piece-sets/xiangqi/animal-dobutsu/black-elephant.png');
    expect(advisor).toContain('fill="#fff2cf"');
    expect(elephant).toContain('stroke="#283a47"');
    expect(advisor).not.toContain('<text');
    expect(elephant).not.toContain('<text');
  });

  it('uses the actual horse artwork for the Dobutsu horse slot', () => {
    const horse = renderXiangqiPieceGlyphed({ color: 'red', role: 'horse' }, 'animal-dobutsu', {});
    expect(horse).toContain('/piece-sets/xiangqi/animal-dobutsu/red-horse.png');
    expect(horse).not.toContain('crane');
  });

  it('uses tortoise advisor and elephant asset slots in the Dobutsu set', () => {
    const advisor = renderXiangqiPieceGlyphed(
      { color: 'black', role: 'advisor' },
      'animal-dobutsu',
      {},
    );
    const elephant = renderXiangqiPieceGlyphed(
      { color: 'red', role: 'elephant' },
      'animal-dobutsu',
      {},
    );
    expect(advisor).toContain('/piece-sets/xiangqi/animal-dobutsu/black-advisor.png');
    expect(elephant).toContain('/piece-sets/xiangqi/animal-dobutsu/red-elephant.png');
    expect(advisor).not.toContain('<text');
    expect(elephant).not.toContain('<text');
  });

  it('shows a role-neutral mark for a shrouded piece regardless of set', () => {
    const svg = renderXiangqiPieceGlyphed(redGeneral, 'traditional', {
      shrouded: true,
      ariaLabel: 'red hidden piece',
    });
    expect(svg).toContain('?');
    expect(svg).not.toContain(XIANGQI_GLYPH_PATHS.帥);
    expect(svg).toContain('aria-label="red hidden piece"');
  });

  it('does not reveal animal identity for a shrouded animal-set piece', () => {
    const svg = renderXiangqiPieceGlyphed(redGeneral, 'animal-dobutsu', {
      shrouded: true,
      ariaLabel: 'red hidden piece',
    });
    expect(svg).toContain('?');
    expect(svg).not.toContain('/piece-sets/xiangqi/animal-dobutsu/red-general.png');
    expect(svg).toContain('aria-label="red hidden piece"');
  });

  it('does not reveal international image identity for a shrouded piece', () => {
    const svg = renderXiangqiPieceGlyphed(redGeneral, 'international', {
      shrouded: true,
      ariaLabel: 'red hidden piece',
    });
    expect(svg).toContain('?');
    expect(svg).not.toContain('/piece-sets/xiangqi/international/red-general.png');
    expect(svg).toContain('aria-label="red hidden piece"');
  });
});

describe('xiangqiPreviewGlyph', () => {
  it('returns a representative red general per set', () => {
    expect(xiangqiPreviewGlyph('traditional')).toBe('帥');
    expect(xiangqiPreviewGlyph('simplified')).toBe('帅');
    expect(xiangqiPreviewGlyph('western')).toBe('G');
    expect(xiangqiPreviewGlyph('symbols')).toBe('★');
    expect(xiangqiPreviewGlyph('international')).toBe('G');
    expect(xiangqiPreviewGlyph('international-flat')).toBe('G');
    expect(xiangqiPreviewGlyph('animal-dobutsu')).toBe('G');
  });
});

describe('xiangqiPieceTilePreview', () => {
  it('uses text previews for glyph sets and SVG previews for image sets', () => {
    expect(xiangqiPieceTilePreview('traditional')).toEqual({ kind: 'text', text: '帥' });
    const international = xiangqiPieceTilePreview('international');
    expect(international.kind).toBe('svg');
    if (international.kind === 'svg') {
      expect(international.markup).toContain('/piece-sets/xiangqi/international/red-general.png');
      expect(international.markup).not.toContain('stroke="#c2261e"');
    }
    const chessStyle = xiangqiPieceTilePreview('international-flat');
    expect(chessStyle.kind).toBe('svg');
    if (chessStyle.kind === 'svg') {
      expect(chessStyle.markup).toContain('/piece-sets/xiangqi/international-flat/red-general.png');
      expect(chessStyle.markup).not.toContain('<circle');
    }
    const dobutsu = xiangqiPieceTilePreview('animal-dobutsu');
    expect(dobutsu.kind).toBe('svg');
    if (dobutsu.kind === 'svg') {
      expect(dobutsu.markup).toContain('/piece-sets/xiangqi/animal-dobutsu/red-general.png');
      expect(dobutsu.markup).toContain('stroke="#c2261e"');
    }
  });
});
