import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UserAccount } from '../persistence.js';
import {
  HOST_DAYS_PER_MOVE,
  HOST_MAX_ACTIVE_GAMES,
  HOST_MAX_GAMES_PER_PLAYER,
  type HostCounts,
  type HostDeps,
  hostChallengeResult,
  hostInfoResult,
} from './correspondence-host.js';

const brian = { id: 'u-brian', handle: 'brian', displayName: 'Brian' } as UserAccount;
const me = { id: 'u-me', handle: 'me', displayName: 'Me' } as UserAccount;

type Calls = {
  posts: Array<{ host: UserAccount; body: Record<string, unknown> }>;
  accepts: Array<{ player: UserAccount; seekId: string }>;
  cancels: string[];
};

function harness(overrides: Partial<HostDeps> & { counts?: HostCounts } = {}): {
  deps: HostDeps;
  calls: Calls;
} {
  const calls: Calls = { posts: [], accepts: [], cancels: [] };
  const counts = overrides.counts ?? { total: 0, withPlayer: 0 };
  const deps: HostDeps = {
    correspondenceEnabled: () => true,
    hostHandle: () => 'brian',
    findHost: async (handle) => (handle === 'brian' ? brian : null),
    countGames: async () => counts,
    specIds: () => ['xiangqi', 'jieqi'],
    post: async (host, body) => {
      calls.posts.push({ host, body });
      return { status: 201, body: { seek: { id: 'seek_1' } } };
    },
    accept: async (player, seekId) => {
      calls.accepts.push({ player, seekId });
      return {
        status: 201,
        body: { roomId: 'room_1', url: '/xiangqi/room_1', seat: 'red', gameSpecId: 'xiangqi' },
      };
    },
    cancel: async (_host, seekId) => {
      calls.cancels.push(seekId);
    },
    ...overrides,
  };
  return { deps, calls };
}

test('host off: no handle, no account, or correspondence off is a 404 everywhere', async () => {
  for (const overrides of [
    { hostHandle: () => null },
    { findHost: async () => null },
    { correspondenceEnabled: () => false },
  ] satisfies Array<Partial<HostDeps>>) {
    const { deps, calls } = harness(overrides);
    assert.deepEqual(await hostInfoResult(me, deps), {
      status: 404,
      body: { error: 'host_disabled' },
    });
    assert.equal((await hostInfoResult(null, deps)).status, 404);
    const posted = await hostChallengeResult(me, { gameSpecId: 'xiangqi' }, deps);
    assert.equal(posted.status, 404);
    assert.equal(calls.posts.length, 0);
  }
});

test('a guest sees the card terms but cannot start a game', async () => {
  const { deps, calls } = harness();
  const info = await hostInfoResult(null, deps);
  assert.equal(info.status, 200);
  assert.equal(info.body.signedIn, false);
  assert.deepEqual(info.body.host, { handle: 'brian', displayName: 'Brian' });
  assert.equal(info.body.daysPerMove, HOST_DAYS_PER_MOVE);
  assert.deepEqual(info.body.gameSpecIds, ['xiangqi', 'jieqi']);

  const posted = await hostChallengeResult(null, { gameSpecId: 'xiangqi' }, deps);
  assert.deepEqual(posted, { status: 401, body: { error: 'not_signed_in' } });
  assert.equal(calls.posts.length, 0);
});

test('the host cannot challenge himself', async () => {
  const { deps, calls } = harness();
  const info = await hostInfoResult(brian, deps);
  assert.equal(info.body.isHost, true);
  assert.equal(info.body.canPlay, false);
  const posted = await hostChallengeResult(brian, { gameSpecId: 'xiangqi' }, deps);
  assert.deepEqual(posted, { status: 400, body: { error: 'cannot_challenge_self' } });
  assert.equal(calls.posts.length, 0);
});

test('a variant the host does not offer is refused before any seek', async () => {
  const { deps, calls } = harness();
  const posted = await hostChallengeResult(me, { gameSpecId: 'dark-chess' }, deps);
  assert.deepEqual(posted, { status: 400, body: { error: 'host_unsupported_spec' } });
  assert.equal(calls.posts.length, 0);
});

