import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Mistboard draws one shadow under every piece set, from the Piece shadow
// setting (xiangqiPieceShadowMarks), so the art itself carries none. A shadow
// baked into a file shows even with the setting off, doubles it when on, and
// is cut by the disc's viewBox (Lacquer until 2026-10-29). The tell is a disc
// shape drawn through a filter; brush and clerical keep filters on their
// characters (an engraved look), which this leaves alone.

const ART = path.resolve(__dirname, '../public/piece-sets/xiangqi');

const BAKED_DISC_SHADOW = /<(circle|ellipse|rect)\b[^>]*\bfilter="url\(#[^)]+\)"[^>]*>/g;

function bakedDiscShadows(svg: string): string[] {
  return svg.match(BAKED_DISC_SHADOW) ?? [];
}

function svgFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return svgFiles(full);
    return entry.name.endsWith('.svg') ? [full] : [];
  });
}

describe('piece set art carries no shadow of its own', () => {
  it('catches the shadow Lacquer shipped with', () => {
    const lacquerBefore =
      '<svg><filter id="a"><feOffset dx="1" dy="0" in="SourceAlpha"/><feGaussianBlur stdDeviation="1"/></filter>' +
      '<circle cx="50" cy="49.5" filter="url(#a)" opacity=".5" r="39"/><circle cx="50" cy="48" r="44" fill="#c00"/></svg>';
    expect(bakedDiscShadows(lacquerBefore)).toHaveLength(1);
  });

  it('leaves a filter on a character alone', () => {
    expect(
      bakedDiscShadows('<svg><g fill="#050" filter="url(#d)"><path d="m0 0h1"/></g></svg>'),
    ).toEqual([]);
  });

  const files = svgFiles(ART);

  it('reads every set', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(files.map((file) => [path.relative(ART, file), file]))('%s', (_name, file) => {
    expect(bakedDiscShadows(readFileSync(file, 'utf8'))).toEqual([]);
  });
});
