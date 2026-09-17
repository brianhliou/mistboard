// Headless engine smoke: proves every in-browser analysis backend actually RUNS
// end-to-end against prod, not just that their assets serve. This is the check
// that would have caught the 2026-07-06 prod outage (five stacked
// serving/isolation bugs, all hidden behind green deploys because nothing
// exercised a real search).
//
// Backends (see apps/web/src/review/engine/):
//   fsf   - Fairy-Stockfish pthread wasm on /analysis/xiangqi,
//           /analysis/fortress-xiangqi and /analysis/atomic-xiangqi (needs
//           COOP/COEP cross-origin isolation + SharedArrayBuffer). ceval.ts.
//           The atomic board is gated on BEHAVIOUR: the vendored build is
//           patched for atomic's rules, and a stock build loads the same .ini
//           without complaint and plays a different game.
//   misty - Misty single-threaded wasm on /analysis/jungle,
//           /analysis/jungle-flip, plus MistyBanqi on a finished banqi game's
//           review page. The game id is DISCOVERED at runtime from the public
//           /api/watch?channel=banqi feed, never hardcoded.
//           Note: the review document carries COEP, so the dedicated worker
//           script must itself be served with a compatible COEP header or
//           Chrome blocks the load (net::ERR_BLOCKED_BY_RESPONSE) - the exact
//           class that broke FSF on 2026-07-06. A header preflight asserts
//           this before the browser run so the failure names the real cause.
//   pika  - PikaJieQi pthread wasm on /analysis/jieqi. This exercises the
//           redacted Jieqi FEN, persistent UCI worker, and streaming MultiPV.
//
// Each check: load the page, mount the board/panel, toggle the engine on, and
// wait for a real eval + at least one PV line. Fails on engine console errors.
//
// Usage: node scripts/prod-ceval-smoke.mjs [--backend fsf|misty|pika|all]
// Defaults to prod + all backends; point MISTBOARD_WEB_URL at a local build to
// smoke locally. MISTBOARD_CEVAL_SMOKE_BACKEND is the env equivalent.
import { readFileSync } from 'node:fs';

import { launchChromium } from './lib/launch-browser.mjs';

const options = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(
  options.baseUrl ?? process.env.MISTBOARD_WEB_URL ?? 'https://mistboard.com',
);
const timeoutMs = Number(process.env.MISTBOARD_CEVAL_SMOKE_TIMEOUT_MS ?? 45000);
const moves = process.env.MISTBOARD_CEVAL_SMOKE_MOVES ?? 'b3e3,h8e8,b1c3';
const backend = options.backend;

const browserArgs = [];
if (baseUrl.startsWith('http://') && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::|$)/.test(baseUrl)) {
  // Docker-based local smoke reaches the host through a LAN/bridge address.
  // Treat only that explicitly supplied origin as secure so COOP/COEP can
  // create the same cross-origin-isolated environment as production HTTPS.
  browserArgs.push(`--unsafely-treat-insecure-origin-as-secure=${baseUrl}`);
}
const browser = await launchChromium({ args: browserArgs });
const failures = [];
try {
  if (backend === 'fsf' || backend === 'all') {
    await runCheck('fsf', () => checkFsf(browser));
  }
  if (backend === 'misty' || backend === 'all') {
    await runCheck('misty', () => checkMisty(browser));
  }
  if (backend === 'pika' || backend === 'all') {
    await runCheck('pika', () => checkPika(browser));
  }
} finally {
  await browser.close();
}
if (failures.length > 0) process.exitCode = 1;

async function runCheck(name, fn) {
  try {
    const result = await fn();
    console.log(JSON.stringify({ ok: true, check: name, baseUrl, ...result }));
  } catch (err) {
    failures.push(name);
    console.error(
      JSON.stringify({ ok: false, check: name, baseUrl, error: err?.message ?? String(err) }),
    );
  }
}

