import assert from 'node:assert/strict';
import test from 'node:test';
import { svgToPng } from './og-raster.js';

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
