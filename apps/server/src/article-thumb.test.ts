import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import {
  coverBelowFrame,
  renderArticleThumbnail,
  resetArticleThumbs,
  serveArticleThumbnail,
} from './article-thumb.js';
import { pngSize, svgToPng } from './og-raster.js';

const staticDir = mkdtempSync(join(tmpdir(), 'article-thumb-'));
mkdirSync(join(staticDir, 'thumb', 'article'), { recursive: true });
after(() => rmSync(staticDir, { recursive: true, force: true }));
beforeEach(() => resetArticleThumbs());

/** The web prerender's frame (apps/web/src/articles/feed-thumbnail.ts) around
 *  `inner`: a 480x300 root, a panel, the card art in a nested viewport. */
function frame(inner: string, height = 300): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${height}" viewBox="0 0 480 ${height}" color="#e8e4dc"><rect width="480" height="300" fill="#33312e"/>${inner}</svg>`;
}

// A half-board card's shape (Atomic Xiangqi's, reduced): the nested viewBox
// crops the diagram, and a faded arrow and a piece viewport fall below the
// frame. Drawn as-is, resvg 2.6 aborts the process.
const croppedCard = frame(
  '<svg x="0" y="0" width="480" height="300" viewBox="86.2 150.625 111.6 69.75">' +
    '<rect y="28" width="284" height="315" fill="#f2dfb1"/>' +
    '<line x1="142" y1="201" x2="142" y2="180" stroke="#15781B" stroke-width="5.25" opacity="0.38"/>' +
    '<line x1="142" y1="290" x2="142" y2="320" stroke="#15781B" stroke-width="5.25" opacity="0.38"/>' +
    '<svg x="120" y="300" width="20" height="20" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45"/></svg>' +
    '</svg>',
);

type Captured = { status: number; headers: Record<string, string>; body: Buffer | null };

function fakeResponse(): { response: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, headers: {}, body: null };
  const response = {
    headersSent: false,
    writeHead(status: number, headers: Record<string, string> = {}) {
      captured.status = status;
      captured.headers = headers;
      this.headersSent = true;
      return this;
    },
    end(body?: Buffer | string) {
      captured.body = body === undefined ? null : Buffer.from(body);
    },
  };
  return { response: response as unknown as ServerResponse, captured };
}

async function serve(slug: string): Promise<Captured> {
  const { response, captured } = fakeResponse();
  await serveArticleThumbnail({ slug, response, staticDir });
  return captured;
}

test('an inline-SVG thumbnail is served as a 16:10 PNG at least 480 wide', async () => {
  writeFileSync(join(staticDir, 'thumb', 'article', 'cropped-card.svg'), croppedCard);
  const first = await serve('cropped-card');
  assert.equal(first.status, 200);
  assert.equal(first.headers['content-type'], 'image/png');
  assert.match(first.headers['cache-control'] ?? '', /immutable/);
  assert.equal(first.headers['x-og-cache'], 'MISS');
  const { width, height } = pngSize(first.body!);
  assert.ok(width >= 480, `width ${width}`);
  assert.equal(width / height, 16 / 10);
  assert.deepEqual({ width, height }, { width: 960, height: 600 });
  const second = await serve('cropped-card');
  assert.equal(second.headers['x-og-cache'], 'HIT');
});

test('a photo is never upscaled: the zoom drops to its pixels, not below 480', async () => {
  // A 600x375 photo filling the frame caps the render at 600x375 (1.25x).
  const photo = await svgToPng(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="375"><rect width="600" height="375" fill="#a33"/></svg>',
    '#a33',
    1,
  );
  assert.deepEqual(pngSize(photo), { width: 600, height: 375 });
  mkdirSync(join(staticDir, 'img'), { recursive: true });
  writeFileSync(join(staticDir, 'img', 'face.png'), photo);
  const png = await renderArticleThumbnail(
    frame('<image href="/img/face.png" x="0" y="0" width="480" height="300"/>'),
    staticDir,
  );
  assert.deepEqual(pngSize(png!), { width: 600, height: 375 });
});

test('a post with no thumbnail file falls back to its OG card', async () => {
  const missing = await serve('no-card-art');
  assert.equal(missing.status, 302);
  assert.equal(missing.headers.location, '/og/article/no-card-art.png');
});

test('a slug outside [a-z0-9-] is a 404, so no path leaves the thumb directory', async () => {
  for (const slug of ['..', '../../etc/passwd', 'Has-Caps', 'a.b']) {
    assert.equal((await serve(slug)).status, 404, slug);
  }
});

test('coverBelowFrame grows the canvas to the art, and gives up past the cap', () => {
  const covered = coverBelowFrame(croppedCard)!;
  const height = Number(/^<svg\b[^>]*\bheight="(\d+)"/.exec(covered)?.[1]);
  assert.ok(height > 300, `canvas ${height}`);
  assert.match(covered, new RegExp(`viewBox="0 0 480 ${height}"`));

  const flat = frame('<rect x="10" y="10" width="100" height="100" opacity="0.5"/>');
  assert.equal(coverBelowFrame(flat), flat);

  const deep = frame('<circle cx="50" cy="5000" r="10" opacity="0.5"/>');
  assert.equal(coverBelowFrame(deep), null);
  assert.equal(coverBelowFrame(frame('', 400)), null, 'not the 480x300 frame');
});

test('art too far below the frame falls back to the OG card instead of rendering', async () => {
  writeFileSync(
    join(staticDir, 'thumb', 'article', 'too-deep.svg'),
    frame('<circle cx="50" cy="5000" r="10" opacity="0.5"/>'),
  );
  const deep = await serve('too-deep');
  assert.equal(deep.status, 302);
  assert.equal(deep.headers.location, '/og/article/too-deep.png');
});

test('the planted card really aborts resvg when drawn as-is (the check is live)', () => {
  // If this starts passing, resvg fixed the panic and coverBelowFrame can go.
  const file = join(staticDir, 'planted.svg');
  writeFileSync(file, croppedCard);
  const resvg = createRequire(import.meta.url).resolve('@resvg/resvg-js');
  const code = `const { Resvg } = require(${JSON.stringify(resvg)});
const svg = require('node:fs').readFileSync(${JSON.stringify(file)}, 'utf8');
new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, font: { loadSystemFonts: false }, logLevel: 'off' }).render().asPng();`;
  const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  assert.notEqual(child.status, 0, 'resvg drew the cropped card without the canvas fix');
});
