import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { applyGomokuRoomMove, createGomokuRoomState, getGomokuPlayerView, GOMOKU_OPENINGS } =
  await tsImport('../packages/game/src/variants-gomoku.ts', import.meta.url);

function fixture({
  move = 'a1',
  reply = true,
  status = 201,
  openings = [GOMOKU_OPENINGS.find((o) => o.turn === 'black')],
} = {}) {
  const page = new EventEmitter();
  const socket = new EventEmitter();
  let initial;
  let next;
  let attempts = 0;
  const view = (state) => getGomokuPlayerView(state, 'white');
  const frame = (message) => socket.emit('framereceived', { payload: JSON.stringify(message) });
  const clicks = [];
  let posted;
  let closed = false;
  page.request = {
    async post(url, options) {
      posted = { url, ...options };
      const opening = openings[Math.min(attempts++, openings.length - 1)];
      initial = createGomokuRoomState(`gmk_smoke_${attempts}`, opening);
      next = applyGomokuRoomMove(initial, { to: move });
      return {
        status: () => status,
        json: async () => ({ roomId: initial.id, url: `/room/${initial.id}`, rated: false }),
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
    if (reply && initial.status.turn === 'black') {
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
          state: {
            ...view(initial.status.turn === 'black' ? next : initial),
            status: { type: 'aborted', reason: 'manual' },
          },
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
    get initial() {
      return initial;
    },
    get next() {
      return next;
    },
    get attempts() {
      return attempts;
    },
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

test('a kernel-legal server socket reply passes without browser bot frames, workers or network downloads', async () => {
  const f = fixture();
  const result = await run(f);
  assert.equal(result.ok, true);
  assert.equal(result.check, 'gomoku-server-bot');
  assert.equal(result.move, 'a1');
  assert.equal(result.finalStatus.type, 'aborted');
  assert.equal(f.posted.data.gameSpecId, 'gomoku');
  assert.equal(f.posted.data.engineId, 'rapfi-level-1');
  assert.equal(f.posted.data.rated, false);
  assert.equal(f.posted.data.preferredColor, 'white');
  assert.equal(Object.hasOwn(f.posted.data, 'opening'), false);
  assert.deepEqual(f.clicks, ['[data-game-action="abort"]', '[data-game-action="confirm-yes"]']);
  assert.equal(f.closed, true);
});

test('human-first balanced deals are aborted before retrying a bot-first deal', async () => {
  const f = fixture({
    openings: [
      GOMOKU_OPENINGS.find((o) => o.turn === 'white'),
      GOMOKU_OPENINGS.find((o) => o.turn === 'black'),
    ],
  });
  assert.equal((await run(f)).ok, true);
  assert.equal(f.attempts, 2);
  assert.equal(f.clicks.length, 4);
});

test('a legal bot reply without a confirmed abort cannot pass', async () => {
  const f = fixture();
  const locator = f.page.locator;
  f.page.locator = (selector) => ({ ...locator(selector), click: async () => {} });
  await assert.rejects(run(f, { timeoutMs: 30 }), /timed out.*confirmed pregame abort/);
  assert.equal(f.closed, true);
});

test('a room without a server reply cannot pass', async () => {
  const f = fixture({ reply: false });
  await assert.rejects(run(f, { timeoutMs: 30 }), /timed out.*server bot reply/i);
  assert.equal(f.closed, true);
});

test('a disabled route fails a manually invoked smoke rather than reporting success', async () => {
  const f = fixture({ status: 404 });
  await assert.rejects(run(f), /room creation failed: 404/);
  assert.equal(f.closed, true);
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
    if (message.state?.ply === f.initial.ply + 1) {
      message.state.board[0] = 'white';
      frame.payload = JSON.stringify(message);
    }
  });
  await assert.rejects(run(f), /kernel/);
});

test('HTTP failure, browser error and rejected bot moves fail promptly', async () => {
  for (const event of ['pageerror', 'error-frame', 'page-http']) {
    const f = fixture();
    const goto = f.page.goto;
    f.page.goto = async (...args) => {
      const response = await goto(...args);
      if (event === 'pageerror') f.page.emit('pageerror', new Error('page failed'));
      if (event === 'error-frame')
        f.socket.emit('framereceived', {
          payload: JSON.stringify({ type: 'error', error: 'illegal_move' }),
        });
      return event === 'page-http' ? { ok: () => false, status: () => 503 } : response;
    };
    await assert.rejects(run(f), /page failed|illegal_move|HTTP 503/);
    assert.equal(f.closed, true);
  }
});
