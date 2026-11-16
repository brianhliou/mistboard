/**
 * The search bot decides from its seat's view and nothing else.
 *
 * At every decision of a set of matches the tiles the deciding seat cannot see
 * (the opponent's concealed hand, the wall in draw order, the walls of the
 * hands still to come) are shuffled among themselves. The seat's view must come
 * out identical and the bot's action must not change. A planted bot that peeks
 * at the room state must fail the same check, or the check proves nothing.
 *
 * Blind spot, named: the check runs on positions reached by this bot's own
 * play, and one reshuffle per position.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { XMJ_TAI_TABLE, type XmjTile } from './xiangqi-mahjong.js';
import { xmjBotAction } from './xiangqi-mahjong-bot.js';
import { type XmjBotPolicy, xmjMatchWalls, xmjPlayBotMatch } from './xiangqi-mahjong-bot-match.js';
import {
  createXmjSearchBot,
  xmjFastHeuristicHand,
  xmjSearchBotAction,
} from './xiangqi-mahjong-bot-search.js';
import {
  applyXmjMove,
  createXmjRoomState,
  type XmjRoomState,
  xmjPendingAction,
  xmjSeatName,
  xmjViewFor,
} from './xiangqi-mahjong-room.js';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The same position with everything seat `index` cannot see dealt again. */
function reshuffleHidden(state: XmjRoomState, index: 0 | 1, random: () => number): XmjRoomState {
  const hand = state.match.hand;
  const other = index === 0 ? 1 : 0;
  const theirs = hand.hands[other];
  const hidden = shuffled<XmjTile>([...theirs, ...hand.wall], random);
  const hands = [hand.hands[0], hand.hands[1]] as [readonly XmjTile[], readonly XmjTile[]];
  hands[other] = hidden.slice(0, theirs.length);
  const walls = state.match.walls.map((wall, i) =>
    i > state.match.handIndex ? shuffled(wall, random) : wall,
  );
  return {
    ...state,
    match: { ...state.match, walls, hand: { ...hand, hands, wall: hidden.slice(theirs.length) } },
  };
}

/**
 * Plays `matches` matches with the bot `make` builds in both seats and returns
 * how many decisions were checked and how many changed under a reshuffle.
 * `make` is handed a way to read the room state, which an honest bot ignores.
 */
function blindnessCheck(make: (peek: () => XmjRoomState) => XmjBotPolicy, matches: number) {
  let current!: XmjRoomState;
  const policy = make(() => current);
  const random = mulberry32(20261116);
  let checked = 0;
  let changed = 0;
  let moved = 0;
  for (let seed = 7000; seed < 7000 + matches; seed += 1) {
    let state = createXmjRoomState(
      { walls: xmjMatchWalls(seed), firstDealer: 'east', taiTable: XMJ_TAI_TABLE },
      `blind-${seed}`,
    );
    let at = 0;
    while (!state.match.over) {
      at += 2_000;
      if (state.match.between) {
        const pending = xmjPendingAction(state);
        assert.ok(pending);
        at = Math.max(at, pending.at);
        state = applyXmjMove(state, pending.move);
        continue;
      }
      const phase = state.match.hand.phase;
      const index =
        phase.type === 'claim' ? (phase.discarder === 0 ? 1 : 0) : state.match.hand.turn;
      const seat = xmjSeatName(index);
      const view = xmjViewFor(state, seat);
      current = state;
      const action = policy(view, seat);

      const swapped = reshuffleHidden(state, index, random);
      const swappedView = xmjViewFor(swapped, seat);
      assert.deepEqual(swappedView, view, 'the reshuffle touched something the seat can see');
      if (JSON.stringify(swapped.match.hand) !== JSON.stringify(state.match.hand)) moved += 1;
      current = swapped;
      const again = policy(swappedView, seat);
      checked += 1;
      if (JSON.stringify(again) !== JSON.stringify(action)) changed += 1;

      current = state;
      const pending = action === null ? xmjPendingAction(state) : null;
      at = Math.max(at, pending?.at ?? 0);
      const move = action ? { ...action, by: seat, at } : pending ? { ...pending.move, at } : null;
      assert.ok(move, `seed ${seed}: no move`);
      const next = applyXmjMove(state, move);
      assert.notEqual(next, state, `seed ${seed}: no progress`);
      state = next;
    }
  }
  return { checked, changed, moved };
}

test('the search bot never changes its action when its unseen tiles are reshuffled', () => {
  const bot = createXmjSearchBot({ samples: 24 });
  const { checked, changed, moved } = blindnessCheck(() => bot, 12);
  assert.ok(checked > 500, `only ${checked} decisions checked`);
  // The reshuffle has to really move hidden tiles, or an unchanged action means nothing.
  assert.ok(moved > checked * 0.9, `only ${moved} of ${checked} reshuffles moved a tile`);
  assert.equal(changed, 0);
});

test('the check catches a planted bot that peeks at the opponent hand and the wall', () => {
  const bot = createXmjSearchBot({ samples: 24 });
  const peeker =
    (peek: () => XmjRoomState): XmjBotPolicy =>
    (view, seat) => {
      const options = view.legal.discard;
      if (view.legal.selfDraw || view.legal.pass || options.length < 2) return bot(view, seat);
      // Holds back what the opponent holds or the wall gives next: it reads both.
      const hand = peek().match.hand;
      const theirs = hand.hands[seat === 'east' ? 1 : 0];
      const safe = options.filter((tile) => !theirs.includes(tile) && tile !== hand.wall[0]);
      return { action: 'discard', tile: (safe[0] ?? options[0]) as XmjTile };
    };
  const { checked, changed } = blindnessCheck(peeker, 4);
  assert.ok(changed > checked * 0.05, `the peeker changed only ${changed} of ${checked} actions`);
});

// The search's optimized playout kernel must keep the production rules and
// heuristic policy: a fast simulation with different scoring is a different bot.
test('fast heuristic playouts match the real kernel and policy in both dealer seats', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const walls = xmjMatchWalls(seed);
    const actual = xmjPlayBotMatch(seed, [xmjBotAction, xmjBotAction]);
    for (let i = 0; i < actual.results.length; i += 1) {
      const result = actual.results[i]!;
      const expected =
        result.winner === null
          ? 0
          : (result.winner === result.dealer ? 1 : -1) * result.score!.total;
      assert.equal(
        xmjFastHeuristicHand(walls[i]!, result.dealer),
        expected,
        `seed ${seed}, hand ${i}`,
      );
    }
  }
});

test('default search is deterministic, leaves its input intact and differs from the heuristic', () => {
  let different = 0;
  for (let seed = 1; seed <= 8; seed += 1) {
    const view = xmjViewFor(
      createXmjRoomState({ walls: xmjMatchWalls(seed), firstDealer: 'east' }),
      'east',
    );
    const before = JSON.stringify(view);
    const action = xmjSearchBotAction(view, 'east');
    assert.deepEqual(xmjSearchBotAction(view, 'east'), action);
    assert.equal(JSON.stringify(view), before);
    if (JSON.stringify(action) !== JSON.stringify(xmjBotAction(view, 'east'))) different += 1;
  }
  assert.ok(different > 0, 'the new entry point must actually search');
});
