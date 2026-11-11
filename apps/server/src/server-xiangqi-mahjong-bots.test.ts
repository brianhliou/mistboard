import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  type XmjRoomState,
  type XmjTile,
  xmjPendingAction,
  xmjSeatIndex,
  xmjViewFor,
} from '@mistboard/game';
import { xmjBotMove } from './server-xiangqi-mahjong-bots.js';

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

test('the bot plays the same move whatever the hidden tiles are', () => {
  let checked = 0;
  let changed = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    const random = seeded(seed * 7919);
    let state = createXmjRoomState(createXmjSetup(seeded(seed)), `xmj_blind_${seed}`);
    for (let step = 0; step < 400 && state.status.type === 'playing'; step += 1) {
      const now = 1_000 + step * 100;
      const live = !state.match.between;
      const move = xmjBotMove(state, 'west', now);
      if (live && move !== null) {
        const twin = hiddenRedealt(state, random);
        const east = xmjSeatIndex('east');
        if (twin.match.hand.hands[east].join() !== state.match.hand.hands[east].join()) {
          changed += 1;
        }
        assert.deepEqual(xmjViewFor(twin, 'west'), xmjViewFor(state, 'west'));
        assert.deepEqual(xmjBotMove(twin, 'west', now), move, `seed ${seed}, step ${step}`);
        checked += 1;
      }
      const next = move ?? xmjBotMove(state, 'east', now) ?? xmjPendingAction(state)?.move;
      if (!next) break;
      state = applyXmjMove(state, next);
    }
  }
  // Not vacuous: the bot decided many times, and the redeal moved east's tiles.
  assert.ok(checked > 300, `only ${checked} bot decisions checked`);
  assert.ok(changed > checked / 2, `east's tiles changed in only ${changed} of ${checked}`);
});