// ── Fairy-Stockfish on the standalone analysis board ────────────────────────
async function checkFsf(browser) {
  const xiangqi = await checkFsfAnalysisSurface(browser, {
    slug: 'xiangqi',
    query: `?moves=${encodeURIComponent(moves)}`,
    boardSelector: '.xiangqi-live-board svg',
  });
  const fortressXiangqi = await checkFsfAnalysisSurface(browser, {
    slug: 'fortress-xiangqi',
    boardSelector: '.fortress-xiangqi-live-board svg',
  });
  const atomicXiangqi = await checkAtomicXiangqiPatched(browser);
  const nnue = await checkXiangqiNnueLoaded(browser);
  return { surfaces: { xiangqi, fortressXiangqi, atomicXiangqi }, nnue };
}

/**
 * Assert the browser engine plays ATOMIC xiangqi, not xiangqi with an .ini it
 * half-understood.
 *
 * The vendored Fairy-Stockfish is built with fairy-stockfish-atomic-xiangqi.patch
 * (the bot's patch); stock Fairy-Stockfish ignores the four options it adds and
 * loads the variant anyway, so an asset-level check cannot tell the two apart.
 * The probe is the blast gate railpack runs on the native binary: a red chariot
 * on the advisor file with nothing between it and the black advisor. Under the
 * patch, taking the advisor blows up the general beside it, mate in one; a
 * build that half-loaded the stanza reads it as a quiet position.
 */
async function checkAtomicXiangqiPatched(browser) {
  const probeFen = '3ak4/9/9/9/9/9/9/3R5/9/4K4 w - - 0 1';
  const url = `${baseUrl}/analysis/atomic-xiangqi?fen=${encodeURIComponent(probeFen)}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const errors = collectErrors(page);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok())
      throw new Error(`${url} returned HTTP ${response?.status() ?? 'no response'}`);
    await page
      .locator('.xiangqi-live-board svg')
      .first()
      .waitFor({ state: 'attached', timeout: timeoutMs });
    await toggleEngineOn(page);
    await waitForEvalAndLines(page);
    const panel = await readPanel(page);
    if (panel.eval !== '#1') {
      throw new Error(
        `atomic xiangqi analysis reads ${JSON.stringify(panel.eval)} where the chariot takes the advisor and ` +
          'blows up the general (#1): the browser engine is not the patched build, or atomic-xiangqi.ini ' +
          'did not load (apps/web/public/engine/fairy-stockfish/README.md).',
      );
    }
    assertNoFatalErrors(errors);
    return { url, eval: panel.eval, lines: panel.lines };
  } finally {
    await page.close();
  }
}

/**
 * Assert the browser xiangqi engine is actually running on its NNUE net.
 *
 * This is a RELEASE GATE, not a nicety. `loadXiangqiNet` in ceval.ts falls back
 * to the classical evaluation when the net cannot be fetched, deliberately, so
 * that a CDN miss degrades the analysis instead of taking the engine panel down.
 * The cost of that choice is that a 404 on the 11MB asset is invisible: the
 * board keeps answering, just with the evaluation that could not tell a won
 * basic endgame from a drawn one in 15 of 32 corpus positions (#363).
 *
 * So this asserts on BEHAVIOUR rather than on the asset alone. The 200 check
 * names the cause when it breaks; the evaluation check is what actually proves
 * the engine is using it, because a fetched-but-unloaded net would still pass a
 * network assertion.
 */
async function checkXiangqiNnueLoaded(browser) {
  // A dead-drawn basic endgame: a red soldier stranded on the last rank, where
  // it can only shuffle sideways, plus an elephant that cannot mate either.
  // Declared here rather than at module scope because the checks run as
  // top-level await ABOVE this point, and a module-level const is still in its
  // temporal dead zone when they do.
  const probeFen = '5P3/9/3k5/9/9/2B6/9/9/9/4K4 w - - 17 17';
  // Classical FSF reads this +0.7 ("Red is better"); with the net it reads 0.0.
  const maxAbsEval = 0.3;
  const assetUrl = `${baseUrl}/engine/fairy-stockfish/${xiangqiNnueNet()}?v=${encodeURIComponent(fsfAssetVersion())}`;
  const asset = await fetch(assetUrl, { method: 'HEAD' });
  if (!asset.ok) {
    throw new Error(
      `${assetUrl} returned HTTP ${asset.status}: the xiangqi NNUE net is not being served, so ` +
        'every xiangqi board silently falls back to the classical evaluation (#363).',
    );
  }

  const url = `${baseUrl}/analysis/xiangqi?fen=${encodeURIComponent(probeFen)}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const errors = collectErrors(page);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok())
      throw new Error(`${url} returned HTTP ${response?.status() ?? 'no response'}`);
    await page
      .locator('.xiangqi-live-board svg')
      .first()
      .waitFor({ state: 'attached', timeout: timeoutMs });
    await toggleEngineOn(page);
    await waitForEvalAndLines(page);
    const panel = await readPanel(page);
    const score = Number.parseFloat(String(panel.eval ?? '').replace(/[^\d.+-]/g, ''));
    if (!Number.isFinite(score)) {
      throw new Error(
        `could not read an evaluation from the panel (got ${JSON.stringify(panel.eval)})`,
      );
    }
    if (Math.abs(score) > maxAbsEval) {
      throw new Error(
        `xiangqi analysis reads ${panel.eval} on a dead-drawn endgame; with the NNUE net it reads about 0.0, ` +
          'so the engine is running its classical evaluation. The net was served but did not load: ' +
          'check the FS.writeFile / EvalFile path in loadXiangqiNet (apps/web/src/review/engine/ceval.ts).',
      );
    }
    assertNoFatalErrors(errors);
    return { url, eval: panel.eval, netUrl: assetUrl };
  } finally {
    await page.close();
  }
}

