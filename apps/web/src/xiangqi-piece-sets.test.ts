import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { XIANGQI_GLYPH_PATHS } from '@mistboard/board-render';
import type { XiangqiPiece } from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AssetXiangqiPieceSet,
  assetTreasureMarks,
  DEFAULT_XIANGQI_PIECE_SET,
  duckPieceMarks,
  internationalTreasureMarks,
  isAssetPieceSet,
  RETIRED_XIANGQI_PIECE_SETS,
  renderXiangqiPieceGlyphed,
  XIANGQI_PIECE_SETS,
  xiangqiBanqiBackMarks,
  xiangqiGlyph,
  xiangqiNeutralBackMarks,
  xiangqiPieceDiscShadow,
  xiangqiPieceSetShape,
  xiangqiPieceShadowMarks,
  xiangqiPieceShapeForLayout,
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
  });

  it('uses shared modern characters for the simplified set', () => {
    expect(xiangqiGlyph('simplified', 'red', 'general')).toBe('帅');
    expect(xiangqiGlyph('simplified', 'black', 'general')).toBe('将');
    expect(xiangqiGlyph('simplified', 'red', 'horse')).toBe('马');
    expect(xiangqiGlyph('simplified', 'black', 'horse')).toBe('马');
  });

  it('falls back to the traditional characters for the image sets', () => {
    expect(xiangqiGlyph('international', 'red', 'general')).toBe('帥');
    expect(xiangqiGlyph('animal-dobutsu', 'black', 'elephant')).toBe('象');
    expect(xiangqiGlyph('wood', 'black', 'horse')).toBe('馬');
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

  it('renders the international set from figure cutouts on a deterministic token', () => {
    const general = renderXiangqiPieceGlyphed(redGeneral, 'international', {});
    const cannon = renderXiangqiPieceGlyphed({ color: 'black', role: 'cannon' }, 'international', {
      className: 'xq-piece',
    });
    expect(general).toContain('/piece-sets/xiangqi/international/red-general.png?v=18');
    expect(cannon).toContain('/piece-sets/xiangqi/international/black-cannon.png?v=18');
    expect(general).toContain('x="-7" y="-7" width="114" height="114"');
    expect(cannon).toContain('x="-11" y="-11" width="122" height="122"');
    expect(cannon).toContain('class="xq-piece"');
    expect(general).toContain('fill="#fef0d7"');
    // One dark ring on both sides (Brian, 2026-10-14): the figure's fill carries the side.
    expect(general).toContain('stroke="#202427"');
    expect(general).not.toContain('stroke="#c30d0d"');
    expect(cannon).toContain('stroke="#202427"');
    expect(general).not.toContain('<text');
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

  it('uses the promoted-soldier art after crossing the river', () => {
    const piece = { color: 'red', role: 'soldier' } as const;
    const international = renderXiangqiPieceGlyphed(piece, 'international', { crossed: true });

    expect(international).toContain(
      '/piece-sets/xiangqi/international/red-crossed-soldier.png?v=18',
    );
  });

  it('renders the international Fortress treasure from the generated cutout art', () => {
    const red = internationalTreasureMarks('red');
    const black = internationalTreasureMarks('black');
    expect(red).toContain('/piece-sets/xiangqi/international/red-treasure.png?v=18');
    expect(black).toContain('/piece-sets/xiangqi/international/black-treasure.png?v=18');
    // Two units below the other 114-unit figures: the diamond is top-heavy.
    expect(red).toContain('x="-7" y="-5" width="114" height="114"');
    expect(red).toContain('fill="#fef0d7"');
    expect(red).toContain('stroke="#202427"');
    expect(black).toContain('stroke="#202427"');
    expect(red).not.toContain('M38 38 L62 38');
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
    expect(xiangqiPreviewGlyph('international')).toBe('G');
    expect(xiangqiPreviewGlyph('animal-dobutsu')).toBe('G');
  });
});

describe('xiangqiPieceTilePreview', () => {
  it('previews the character sets as a piece on its disc, not a bare glyph', () => {
    const red = { color: 'red', role: 'general' } as const;
    const traditional = xiangqiPieceTilePreview('traditional');
    const simplified = xiangqiPieceTilePreview('simplified');
    expect(traditional.markup).toBe(renderXiangqiPieceGlyphed(red, 'traditional'));
    expect(simplified.markup).toBe(renderXiangqiPieceGlyphed(red, 'simplified'));
    expect(traditional.markup).toContain('<circle cx="50" cy="50" r="46"');
    expect(traditional.markup).not.toBe(simplified.markup);
  });

  it('uses the set art for image sets', () => {
    const international = xiangqiPieceTilePreview('international');
    expect(international.kind).toBe('svg');
    if (international.kind === 'svg') {
      expect(international.markup).toContain('/piece-sets/xiangqi/international/red-general.png');
      expect(international.markup).not.toContain('stroke="#c2261e"');
    }
    const dobutsu = xiangqiPieceTilePreview('animal-dobutsu');
    expect(dobutsu.kind).toBe('svg');
    if (dobutsu.kind === 'svg') {
      expect(dobutsu.markup).toContain('/piece-sets/xiangqi/animal-dobutsu/red-general.png');
      expect(dobutsu.markup).toContain('stroke="#283a47"');
    }
  });
});

describe('asset piece sets', () => {
  const ASSET_SETS: readonly AssetXiangqiPieceSet[] = [
    'lacquer',
    'wood',
    'book',
    'brush',
    'clerical',
  ];
  const ROLES = [
    'general',
    'advisor',
    'elephant',
    'horse',
    'chariot',
    'cannon',
    'soldier',
  ] as const;
  const COLORS = ['red', 'black'] as const;
  // The cache-busting ?v= per set; brush and clerical went to 2 when their
  // baked disc shadow came out (2026-10-08).
  const ASSET_VERSIONS: Record<AssetXiangqiPieceSet, number> = {
    lacquer: 2,
    wood: 1,
    book: 1,
    brush: 2,
    clerical: 2,
  };
  const publicDir = ['public', 'apps/web/public']
    .map((candidate) => resolve(process.cwd(), candidate))
    .find((candidate) => existsSync(`${candidate}/piece-sets/xiangqi`)) as string;

  function hrefs(svg: string): string[] {
    return [...svg.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!.replaceAll('&amp;', '&'));
  }

  function fileExists(href: string): boolean {
    return existsSync(`${publicDir}${href.split('?')[0]}`);
  }

  it('offers exactly the five asset sets beside the four built-in ones, and none retired', () => {
    expect(
      XIANGQI_PIECE_SETS.filter((set) => isAssetPieceSet(set.id)).map((set) => set.id),
    ).toEqual(ASSET_SETS);
    expect(XIANGQI_PIECE_SETS).toHaveLength(9);
    for (const set of XIANGQI_PIECE_SETS) {
      expect(RETIRED_XIANGQI_PIECE_SETS.has(set.id)).toBe(false);
      expect(set.labelKey).toBe(`prefs.xqPieceSet.${set.id}`);
    }
  });

  for (const set of ASSET_SETS) {
    it(`${set}: renders all 14 pieces, the back and the fog token from files that exist`, () => {
      for (const color of COLORS) {
        for (const role of ROLES) {
          const svg = renderXiangqiPieceGlyphed({ color, role }, set, {});
          expect(hrefs(svg)).toEqual([
            `/piece-sets/xiangqi/${set}/${color}-${role}.svg?v=${ASSET_VERSIONS[set]}`,
          ]);
          expect(fileExists(hrefs(svg)[0]!), `${set} ${color} ${role}`).toBe(true);
          expect(svg).toContain(`aria-label="${color} ${role}"`);
        }
        const back = renderXiangqiPieceGlyphed({ color, role: 'general' }, set, {
          shrouded: true,
          shroudedStyle: 'back',
        });
        expect(hrefs(back)).toEqual([
          `/piece-sets/xiangqi/${set}/${color}-back.svg?v=${ASSET_VERSIONS[set]}`,
        ]);
        expect(fileExists(hrefs(back)[0]!)).toBe(true);
        expect(back).not.toContain('general.svg');
        expect(back).not.toContain('?</text>');
        const question = renderXiangqiPieceGlyphed({ color, role: 'general' }, set, {
          shrouded: true,
        });
        expect(hrefs(question)).toEqual([
          `/piece-sets/xiangqi/${set}/${color}-back.svg?v=${ASSET_VERSIONS[set]}`,
        ]);
        expect(question).toContain('>?</text>');
        expect(question).toContain(`aria-label="${color} hidden piece"`);
      }
    });

    it(`${set}: Fortress treasure and duck draw on files that exist`, () => {
      for (const color of COLORS) {
        const treasure = assetTreasureMarks(set, color);
        expect(hrefs(treasure)).toEqual([
          `/piece-sets/xiangqi/${set}/${color}-back.svg?v=${ASSET_VERSIONS[set]}`,
        ]);
        expect(treasure).toContain(`<path d="${XIANGQI_GLYPH_PATHS.寶}"`);
      }
      for (const href of hrefs(duckPieceMarks(set))) {
        expect(fileExists(href), href).toBe(true);
      }
    });

    it(`${set}: previews in the settings tile as its own red general`, () => {
      const preview = xiangqiPieceTilePreview(set);
      expect(preview.kind).toBe('svg');
      if (preview.kind === 'svg') {
        expect(preview.markup).toContain(`/piece-sets/xiangqi/${set}/red-general.svg`);
      }
    });
  }

  it('gives banqi a back only where both sides share one look', () => {
    expect(xiangqiNeutralBackMarks('lacquer')).toBeNull();
    expect(xiangqiNeutralBackMarks('book')).toBeNull();
    expect(xiangqiNeutralBackMarks('international')).toBeNull();
    expect(xiangqiNeutralBackMarks('traditional')).toBeNull();
    for (const set of ['wood', 'brush', 'clerical'] as const) {
      const marks = xiangqiNeutralBackMarks(set);
      expect(marks && hrefs(marks)).toEqual([
        `/piece-sets/xiangqi/${set}/red-back.svg?v=${ASSET_VERSIONS[set]}`,
      ]);
    }
  });

  it('turns banqi tiles over to one back per set, the same for both sides', () => {
    expect(xiangqiBanqiBackMarks('traditional')).toBeNull();
    expect(xiangqiBanqiBackMarks('international')).toBeNull();
    expect(xiangqiBanqiBackMarks('wood')).toBe(xiangqiNeutralBackMarks('wood'));
    for (const set of ['brush', 'clerical'] as const) {
      const marks = xiangqiBanqiBackMarks(set) ?? '';
      expect(marks).toContain(xiangqiNeutralBackMarks(set) ?? 'missing');
      expect(marks).toContain('fill="#5a3018"');
    }
    const lacquer = xiangqiBanqiBackMarks('lacquer') ?? '';
    expect(hrefs(lacquer)).toEqual(['/piece-sets/xiangqi/lacquer/banqi-back.svg?v=2']);
    expect(fileExists(hrefs(lacquer)[0]!)).toBe(true);
    const book = xiangqiBanqiBackMarks('book') ?? '';
    expect(book).not.toMatch(/red-|black-/);
    expect(book).toContain('fill="#FFD438"');
    expect(book).not.toMatch(/#FF0000|#000000/i);
  });
});

describe('piece shadow', () => {
  const general: XiangqiPiece = { color: 'red', role: 'general' };
  const SHADOW = /<g class="xq-piece-shadow"/g;
  const count = (svg: string) => (svg.match(SHADOW) ?? []).length;

  afterEach(() => {
    delete document.documentElement.dataset.xiangqiPieceShadow;
  });

  it('draws none by default: the shadow is off since 2026-10-14', () => {
    for (const { id } of XIANGQI_PIECE_SETS) {
      const svg = renderXiangqiPieceGlyphed(general, id, { x: 0, y: 0, size: 56 });
      expect(count(svg), id).toBe(0);
    }
  });

  it('draws one shadow under every disc set when switched on, first, with the box opened for it', () => {
    document.documentElement.dataset.xiangqiPieceShadow = 'on';
    for (const { id } of XIANGQI_PIECE_SETS) {
      const svg = renderXiangqiPieceGlyphed(general, id, { x: 0, y: 0, size: 56 });
      expect(count(svg), id).toBe(1);
      expect(svg, id).toContain('overflow="visible"');
      // Under the disc: the shadow is the first thing inside the piece box.
      expect(svg.indexOf('xq-piece-shadow'), id).toBeLessThan(
        svg.search(/<(image|circle cx="50" cy="50")/),
      );
    }
  });

  it('draws it under the face-down backs too', () => {
    document.documentElement.dataset.xiangqiPieceShadow = 'on';
    for (const id of ['traditional', 'international', 'lacquer', 'wood'] as const) {
      const back = renderXiangqiPieceGlyphed(general, id, {
        shrouded: true,
        shroudedStyle: 'back',
      });
      expect(count(back), id).toBe(1);
    }
  });

  it('follows the switch on the root, and an explicit option wins', () => {
    expect(count(renderXiangqiPieceGlyphed(general, 'traditional'))).toBe(0);
    document.documentElement.dataset.xiangqiPieceShadow = 'off';
    expect(count(renderXiangqiPieceGlyphed(general, 'traditional'))).toBe(0);
    expect(count(renderXiangqiPieceGlyphed(general, 'lacquer'))).toBe(0);
    expect(renderXiangqiPieceGlyphed(general, 'traditional')).not.toContain('overflow');
    expect(xiangqiPieceDiscShadow('traditional')).toBe('');
    expect(count(renderXiangqiPieceGlyphed(general, 'traditional', { shadow: true }))).toBe(1);
    document.documentElement.dataset.xiangqiPieceShadow = 'on';
    expect(count(renderXiangqiPieceGlyphed(general, 'traditional'))).toBe(1);
    expect(count(renderXiangqiPieceGlyphed(general, 'traditional', { shadow: false }))).toBe(0);
  });

  it('is four stacked static circles below the disc, no filter', () => {
    const marks = xiangqiPieceShadowMarks(45);
    expect(marks.match(/<circle /g)).toHaveLength(4);
    expect(marks).not.toMatch(/filter|animate/);
    const [, cx, cy] = marks.match(/translate\(([\d.]+) ([\d.]+)\)/) ?? [];
    expect(Number(cx)).toBe(50);
    expect(Number(cy)).toBeGreaterThan(50);
  });

  it('no asset set bakes in a disc shadow of its own', () => {
    // brush and clerical shipped a drop shadow on the disc (filter url(#c)),
    // which doubled with the drawn one and ignored the switch.
    const publicDir = ['public', 'apps/web/public']
      .map((candidate) => resolve(process.cwd(), candidate))
      .find((candidate) => existsSync(`${candidate}/piece-sets/xiangqi`)) as string;
    for (const set of ['brush', 'clerical'] as const) {
      for (const color of ['red', 'black'] as const) {
        for (const role of ['general', 'soldier', 'back'] as const) {
          const svg = readFileSync(
            `${publicDir}/piece-sets/xiangqi/${set}/${color}-${role}.svg`,
            'utf8',
          );
          expect(svg, `${set} ${color}-${role}`).not.toContain('filter="url(#c)"');
        }
      }
    }
  });
});

// The 2026-10-14 piece look (docs-private/tools/x-drafts/card-lab/PIECES-2026-10.md).
describe('the 2026-10-14 piece look', () => {
  const SQUARE = '<rect x="4" y="4" width="92" height="92" rx="14"';
  const general: XiangqiPiece = { color: 'red', role: 'general' };

  it('draws a rounded square on the square grid for the international and Dobutsu sets only', () => {
    expect(xiangqiPieceShapeForLayout('cell')).toBe('square');
    expect(xiangqiPieceShapeForLayout('intersection')).toBe('disc');
    for (const set of ['international', 'animal-dobutsu'] as const) {
      const onGrid = renderXiangqiPieceGlyphed(general, set, { shape: 'square' });
      expect(onGrid, set).toContain(SQUARE);
      expect(onGrid, set).not.toContain('<circle cx="50" cy="50" r="46"');
      const onLines = renderXiangqiPieceGlyphed(general, set, { shape: 'disc' });
      expect(onLines, set).toContain('<circle cx="50" cy="50" r="46"');
      expect(onLines, set).not.toContain('<rect');
    }
    // The asset sets are whole disc files and keep their disc on every board.
    expect(renderXiangqiPieceGlyphed(general, 'lacquer', { shape: 'square' })).not.toContain(
      SQUARE,
    );
  });

  // 2026-10-15, Brian: "use rounded squares at 98% like the picture sets, to unify".
  it('draws the character sets as rounded squares on the grid, double ring kept, ring colour by side', () => {
    for (const set of ['traditional', 'simplified'] as const) {
      expect(xiangqiPieceSetShape(set, xiangqiPieceShapeForLayout('cell')), set).toBe('square');
      expect(xiangqiPieceSetShape(set, xiangqiPieceShapeForLayout('intersection')), set).toBe(
        'disc',
      );
      for (const [color, ink] of [
        ['red', '#b91c1c'],
        ['black', '#1f2937'],
      ] as const) {
        const onGrid = renderXiangqiPieceGlyphed({ color, role: 'chariot' }, set, {
          shape: 'square',
        });
        expect(onGrid, `${set} ${color}`).toContain(
          `${SQUARE} fill="#f3e6c4" stroke="${ink}" stroke-width="2.5"/>`,
        );
        expect(onGrid, `${set} ${color}`).toContain(
          `<rect x="12" y="12" width="76" height="76" rx="9" fill="none" stroke="${ink}"`,
        );
        expect(onGrid, `${set} ${color}`).not.toContain('<circle');
        const onLines = renderXiangqiPieceGlyphed({ color, role: 'chariot' }, set, {
          shape: 'disc',
        });
        expect(onLines, `${set} ${color}`).toContain(
          `<circle cx="50" cy="50" r="46" fill="#f3e6c4" stroke="${ink}" stroke-width="2.5"/>`,
        );
        expect(onLines, `${set} ${color}`).not.toContain('<rect');
      }
    }
  });

  it('draws face-down backs at the face-up edge, r 46, square on the grid', () => {
    const back = (shape: 'disc' | 'square') =>
      renderXiangqiPieceGlyphed(general, 'international', {
        shrouded: true,
        shroudedStyle: 'back',
        shape,
      });
    expect(back('disc')).toContain('<circle cx="50" cy="50" r="46" class="xq-piece-back-mark"');
    expect(back('disc')).not.toContain('r="43"');
    expect(back('square')).toContain(`${SQUARE} class="xq-piece-back-mark"`);
  });

  it('puts the Dobutsu ring on the edge (r 46, 2.8 wide), dark on both sides', () => {
    for (const color of ['red', 'black'] as const) {
      const svg = renderXiangqiPieceGlyphed({ color, role: 'horse' }, 'animal-dobutsu');
      expect(svg, color).toContain('r="46"');
      expect(svg, color).toContain('stroke="#283a47" stroke-width="2.8"');
      expect(svg, color).not.toContain('r="48.5"');
      expect(svg, color).not.toContain('r="45"');
      expect(svg, color).not.toContain('#c2261e');
    }
  });

  it('rings red international pieces in the same dark ink as black', () => {
    for (const color of ['red', 'black'] as const) {
      const svg = renderXiangqiPieceGlyphed({ color, role: 'chariot' }, 'international');
      expect(svg, color).toContain('stroke="#202427" stroke-width="2.8"');
      expect(svg, color).not.toContain('#c30d0d');
    }
  });

  it('retires Chess-style and Animal (no disc)', () => {
    expect(RETIRED_XIANGQI_PIECE_SETS.has('international-flat')).toBe(true);
    expect(RETIRED_XIANGQI_PIECE_SETS.has('animal-flat')).toBe(true);
    const offered = XIANGQI_PIECE_SETS.map((entry) => entry.id as string);
    expect(offered).not.toContain('international-flat');
    expect(offered).not.toContain('animal-flat');
  });
});
