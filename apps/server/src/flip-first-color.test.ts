/**
 * Flip-variant firstColor derivation for list surfaces (the watch feed). Banqi,
 * Flip Jungle and Three Kingdoms Banqi record results by SEAT, decoupled from ink;
 * firstColor (the first-mover seat's bound ink) is NOT a stored column, so it is
 * recovered by replaying the event log. These pins cover the derivation for all
 * flip tenants, the variant filter, and the cache.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyBanqiMove,
  applyJungleFlipMove,
  BANQI_SPEC_ID,
  type BanqiMove,
  type BanqiSeat,
  createBanqiDeal,
  createInitialBanqiState,
  createInitialJungleFlipState,
  createJungleFlipDeal,
  createThreeKingdomsBanqiSetup,
  getBanqiLegalMoves,
  getJungleFlipLegalMoves,
  JUNGLE_FLIP_SPEC_ID,
  type JungleFlipMove,
  type JungleFlipSeat,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  THREE_KINGDOMS_BANQI_SPEC_ID,
} from '@mistboard/game';
import type { BanqiEvent } from './banqi-runtime.js';
import {
  attachFlipFirstColors,
  type FlipFirstColorDeps,
  flipFirstColorForRoom,
  isFlipInkVariant,
} from './flip-first-color.js';
import type { JungleFlipEvent } from './jungle-flip-runtime.js';
import type { ThreeKingdomsBanqiEvent } from './three-kingdoms-banqi-tenant.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';

process.env.MISTBOARD_BANQI_ENABLED = 'true';
process.env.MISTBOARD_JUNGLE_FLIP_ENABLED = 'true';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// A finished banqi event log for `roomId`, plus the firstColor the kernel binds
// on the opening flip (so the test asserts the derivation against ground truth).
function finishedBanqiGame(
  roomId: string,
  seed: number,
): { events: BanqiEvent[]; firstColor: 'red' | 'black' } {
  const deal = createBanqiDeal(seeded(seed));
  const events: TenantRoomEvent<BanqiSeat, BanqiMove, typeof BANQI_SPEC_ID>[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: BANQI_SPEC_ID, setup: deal },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'a', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];
  let state = createInitialBanqiState(roomId, deal);
  let at = 4;
  let plies = 0;
  while (state.status.type === 'playing' && plies < 400) {
    const move = getBanqiLegalMoves(state)[0]!;
    events.push({ type: 'move-played', at: at++, roomId, color: state.status.turn, move });
    state = applyBanqiMove(state, move);
    plies += 1;
  }
  assert.equal(state.status.type, 'finished', 'the scripted line finishes');
  assert.ok(state.firstColor, 'a finished game has bound firstColor');
  return { events: events as BanqiEvent[], firstColor: state.firstColor };
}

// The Flip Jungle twin of the above: the second flip tenant sharing the seat/ink
// split, so the derivation is pinned per tenant rather than assumed to generalize.
function finishedJungleFlipGame(
  roomId: string,
  seed: number,
): { events: JungleFlipEvent[]; firstColor: 'red' | 'black' } {
  const deal = createJungleFlipDeal(seeded(seed));
  const events: TenantRoomEvent<JungleFlipSeat, JungleFlipMove, typeof JUNGLE_FLIP_SPEC_ID>[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: JUNGLE_FLIP_SPEC_ID, setup: deal },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'a', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];
  let state = createInitialJungleFlipState(roomId, deal);
  let at = 4;
  let plies = 0;
  while (state.status.type === 'playing' && plies < 400) {
    const move = getJungleFlipLegalMoves(state)[0]!;
    events.push({ type: 'move-played', at: at++, roomId, color: state.status.turn, move });
    state = applyJungleFlipMove(state, move);
    plies += 1;
  }
  assert.ok(state.firstColor, 'the opening flip binds an ink');
  return { events: events as JungleFlipEvent[], firstColor: state.firstColor };
}

function depsFor(logs: Record<string, readonly unknown[]>): {
  deps: FlipFirstColorDeps;
  calls: () => string[];
} {
  const calls: string[] = [];
  return {
    calls: () => calls,
    deps: {
      loadRoomEvents: async (roomId) => {
        calls.push(roomId);
        return logs[roomId] ?? null;
      },
    },
  };
}

test('derives the ink bound on the opening flip from the event log', async () => {
  const { events, firstColor } = finishedBanqiGame('bq_fc_1', 7);
  const { deps } = depsFor({ bq_fc_1: events });
  assert.equal(await flipFirstColorForRoom('bq_fc_1', BANQI_SPEC_ID, deps), firstColor);
});

test('derives Flip Jungle ink from its own tenant replay', async () => {
  const { events, firstColor } = finishedJungleFlipGame('jgf_fc_1', 5);
  const { deps } = depsFor({ jgf_fc_1: events });
  assert.equal(await flipFirstColorForRoom('jgf_fc_1', JUNGLE_FLIP_SPEC_ID, deps), firstColor);
});

for (const firstColor of ['red', 'black', null] as const) {
  test(`TK list rows expose only the public firstColor (${firstColor})`, async () => {
    const roomId = `tkb_fc_${firstColor}`;
    const setup = createThreeKingdomsBanqiSetup(seeded(7));
    const events: ThreeKingdomsBanqiEvent[] = [
      { type: 'room-created', at: 1, roomId, gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID, setup },
    ];
    if (firstColor) {
      const square =
        THREE_KINGDOMS_BANQI_SETUP_SQUARES[
          setup.deal.findIndex((piece) => piece.color === firstColor)
        ]!;
      events.push({
        type: 'move-played',
        at: 2,
        roomId,
        color: 'red',
        move: { from: square, to: square },
      });
    }
    events.push({ type: 'seat-resigned', at: 3, roomId, color: 'black' });
    const { deps } = depsFor({ [roomId]: events });
    const rows = [{ roomId, variant: THREE_KINGDOMS_BANQI_SPEC_ID }];
    await attachFlipFirstColors(rows, deps);
    // Whole serialized list payload: no deal, state, board or hidden identity
    // can hitchhike out of the replay used to recover this one public scalar.
    assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
      { roomId, variant: THREE_KINGDOMS_BANQI_SPEC_ID, firstColor },
    ]);
  });
}

test('a flip log replayed under the WRONG tenant derives nothing rather than guessing', async () => {
  // Fail-closed: the two flip tenants share a seat vocabulary, so a mismatched
  // spec id must be rejected by the event-log guard, not silently replayed.
  const { events } = finishedJungleFlipGame('jgf_fc_mismatch', 23);
  const { deps } = depsFor({ jgf_fc_mismatch: events });
  assert.equal(await flipFirstColorForRoom('jgf_fc_mismatch', BANQI_SPEC_ID, deps), null);
});

test('caches per room so a polled feed replays each game only once', async () => {
  const { events } = finishedBanqiGame('bq_fc_cache', 11);
  const { deps, calls } = depsFor({ bq_fc_cache: events });
  const first = await flipFirstColorForRoom('bq_fc_cache', BANQI_SPEC_ID, deps);
  const second = await flipFirstColorForRoom('bq_fc_cache', BANQI_SPEC_ID, deps);
  assert.equal(first, second);
  assert.deepEqual(calls(), ['bq_fc_cache'], 'the event log is loaded once, not per call');
});

test('attaches firstColor only to flip rows and leaves others untouched', async () => {
  const banqi = finishedBanqiGame('bq_fc_attach', 19);
  const jungleFlip = finishedJungleFlipGame('jgf_fc_attach', 31);
  const { deps, calls } = depsFor({
    bq_fc_attach: banqi.events,
    jgf_fc_attach: jungleFlip.events,
  });
  const rows = [
    {
      roomId: 'bq_fc_attach',
      variant: BANQI_SPEC_ID,
      firstColor: undefined as 'red' | 'black' | null | undefined,
    },
    {
      roomId: 'jgf_fc_attach',
      variant: JUNGLE_FLIP_SPEC_ID,
      firstColor: undefined as 'red' | 'black' | null | undefined,
    },
    {
      roomId: 'chess_row',
      variant: 'dark-chess',
      firstColor: undefined as 'red' | 'black' | null | undefined,
    },
  ];
  await attachFlipFirstColors(rows, deps);
  assert.equal(rows[0]!.firstColor, banqi.firstColor, 'banqi row gets its bound ink');
  assert.equal(rows[1]!.firstColor, jungleFlip.firstColor, 'flip jungle row gets its bound ink');
  assert.equal(rows[2]!.firstColor, undefined, 'non-flip row is skipped');
  assert.deepEqual(
    calls().slice().sort(),
    ['bq_fc_attach', 'jgf_fc_attach'],
    'only the flip rooms hit the loader',
  );
});

test('the flip-variant predicate covers all three flip tenants and nothing else', () => {
  assert.equal(isFlipInkVariant(BANQI_SPEC_ID), true);
  assert.equal(isFlipInkVariant(JUNGLE_FLIP_SPEC_ID), true);
  assert.equal(isFlipInkVariant(THREE_KINGDOMS_BANQI_SPEC_ID), true);
  // Jieqi deals face down but its seats own a fixed ink from move one.
  assert.equal(isFlipInkVariant('jieqi'), false);
  assert.equal(isFlipInkVariant('xiangqi'), false);
  assert.equal(isFlipInkVariant('not-a-variant'), false);
});

test('returns null for an unreplayable / missing event log', async () => {
  const { deps } = depsFor({});
  assert.equal(await flipFirstColorForRoom('bq_fc_missing', BANQI_SPEC_ID, deps), null);
});

test('a null derivation is cached too, so a polled feed does not re-replay it', async () => {
  // The bounded cache distinguishes a MISS (undefined) from a cached null: an
  // unreplayable log must still load only once per TTL window, not per poll.
  const { deps, calls } = depsFor({});
  assert.equal(await flipFirstColorForRoom('bq_fc_null_cache', BANQI_SPEC_ID, deps), null);
  assert.equal(await flipFirstColorForRoom('bq_fc_null_cache', BANQI_SPEC_ID, deps), null);
  assert.deepEqual(calls(), ['bq_fc_null_cache'], 'the missing log is loaded once, not per call');
});
