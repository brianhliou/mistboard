import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHomeTileArt, HOME_TILE_ARTS, homeTileArtSvg } from './home-tile-art.js';

afterEach(() => vi.unstubAllGlobals());

// The broadcast TV's palette (landing-event-banners.ts BROADCAST_ART, and the
// News marks in news-disc.ts): outline, red, navy, cream, gold.
const PALETTE = new Set(['#1a1a1a', '#e22b13', '#3a5a7a', '#f3e9c4', '#e8a23a']);

function coloursIn(svg: string): string[] {
  return [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)]
    .map((match) => match[1]?.toLowerCase() ?? '')
    .filter((colour) => colour !== 'none');
}

function offPalette(svg: string): string[] {
  return coloursIn(svg).filter((colour) => !PALETTE.has(colour));
}

function outlineWidths(svg: string): Set<number> {
  return new Set(
    [...svg.matchAll(/stroke="#1a1a1a" stroke-width="([\d.]+)"/g)].map((match) => Number(match[1])),
  );
}

describe('phone home tile drawings', () => {
  it('draws all six tiles', () => {
    expect(HOME_TILE_ARTS).toEqual(['puzzles', 'rules', 'study', 'analysis', 'forum', 'watch']);
  });

  it.each(HOME_TILE_ARTS)('paints %s only in the broadcast TV palette', (name) => {
    const svg = homeTileArtSvg(name);
    expect(coloursIn(svg).length).toBeGreaterThan(0);
    expect(offPalette(svg)).toEqual([]);
  });

  it('catches a colour off the palette', () => {
    // Planted failure: the checks above must reject a drawing that slips in
    // another colour, by hex or by name.
    const svg = homeTileArtSvg('puzzles');
    expect(offPalette(svg.replace('#e22b13', '#ff0000'))).toEqual(['#ff0000']);
    expect(offPalette(svg.replace('fill="#f3e9c4"', 'fill="white"'))).toEqual(['white']);
  });

  it.each(HOME_TILE_ARTS)('outlines %s at one weight', (name) => {
    expect([...outlineWidths(homeTileArtSvg(name))]).toEqual([4.5]);
  });

  it('catches a second outline weight', () => {
    const svg = homeTileArtSvg('watch').replace('stroke-width="4.5"', 'stroke-width="3"');
    expect([...outlineWidths(svg)].sort()).toEqual([3, 4.5]);
  });

  it.each(HOME_TILE_ARTS)('keeps the live and string %s drawings identical', (name) => {
    const host = document.createElement('div');
    host.innerHTML = homeTileArtSvg(name);
    expect(buildHomeTileArt(name).isEqualNode(host.firstElementChild)).toBe(true);
  });

  it('builds in the SVG namespace without a constructor identity check', () => {
    vi.stubGlobal('SVGSVGElement', class OtherRealmSvg {});
    const svg = buildHomeTileArt('rules');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('data-art')).toBe('rules');
  });

  it('puts a cream halo behind every drawing that only the dark theme shows', () => {
    for (const name of HOME_TILE_ARTS) {
      const first = buildHomeTileArt(name).firstElementChild;
      expect(first?.getAttribute('class')).toBe('landing-phone-tile-halo');
      expect(first?.getAttribute('fill')).toBe('#f3e9c4');
      expect(first?.childElementCount).toBeGreaterThan(0);
    }
    const css = readFileSync('src/landing.css', 'utf8');
    expect(css).toMatch(/\.landing-phone-tile-halo \{\s*display: none;/);
    expect(css).toMatch(
      /:root\[data-effective-theme="dark"\] \.landing-phone-tile-halo \{\s*display: inline;/,
    );
  });
});
