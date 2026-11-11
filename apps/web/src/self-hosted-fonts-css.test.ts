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

/** A face cut to fixed captions draws only the characters it lists and never
 *  running text: every range is CJK (U+3000 and up) or one ASCII letter or
 *  letter run, and the whole cut is a few dozen code points. The river face
 *  holds 楚河漢界 and the letters of "Mistboard", so no Vietnamese text meets it. */
const CAPTION_CUT_MAX = 32;
function captionOnly(face: Face): boolean {
  const ranges = face.unicodeRange?.split(',').map((r) => {
    const [lo, hi = lo] = r
      .trim()
      .slice(2)
      .split('-')
      .map((h) => Number.parseInt(h, 16));
    return { lo, hi };
  });
  if (!ranges?.length) return false;
  const letter = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  const size = ranges.reduce((n, { lo, hi }) => n + hi - lo + 1, 0);
  return (
    size <= CAPTION_CUT_MAX &&
    ranges.every(({ lo, hi }) => lo >= 0x3000 || (letter(lo) && letter(hi)))
  );
}

describe('self-hosted font faces', () => {
  const selfHosted = faces.filter((f) => f.src.startsWith('/fonts/'));
  const families = [
    ...new Set(
      selfHosted
        .filter((f) => !selfHosted.filter((o) => o.family === f.family).every(captionOnly))
        .map((f) => f.family),
    ),
  ];

  it('tells a caption cut from a text face', () => {
    const face = (unicodeRange: string) =>
      ({ family: 'X', src: '/fonts/x.woff2', unicodeRange }) as Face;
    expect(captionOnly(face('U+4D, U+61-62, U+64, U+69, U+6F, U+72-74, U+695A, U+6CB3'))).toBe(
      true,
    );
    expect(captionOnly(face('U+0000-00FF, U+0131'))).toBe(false);
    expect(captionOnly(face('U+0020-007E'))).toBe(false);
    expect(captionOnly(face('U+41-5A, U+61-7A'))).toBe(false);
  });

  it('skips only the river caption face', () => {
    expect(selfHosted.filter(captionOnly).map((f) => f.family)).toEqual(['Mistboard River']);
    expect(families).not.toContain('Mistboard River');
  });

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
