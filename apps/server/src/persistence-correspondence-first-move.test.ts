import { correspondenceTimeControl, DAY_MS } from '@mistboard/game';
import { enableCorrespondenceVariantFlags, legalMoveFor } from './correspondence-test-support.js';
import {
  createCorrespondenceSeek,
  createUser,
  firstMoveOwedForUser,
  getCorrespondenceSeek,
  listRoomLifecycleAudit,
  loadRoomEvents,
  type UserAccount,
  upsertRoomDeadline,
} from './persistence.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { acceptSeekResult, createSeekResult } from './routes/correspondence-seeks.js';
import './variant-tenant/register-tenants.js';
import { appendTenantEvent } from './variant-tenant/events.js';
import { sweepTenantRoomDeadline } from './variant-tenant/lifecycle.js';
import { correspondenceTenantForSpecId } from './variant-tenant/registry.js';
import type { XiangqiRuntimeRoom } from './xiangqi-runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

enableCorrespondenceVariantFlags();
const ctx = { refusesCreate: () => false, drainDeadlineMs: () => null };
const terms = { gameSpecId: 'xiangqi', daysPerMove: 1, preferredColor: 'first' };

definePersistenceTests('correspondence first move debt (#1131)', () => {
  for (const action of ['post', 'accept', 'challenge', 'accept challenge'] as const) {
    test(`${action}: refuses while owed and allows after the first move`, async (t) => {
      const me = await account('me');
      const opponent = await account('opponent');
      const friend = await account('friend');
      const room = await game(me, opponent);
      t.after(() => correspondenceTenantForSpecId('xiangqi')!.clearRooms());
      const seekId = `seek-${action}`;
      await createCorrespondenceSeek({
        id: seekId,
        creatorUserId: friend.id,
        ...terms,
        preferredColor: 'second',
        targetUserId: action === 'accept challenge' ? me.id : null,
        visibility: action === 'accept challenge' ? 'private' : 'public',
        expiresAt: null,
      });
      const run = () =>
        action === 'post' || action === 'challenge'
          ? createSeekResult(
              ctx,
              me,
              {
                ...terms,
                ...(action === 'challenge' ? { targetHandle: friend.handle } : {}),
              },
              'board',
            )
          : acceptSeekResult(ctx, me, seekId);
      assert.deepEqual(await run(), {
        status: 409,
        body: { error: 'first_move_owed', roomId: room.id, opponentName: 'opponent' },
      });
      assert.ok(await getCorrespondenceSeek(seekId), 'refusal does not consume the seek');
      assert.equal(
        await firstMoveOwedForUser(opponent.id),
        null,
        'waiting on the opponent is allowed',
      );
      await move(room);
      assert.equal(await firstMoveOwedForUser(me.id), null);
      assert.equal(
        (await firstMoveOwedForUser(opponent.id))?.roomId,
        room.id,
        'second mover now owes',
      );
      assert.equal((await run()).status, 201);
    });
  }

  test('chooses the oldest game, releases each seat, and ignores live, PvE and finished games', async (t) => {
    const me = await account('me');
    const opponent = await account('opponent');
    t.after(() => correspondenceTenantForSpecId('xiangqi')!.clearRooms());
    assert.equal(await firstMoveOwedForUser(me.id), null, 'no games');
    const old = await game(me, opponent);
    const newer = await game(me, opponent);
    // The oldest allowance need not be the earliest deadline.
    await getPool().query(
      "UPDATE room_deadlines SET due_at = due_at + interval '7 days' WHERE room_id = $1",
      [old.id],
    );
    await getPool().query(
      "UPDATE events SET created_at = created_at - interval '1 day' WHERE room_id = $1 AND seq = 0",
      [old.id],
    );
    assert.equal((await firstMoveOwedForUser(me.id))?.roomId, old.id);
    await move(old);
    assert.equal((await firstMoveOwedForUser(me.id))?.roomId, newer.id);
    await move(newer);
    await move(newer);
    await move(old);
    assert.equal(await firstMoveOwedForUser(me.id), null, 'two plies close pregame');
    assert.equal(await firstMoveOwedForUser(opponent.id), null, 'second move made');

    const finished = await game(me, opponent);
    await appendTenantEvent(xiangqiTenant, finished, {
      type: 'game-aborted',
      roomId: finished.id,
      at: Date.now(),
      reason: 'user-abort',
    });
    assert.equal(await firstMoveOwedForUser(me.id), null, 'aborted game');
    const resigned = await game(me, opponent);
    await appendTenantEvent(xiangqiTenant, resigned, {
      type: 'seat-resigned',
      roomId: resigned.id,
      at: Date.now(),
      color: 'red',
    });
    await upsertRoomDeadline({
      roomId: resigned.id,
      gameSpecId: 'xiangqi',
      seat: 'red',
      seatUserId: me.id,
      dueAt: new Date(),
    });
    assert.equal(await firstMoveOwedForUser(me.id), null, 'finished game');
    const live = await game(me, opponent);
    const pve = await game(me, opponent);
    // Keep deadline rows deliberately: the persisted time control and bot
    // identity must prevent a false block even with a stale index entry.
    await getPool().query(
      `UPDATE events SET payload = jsonb_set(payload, '{timeControl}',
      '{"initialMs":60000,"incrementMs":0}'::jsonb) WHERE room_id = $1 AND seq = 0`,
      [live.id],
    );
    await getPool().query(
      `UPDATE events SET payload = jsonb_set(payload, '{pveBotId}',
      '"xiangqi-bot"'::jsonb) WHERE room_id = $1 AND seq = 0`,
      [pve.id],
    );
    assert.equal(await firstMoveOwedForUser(me.id), null);
  });

  for (const plies of [0, 1]) {
    test(`pregame timeout after ${plies} plies retains the stalling account privately`, async (t) => {
      const first = await account('first');
      const second = await account('second');
      const room = await game(first, second);
      t.after(() => correspondenceTenantForSpecId('xiangqi')!.clearRooms());
      if (plies) await move(room);
      const expectedSeat = plies ? 'black' : 'red';
      const expectedUser = plies ? second.id : first.id;
      const result = await sweepTenantRoomDeadline(xiangqiTenant, room, {
        now: () => Date.now() + 2 * DAY_MS,
        appendEvent: (target, event) => appendTenantEvent(xiangqiTenant, target, event),
        broadcastEventAppended: () => {},
      });
      assert.equal(result, 'aborted');
      const audit = await listRoomLifecycleAudit({ roomId: room.id });
      const stalled = audit.filter((row) => row.kind === 'correspondence-first-move-stalled');
      assert.equal(stalled.length, 1);
      assert.deepEqual(stalled[0]?.payload, {
        userId: expectedUser,
        seat: expectedSeat,
        gameSpecId: 'xiangqi',
      });
      assert.equal(stalled[0]?.eventSeq, room.events.length - 1);
      assert.equal(await firstMoveOwedForUser(expectedUser), null, 'abort clears the block');
      const events = await loadRoomEvents(room.id);
      assert.doesNotMatch(JSON.stringify(events), /user-first|user-second|stallingUserId/);
      const again = await sweepTenantRoomDeadline(xiangqiTenant, room, {
        now: () => Date.now() + 3 * DAY_MS,
        appendEvent: (target, event) => appendTenantEvent(xiangqiTenant, target, event),
        broadcastEventAppended: () => {},
      });
      assert.equal(again, 'no-deadline');
      assert.equal((await listRoomLifecycleAudit({ roomId: room.id })).length, audit.length);
    });
  }
});