test('two active games with the host: the player is refused, and told so on GET', async () => {
  const { deps, calls } = harness({
    counts: { total: 3, withPlayer: HOST_MAX_GAMES_PER_PLAYER },
  });
  const info = await hostInfoResult(me, deps);
  assert.equal(info.body.canPlay, false);
  assert.equal(info.body.reason, 'player_limit_reached');
  assert.equal(info.body.activeWithYou, HOST_MAX_GAMES_PER_PLAYER);
  const posted = await hostChallengeResult(me, { gameSpecId: 'xiangqi' }, deps);
  assert.deepEqual(posted, {
    status: 409,
    body: { error: 'player_limit_reached', limit: HOST_MAX_GAMES_PER_PLAYER },
  });
  assert.equal(calls.posts.length, 0);
});

test('the host at fifteen active games refuses everyone', async () => {
  const { deps, calls } = harness({ counts: { total: HOST_MAX_ACTIVE_GAMES, withPlayer: 0 } });
  const info = await hostInfoResult(me, deps);
  assert.equal(info.body.canPlay, false);
  assert.equal(info.body.reason, 'host_full');
  const posted = await hostChallengeResult(me, { gameSpecId: 'xiangqi' }, deps);
  assert.deepEqual(posted, {
    status: 409,
    body: { error: 'host_full', limit: HOST_MAX_ACTIVE_GAMES },
  });
  assert.equal(calls.posts.length, 0);
});

test('one below each cap still plays', async () => {
  const { deps } = harness({
    counts: { total: HOST_MAX_ACTIVE_GAMES - 1, withPlayer: HOST_MAX_GAMES_PER_PLAYER - 1 },
  });
  const info = await hostInfoResult(me, deps);
  assert.equal(info.body.canPlay, true);
  assert.equal(info.body.reason, null);
  assert.equal((await hostChallengeResult(me, { gameSpecId: 'xiangqi' }, deps)).status, 201);
});

test('the host takes the side the player did not pick; random stays random', async () => {
  const cases: Array<[unknown, string]> = [
    ['first', 'second'],
    ['second', 'first'],
    ['random', 'random'],
    [undefined, 'random'],
    ['nonsense', 'random'],
  ];
  for (const [side, hostSide] of cases) {
    const { deps, calls } = harness();
    await hostChallengeResult(me, { gameSpecId: 'jieqi', side }, deps);
    assert.equal(calls.posts[0]?.body.preferredColor, hostSide, `player side ${String(side)}`);
  }
});

test('a start posts a casual 2-day private seek as the host and accepts it as the player', async () => {
  const { deps, calls } = harness();
  const result = await hostChallengeResult(
    me,
    { gameSpecId: 'xiangqi', side: 'first', daysPerMove: 7, rated: true },
    deps,
  );
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    roomId: 'room_1',
    url: '/xiangqi/room_1',
    seat: 'red',
    gameSpecId: 'xiangqi',
    daysPerMove: HOST_DAYS_PER_MOVE,
    rated: false,
    host: { handle: 'brian', displayName: 'Brian' },
  });
  // The body's own daysPerMove and rated are ignored: the terms are fixed.
  assert.equal(calls.posts.length, 1);
  assert.equal(calls.posts[0]?.host, brian);
  assert.deepEqual(calls.posts[0]?.body, {
    gameSpecId: 'xiangqi',
    daysPerMove: 2,
    preferredColor: 'second',
    targetUserId: me.id,
    rated: false,
  });
  assert.deepEqual(calls.accepts, [{ player: me, seekId: 'seek_1' }]);
  assert.deepEqual(calls.cancels, []);
});

test('a refused post passes its answer through and accepts nothing', async () => {
  const { deps, calls } = harness({
    post: async () => ({ status: 403, body: { error: 'challenge_blocked' } }),
  });
  const result = await hostChallengeResult(me, { gameSpecId: 'xiangqi' }, deps);
  assert.deepEqual(result, { status: 403, body: { error: 'challenge_blocked' } });
  assert.equal(calls.accepts.length, 0);
});

test('a refused accept withdraws the host seek so it never stands', async () => {
  const { deps, calls } = harness({
    accept: async () => ({ status: 503, body: { error: 'server_draining' } }),
  });
  const result = await hostChallengeResult(me, { gameSpecId: 'xiangqi' }, deps);
  assert.deepEqual(result, { status: 503, body: { error: 'server_draining' } });
  assert.deepEqual(calls.cancels, ['seek_1']);
});
