import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { svgToPng } from './og-raster.js';

const belowFrameCard = (layer: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><clipPath id="clip"><rect width="1200" height="4000"/></clipPath><mask id="mask"><rect width="1200" height="4000" fill="white"/></mask><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter></defs><rect x="100" y="100" width="400" height="530" fill="#e0b341"/>${layer}</svg>`;
const belowFrameRect = '<rect x="100" y="2000" width="100" height="100" fill="red"/>';
const belowFrameLayers = [
  `<g opacity="0.5">${belowFrameRect}</g>`,
  `<g clip-path="url(#clip)">${belowFrameRect}</g>`,
  `<g mask="url(#mask)">${belowFrameRect}</g>`,
  `<g filter="url(#blur)">${belowFrameRect}</g>`,
  '<svg x="100" y="2000" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="red"/></svg>',
];

test('a below-frame OG layer still aborts unguarded resvg', () => {
  const resvg = createRequire(import.meta.url).resolve('@resvg/resvg-js');
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `new (require(${JSON.stringify(resvg)}).Resvg)(${JSON.stringify(belowFrameCard(belowFrameLayers[0]!))}, { fitTo: { mode: 'zoom', value: 2 }, font: { loadSystemFonts: false } }).render().asPng();`,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.ifError(child.error);
  assert.equal(child.signal, 'SIGABRT', child.stderr);
  assert.match(child.stderr, /geom\.rs/);
});

test('OG rasters safely crop every below-frame layer without changing visible pixels', () => {
  // A regression aborts only this child, leaving the test runner alive to report it.
  const code = `
import assert from 'node:assert/strict';
import { pngSize, svgToPng, svgToRgba } from ${JSON.stringify(new URL('./og-raster.js', import.meta.url).href)};
const card = ${belowFrameCard.toString()};
const layers = ${JSON.stringify(belowFrameLayers)};
for (const zoom of [1, 2]) {
  const crops = [undefined, { left: 200 * zoom, top: 150 * zoom, right: 600 * zoom, bottom: 630 * zoom }];
  for (const crop of crops) {
    const expectedPng = await svgToPng(card(''), '#0f1115', zoom, crop);
    const expectedRgba = await svgToRgba(card(''), '#0f1115', zoom, crop);
    for (const layer of layers) {
      process.stderr.write('rendering at zoom ' + zoom + ': ' + layer + '\\n');
      const png = await svgToPng(card(layer), '#0f1115', zoom, crop);
      assert.deepEqual(pngSize(png), pngSize(expectedPng));
      assert.deepEqual(png, expectedPng, layer);
      assert.deepEqual(await svgToRgba(card(layer), '#0f1115', zoom, crop), expectedRgba, layer);
    }
  }
}
const deep = card('<circle cx="50" cy="10000" r="10" opacity="0.5"/>');
await assert.rejects(svgToPng(deep), /safely/);
await assert.rejects(svgToRgba(deep, '#0f1115', 1), /safely/);
const noViewBox = (svg) => svg.replace(' viewBox="0 0 1200 630"', '');
assert.deepEqual(
  await svgToPng(noViewBox(card(layers[0])), '#0f1115', 1.5),
  await svgToPng(noViewBox(card('')), '#0f1115', 1.5),
);
for (const invalid of ['<svg', card('').replace('width="1200"', 'width="0"'), card('').replace('0 0 1200 630', '0 0 120 63')]) {
  await assert.rejects(svgToPng(invalid), /safely/);
}
`;
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', code],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, `signal ${child.signal}\n${child.stderr}`);
});

// A card-sized SVG heavy enough to take tens of milliseconds to raster on any
// machine: a blur filter over a few thousand shapes. The exact time does not
// matter, only that it is many event-loop turns long.
function heavySvg(): string {
  const shapes: string[] = [];
  for (let i = 0; i < 3000; i++) {
    const x = (i * 37) % 1200;
    const y = (i * 53) % 630;
    shapes.push(`<circle cx="${x}" cy="${y}" r="14" fill="#e0b341" filter="url(#b)"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><filter id="b"><feGaussianBlur stdDeviation="3"/></filter></defs>${shapes.join('')}</svg>`;
}

test('rastering a card does not block the event loop', async () => {
  // The synchronous Resvg#render this replaced held the loop for the whole
  // raster (~1 s per study card in prod), so a 1 ms interval could not tick
  // until the PNG was done. With the render on a worker thread the loop keeps
  // turning while it runs. Two ticks is a wide margin: the raster takes far
  // longer than that, and more on a slow CI box, never fewer.
  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
  }, 1);
  try {
    const startedAt = performance.now();
    const png = await svgToPng(heavySvg());
    const elapsedMs = performance.now() - startedAt;
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(
      ticks >= 2,
      `event loop ticked ${ticks} times during a ${Math.round(elapsedMs)} ms raster`,
    );
  } finally {
    clearInterval(interval);
  }
});
