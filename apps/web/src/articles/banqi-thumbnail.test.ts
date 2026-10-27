import { describe, expect, it } from 'vitest';
import { articles } from '../articles-data.js';
import {
  BANQI_BOARD_H,
  BANQI_BOARD_W,
  BANQI_ENGINE_THUMB_H,
  BANQI_ENGINE_THUMB_Y,
  banqiBoardGrid,
  banqiThumbnailSvg,
  xqSvg,
} from './diagrams.js';
import { feedThumbnails } from './feed-thumbnail.js';

// A banqi card thumbnail runs the board colour to every edge of whatever box
// shows it (Brian, 2026-10-25: the board read as floating on a light card).
// The boxes it is shown in: 16:10 article cards and the feed PNG, square
// sidebar and rules tiles.
const BOX_ASPECTS = [16 / 10, 1];

const BANQI_BOARD_RECT = new RegExp(
  `<rect x="[-\\d.]+" y="[-\\d.]+" width="${BANQI_BOARD_W}" height="${BANQI_BOARD_H}" rx="[\\d.]+" class="xq-diagram-bg"/>`,
);

const num = (attrs: string, name: string): number =>
  Number(new RegExp(`\\s${name}="([-\\d.]+)"`).exec(attrs)?.[1] ?? Number.NaN);

/** Why `svg` would show a margin around its banqi board, or null when it would not. */
function bleedProblem(svg: string): string | null {
  const root = /^<svg\b([^>]*)>/.exec(svg)?.[1] ?? '';
  if (!/\soverflow="visible"/.test(root)) return 'root svg clips to its viewBox';
  const [, , vbW, vbH] = (/\sviewBox="([^"]*)"/.exec(root)?.[1] ?? '').split(/\s+/).map(Number);
  const offset = /^<g transform="translate\(([-\d.]+) ([-\d.]+)\)">/.exec(
    svg.slice(svg.indexOf('>') + 1),
  );
  const [dx, dy] = offset ? [Number(offset[1]), Number(offset[2])] : [0, 0];
  const bleedTag = /<rect\b([^>]*\sdata-banqi-thumb-bleed=""[^>]*)\/>/.exec(svg);
  if (!bleedTag) return 'no bleed rect';
  const attrs = bleedTag[1]!;
  if (!/\sclass="xq-diagram-bg"/.test(attrs)) return 'bleed is not the board colour';
  const board = BANQI_BOARD_RECT.exec(svg);
  if (!board || board.index < bleedTag.index) return 'bleed is not under the board';
  const left = num(attrs, 'x') + dx;
  const top = num(attrs, 'y') + dy;
  const right = left + num(attrs, 'width');
  const bottom = top + num(attrs, 'height');
  for (const aspect of BOX_ASPECTS) {
    // The figure is fitted with `meet`: the letterbox, in viewBox units.
    const padX = Math.max(0, (vbH! * aspect - vbW!) / 2);
    const padY = Math.max(0, (vbW! / aspect - vbH!) / 2);
    if (left > -padX || top > -padY || right < vbW! + padX || bottom < vbH! + padY) {
      return `bleed leaves a margin in a ${aspect.toFixed(2)} box`;
    }
  }
  return null;
}

const svgOf = (thumb: (typeof articles)[number]['thumbnail']): string | null => {
  if (thumb?.kind !== 'svg') return null;
  return typeof thumb.svg === 'function' ? thumb.svg('en') : thumb.svg;
};

describe('banqi card thumbnails', () => {
  const banqi = articles
    .map((article) => ({ slug: article.slug, svg: svgOf(article.thumbnail) }))
    .filter((entry): entry is { slug: string; svg: string } =>
      Boolean(entry.svg && BANQI_BOARD_RECT.test(entry.svg)),
    );

  it('finds every card that shows a banqi board', () => {
    expect(banqi.map((entry) => entry.slug)).toEqual(
      expect.arrayContaining([
        'banqi-perpetual-chase',
        'banqi-statistics',
        'mistybanqi',
        'banqi-chariot-endgame',
      ]),
    );
  });

  it('runs the board colour to every edge of a 16:10 or square box', () => {
    for (const { slug, svg } of banqi) expect(bleedProblem(svg), slug).toBeNull();
  });

  it('catches a planted banqi card drawn without the bleed', () => {
    const plain = xqSvg(BANQI_BOARD_W, BANQI_BOARD_H, banqiBoardGrid(0, 0));
    expect(bleedProblem(plain)).toBe('root svg clips to its viewBox');
    // A bleed only as big as the board: the margin is back.
    const short = banqiThumbnailSvg(BANQI_BOARD_H, banqiBoardGrid(0, 0)).replace(
      /<rect [^>]*data-banqi-thumb-bleed=""\/>/,
      `<rect x="0" y="0" width="${BANQI_BOARD_W}" height="${BANQI_BOARD_H}" class="xq-diagram-bg" data-banqi-thumb-bleed=""/>`,
    );
    expect(bleedProblem(short)).toMatch(/margin/);
  });

  it('keeps the grid and pieces where the plain figure drew them', () => {
    const body = banqiBoardGrid(0, BANQI_ENGINE_THUMB_Y);
    const bled = banqiThumbnailSvg(BANQI_ENGINE_THUMB_H, body)
      .replace(' overflow="visible"', '')
      .replace(/<rect [^>]*data-banqi-thumb-bleed=""\/>/, '');
    expect(bled).toBe(xqSvg(BANQI_BOARD_W, BANQI_ENGINE_THUMB_H, body));
  });

  it('carries the bleed into the feed thumbnail', () => {
    const thumbs = feedThumbnails(articles);
    for (const { slug } of banqi) {
      const feed = thumbs.get(slug);
      if (!feed) continue;
      expect(feed.svg, slug).toMatch(/<svg x="0" y="0"[^>]*\soverflow="visible"/);
      expect(feed.svg, slug).toContain('data-banqi-thumb-bleed');
    }
  });
});
