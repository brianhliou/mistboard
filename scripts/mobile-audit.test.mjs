import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEVICES, parseArgs, readHelp } from './mobile-audit.mjs';

test('the desktop devices are Chromium windows the phone rules skip', () => {
  const sizes = {
    desktop: [1280, 720],
    laptop: [1440, 900],
    'desktop-hd': [1920, 1080],
  };
  for (const [key, [width, height]] of Object.entries(sizes)) {
    const d = DEVICES[key];
    assert.ok(d, `${key} is defined`);
    assert.equal(d.engine, 'chromium');
    assert.equal(d.phone, false);
    assert.deepEqual(d.descriptor.viewport, { width, height });
    assert.equal(d.descriptor.isMobile, false);
    assert.equal(d.descriptor.hasTouch, false);
    assert.equal(d.descriptor.deviceScaleFactor, 1);
  }
});

test('--device takes the new desktops and all lists every device', () => {
  assert.deepEqual(parseArgs(['--device', 'iphone,laptop,desktop-hd']).devices, [
    'iphone',
    'laptop',
    'desktop-hd',
  ]);
  assert.deepEqual(parseArgs(['--device', 'all']).devices, Object.keys(DEVICES));
});

test('an unknown device names every valid one', () => {
  assert.throws(
    () => parseArgs(['--device', 'ipad']),
    /unknown device ipad \(iphone, android, desktop, laptop, desktop-hd, all\)/,
  );
});

test('the help line lists every device', () => {
  assert.match(readHelp(), /--device iphone\|android\|desktop\|laptop\|desktop-hd\|all/);
});