async function checkFsfAnalysisSurface(browser, { slug, query = '', boardSelector }) {
  const url = `${baseUrl}/analysis/${slug}${query}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const errors = collectErrors(page);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok())
      throw new Error(`${url} returned HTTP ${response?.status() ?? 'no response'}`);

    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated === true);
    if (!isolated) {
      throw new Error(
        'page is not cross-origin isolated: COOP/COEP missing, so SharedArrayBuffer (and the WASM engine) is unavailable',
      );
    }

    // The board must reconstruct from the pasted move list.
    await page.locator(boardSelector).first().waitFor({ state: 'attached', timeout: timeoutMs });

    await toggleEngineOn(page);
    await waitForEvalAndLines(page);
    await waitForBestMoveArrow(page);
    const result = await readPanel(page);
    assertNoFatalErrors(errors);
    return { url, ...result };
  } finally {
    await page.close();
  }
}

// ── MistyBanqi wasm on a finished banqi game's review page ──────────────────
async function checkMisty(browser) {
  // Preflight: the review document is served with COEP, so the dedicated
  // worker script must carry a compatible COEP of its own or Chrome refuses to
  // start it. Assert the served headers first so a regression fails with the
  // real cause instead of an opaque "worker error".
  await assertMistyAssetHeaders('misty-banqi', 'banqi_wasm');
  await assertMistyAssetHeaders('misty-jungle', 'jungle_wasm');
  await assertMistyAssetHeaders('misty-jungle-flip', 'jungle_flip_wasm');

  const jungle = await checkMistyJungle(browser);
  const jungleFlip = await checkMistyJungleFlip(browser);
  const banqi = await checkMistyBanqiAnalysis(browser);
  const banqiGame = await checkMistyBanqiGame(browser);
  return { surfaces: { jungle, jungleFlip, banqi, banqiGame } };
}

async function checkMistyJungle(browser) {
  const url = `${baseUrl}/analysis/jungle`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const errors = collectErrors(page);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok())
      throw new Error(`${url} returned HTTP ${response?.status() ?? 'no response'}`);

    await page
      .locator('.jungle-live-board svg')
      .first()
      .waitFor({ state: 'attached', timeout: timeoutMs });
    await toggleEngineOn(page);
    await waitForEvalAndLines(page);
    await waitForBestMoveArrow(page);
    const result = await readPanel(page);
    const continuous = await exerciseContinuousAnalysis(page, 8);
    const engineNamed = await page.evaluate(() =>
      (document.querySelector('.engine-panel')?.textContent ?? '').includes('MistyJungle'),
    );
    if (!engineNamed) throw new Error('engine panel did not name MistyJungle');
    assertNoFatalErrors(errors);
    return { url, engine: 'MistyJungle', ...result, continuous };
  } finally {
    await page.close();
  }
}

async function checkMistyJungleFlip(browser) {
  const url = `${baseUrl}/analysis/jungle-flip`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const errors = collectErrors(page);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok())
      throw new Error(`${url} returned HTTP ${response?.status() ?? 'no response'}`);

    await page
      .locator('.jungle-flip-live-board svg')
      .first()
      .waitFor({ state: 'attached', timeout: timeoutMs });
    await toggleEngineOn(page);
    await waitForEvalAndLines(page);
    await waitForBestMoveIndicator(page);
    const result = await readPanel(page);
    const continuous = await exerciseContinuousAnalysis(page, 3);
    const engineNamed = await page.evaluate(() =>
      (document.querySelector('.engine-panel')?.textContent ?? '').includes('MistyJungleFlip'),
    );
    if (!engineNamed) throw new Error('engine panel did not name MistyJungleFlip');
    assertNoFatalErrors(errors);
    return { url, engine: 'MistyJungleFlip', ...result, continuous };
  } finally {
    await page.close();
  }
}

async function checkMistyBanqiAnalysis(browser) {
  const url = `${baseUrl}/analysis/banqi`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const errors = collectErrors(page);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok())
      throw new Error(`${url} returned HTTP ${response?.status() ?? 'no response'}`);

    await page
      .locator('.banqi-live-board svg')
      .first()
      .waitFor({ state: 'attached', timeout: timeoutMs });
    await toggleEngineOn(page);
    await waitForEvalAndLines(page);
    await waitForBestMoveIndicator(page);
    const result = await readPanel(page);
    const continuous = await exerciseContinuousAnalysis(page, 2);
    const engineNamed = await page.evaluate(() =>
      (document.querySelector('.engine-panel')?.textContent ?? '').includes('MistyBanqi'),
    );
    if (!engineNamed) throw new Error('engine panel did not name MistyBanqi');
    assertNoFatalErrors(errors);
    return { url, engine: 'MistyBanqi', ...result, continuous };
  } finally {
    await page.close();
  }
}

async function checkMistyBanqiGame(browser) {
  const roomId = await discoverFinishedBanqiGame();
  if (!roomId) {
    // Watch feed had no finished banqi game to open (feed drained). The asset
    // preflight above already passed; report the degraded mode loudly instead
    // of failing a deploy on missing content.
    return { mode: 'assets-only', reason: 'no finished banqi game in /api/watch?channel=banqi' };
  }

  const url = `${baseUrl}/banqi/game/${encodeURIComponent(roomId)}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const errors = collectErrors(page);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok())
      throw new Error(`${url} returned HTTP ${response?.status() ?? 'no response'}`);

    await page.locator('.engine-panel').waitFor({ state: 'attached', timeout: timeoutMs });

    await toggleEngineOn(page);
    const finalState = await waitForEvalOrGameOver(page);
    // A rules-terminal final position has no root move to search. The review
    // panel must say so instead of sending Misty's single-shot engine into a
    // non-returning search. Step back to prove the same enabled panel resumes.
    if (finalState === 'game-over') {
      await page.keyboard.press('ArrowLeft');
      await waitForEvalAndLines(page);
    }
    await waitForBestMoveIndicator(page);
    const result = await readPanel(page);

    // Prove the Misty backend answered, not FSF: the panel names its engine.
    const engineNamed = await page.evaluate(() =>
      (document.querySelector('.engine-panel')?.textContent ?? '').includes('MistyBanqi'),
    );
    if (!engineNamed) throw new Error('engine panel did not name MistyBanqi');
    assertNoFatalErrors(errors);
    return { url, engine: 'MistyBanqi', ...result };
  } finally {
    await page.close();
  }
}

