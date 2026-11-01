import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { applyGomokuRoomMove, createGomokuRoomState, getGomokuPlayerView } = await tsImport(
  '../packages/game/src/variants-gomoku.ts',
  import.meta.url,
);

function fixture({ move = 'h8', network = true, worker = true, reply = true, status = 201 } = {}) {
  const page = new EventEmitter();
  const socket = new EventEmitter();
  const initial = createGomokuRoomState('gmk_smoke', { stones: [], turn: 'black' });
  const next = applyGomokuRoomMove(initial, { to: move });
  const view = (state) => getGomokuPlayerView(state, 'white');
  const frame = (message) => socket.emit('framereceived', { payload: JSON.stringify(message) });
  const clicks = [];
  let posted;
  let closed = false;
  page.request = {
    async post(url, options) {
      posted = { url, ...options };
      return {
        status: () => status,
        json: async () => ({ roomId: initial.id, url: '/room/gmk_smoke', rated: false }),
      };
    },
  };
  page.goto = async () => {
    page.emit('websocket', socket);
    frame({
      type: 'hello',
      seat: 'white',
      roomMode: 'pve',
      pveEngineId: 'rapfi-level-1',
      seats: { white: 'smoke-player', black: 'rapfi-level-1' },
      state: view(initial),
    });
    if (worker)
      page.emit('worker', { url: () => 'https://example.test/engine/rapfi/worker.js?v=pin' });
    if (network)
      page.emit('response', {
        url: () => 'https://example.test/engine/rapfi/rapfi-single-simd128.data?v=pin',
        ok: () => true,
        status: () => 200,
        finished: async () => null,
      });
    if (reply) {
      socket.emit('framesent', {
        payload: JSON.stringify({
          type: 'move',
          to: move,
          browserBot: true,
          roomId: initial.id,
          expectedPly: 0,
        }),
      });
      frame({ type: 'event-appended', state: view(next) });
    }
    return { ok: () => true, status: () => 200 };
  };
  page.locator = (selector) => ({
    waitFor: async () => {},
    async click() {
      clicks.push(selector);
      if (selector.includes('confirm-yes'))
        frame({
          type: 'event-appended',
          state: { ...view(next), status: { type: 'aborted', reason: 'manual' } },
        });
    },
  });
  page.close = async () => {
    closed = true;
  };
  return {
    browser: { newPage: async () => page },
    page,
    socket,
    initial,
    next,
    clicks,
    get posted() {
      return posted;
    },
    get closed() {
      return closed;
    },
  };
}

async function run(f, options = {}) {
  const { checkGomokuRoom } = await import('./prod-gomoku-smoke.mjs');
  return checkGomokuRoom(f.browser, {
    baseUrl: 'https://example.test',
    timeoutMs: 100,
    ...options,
  });
}

test('prod:smoke:gomoku is a runnable package entry', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['prod:smoke:gomoku'], 'node scripts/prod-gomoku-smoke.mjs');
});

test('worker/download evidence plus a kernel-legal server reply pass, then abort', async () => {
  const f = fixture();
  const result = await run(f);
  assert.equal(result.ok, true);
  assert.equal(result.move, 'h8');
  assert.equal(result.finalStatus.type, 'aborted');
  assert.equal(f.posted.data.gameSpecId, 'gomoku');
  assert.equal(f.posted.data.engineId, 'rapfi-level-1');
  assert.equal(f.posted.data.rated, false);
  assert.equal(f.posted.data.preferredColor, 'white');
  assert.equal(f.posted.data.opening, 'free');
  assert.deepEqual(f.clicks, ['[data-game-action="abort"]', '[data-game-action="confirm-yes"]']);
  assert.equal(f.closed, true);
});

test('a legal bot reply without a confirmed abort cannot pass', async () => {
  const f = fixture();
  const locator = f.page.locator;
  f.page.locator = (selector) => ({ ...locator(selector), click: async () => {} });
  await assert.rejects(run(f, { timeoutMs: 30 }), /timed out.*confirmed pregame abort/);
  assert.equal(f.closed, true);
});

for (const missing of ['network', 'worker', 'reply']) {
  test(`a move without ${missing} evidence cannot pass`, async () => {
    const f = fixture({ [missing]: false });
    await assert.rejects(run(f, { timeoutMs: 30 }), /timed out/i);
    assert.equal(f.closed, true);
  });
}

test('a download is complete only after its response body finishes', async () => {
  const f = fixture();
  f.page.prependListener('response', (response) => {
    response.finished = async () => new Error('truncated');
  });
  await assert.rejects(run(f), /truncated/);
  assert.equal(f.closed, true);
});

test('a disabled route fails a manually invoked smoke rather than reporting success', async () => {
  const f = fixture({ status: 404 });
  await assert.rejects(run(f), /room creation failed: 404/);
  assert.equal(f.closed, true);
});

test('a board change must be the browser bot submission accepted by the server', async () => {
  const f = fixture();
  f.socket.prependListener('framesent', (frame) => {
    frame.payload = JSON.stringify({ type: 'move', to: 'h8' });
  });
  await assert.rejects(run(f), /browser bot submission/);
});

test('a rated hello is refused even when the create response said unrated', async () => {
  const f = fixture();
  f.socket.prependListener('framereceived', (frame) => {
    const message = JSON.parse(frame.payload);
    if (message.type === 'hello') frame.payload = JSON.stringify({ ...message, rated: true });
  });
  await assert.rejects(run(f), /smoke must be unrated/);
});

test('illegal or corrupted server replies fail kernel validation', async () => {
  const f = fixture();
  f.socket.prependListener('framereceived', (frame) => {
    const message = JSON.parse(frame.payload);
    if (message.state?.ply === 1) {
      message.state.board[0] = 'white';
      frame.payload = JSON.stringify(message);
    }
  });
  await assert.rejects(run(f), /kernel/);
});

test('HTTP failure, browser error and rejected bot moves fail promptly', async () => {
  for (const event of ['pageerror', 'error-frame', 'network-http']) {
    const f = fixture();
    const goto = f.page.goto;
    f.page.goto = async (...args) => {
      const response = await goto(...args);
      if (event === 'pageerror') f.page.emit('pageerror', new Error('WASM failed'));
      if (event === 'error-frame')
        f.socket.emit('framereceived', {
          payload: JSON.stringify({ type: 'error', error: 'illegal_move' }),
        });
      if (event === 'network-http')
        f.page.emit('response', {
          url: () => 'https://example.test/engine/rapfi/rapfi-single-simd128.data',
          ok: () => false,
          status: () => 404,
        });
      return response;
    };
    await assert.rejects(run(f), /WASM failed|illegal_move|HTTP 404/);
    assert.equal(f.closed, true);
  }
});
