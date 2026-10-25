// Every published post's feed thumbnail, rendered by the server's own code
// (apps/server/src/article-thumb.ts renderArticleThumbnail) with the build's
// public files. resvg 2.6 aborts the whole process on some inputs (a layer
// wholly below the canvas: geom.rs:27), which in prod would drop every live
// game, so each card is drawn here first, in a child process, scheduled posts
// included (they go live without a build).
//
// brianhliou.com hotlinks these PNGs on its home page at ~177 px (240 at most),
// so each is 480x300 (2x that) and small: until 2026-10-25 they were 960x600
// (photos 600x375) 32-bit PNGs, 7.2 MB over 56 cards, a face photo 396 KB.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { articles } from '../articles-data.js';
import {
  FEED_THUMB_RENDER_REVISION,
  feedThumbnailSvg,
  feedThumbnails,
} from './feed-thumbnail.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '../../../server');
const publicDir = resolve(here, '../../public');
const dir = mkdtempSync(join(tmpdir(), 'feed-thumb-render-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Draw each SVG in one child process and report the names it finished, each
 * with its PNG size and byte length, the child's exit status, and the server's
 * render revision. `raw` hands the SVG straight
 * to resvg, as the route did before it grew the canvas.
 */
function renderAll(
  svgs: ReadonlyMap<string, string>,
  mode: 'route' | 'raw' = 'route',
): { rendered: string[]; status: number | null; revision: number } {
  const files = [...svgs].map(([name, svg]) => {
    const file = join(dir, `${name}.svg`);
    writeFileSync(file, svg);
    return [name, file];
  });
  const script = join(dir, `render-${mode}.mts`);
  writeFileSync(
    script,
    `import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as thumb from ${JSON.stringify(join(serverDir, 'src/article-thumb.ts'))};
import { pngSize } from ${JSON.stringify(join(serverDir, 'src/og-raster.ts'))};
const { Resvg } = createRequire(${JSON.stringify(join(serverDir, 'package.json'))})('@resvg/resvg-js');
console.log('revision ' + thumb.ARTICLE_THUMB_RENDER_REVISION);
for (const [name, file] of ${JSON.stringify(files)}) {
  const svg = readFileSync(file, 'utf8');
  const png = ${JSON.stringify(mode)} === 'raw'
    ? new Resvg(svg, { font: { loadSystemFonts: false }, logLevel: 'off' }).render().asPng()
    : await thumb.renderArticleThumbnail(svg, ${JSON.stringify(publicDir)});
  const size = png ? pngSize(png) : null;
  console.log(name + ' ' + (size ? size.width + 'x' + size.height + ' ' + png.length : 'none'));
}
`,
  );
  const child = spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: serverDir,
    encoding: 'utf8',
  });
  const lines = child.stdout.split('\n').filter(Boolean);
  const revision = Number(lines.shift()?.replace(/^revision /, ''));
  return { rendered: lines, status: child.status, revision };
}

/** Per card: the worst photo card is 64 KB at 128 colours (misty), so 80 KB
 *  leaves room for a new photo; the old 2x render served 396 KB for one face. */
const MAX_THUMB_BYTES = 80 * 1024;
/** On average: board art is 2-25 KB and photos are a few cards of 56 (15 KB
 *  mean on 2026-10-25, against 128 KB before); a renderer regression that
 *  doubles every card trips this before it trips the per-card cap. */
const MAX_MEAN_THUMB_BYTES = 25 * 1024;

// A half-board card's shape: the viewBox crops the diagram, and a faded arrow
// sits below the frame (Atomic Xiangqi's card, reduced).
const croppedCard = feedThumbnailSvg({
  kind: 'svg',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="86.2 150.625 111.6 69.75"><rect y="28" width="284" height="315"/><line x1="142" y1="201" x2="142" y2="180" stroke="#15781B" stroke-width="5.25" opacity="0.38"/></svg>',
})!;

describe('feed thumbnails through the server renderer', () => {
  it('draws every published post at 480x300 under the byte caps, without aborting', () => {
    const published = articles.filter((a) => a.status === 'published');
    const svgs = new Map([...feedThumbnails(published).values()].map((t) => [t.slug, t.svg]));
    expect(svgs.size).toBeGreaterThan(40);
    // The three cards brianhliou.com reported (a face photo, two 960-wide boards).
    for (const slug of ['zuo-wenjing', 'fortress-and-atomic-xiangqi-on-hold', 'banqi-perpetual-chase']) {
      expect(svgs.has(slug), slug).toBe(true);
    }
    const { rendered, status, revision } = renderAll(svgs);
    const next = [...svgs.keys()][rendered.length];
    expect(status, `the renderer died on ${next}`).toBe(0);
    expect(rendered.map((line) => line.split(' ')[0])).toEqual([...svgs.keys()]);
    let total = 0;
    for (const line of rendered) {
      const [name, size, bytes] = line.split(' ');
      const [width, height] = size!.split('x').map(Number);
      expect({ width, height }, name).toEqual({ width: 480, height: 300 });
      expect(Number(bytes), name).toBeLessThanOrEqual(MAX_THUMB_BYTES);
      total += Number(bytes);
    }
    expect(total / rendered.length).toBeLessThanOrEqual(MAX_MEAN_THUMB_BYTES);
    // A renderer change moves the feed's ?v= only through this revision.
    expect(revision).toBe(FEED_THUMB_RENDER_REVISION);
  });

  it('catches the abort: resvg alone dies on the cropped card', () => {
    expect(renderAll(new Map([['planted', croppedCard]]), 'raw').status).not.toBe(0);
  });

  it('draws the same card through the route', () => {
    const { rendered, status } = renderAll(new Map([['planted', croppedCard]]));
    expect(status).toBe(0);
    expect(rendered.map((line) => line.split(' ').slice(0, 2).join(' '))).toEqual([
      'planted 480x300',
    ]);
  });
});