async function discoverFinishedBanqiGame() {
  const feedUrl = `${baseUrl}/api/watch?channel=banqi`;
  const response = await fetch(feedUrl);
  if (!response.ok) {
    // The in-memory local server has no persistence-backed watch feed. Let its
    // browser smoke continue in assets-only Banqi mode, while HTTPS staging and
    // production still fail closed on an unavailable feed.
    if (baseUrl.startsWith('http://') && response.status === 503) return null;
    throw new Error(`${feedUrl} returned HTTP ${response.status}`);
  }
  const feed = await response.json();
  const game = (feed.unlocked ?? []).find((entry) => typeof entry.roomId === 'string');
  return game?.roomId ?? null;
}

// ── PikaJieQi wasm on the standalone Jieqi analysis board ──────────
async function checkPika(browser) {
  await assertPikaAssetHeaders();

  const url = `${baseUrl}/analysis/jieqi`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const errors = collectErrors(page);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (!response?.ok())
      throw new Error(`${url} returned HTTP ${response?.status() ?? 'no response'}`);

    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated === true);
    if (!isolated) {
      throw new Error(
        'Jieqi analysis page is not cross-origin isolated, so PikaJieQi pthread wasm is unavailable',
      );
    }

    await page
      .locator('.jieqi-live-board svg')
      .first()
      .waitFor({ state: 'attached', timeout: timeoutMs });
    await toggleEngineOn(page);
    await waitForEvalAndLines(page);
    await waitForBestMoveArrow(page);
    const result = await readPanel(page);
    const engineNamed = await page.evaluate(() =>
      (document.querySelector('.engine-panel')?.textContent ?? '').includes('PikaJieQi'),
    );
    if (!engineNamed) throw new Error('engine panel did not name PikaJieQi');
    assertNoFatalErrors(errors);
    return { url, engine: 'PikaJieQi', ...result };
  } finally {
    await page.close();
  }
}

