#!/usr/bin/env node
// Rapfi is a browser worker, so an engine-seat WS smoke cannot prove it runs.
// Use a fresh, unrated bot-first room: download the real ~40 MB network pack,
// observe a browser-bot submission AND the server's kernel-legal reply, then
// abort before the human moves. No counted human game or rating is produced.
import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { resolveBaseUrl } from './lib/base-url.mjs';
import { launchChromium } from './lib/launch-browser.mjs';
import { parseSmokeArgs } from './lib/smoke-args.mjs';
import { reportResult } from './lib/smoke-report.mjs';

const DEFAULT_TIMEOUT_MS = 120_000;
const ENGINE_ID = 'rapfi-level-1';
const NETWORK_PATH = '/engine/rapfi/rapfi-single-simd128.data';

export async function checkGomokuRoom(browser, { baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const { applyGomokuRoomMove, createGomokuRoomState } = await tsImport(
    '../packages/game/src/variants-gomoku.ts',
    import.meta.url,
  );
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  let failure;
  let roomId;
  let initial;
  let submitted;
  let reply;
  let finalStatus;
  let workerLoaded = false;
  let networkLoaded = false;
  const fail = (error) => {
    failure ??= error;
  };
  const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()));
  const waitFor = async (predicate, label) => {
    while (true) {
      if (failure) throw failure;
      if (performance.now() >= deadline)
        throw new Error(
          `Gomoku smoke timed out waiting for ${label} (worker=${workerLoaded}, network=${networkLoaded}, reply=${!!reply})`,
        );
      if (predicate()) return;
      await delay(Math.min(50, remaining()));
    }
  };

  page.on('pageerror', fail);
  page.on('worker', (worker) => {
    if (new URL(worker.url()).pathname === '/engine/rapfi/worker.js') workerLoaded = true;
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname !== NETWORK_PATH) return;
    if (!response.ok()) {
      fail(new Error(`Rapfi networks returned HTTP ${response.status()}`));
      return;
    }
    // Headers alone do not prove a 40 MB download completed.
    void response
      .finished()
      .then((error) => {
        if (error) fail(error);
        else networkLoaded = true;
      })
      .catch(fail);
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.startsWith('/engine/rapfi/'))
      fail(new Error(`Rapfi asset request failed: ${new URL(request.url()).pathname}`));
  });
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame.type === 'move' && frame.browserBot === true) submitted = frame;
      } catch (error) {
        fail(error);
      }
    });
    socket.on('framereceived', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame.type === 'error')
          throw new Error(`Gomoku server rejected a move: ${frame.error ?? frame.code}`);
        const state = frame.state;
        if (!state || state.id !== roomId) return;
        if (frame.type === 'hello') {
          assert.equal(frame.seat, 'white', 'smoke must own the human white seat');
          assert.equal(frame.roomMode, 'pve');
          // Casual tenant snapshots omit the rated marker entirely.
          assert.equal(frame.rated ?? false, false, 'smoke must be unrated');
          assert.equal(frame.pveEngineId, ENGINE_ID);
          assert.equal(frame.seats?.black, ENGINE_ID);
          initial = createGomokuRoomState(roomId, state.opening);
          assert.equal(initial.ply, 0, 'smoke requires an empty bot-first opening');
          assert.deepEqual(state.board, initial.board);
          assert.deepEqual(state.status, initial.status);
        } else if (state.ply === 1 && !reply) {
          assert.ok(initial, 'missing initial Gomoku frame');
          assert.ok(
            submitted?.roomId === roomId &&
              submitted.expectedPly === 0 &&
              submitted.to === state.lastMove?.to,
            'missing matching browser bot submission',
          );
          const expected = applyGomokuRoomMove(initial, state.lastMove);
          assert.notEqual(expected, initial, 'bot move must be kernel-legal');
          assert.deepEqual(state.board, expected.board, 'server board differs from kernel');
          assert.deepEqual(state.status, expected.status, 'server status differs from kernel');
          assert.equal(state.ply, expected.ply);
          reply = state;
        }
        if (state.status.type === 'aborted') finalStatus = state.status;
      } catch (error) {
        fail(error);
      }
    });
  });

  try {
    const created = await page.request.post(new URL('/api/rooms', baseUrl).href, {
      timeout: remaining(),
      data: {
        gameSpecId: 'gomoku',
        mode: 'pve',
        preferredColor: 'white',
        engineId: ENGINE_ID,
        rated: false,
        opening: 'free',
        timeControl: { initialMs: 600_000, incrementMs: 5_000 },
      },
    });
    if (created.status() !== 201)
      throw new Error(
        `Gomoku room creation failed: ${created.status()} (check the Gomoku flag/public launch)`,
      );
    const room = await created.json();
    assert.equal(typeof room.roomId, 'string');
    assert.equal(room.rated, false);
    roomId = room.roomId;
    const url = new URL(room.url, baseUrl);
    assert.equal(url.origin, new URL(baseUrl).origin, 'room URL must stay on the smoke origin');
    const response = await page.goto(url.href, {
      waitUntil: 'domcontentloaded',
      timeout: remaining(),
    });
    if (!response?.ok())
      throw new Error(`Gomoku room page returned HTTP ${response?.status() ?? 'no response'}`);
    await page.locator('.gomoku-svg').waitFor({ state: 'visible', timeout: remaining() });
    await waitFor(
      () => initial && submitted && reply && workerLoaded && networkLoaded,
      'Rapfi networks and a legal bot reply',
    );
    const elapsedMs = Math.round(performance.now() - startedAt);
    await page.locator('[data-game-action="abort"]').click({ timeout: remaining() });
    await page.locator('[data-game-action="confirm-yes"]').click({ timeout: remaining() });
    await waitFor(() => finalStatus, 'confirmed pregame abort');
    return {
      ok: true,
      check: 'gomoku-browser-bot',
      baseUrl,
      roomId,
      engineId: ENGINE_ID,
      move: reply.lastMove.to,
      elapsedMs,
      finalStatus,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const options = parseSmokeArgs(process.argv.slice(2), {
    usage: 'npm run prod:smoke:gomoku -- [options]',
    description:
      'Open an unrated Gomoku bot game, load Rapfi networks, verify one legal move, then abort.',
    flags: {
      '--base': {
        key: 'baseUrl',
        placeholder: '<url>',
        help: 'Base URL, default https://mistboard.com',
      },
      '--timeout-ms': {
        key: 'timeoutMs',
        placeholder: '<ms>',
        kind: 'positive-int',
        help: `Total room/load/move/abort deadline, default ${DEFAULT_TIMEOUT_MS}`,
      },
    },
  });
  const baseUrl = resolveBaseUrl(options.baseUrl).origin;
  const browser = await launchChromium();
  try {
    reportResult(
      await checkGomokuRoom(browser, {
        baseUrl,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, check: 'gomoku-browser-bot', error: error.message }));
    process.exitCode = 1;
  });
}
