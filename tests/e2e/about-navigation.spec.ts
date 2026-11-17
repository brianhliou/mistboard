/// <reference types="vite/client" />
import { expect, type Page, test } from '@playwright/test';
import { ABOUT_NAV_GROUPS } from '../../apps/web/src/about-nav-items';

const pages = ABOUT_NAV_GROUPS.flat().filter((item) => !('leavesRail' in item));
// A destination is prepared in a hidden staging root that briefly holds a
// second rail, so the active-link locators below match visible links only.
const canonicalHref = () =>
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
const regions = '.site-nav, .static-page-rail-shell, .static-page-rail, .static-page-rail-link';

async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

test('About rail keeps every header and rail box stable between pages and through history', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/about');
  await expect(
    page.locator('.static-page-rail-link[data-static-page-link]').first(),
  ).toBeAttached();
  await settled(page);
  const header = await page.locator('.site-nav').elementHandle();
  const rail = await page.locator('.static-page-rail').elementHandle();
  let documentLoads = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads++;
  });

  for (const { href } of [...pages.slice(1), pages[0]!]) {
    const link = page.locator(`.static-page-rail-link[href="${href}"]`);
    // Deliberately position the phone strip before measuring. Clicking the
    // destination must not rebuild it or reveal the active item a second time.
    await link.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'center' }));
    await settled(page);
    const before = await page
      .locator(regions)
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    const scrollLeft = await rail!.evaluate((node) => node.scrollLeft);
    await page.evaluate((selector) => {
      const nodes = [...document.querySelectorAll(selector)];
      const baseline = nodes.map((node) => node.getBoundingClientRect().toJSON());
      const samples: unknown[] = [];
      let running = true;
      const sample = () => {
        if (!running) return;
        const boxes = nodes.map((node) => node.getBoundingClientRect().toJSON());
        if (JSON.stringify(boxes) !== JSON.stringify(baseline)) samples.push(boxes);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      Object.assign(window, {
        stopAboutBoxProbe: () => {
          running = false;
          return samples;
        },
      });
    }, regions);
    await link.click();
    await expect(
      page.locator('.static-page-rail-link[aria-current="page"]:visible'),
    ).toHaveAttribute('href', href);
    await settled(page);
    expect(await header!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await rail!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await rail!.evaluate((node) => node.scrollLeft)).toBe(scrollLeft);
    expect(
      await page
        .locator(regions)
        .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON())),
    ).toEqual(before);
    expect(
      await page.evaluate(() =>
        (window as unknown as { stopAboutBoxProbe(): unknown[] }).stopAboutBoxProbe(),
      ),
    ).toEqual([]);
    expect(new URL(page.url()).pathname).toBe(href);
  }
  await page.goBack();
  await expect(page.locator('.static-page-rail-link[aria-current="page"]:visible')).toHaveAttribute(
    'href',
    '/thanks',
  );
  await page.goForward();
  await expect(page.locator('.static-page-rail-link[aria-current="page"]:visible')).toHaveAttribute(
    'href',
    '/about',
  );
  expect(documentLoads).toBe(0);
});

test('every rail destination retains its direct-link title and canonical after a rail visit', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const direct = await context.newPage();
  try {
    await page.goto('/about');
    await expect(page.locator('[data-static-page-link]').first()).toBeAttached();
    for (const { href } of pages) {
      await direct.goto(href);
      await expect(
        direct.locator('.static-page-rail-link[aria-current="page"]:visible'),
      ).toHaveAttribute('href', href);
      await settled(direct);
      const title = await direct.title();
      // The Vite dev shell serves no canonical; production serves one per route.
      const canonical = await direct.evaluate(canonicalHref);
      await page
        .locator(`.static-page-rail-link[href="${href}"]`)
        .evaluate((node) => (node as HTMLAnchorElement).click());
      await expect(
        page.locator('.static-page-rail-link[aria-current="page"]:visible'),
      ).toHaveAttribute('href', href);
      await expect(page).toHaveTitle(title);
      await expect.poll(() => page.evaluate(canonicalHref)).toBe(canonical);
    }
  } finally {
    await direct.close();
  }
});