// Preflight the exact versioned URLs the client fetches (?v= from
// MISTY_ASSET_VERSION in misty-ceval.ts, read from source so it always matches
// the deployed revision). The bare path is a DIFFERENT edge-cache key and can
// hold a stale header-less copy long after a fix deploys, which is exactly the
// false signal this smoke exists to prevent: worker script must be JS with a
// COEP the isolated review document accepts; the wasm must serve as
// application/wasm.
// The vendored net's filename and the engine asset generation both live in
// ceval.ts; read them from source so a rename or a cache-bust cannot leave this
// gate probing a URL that no longer exists and passing on the 404 check alone.
function fsfSource() {
  return readFileSync(new URL('../apps/web/src/review/engine/ceval.ts', import.meta.url), 'utf8');
}

function fsfAssetVersion() {
  const match = fsfSource().match(/ENGINE_ASSET_VERSION = '([^']+)'/);
  if (!match) throw new Error('ENGINE_ASSET_VERSION not found in ceval.ts');
  return match[1];
}

function xiangqiNnueNet() {
  const match = fsfSource().match(/XIANGQI_NNUE_NET = '([^']+)'/);
  if (!match) throw new Error('XIANGQI_NNUE_NET not found in ceval.ts');
  return match[1];
}

function mistyAssetVersion() {
  const source = readFileSync(
    new URL('../apps/web/src/review/engine/misty-ceval.ts', import.meta.url),
    'utf8',
  );
  const match = source.match(/MISTY_ASSET_VERSION = '([^']+)'/);
  if (!match) throw new Error('MISTY_ASSET_VERSION not found in misty-ceval.ts');
  return match[1];
}

