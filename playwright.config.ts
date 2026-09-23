import { execFileSync } from 'node:child_process';

import { defineConfig } from '@playwright/test';

// Browser e2e suite: the checks sessions used to re-drive by hand, frozen as
// specs (tests/e2e/). Lives at the repo root because it drives the whole stack
// (server + web pair from scripts/dev.mjs), and @playwright/test, the smoke
// scripts and CI's `npx playwright install` all sit at the root too.
//
// Target:
//   E2E_BASE_URL set    -> run against that server, start nothing.
//   E2E_BASE_URL unset  -> start the persistent pair like CI's browser-smoke job
//                          does for study-creator-persistent-smoke.mjs:
//                          `npm run dev:persistent` on MISTBOARD_DEV_PORT_BASE
//                          (web = base, server = base + 1; default 3000, the
//                          pinned pair), after `npm run db:migrate`.
// Postgres must be up first: `npm run db:up` locally, the 5435 service in CI.
// The persistent server is required, not optional: auth, game history and
// review read from Postgres, and the no-DB pair 503s them.
//
// An occupied port fails the run; the suite never reuses or shifts to a server
// it did not start (another checkout's pair serves a stale tree). If a pair is
// already up, point at it explicitly:
//   E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
// or start a fresh one on a free block:
//   MISTBOARD_DEV_PORT_BASE=3040 npm run test:e2e
// Two-terminal equivalent: `MISTBOARD_DEV_PORT_BASE=3040 npm run dev:persistent`
// in one, `E2E_BASE_URL=http://127.0.0.1:3040 npm run test:e2e` in the other.
//
// Not here: the in-browser engine gate (`prod:smoke:ceval`), a release gate
// that scripts/release-prod.mjs runs against the deployed build.
//
// Screenshots land in test-results/screenshots/<project>/ (full page, for a
// human or agent to read); video and trace are kept for every test. No pixel
// baselines: live data and seeded content move, so specs assert structure.

const externalBaseUrl = process.env.E2E_BASE_URL?.trim().replace(/\/+$/, '') || null;
const portBase = parsePortBase(process.env.MISTBOARD_DEV_PORT_BASE);
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${portBase}`;

// The runner process only (workers re-load this file while our own server
// holds the ports): name whatever already listens on the pair we would start.
if (!externalBaseUrl && process.env.TEST_WORKER_INDEX === undefined) {
  assertPortsFree([portBase, portBase + 1]);
}

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  // Vite compiles modules on first request, so a cold page is slow once.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'on',
    video: 'on',
    screenshot: 'only-on-failure',
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } },
    },
    {
      // The phone column visual-check.mjs and mobile-loop.mjs covered (390 wide).
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run db:migrate && npm run dev:persistent',
        url: `${baseURL}/api/auth/me`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          MISTBOARD_DEV_PORT_BASE: String(portBase),
          BROWSER: 'none',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
        stdout: 'ignore',
        stderr: 'pipe',
        gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      },
});

function assertPortsFree(ports: number[]): void {
  const listeners = ports.map((port) => listenerOn(port)).filter(Boolean);
  if (listeners.length === 0) return;
  throw new Error(
    [
      `e2e: the pair on ${ports.join('/')} is already taken; this suite starts its own server.`,
      ...listeners,
      `Test that pair on purpose:  E2E_BASE_URL=http://127.0.0.1:${ports[0]} npm run test:e2e`,
      'Or start a fresh pair:      MISTBOARD_DEV_PORT_BASE=<free base> npm run test:e2e',
    ].join('\n'),
  );
}

// lsof exits 1 when nothing listens; a missing lsof (bare CI image) skips the
// check and leaves Playwright's own "already used" check in place.
function listenerOn(port: number): string | null {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() ? `port ${port}:\n${out.trim()}` : null;
  } catch {
    return null;
  }
}

function parsePortBase(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 3000;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1024 || value > 65_534) {
    throw new Error(`MISTBOARD_DEV_PORT_BASE must be an integer in [1024, 65534], got "${raw}"`);
  }
  return value;
}
