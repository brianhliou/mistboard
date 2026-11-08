#!/usr/bin/env node
// Verify native server Rapfi in a fresh, unrated bot-first room: observe the
// server's socket reply, validate it against the kernel, then abort before the
// human moves. No counted human game or rating is produced.
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
  let reply;
  let finalStatus;
  const fail = (error) => {
    failure ??= error;
  };
  const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()));
  const waitFor = async (predicate, label) => {
    while (true) {
      if (failure) throw failure;
      if (performance.now() >= deadline)
        throw new Error(`Gomoku smoke timed out waiting for ${label} (reply=${!!reply})`);
      if (predicate()) return;
      await delay(Math.min(50, remaining()));
    }
  };

  page.on('pageerror', fail);
  page.on('websocket', (socket) => {
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
          assert.ok([3, 4, 5].includes(initial.ply), 'smoke requires a dealt balanced opening');
          assert.deepEqual(state.board, initial.board);
          assert.deepEqual(state.status, initial.status);
        } else if (state.ply === initial?.ply + 1 && !reply) {
          assert.ok(initial, 'missing initial Gomoku frame');
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
    // A dealt opening can start with either colour. Abort human-first deals
    // and retry within the same deadline, without playing any human moves.
    while (true) {
      initial = reply = finalStatus = undefined;
      const created = await page.request.post(new URL('/api/rooms', baseUrl).href, {
        timeout: remaining(),
        data: {
          gameSpecId: 'gomoku',
          mode: 'pve',
          preferredColor: 'white',
          engineId: ENGINE_ID,
          rated: false,
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
      await waitFor(() => initial, 'the dealt opening');
      if (initial.status.turn === 'black') break;
      await page.locator('[data-game-action="abort"]').click({ timeout: remaining() });
      await page.locator('[data-game-action="confirm-yes"]').click({ timeout: remaining() });
      await waitFor(() => finalStatus, 'aborting the human-first deal');
    }
    await waitFor(() => reply, 'a legal server bot reply');
    const elapsedMs = Math.round(performance.now() - startedAt);
    await page.locator('[data-game-action="abort"]').click({ timeout: remaining() });
    await page.locator('[data-game-action="confirm-yes"]').click({ timeout: remaining() });
    await waitFor(() => finalStatus, 'confirmed pregame abort');
    return {
      ok: true,
      check: 'gomoku-server-bot',
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
    usage: 'npm run prod:smoke:gomoku-browser -- [options]',
    description: 'Open an unrated Gomoku bot game, verify one legal server bot move, then abort.',
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
        help: `Total room/move/abort deadline, default ${DEFAULT_TIMEOUT_MS}`,
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
    console.error(JSON.stringify({ ok: false, check: 'gomoku-server-bot', error: error.message }));
    process.exitCode = 1;
  });
}
