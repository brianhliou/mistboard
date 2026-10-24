// Every published post's feed thumbnail, rendered by the server's own code
// (apps/server/src/article-thumb.ts renderArticleThumbnail) with the build's
// public files. resvg 2.6 aborts the whole process on some inputs (a layer
// wholly below the canvas: geom.rs:27), which in prod would drop every live
// game, so each card is drawn here first, in a child process, scheduled posts
// included (they go live without a build).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { articles } from '../articles-data.js';
import { feedThumbnailSvg, feedThumbnails } from './feed-thumbnail.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '../../../server');
const publicDir = resolve(here, '../../public');
const dir = mkdtempSync(join(tmpdir(), 'feed-thumb-render-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Draw each SVG in one child process and report the names it finished, each
 * with its PNG size, and the child's exit status. `raw` hands the SVG straight
 * to resvg, as the route did before it grew the canvas.
 */
function renderAll(
  svgs: ReadonlyMap<string, string>,
  mode: 'route' | 'raw' = 'route',
): { rendered: string[]; status: number | null } {
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
import { renderArticleThumbnail } from ${JSON.stringify(join(serverDir, 'src/article-thumb.ts'))};
import { pngSize } from ${JSON.stringify(join(serverDir, 'src/og-raster.ts'))};
const { Resvg } = createRequire(${JSON.stringify(join(serverDir, 'package.json'))})('@resvg/resvg-js');
for (const [name, file] of ${JSON.stringify(files)}) {
  const svg = readFileSync(file, 'utf8');
  const png = ${JSON.stringify(mode)} === 'raw'
    ? new Resvg(svg, { font: { loadSystemFonts: false }, logLevel: 'off' }).render().asPng()
    : await renderArticleThumbnail(svg, ${JSON.stringify(publicDir)});
  const size = png ? pngSize(png) : null;
  console.log(name + ' ' + (size ? size.width + 'x' + size.height : 'none'));
}
`,
  );
  const child = spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: serverDir,
    encoding: 'utf8',
  });
  return { rendered: child.stdout.split('\n').filter(Boolean), status: child.status };
}

// A half-board card's shape: the viewBox crops the diagram, and a faded arrow
// sits below the frame (Atomic Xiangqi's card, reduced).
const croppedCard = feedThumbnailSvg({
  kind: 'svg',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="86.2 150.625 111.6 69.75"><rect y="28" width="284" height="315"/><line x1="142" y1="201" x2="142" y2="180" stroke="#15781B" stroke-width="5.25" opacity="0.38"/></svg>',
})!;

describe('feed thumbnails through the server renderer', () => {
  it('draws every published post at 16:10, at least 480 wide, without aborting', () => {
    const published = articles.filter((a) => a.status === 'published');
    const svgs = new Map([...feedThumbnails(published).values()].map((t) => [t.slug, t.svg]));
    expect(svgs.size).toBeGreaterThan(40);
    const { rendered, status } = renderAll(svgs);
    const next = [...svgs.keys()][rendered.length];
    expect(status, `the renderer died on ${next}`).toBe(0);
    expect(rendered.map((line) => line.split(' ')[0])).toEqual([...svgs.keys()]);
    for (const line of rendered) {
      const [name, size] = line.split(' ');
      const [width, height] = size!.split('x').map(Number);
      expect(width, name).toBeGreaterThanOrEqual(480);
      expect(width! / height!, name).toBe(16 / 10);
    }
  });

  it('catches the abort: resvg alone dies on the cropped card', () => {
    expect(renderAll(new Map([['planted', croppedCard]]), 'raw').status).not.toBe(0);
  });

  it('draws the same card through the route', () => {
    const { rendered, status } = renderAll(new Map([['planted', croppedCard]]));
    expect(status).toBe(0);
    expect(rendered).toEqual(['planted 960x600']);
  });
});
