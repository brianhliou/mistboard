import { expect, type Page, test } from '@playwright/test';

import { capture, expectNoErrors, trackPageErrors } from './support';

// Port of scripts/auth-nav-smoke.mjs, driven the way a player signs in: from a
// page, through the nav's Sign in link. Needs the
// persistent (Postgres) server: dev auth auto-fills the code only there, and
// the session must survive a reload.
//
// What changed since that script, and is asserted here instead: nav labels are
// CSS-uppercased (match by role, not innerText), and sign-in lands on home
// (or on ?referrer=, which in-context prompts set; the nav link does not), not
// on /account.
//
// One sign-in per run on purpose. Auth rate limits live in Postgres, so every
// local pair on this machine shares them: 3 code requests per email per 10 min
// (hence a fresh email per run) and 10 confirms per IP per 10 min across ALL
// local sign-ins (seeders, study smoke, other sessions). A 429 here reads
// "Too many attempts" on the form; wait out the window.

const EMAIL = process.env.E2E_AUTH_EMAIL ?? `e2e-auth+${Date.now()}-${process.pid}@example.com`;

test.skip(({ isMobile }) => isMobile, 'nav auth state is width-independent');

test('nav sign-in flips the nav, lands home, survives a reload', async ({ page }, testInfo) => {
  const me = await page.request.get('/api/auth/me');
  expect(
    me.ok(),
    'auth API unreachable: run the persistent pair (npm run db:up, db:migrate, dev:persistent)',
  ).toBe(true);

  const errors = trackPageErrors(page);
  await page.goto('/puzzles');
  const nav = page.locator('.site-nav-auth');
  await expect(nav.getByRole('link', { name: /^register$/i })).toBeVisible();
  await expect(page.locator('.account-nav-trigger')).toHaveCount(0);
  await capture(page, testInfo, 'auth-signed-out');

  await nav.getByRole('link', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/account');
  await signIn(page);

  await expect(page).toHaveURL((url) => url.pathname === '/');
  const trigger = page.locator('.account-nav-trigger');
  await expect(trigger).toBeVisible();
  await expect(trigger).not.toHaveText('');
  await expect(page.locator('.site-nav-link-signin')).toHaveCount(0);
  await capture(page, testInfo, 'auth-signed-in');

  await page.reload();
  await expect(page.locator('.account-nav-trigger')).toBeVisible();
  const body = (await (await page.request.get('/api/auth/me')).json()) as {
    user?: { handle?: string } | null;
  };
  const handle = body.user?.handle;
  expect(handle, 'the session cookie resolves to an account').toBeTruthy();
  await expect(page.locator('.account-nav-trigger')).toContainText(handle as string);

  // Signed in, /account is the settings page, not the sign-in form.
  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 1, name: 'Edit profile' })).toBeVisible();
  await expect(page.locator('form.account-form input[name=email]')).toHaveCount(0);
  await capture(page, testInfo, 'auth-account-page');
  expectNoErrors(errors);
});

async function signIn(page: Page): Promise<void> {
  // Filling before the client wires the form lets the browser submit it
  // natively and reload the page, so let the page settle first.
  await page.waitForLoadState('networkidle');
  const form = page.locator('form.account-form');
  await form.locator('input[name=email]').fill(EMAIL);
  await form.locator('button[type=submit]').click();
  const code = page.locator('input[name=code]:visible');
  const refusal = form.locator('.account-status[data-state="error"]');
  await expect(code.or(refusal)).toBeVisible();
  // Name the refusal (rate limit, auth API down) instead of timing out on it.
  if (await refusal.isVisible()) throw new Error(`sign-in refused: ${await refusal.innerText()}`);
  // Dev auth returns the code in the response and the form fills it; empty
  // means the server is not a local dev pair.
  await expect(code).not.toHaveValue('');
  await form.locator('button[type=submit]').click();
}
