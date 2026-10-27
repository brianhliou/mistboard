import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnnouncementKind } from './announcements.js';
import { buildNewsDisc, buildNewsMoreDisc, newsDiscSvg, newsMoreDiscSvg } from './news-disc.js';

afterEach(() => vi.unstubAllGlobals());

describe('News disc DOM construction', () => {
  it('does not abort the homepage when the SVG constructor identity differs', () => {
    // The production throw came from an instanceof check, not malformed
    // authored markup. A different constructor must not reject a valid SVG.
    vi.stubGlobal('SVGSVGElement', class OtherRealmSvg {});
    const svg = buildNewsDisc('article');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.localName).toBe('svg');
    expect(svg.querySelector('path, rect')).not.toBeNull();
    // Halo, button, three dots.
    expect(buildNewsMoreDisc().querySelectorAll('circle')).toHaveLength(5);
  });

  it.each<AnnouncementKind>(['release', 'article', 'update', 'status'])(
    'keeps the live and prerendered %s discs identical',
    (kind) => {
      const host = document.createElement('div');
      host.innerHTML = newsDiscSvg(kind);
      expect(buildNewsDisc(kind).isEqualNode(host.firstElementChild)).toBe(true);
    },
  );

  it('keeps the live and prerendered archive disc identical', () => {
    const host = document.createElement('div');
    host.innerHTML = newsMoreDiscSvg();
    expect(buildNewsMoreDisc().isEqualNode(host.firstElementChild)).toBe(true);
  });
});

describe('News drawings', () => {
  const svgs = [
    ...(['release', 'article', 'update', 'status'] as const).map((kind) => newsDiscSvg(kind)),
    newsMoreDiscSvg(),
  ];

  it('paints only the broadcast TV palette', () => {
    // The drawings match the TV art (#711): outline, red, navy, cream, gold.
    const palette = new Set(['#1a1a1a', '#e22b13', '#3a5a7a', '#f3e9c4', '#e8a23a']);
    for (const svg of svgs) {
      const colours = [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/gi)].map((match) =>
        match[1]?.toLowerCase(),
      );
      expect(colours.length).toBeGreaterThan(0);
      for (const colour of colours) expect(palette.has(colour ?? '')).toBe(true);
    }
  });

  it('draws one outline weight on every drawing', () => {
    // A centred 4.5 outline, or the gear's 9 union outline whose inner half is
    // covered by its fill: either way 2.25 units show past the edge.
    for (const svg of svgs) {
      const widths = new Set(
        [...svg.matchAll(/stroke="#1a1a1a" stroke-width="([\d.]+)"/g)].map((match) =>
          Number(match[1]),
        ),
      );
      expect(widths.size).toBeGreaterThan(0);
      for (const width of widths) expect([4.5, 9]).toContain(width);
      // Only a union body (the gear) takes the double-width outline.
      if (widths.has(9)) expect(svg).toContain('data-mark="gear"');
    }
  });

  it('puts a cream halo behind every drawing that only the dark theme shows', () => {
    for (const svg of svgs) {
      const host = document.createElement('div');
      host.innerHTML = svg;
      const first = host.firstElementChild?.firstElementChild;
      expect(first?.getAttribute('class')).toBe('landing-news-disc-halo');
      expect(first?.childElementCount).toBeGreaterThan(0);
    }
    const css = readFileSync('src/landing-announcements.css', 'utf8');
    expect(css).toMatch(/\.landing-news-disc-halo \{\s*display: none;/);
    expect(css).toMatch(
      /:root\[data-effective-theme="dark"\] \.landing-news-disc-halo \{\s*display: inline;/,
    );
  });
});
