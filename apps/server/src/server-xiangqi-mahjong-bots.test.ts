import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  type XmjAction,
  type XmjPlayerView,
  type XmjRoomState,
  type XmjSeat,
  type XmjTile,
  xmjBotAction,
  xmjPendingAction,
  xmjSearchBotAction,
  xmjSeatIndex,
  xmjViewFor,
} from '@mistboard/game';
import {
  scheduleXmjBotMove,
  XMJ_BOT_CLIENT_ID,
  XMJ_BOT_ID,
  xmjBotMove,
  xmjBotMoveAsync,
} from './server-xiangqi-mahjong-bots.js';
import { XmjBotSearchWorker, xmjBotSearchWorker } from './xiangqi-mahjong-bot-search-worker.js';

test.after(() => xmjBotSearchWorker.close());

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(tiles: readonly XmjTile[], random: () => number): XmjTile[] {
  const out = [...tiles];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as XmjTile, out[i] as XmjTile];
  }
  return out;
}

/**
 * The same table with everything the west seat cannot see dealt again: east's
 * concealed tiles and this hand's wall reshuffled together, and every later
 * hand's wall reshuffled.
 */
function hiddenRedealt(state: XmjRoomState, random: () => number): XmjRoomState {
  const { match } = state;
  const { hand } = match;
  const east = xmjSeatIndex('east');
  const pool = shuffled([...hand.hands[east], ...hand.wall], random);
  const count = hand.hands[east].length;
  const hands = [...hand.hands] as [XmjTile[], XmjTile[]];
  hands[east] = pool.slice(0, count);
  return {
    ...state,
    match: {
      ...match,
      walls: match.walls.map((wall, index) =>
        index > match.handIndex ? shuffled(wall, random) : wall,
      ),
      hand: { ...hand, hands, wall: pool.slice(count) },
    },
  };
}

test('the live worker plays the same move whatever the hidden tiles are', async () => {
  let checked = 0;
  let changed = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const random = seeded(seed * 7919);
    let state = createXmjRoomState(createXmjSetup(seeded(seed)), `xmj_blind_${seed}`);
    for (let step = 0; step < 400 && state.status.type === 'playing'; step += 1) {
      const now = 1_000 + step * 100;
      const live = !state.match.between;
      const move = await xmjBotMoveAsync(state, 'west', now);
      if (live && move !== null) {
        const twin = hiddenRedealt(state, random);
        const east = xmjSeatIndex('east');
        if (twin.match.hand.hands[east].join() !== state.match.hand.hands[east].join()) {
          changed += 1;
        }
        assert.deepEqual(xmjViewFor(twin, 'west'), xmjViewFor(state, 'west'));
        assert.deepEqual(
          await xmjBotMoveAsync(twin, 'west', now),
          move,
          `seed ${seed}, step ${step}`,
        );
        checked += 1;
      }
      const next =
        move ?? (await xmjBotMoveAsync(state, 'east', now)) ?? xmjPendingAction(state)?.move;
      if (!next) break;
      state = applyXmjMove(state, next);
    }
  }
  // Not vacuous: the bot decided many times, and the redeal moved east's tiles.
  assert.ok(checked > 300, `only ${checked} bot decisions checked`);
  assert.ok(changed > checked / 2, `east's tiles changed in only ${changed} of ${checked}`);
});

test('Misty keeps its identity and uses the unmodified default search in the worker', async () => {
  const state = createXmjRoomState(createXmjSetup(seeded(42)));
  const view = xmjViewFor(state, 'east');
  const expected = xmjSearchBotAction(view, 'east');
  const sync = xmjBotMove(state, 'east', 1234);
  assert.deepEqual(sync, { ...expected, by: 'east', at: 1234 });
  assert.deepEqual(await xmjBotMoveAsync(state, 'east', 1234), sync);
  assert.equal(XMJ_BOT_ID, 'misty');
  assert.equal(XMJ_BOT_CLIENT_ID, 'misty-xiangqi-mahjong');
  assert.equal(await xmjBotMoveAsync(state, 'west'), null);
});

test('search thread yields the event loop, handles concurrent jobs, and restarts after close', async () => {
  const worker = new XmjBotSearchWorker();
  try {
    const state = createXmjRoomState({ ...createXmjSetup(seeded(1)), firstDealer: 'east' });
    const view = xmjViewFor(state, 'east');
    let answered = false;
    const first = worker.search(view, 'east').then((action) => {
      answered = true;
      return action;
    });
    await yieldLoop();
    assert.equal(answered, false, 'cold search must leave the server loop free');
    const second = worker.search(view, 'east');
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, xmjSearchBotAction(view, 'east'));
    assert.deepEqual(b, a);
    const cancelled = worker.search(view, 'east');
    const rejected = assert.rejects(cancelled, /stopped/);
    worker.close();
    await rejected;
    assert.deepEqual(await worker.search(view, 'east'), a);
  } finally {
    worker.close();
  }
});

// Search completion is separate from the display timer; simulate both without
// waiting real seconds, and let appendEvent observe exactly what live rooms get.
test('scheduler sends only a redacted view, paces the answer and discards stale decisions', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (action: XmjAction | null) => void;
  const state = createXmjRoomState({ ...createXmjSetup(seeded(7)), firstDealer: 'east' });
  const calls: { view: XmjPlayerView; seat: XmjSeat }[] = [];
  t.mock.method(xmjBotSearchWorker, 'search', (view: XmjPlayerView, seat: XmjSeat) => {
    calls.push({ view, seat });
    return new Promise<XmjAction | null>((resolve) => {
      finish = resolve;
    });
  });
  type Room = Parameters<typeof scheduleXmjBotMove>[1];
  type Context = Parameters<typeof scheduleXmjBotMove>[0];
  const room = {
    id: 'worker-test',
    engineTimer: null,
    events: [],
    projection: { state, seats: { east: XMJ_BOT_CLIENT_ID, west: 'human' } },
  } as unknown as Room;
  const appended: unknown[] = [];
  const ctx = {
    appendEvent: async (_room: Room, event: unknown) => {
      appended.push(event);
      return 0;
    },
    broadcastEventAppended: () => {},
  } as Context;
  scheduleXmjBotMove(ctx, room);
  assert.equal(calls.length, 1, 'readiness must not run a second search');
  assert.equal(calls[0]!.view.hands.west, null);
  assert.equal(JSON.stringify(calls[0]!.view), JSON.stringify(xmjViewFor(state, 'east')));
  const action = xmjBotAction(calls[0]!.view, 'east');
  assert.ok(action);
  finish(action);
  await yieldLoop();
  t.mock.timers.tick(699);
  await yieldLoop();
  assert.equal(appended.length, 0);
  t.mock.timers.tick(1);
  await yieldLoop();
  assert.equal(appended.length, 1);

  // The timer can fire while search is still running; a later projection
  // invalidates the answer even when its move could still look legal.
  scheduleXmjBotMove(ctx, room);
  t.mock.timers.tick(700);
  room.projection.state = { ...state };
  finish(action);
  await yieldLoop();
  assert.equal(appended.length, 1);

  // Re-arming the same projection also invalidates the earlier job.
  scheduleXmjBotMove(ctx, room);
  const oldFinish = finish;
  t.mock.timers.tick(700);
  scheduleXmjBotMove(ctx, room);
  oldFinish(action);
  await yieldLoop();
  assert.equal(appended.length, 1);
  room.stopping = true;
  finish(action);
  t.mock.timers.tick(700);
  await yieldLoop();
  assert.equal(appended.length, 1);
});
