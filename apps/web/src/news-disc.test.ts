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
    expect(buildNewsMoreDisc().querySelectorAll('circle')).toHaveLength(4);
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
