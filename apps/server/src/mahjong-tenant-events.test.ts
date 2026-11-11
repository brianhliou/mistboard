import assert from 'node:assert/strict';
import test from 'node:test';
import { type MahjongEvent, mahjongClientEventFor } from './mahjong-tenant.js';

// Audit 2026-10-16 finding 7: a claim's `fromHand` told every other seat which
// concealed tiles the claimant holds, even for a claim still pending or one that
// loses to a higher claim. Serialize the whole event for every recipient.
function claimEvent(kind: 'pung' | 'chow', fromHand: number[]): MahjongEvent {
  return {
    type: 'move-played',
    at: 5,
    roomId: 'mj_test',
    color: 'south',
    move: { action: 'claim', kind, fromHand, by: 'south', at: 5 },
  } as unknown as MahjongEvent;
}

test('a claim never names its tiles from hand on the wire', () => {
  for (const event of [claimEvent('pung', [4, 4]), claimEvent('chow', [2, 3])]) {
    for (const seat of ['east', 'west', 'north', 'south', 'spectator'] as const) {
      const out = mahjongClientEventFor(event, seat, 7);
      const wire = JSON.parse(JSON.stringify(out)) as { move: Record<string, unknown> };
      assert.deepEqual(wire.move.fromHand, [], seat);
      assert.equal(wire.move.action, 'claim', seat);
    }
  }
});

test('a discard still names its tile, which is face up', () => {
  const event = {
    type: 'move-played',
    at: 4,
    roomId: 'mj_test',
    color: 'east',
    move: { action: 'discard', tile: 4, by: 'east', at: 4 },
  } as unknown as MahjongEvent;
  const out = mahjongClientEventFor(event, 'west', 6) as { move: Record<string, unknown> };
  assert.equal(out.move.tile, 4);
});
