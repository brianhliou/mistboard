import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';
import { pngSize } from './og-raster.js';
import { servePrerenderedPage } from './server-static-pages.js';

const WEB_ROOT = resolve(import.meta.dirname, '../../web');
const HOST = 'https://mistboard.com';
type JsonLd = Record<string, unknown>;

// Load the same build-time module as prerender-articles.mjs, including when
// this test runs from the server's compiled dist/ directory.
const { homeStructuredDataScripts } = await tsImport(
  resolve(WEB_ROOT, 'src/home-structured-data.ts'),
  import.meta.url,
);

async function homepageHtml(inLanguage: string, url: string): Promise<string> {
  const shell = await readFile(resolve(WEB_ROOT, 'index.html'), 'utf8');
  const description = shell.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1];
  assert.ok(description);
  const html = shell.replace(
    '</head>',
    `${homeStructuredDataScripts({ inLanguage, url, description })}</head>`,
  );
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-home-schema-'));
  await writeFile(join(staticDir, 'home.html'), html);
  let body = '';
  const response = {
    writeHead(status: number) {
      assert.equal(status, 200);
    },
    end(chunk: string) {
      body += chunk;
    },
  } as unknown as ServerResponse;
  await servePrerenderedPage({ response, staticDir, file: 'home.html' });
  return body;
}

function documents(html: string): JsonLd[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]!) as JsonLd,
  );
}

test('homepage HTML carries one Organization with a square logo and official profiles', async () => {
  for (const [inLanguage, path] of [
    ['en', '/'],
    ['zh-Hans', '/zh-hans'],
    ['zh-Hant', '/zh-hant'],
  ]) {
    const docs = documents(await homepageHtml(inLanguage!, `${HOST}${path}`));
    const organizations = docs.filter((doc) => doc['@type'] === 'Organization');
    assert.equal(organizations.length, 1, `${path}: one Organization`);
    const organization = organizations[0]!;
    assert.equal(organization.name, 'Mistboard');
    assert.equal(organization.url, `${HOST}/`);
    assert.equal(organization.logo, `${HOST}/logo-512.png`);
    assert.deepEqual(organization.sameAs, [
      'https://www.youtube.com/@Mistboard',
      'https://x.com/Mistboard',
      'https://github.com/brianhliou/mistboard',
    ]);
    const size = pngSize(await readFile(resolve(WEB_ROOT, 'public/logo-512.png')));
    assert.equal(size.width, size.height);
    assert.ok(size.width >= 112);
  }
});

test('homepage HTML offers independently framed search images and preserves the social card', async () => {
  const html = await homepageHtml('en', `${HOST}/`);
  for (const type of ['WebSite', 'WebApplication']) {
    const doc = documents(html).find((item) => item['@type'] === type);
    const images = doc?.image as JsonLd[] | undefined;
    assert.ok(Array.isArray(images), `${type} has an image list`);
    assert.deepEqual(
      images.map(({ width, height }) => [width, height]),
      [
        [1200, 1200],
        [1600, 1200],
        [1920, 1080],
      ],
    );
    for (const image of images) {
      assert.equal(image['@type'], 'ImageObject');
      const url = new URL(image.url as string);
      assert.equal(url.origin, HOST);
      const size = pngSize(await readFile(resolve(WEB_ROOT, `public${url.pathname}`)));
      assert.deepEqual(size, { width: image.width, height: image.height });
      assert.ok(size.width >= 1200);
    }
  }
  for (const attribute of ['property="og:image"', 'name="twitter:image"']) {
    assert.ok(html.includes(`<meta ${attribute} content="${HOST}/og-image.png?v=11"`));
  }
});
