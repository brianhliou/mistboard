// The /correspondence "Recent opponents" row's route (#1058): handle and
// display name only, never the player's own account, at most eight.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RECENT_OPPONENTS_LIMIT,
  type RecentOpponentJson,
  recentOpponentsForUser,
} from './correspondence-games.js';

const me = { id: 'u_me', handle: 'Me' };

test('recent opponents: passes the limit and drops the player own handle', async () => {
  let askedLimit = 0;
  const body = await recentOpponentsForUser(me, {
    list: async (userId, options) => {
      assert.equal(userId, 'u_me');
      askedLimit = options.limit;
      return [
        { handle: 'alice', displayName: 'Alice' },
        { handle: 'me', displayName: 'Me' },
        { handle: 'bob', displayName: '' },
      ];
    },
  });
  assert.equal(askedLimit, RECENT_OPPONENTS_LIMIT);
  assert.deepEqual(body, {
    opponents: [
      { handle: 'alice', displayName: 'Alice' },
      { handle: 'bob', displayName: 'bob' },
    ],
  });
});

test('recent opponents: each row carries handle and display name only', async () => {
  const leaky = {
    handle: 'alice',
    displayName: 'Alice',
    email: 'alice@example.test',
    deviceId: 'dev-1',
    id: 'u_alice',
  } as RecentOpponentJson;
  const body = await recentOpponentsForUser(me, { list: async () => [leaky] });
  const wire = JSON.stringify(body);
  assert.deepEqual(Object.keys(body.opponents[0] ?? {}).sort(), ['displayName', 'handle']);
  assert.ok(!wire.includes('example.test'), 'no email on the wire');
  assert.ok(!wire.includes('dev-1'), 'no device id on the wire');
  assert.ok(!wire.includes('u_alice'), 'no account id on the wire');
});

test('recent opponents: never more than the limit', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ handle: `p${i}`, displayName: `P${i}` }));
  const body = await recentOpponentsForUser(me, { list: async () => rows });
  assert.equal(body.opponents.length, RECENT_OPPONENTS_LIMIT);
  assert.equal(body.opponents[0]?.handle, 'p0');
});
