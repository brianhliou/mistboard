// The tab icon is also the icon Google shows beside search results, cropped to
// a circle (#839). favicon.png is the square board mark at 75% on an opaque
// cream field, so the crop never cuts the mark's corners. The tab draws the
// full-bleed favicon-32.png instead: browsers take the declared size nearest
// the tab, and Google ignores anything under 48px. logo-mark.png stays the
// header and card art.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(__dirname, '..');

function pngSize(path: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25] ?? -1,
  };
}

describe('site icon', () => {
  const html = readFileSync(resolve(webRoot, 'index.html'), 'utf8');
  const icons = [...html.matchAll(/<link rel="icon" href="([^"]+)"/g)].map((m) => m[1]);

  it('declares a full-bleed tab icon and the circle-safe search icon', () => {
    expect(icons).toEqual(['/favicon-32.png', '/favicon.png']);
    expect(html).toContain('href="/favicon-32.png" type="image/png" sizes="32x32"');
    expect(html).toContain('href="/favicon.png" type="image/png" sizes="512x512"');
  });

  it('keeps the tab icon at 32px, under the 48px Google will use', () => {
    const { width, height } = pngSize(resolve(webRoot, 'public', 'favicon-32.png'));
    expect(width).toBe(32);
    expect(height).toBe(32);
  });

  it('is a square PNG Google can use (a multiple of 48px is not required; 512 square is)', () => {
    const { width, height, colorType } = pngSize(resolve(webRoot, 'public', 'favicon.png'));
    expect(width).toBe(512);
    expect(height).toBe(512);
    // Colour type 2 is RGB with no alpha: the background is opaque, so the
    // circle crop shows the cream field and never a transparent corner.
    expect(colorType).toBe(2);
  });
});
