// The signed-out room invite preview (#1058): the game, the pace and the
// creator's name, for a correspondence room waiting on its second player, and a
// 404 for everything else. The payload carries no board and no identifier.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type InviteRoomSummary,
  invitePreviewFor,
  invitePreviewResult,
} from './correspondence-invite.js';

const waiting: InviteRoomSummary = {
  gameSpecId: 'xiangqi',
  daysPerMove: 3,
  statusType: 'playing',
  seats: [{ userId: 'u_alice', userHandle: 'alice', userDisplayName: 'Alice' }],
};

function deps(room: InviteRoomSummary | null, maySee = true) {
  return { loadRoom: async () => room, anonymousMaySee: async () => maySee };
}

test('invite preview: names the creator, the game and the pace', () => {
  assert.deepEqual(invitePreviewFor(waiting), {
    gameSpecId: 'xiangqi',
    daysPerMove: 3,
    creatorName: 'Alice',
  });
  assert.equal(
    invitePreviewFor({
      ...waiting,
      seats: [{ userId: 'u_alice', userHandle: 'alice', userDisplayName: null }],
    })?.creatorName,
    'alice',
  );
});

test('invite preview: only a correspondence room waiting on one more player', () => {
  assert.equal(invitePreviewFor({ ...waiting, daysPerMove: undefined }), null, 'a live room');
  assert.equal(invitePreviewFor({ ...waiting, daysPerMove: 0 }), null);
  assert.equal(invitePreviewFor({ ...waiting, statusType: 'finished' }), null);
  assert.equal(invitePreviewFor({ ...waiting, statusType: 'aborted' }), null);
  assert.equal(
    invitePreviewFor({
      ...waiting,
      seats: [...waiting.seats, { userId: 'u_bob', userHandle: 'bob', userDisplayName: 'Bob' }],
    }),
    null,
    'both seats held: a game in progress',
  );
  assert.equal(invitePreviewFor({ ...waiting, seats: [] }), null, 'nobody to name');
  assert.equal(
    invitePreviewFor({
      ...waiting,
      seats: [{ userId: null, userHandle: null, userDisplayName: 'Guest' }],
    }),
    null,
    'a guest seat is not an account',
  );
});

test('invite preview route: 404 for a missing room or a variant a stranger may not see', async () => {
  assert.equal((await invitePreviewResult('r1', deps(null))).status, 404);
  assert.equal((await invitePreviewResult('r1', deps(waiting, false))).status, 404);
  assert.equal(
    (await invitePreviewResult('r1', deps({ ...waiting, statusType: 'finished' }))).status,
    404,
  );
});

test('invite preview route: the whole payload is three fields, no board and no identifier', async () => {
  // A fog room whose summary carried extras must still send only the three keys.
  const leaky = {
    ...waiting,
    gameSpecId: 'dark-chess',
    board: { e1: 'K' },
    seats: [
      {
        userId: 'u_alice',
        userHandle: 'alice',
        userDisplayName: 'Alice',
        email: 'alice@example.test',
        deviceId: 'dev-1',
        tokenHash: 'hash-1',
      },
    ],
  } as unknown as InviteRoomSummary;
  const result = await invitePreviewResult('fog_room_1', deps(leaky));
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body).sort(), ['creatorName', 'daysPerMove', 'gameSpecId']);
  const wire = JSON.stringify(result.body);
  for (const secret of ['u_alice', 'example.test', 'dev-1', 'hash-1', 'e1', '"K"', '@alice']) {
    assert.ok(!wire.includes(secret), `payload must not carry ${secret}`);
  }
  assert.deepEqual(result.body, { gameSpecId: 'dark-chess', daysPerMove: 3, creatorName: 'Alice' });
});
