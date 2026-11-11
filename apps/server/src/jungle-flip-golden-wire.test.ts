import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { createJungleFlipDeal } from '@mistboard/game';
import { JUNGLE_FLIP_DEFAULT_ENGINE_ID } from './jungle-flip-engine.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

const fixture = new URL('../src/fixtures/jungle-flip-wire-golden.json', import.meta.url);

test('Flip Jungle wire golden keeps the historical id at Level 7 and the neural id at Level 8', () => {
  const snapshots = [JUNGLE_FLIP_DEFAULT_ENGINE_ID, 'misty-jungle-flip-level-8'].map((engineId) => {
    const roomId = 'jgf_golden_net';
    const created = createTenantRuntimeRoomFromEvents(jungleFlipTenant, [
      {
        type: 'room-created',
        at: 1000,
        roomId,
        gameSpecId: 'jungle-flip',
        setup: createJungleFlipDeal(() => 0.5),
      },
      { type: 'seat-assigned', at: 1000, roomId, clientId: engineId, seat: 'red' },
      { type: 'seat-assigned', at: 2000, roomId, clientId: 'client-black', seat: 'black' },
    ]);
    assert.ok(created.ok);
    return Object.fromEntries(
      (['red', 'black', 'spectator'] as const).map((seat) => {
        const payload = tenantSnapshotPayload(jungleFlipTenant, created.room, {
          id: `client-${seat}`,
          seat,
          solo: false,
        });
        return [seat, { ...payload, serverAt: 0 }];
      }),
    );
  });
  const actual = JSON.parse(JSON.stringify(snapshots));
  // Record only intentional wire changes, then review the entire fixture diff.
  if (process.env.MISTBOARD_GOLDEN_RECORD === '1')
    writeFileSync(fixture, `${JSON.stringify(actual, null, 2)}\n`);
  assert.deepEqual(actual, JSON.parse(readFileSync(fixture, 'utf8')));
  for (const [index, level] of [7, 8].entries()) {
    const wire = JSON.stringify(actual[index]);
    assert.ok(wire.includes(`Misty Level ${level}`));
    assert.ok(!wire.includes('"setup"'), 'secret deal is absent from the entire payload');
    assert.ok(!wire.includes('"role":"'), 'face-down pieces have no identity in any seat payload');
  }
});
