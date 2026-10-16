import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The self-hosted fonts are Google's per-script subsets. The latin subset has
// no ơ ư đ or stacked-diacritic vowels, so a family with only a latin face
// draws those letters in a system font mid-word on the Vietnamese articles.
// Every self-hosted family needs a Vietnamese face too. CSS text is asserted
// because the stylesheet is not applied in this environment.
const webRoot = ['.', 'apps/web']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(resolve(candidate, 'src/app-base.css'))) as string;
const css = readFileSync(resolve(webRoot, 'src/app-base.css'), 'utf8');

interface Face {
  family: string;
  src: string;
  unicodeRange: string | null;
}

const faces: Face[] = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => ({
  family: /font-family:\s*"([^"]+)"/.exec(body)?.[1] ?? '',
  src: /url\("([^"]+)"\)/.exec(body)?.[1] ?? '',
  unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)?.[1].replace(/\s+/g, ' ').trim() ?? null,
}));

// The ranges a Vietnamese face must claim: the letters the latin subset lacks.
const VIETNAMESE_RANGES = [
  'U+0102-0103',
  'U+0110-0111',
  'U+0128-0129',
  'U+0168-0169',
  'U+01A0-01A1',
  'U+01AF-01B0',
  'U+1EA0-1EF9',
];

describe('self-hosted font faces', () => {
  const families = [
    ...new Set(faces.filter((f) => f.src.startsWith('/fonts/')).map((f) => f.family)),
  ];

  it('finds the self-hosted families', () => {
    expect(families).toEqual(expect.arrayContaining(['Noto Sans', 'Roboto']));
  });

  for (const family of families) {
    it(`${family} has a Vietnamese face after its latin face`, () => {
      const own = faces.filter((f) => f.family === family);
      const vi = own.findIndex((f) => VIETNAMESE_RANGES.every((r) => f.unicodeRange?.includes(r)));
      expect(vi, `no Vietnamese unicode-range face for ${family}`).toBeGreaterThan(-1);
      // The last face declared is tried first for the characters its range
      // covers, so the Vietnamese face must follow the catch-all latin one.
      const latin = own.findIndex((f) => /latin/.test(f.src));
      expect(latin).toBeGreaterThan(-1);
      expect(vi).toBeGreaterThan(latin);
    });
  }

  it('every self-hosted src is a woff2 in public/fonts', () => {
    for (const face of faces.filter((f) => f.src.startsWith('/fonts/'))) {
      const file = resolve(webRoot, `public${face.src}`);
      expect(existsSync(file), face.src).toBe(true);
      expect(readFileSync(file).subarray(0, 4).toString('latin1'), face.src).toBe('wOF2');
    }
  });

  it('scopes each Vietnamese face by unicode-range, so Latin pages never fetch it', () => {
    const viFaces = faces.filter((f) => /vietnamese/.test(f.src));
    expect(viFaces.length).toBeGreaterThan(0);
    for (const face of viFaces) {
      // No Basic Latin in the range: an English page must not match it.
      expect(face.unicodeRange, face.src).not.toMatch(/U\+00[0-7]/);
    }
  });
});