async function account(handle: string): Promise<UserAccount> {
  const user = { id: `user-${handle}`, handle, displayName: handle } as UserAccount;
  await createUser({
    ...user,
    email: `${handle}@example.com`,
    emailVerifiedAt: new Date(),
    now: new Date(),
  });
  return user;
}

async function game(first: UserAccount, second: UserAccount): Promise<XiangqiRuntimeRoom> {
  const registration = correspondenceTenantForSpecId('xiangqi')!;
  const created = await registration.createCorrespondenceGameForSeek!({
    timeControl: correspondenceTimeControl(1),
    first: { userId: first.id },
    second: { userId: second.id },
  });
  assert.ok(created.ok);
  return registration.rooms.get(created.room.id) as unknown as XiangqiRuntimeRoom;
}

async function move(room: XiangqiRuntimeRoom): Promise<void> {
  const status = room.projection.state.status;
  assert.equal(status.type, 'playing');
  assert.ok(status.type === 'playing');
  const seq = await appendTenantEvent(xiangqiTenant, room, {
    type: 'move-played',
    at: Date.now(),
    roomId: room.id,
    color: status.turn,
    move: legalMoveFor('xiangqi', room.projection.state as never) as Parameters<
      typeof xiangqiTenant.rules.applyMove
    >[1],
  });
  assert.notEqual(seq, -1);
}