async function assertMistyAssetHeaders(packageName, moduleName) {
  const v = encodeURIComponent(mistyAssetVersion());
  const workerUrl = `${baseUrl}/engine/${packageName}/worker.js?v=${v}`;
  const worker = await fetch(workerUrl);
  if (!worker.ok) throw new Error(`${workerUrl} returned HTTP ${worker.status}`);
  const workerType = worker.headers.get('content-type') ?? '';
  if (!/javascript/.test(workerType)) {
    throw new Error(`${workerUrl} content-type is ${workerType || 'missing'}, expected javascript`);
  }
  const coep = worker.headers.get('cross-origin-embedder-policy');
  if (coep !== 'require-corp' && coep !== 'credentialless') {
    throw new Error(
      `${workerUrl} is served without a compatible Cross-Origin-Embedder-Policy (got ${coep ?? 'none'}); ` +
        'the COEP review document blocks the worker load (net::ERR_BLOCKED_BY_RESPONSE). ' +
        'Serve /engine/misty-*/ assets with COEP like the /engine/fairy-stockfish/ branch in apps/server/src/server-http.ts.',
    );
  }

  const wasmUrl = `${baseUrl}/engine/${packageName}/${moduleName}_bg.wasm?v=${v}`;
  const wasm = await fetch(wasmUrl, { method: 'HEAD' });
  if (!wasm.ok) throw new Error(`${wasmUrl} returned HTTP ${wasm.status}`);
  const wasmType = wasm.headers.get('content-type') ?? '';
  if (!wasmType.includes('application/wasm')) {
    throw new Error(
      `${wasmUrl} content-type is ${wasmType || 'missing'}, expected application/wasm`,
    );
  }
}

function pikaAssetVersion() {
  const source = readFileSync(
    new URL('../apps/web/src/review/engine/pikajieqi-ceval.ts', import.meta.url),
    'utf8',
  );
  const match = source.match(/ENGINE_ASSET_VERSION = '([^']+)'/);
  if (!match) throw new Error('ENGINE_ASSET_VERSION not found in pikajieqi-ceval.ts');
  return match[1];
}

async function assertPikaAssetHeaders() {
  const v = encodeURIComponent(pikaAssetVersion());
  const workerUrl = `${baseUrl}/engine/pikafish-jieqi/worker.js?v=${v}`;
  const worker = await fetch(workerUrl);
  if (!worker.ok) throw new Error(`${workerUrl} returned HTTP ${worker.status}`);
  const workerType = worker.headers.get('content-type') ?? '';
  if (!/javascript/.test(workerType)) {
    throw new Error(`${workerUrl} content-type is ${workerType || 'missing'}, expected javascript`);
  }
  const coep = worker.headers.get('cross-origin-embedder-policy');
  if (coep !== 'require-corp' && coep !== 'credentialless') {
    throw new Error(
      `${workerUrl} is served without a compatible Cross-Origin-Embedder-Policy (got ${coep ?? 'none'})`,
    );
  }

  const wasmUrl = `${baseUrl}/engine/pikafish-jieqi/pikajieqi.wasm?v=${v}`;
  const wasm = await fetch(wasmUrl, { method: 'HEAD' });
  if (!wasm.ok) throw new Error(`${wasmUrl} returned HTTP ${wasm.status}`);
  const wasmType = wasm.headers.get('content-type') ?? '';
  if (!wasmType.includes('application/wasm')) {
    throw new Error(
      `${wasmUrl} content-type is ${wasmType || 'missing'}, expected application/wasm`,
    );
  }
}

// ── shared page steps ────────────────────────────────────────────────────────
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('requestfailed', (request) => {
    errors.push(`${request.url()} ${request.failure()?.errorText ?? 'request failed'}`);
  });
  return errors;
}

// Toggle the engine on. Programmatic click fires the handler synchronously and
// sets aria-checked, so we can assert the switch actually engaged. The panel head
// is a lichess-style switch (button.engine-panel__switch, role=switch) with no
// text label since 2026-07-16 — select by class, not by "Engine" text.
async function toggleEngineOn(page) {
  const engaged = await page.evaluate(() => {
    const button = document.querySelector('button.engine-panel__switch');
    if (!button) return { ok: false, reason: 'engine toggle button not found' };
    if (button.disabled)
      return { ok: false, reason: 'engine toggle is disabled (engine reported unsupported)' };
    button.click();
    return { ok: button.getAttribute('aria-checked') === 'true', reason: 'toggle did not engage' };
  });
  if (!engaged.ok) throw new Error(engaged.reason);
}

