// Three Kingdoms banqi (#628) closed playtest (#684): a finished TK room is
// read back from Postgres when an admin opens /room/tkb_<id> after the room
// has left memory (a deploy, a restart). The web client routes tkb_ rooms by
// prefix, so this hydration is what the admin's room link reaches.
//
// Planted failures: a guest and a signed-in non-admin get the same refusal as
// for a live room ('game spec disabled'), never the finished board; and an id
// that was never written stays 'room unavailable' even for the admin.
import {
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiLegalMoves,
  THREE_KINGDOMS_BANQI_SPEC_ID,
} from '@mistboard/game';
import { appendRoomEvent, type UserAccount } from './persistence.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { resolveWebSocketLiveRuntime } from './server-ws-connection.js';
import { threeKingdomsBanqiRooms } from './three-kingdoms-banqi-registration.js';
import type { ThreeKingdomsBanqiEvent } from './three-kingdoms-banqi-tenant.js';
import './variant-tenant/register-tenants.js';
import {
  registeredVariantTenants,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';

const FLAG = 'MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED';

function account(accountRole: UserAccount['accountRole']): UserAccount {
  return {
    id: `${accountRole}-tk-persist`,
    handle: accountRole,
    displayName: accountRole,
    accountRole,
    playDisabledAt: null,
  } as UserAccount;
}

function registration(): VariantTenantRegistration {
  const found = registeredVariantTenants().find(
    (candidate) => candidate.gameSpecId === THREE_KINGDOMS_BANQI_SPEC_ID,
  );
  assert.ok(found, 'three kingdoms banqi is registered');
  return found;
}

definePersistenceTests('three kingdoms banqi room', () => {
  test('a finished TK room loads from Postgres for an admin only', async () => {
    const roomId = 'tkb_persistedfinished';
    const now = Date.now();
    const deal = createThreeKingdomsBanqiSetup(Math.random).deal;
    const firstMove = getThreeKingdomsBanqiLegalMoves(
      createThreeKingdomsBanqiStateFromSetup(roomId, { deal }),
    )[0];
    assert.ok(firstMove, 'the opening position has a legal move');
    const events: ThreeKingdomsBanqiEvent[] = [
      {
        type: 'room-created',
        at: now - 4,
        roomId,
        gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
        timeControl: { initialMs: 300_000, incrementMs: 5_000 },
        setup: { deal },
      },
      { type: 'seat-assigned', at: now - 3, roomId, clientId: 'tk-a', seat: 'red' },
      { type: 'seat-assigned', at: now - 2, roomId, clientId: 'tk-b', seat: 'black' },
      { type: 'move-played', at: now - 1, roomId, color: 'red', move: firstMove },
      { type: 'seat-resigned', at: now, roomId, color: 'black' },
    ];
    for (const [seq, event] of events.entries()) await appendRoomEvent(roomId, seq, event);

    const before = process.env[FLAG];
    delete process.env[FLAG]; // prod: the closed playtest
    threeKingdomsBanqiRooms.delete(roomId);
    try {
      const reg = registration();
      for (const user of [null, account('player')]) {
        assert.deepEqual(
          await resolveWebSocketLiveRuntime([reg], roomId, async () => user),
          { kind: 'variant-tenant-unavailable', reason: 'game spec disabled' },
          `${user?.accountRole ?? 'guest'} must not open a finished TK room`,
        );
      }
      assert.equal(threeKingdomsBanqiRooms.has(roomId), false, 'a refusal hydrates nothing');

      const admitted = await resolveWebSocketLiveRuntime([reg], roomId, async () =>
        account('admin'),
      );
      assert.equal(admitted.kind, 'variant-tenant');
      if (admitted.kind !== 'variant-tenant') return;
      assert.equal(admitted.room.projection?.state.status.type, 'finished');

      assert.deepEqual(
        await resolveWebSocketLiveRuntime([reg], 'tkb_neverwritten', async () => account('admin')),
        { kind: 'variant-tenant-unavailable', reason: 'room unavailable' },
      );
    } finally {
      threeKingdomsBanqiRooms.delete(roomId);
      if (before === undefined) delete process.env[FLAG];
      else process.env[FLAG] = before;
    }
  });
});
