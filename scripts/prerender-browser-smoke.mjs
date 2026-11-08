// Run against the built app on a host with sockets. --before captures the
// unchanged branch on an identically seeded server for side-by-side review.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const base = process.argv.includes('--base') ? arg('--base') : null;
if (!base) throw new Error('Pass --base pointing to the built local app');
const output = process.argv.includes('--output')
  ? arg('--output')
  : join(tmpdir(), 'mistboard-prerender-957');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const targets = [['after', base]];
  if (process.argv.includes('--before')) targets.unshift(['before', arg('--before')]);
  for (const [label, origin] of targets) {
    for (const path of ['/about', '/practice']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 1.6e6 / 8,
        uploadThroughput: 750e3 / 8,
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const response = await page.goto(new URL(path, origin).href, {
        waitUntil: 'domcontentloaded',
      });
      assert.equal(response.status(), 200);
      if (label === 'after') assert.match(await response.text(), /class="crawler-copy"/);
      await page.waitForFunction(
        () => document.querySelector('#app h1') && !document.querySelector('#app .crawler-copy'),
      );
      assert.ok(await page.locator('#app h1').textContent());
      await page.screenshot({
        path: join(output, `${label}-${path.slice(1)}.png`),
        fullPage: true,
      });
      // The same served HTML remains protected while all scripts are blocked.
      if (label === 'after') {
        const noScript = await context.newPage();
        await noScript.route('**/*', (route) =>
          route.request().resourceType() === 'script' ? route.abort() : route.continue(),
        );
        await noScript.goto(new URL(path, origin).href, { waitUntil: 'commit' });
        await noScript.locator('.crawler-copy').waitFor({ state: 'attached' });
        assert.equal(
          await noScript.locator('.crawler-copy').evaluate((el) => getComputedStyle(el).visibility),
          'hidden',
        );
        await noScript.locator('.crawler-copy').waitFor({ state: 'visible', timeout: 8000 });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`Prerender takeover and screenshots: ${output}`);