// The engine must return a real eval and at least one principal variation.
async function waitForEvalAndLines(page) {
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('.engine-panel');
      const evalText = panel?.querySelector('.engine-panel__eval')?.textContent?.trim();
      const lineCount = panel?.querySelectorAll('.engine-panel__line').length ?? 0;
      return Boolean(evalText) && lineCount >= 1;
    },
    { timeout: timeoutMs },
  );
}

async function waitForBestMoveArrow(page) {
  await page.locator('.xq-arrow--pv1').first().waitFor({ state: 'attached', timeout: timeoutMs });
}

async function waitForBestMoveIndicator(page) {
  await page
    .locator('.xq-arrow--pv1, .engine-marker--pv1')
    .first()
    .waitFor({ state: 'attached', timeout: timeoutMs });
}

async function exerciseContinuousAnalysis(page, minDepth) {
  await page.locator('.engine-panel__gear').click();
  const row = page.locator('.engine-panel__setting').filter({ hasText: 'Search effort' });
  const slider = row.locator('input[type="range"]');
  await slider.evaluate((input) => {
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    (requiredDepth) => {
      const status = document.querySelector('.engine-panel__sub')?.textContent ?? '';
      const depth = Number(/\bDepth\s+(\d+)/.exec(status)?.[1] ?? 0);
      return status.includes('analyzing') && depth >= requiredDepth;
    },
    minDepth,
    { timeout: timeoutMs },
  );
  await waitForEvalAndLines(page);
  const result = await readPanel(page);
  await page.locator('button.engine-panel__switch').click();
  await page.waitForFunction(
    () =>
      document.querySelector('button.engine-panel__switch')?.getAttribute('aria-checked') ===
      'false',
    { timeout: timeoutMs },
  );
  return { ...result, stopped: true };
}

async function waitForEvalOrGameOver(page) {
  return page
    .waitForFunction(
      () => {
        const panel = document.querySelector('.engine-panel');
        const status = panel?.querySelector('.engine-panel__sub')?.textContent?.trim();
        if (status === 'Game over') return 'game-over';
        const evalText = panel?.querySelector('.engine-panel__eval')?.textContent?.trim();
        const lineCount = panel?.querySelectorAll('.engine-panel__line').length ?? 0;
        return evalText && lineCount >= 1 ? 'evaluated' : false;
      },
      { timeout: timeoutMs },
    )
    .then((handle) => handle.jsonValue());
}

function readPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.engine-panel');
    return {
      eval: panel?.querySelector('.engine-panel__eval')?.textContent?.trim() ?? null,
      lines: panel?.querySelectorAll('.engine-panel__line').length ?? 0,
      meta: panel?.querySelector('.engine-panel__sub')?.textContent?.trim() ?? null,
      arrows: document.querySelectorAll('.xq-arrow--pv1').length,
      markers: document.querySelectorAll('.engine-marker--pv1').length,
    };
  });
}

function assertNoFatalErrors(errors) {
  const fatal = errors.filter((message) =>
    /pthread|SharedArrayBuffer|ceval|engine global missing|failed to load engine|misty|pikajieqi|ERR_BLOCKED_BY_RESPONSE|Engine unavailable/i.test(
      message,
    ),
  );
  if (fatal.length > 0) throw new Error(`engine console errors: ${fatal.join(' | ')}`);
}

function parseArgs(args) {
  const parsed = {
    backend: process.env.MISTBOARD_CEVAL_SMOKE_BACKEND ?? 'all',
    baseUrl: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--backend') {
      parsed.backend = args[++index];
    } else if (arg === '--base') {
      parsed.baseUrl = args[++index];
    } else {
      throw new Error(
        `unknown argument: ${arg} (usage: [--backend fsf|misty|pika|all] [--base <url>])`,
      );
    }
  }
  if (
    parsed.backend !== 'fsf' &&
    parsed.backend !== 'misty' &&
    parsed.backend !== 'pika' &&
    parsed.backend !== 'all'
  ) {
    throw new Error(
      `--backend must be fsf, misty, pika, or all (got ${parsed.backend ?? 'nothing'})`,
    );
  }
  if (parsed.baseUrl !== null && !parsed.baseUrl) throw new Error('--base requires a value');
  return parsed;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}
