import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserAccount } from './../persistence.js';
import {
  type QuickPairDeps,
  quickPairResult,
  type SeekRouteResult,
} from './correspondence-seeks.js';

const me = { id: 'user-me', handle: 'me', displayName: 'Me' } as UserAccount;
const JIEQI_1D = { gameSpecId: 'jieqi', daysPerMove: 1 };

type Seek = Awaited<ReturnType<QuickPairDeps['listBoardSeeks']>>[number];

function seek(overrides: Partial<Seek> & { id: string }): Seek {
  return {
    creatorUserId: 'user-other',
    gameSpecId: 'jieqi',
    daysPerMove: 1,
    rated: false,
    visibility: 'public',
    targetUserId: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function harness(
  options: {
    own?: Seek[];
    board?: Seek[];
    accept?: (seekId: string) => SeekRouteResult;
    post?: () => SeekRouteResult;
    correspondenceEnabled?: boolean;
    variantEnabled?: boolean;
  } = {},
) {
  const calls = { accept: [] as string[], post: [] as Record<string, unknown>[] };
  const deps: QuickPairDeps = {
    correspondenceEnabled: () => options.correspondenceEnabled ?? true,
    variantEnabled: () => options.variantEnabled ?? true,
    listOwnSeeks: async () => options.own ?? [],
    listBoardSeeks: async () => options.board ?? [],
    accept: async (_user, seekId) => {
      calls.accept.push(seekId);
      return (
        options.accept?.(seekId) ?? {
          status: 201,
          body: { roomId: `jq_${seekId}`, url: `/room/jq_${seekId}`, gameSpecId: 'jieqi' },
        }
      );
    },
    post: async (_user, body) => {
      calls.post.push(body);
      return (
        options.post?.() ?? {
          status: 201,
          body: { seek: { id: 'seek_new', gameSpecId: 'jieqi', daysPerMove: 1 } },
        }
      );
    },
  };
  return { deps, calls };
}

test('quick pair: a guest gets 401 and nothing is read or written', async () => {
  const { deps, calls } = harness({ board: [seek({ id: 'seek_a' })] });
  const result = await quickPairResult(null, JIEQI_1D, deps);
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: 'not_signed_in' });
  assert.deepEqual(calls, { accept: [], post: [] });
});

test('quick pair: posts a casual public 1-day jieqi seek when nobody is waiting', async () => {
  const { deps, calls } = harness();
  const result = await quickPairResult(me, JIEQI_1D, deps);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    kind: 'seek',
    seekId: 'seek_new',
    existing: false,
    gameSpecId: 'jieqi',
    daysPerMove: 1,
  });
  assert.deepEqual(calls.post, [
    {
      gameSpecId: 'jieqi',
      daysPerMove: 1,
      preferredColor: 'random',
      visibility: 'public',
      rated: false,
    },
  ]);
});

test('quick pair: returns the caller own open seek instead of posting a duplicate', async () => {
  const { deps, calls } = harness({
    own: [
      // A private link challenge and a 3-day seek are not the button's offer.
      seek({ id: 'seek_link', creatorUserId: me.id, visibility: 'private' }),
      seek({ id: 'seek_3d', creatorUserId: me.id, daysPerMove: 3 }),
      seek({ id: 'seek_mine', creatorUserId: me.id }),
    ],
    board: [seek({ id: 'seek_other' })],
  });
  const result = await quickPairResult(me, JIEQI_1D, deps);
  assert.equal(result.status, 200);
  assert.equal(result.body.kind, 'seek');
  assert.equal(result.body.seekId, 'seek_mine');
  assert.equal(result.body.existing, true);
  // Waiting already: it neither takes someone else's seek nor posts again.
  assert.deepEqual(calls, { accept: [], post: [] });
});

test('quick pair: accepts the oldest matching seek someone else posted', async () => {
  const { deps, calls } = harness({
    board: [
      seek({ id: 'seek_newer', createdAt: new Date('2026-10-02T00:00:00Z') }),
      seek({ id: 'seek_oldest', createdAt: new Date('2026-09-30T00:00:00Z') }),
      // Older still, but not the button's terms: rated, 3-day, another variant.
      seek({ id: 'seek_rated', rated: true, createdAt: new Date('2026-09-01T00:00:00Z') }),
      seek({ id: 'seek_3d', daysPerMove: 3, createdAt: new Date('2026-09-01T00:00:00Z') }),
      seek({ id: 'seek_xq', gameSpecId: 'xiangqi', createdAt: new Date('2026-09-01T00:00:00Z') }),
    ],
  });
  const result = await quickPairResult(me, JIEQI_1D, deps);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    kind: 'game',
    roomId: 'jq_seek_oldest',
    gameUrl: '/room/jq_seek_oldest',
    gameSpecId: 'jieqi',
    daysPerMove: 1,
  });
  assert.deepEqual(calls.accept, ['seek_oldest']);
  assert.deepEqual(calls.post, []);
});

test('quick pair: never accepts the caller own seek, even when it is the oldest', async () => {
  const { deps, calls } = harness({
    // listOwnSeeks can miss it (a race with an expiry); the board filter still holds.
    board: [
      seek({ id: 'seek_mine', creatorUserId: me.id, createdAt: new Date('2026-09-01T00:00:00Z') }),
      seek({ id: 'seek_other', createdAt: new Date('2026-10-02T00:00:00Z') }),
    ],
  });
  const result = await quickPairResult(me, JIEQI_1D, deps);
  assert.equal(result.body.kind, 'game');
  assert.deepEqual(calls.accept, ['seek_other']);
});

test('quick pair: a seek lost to a racing accepter moves on to the next, then posts', async () => {
  const { deps, calls } = harness({
    board: [
      seek({ id: 'seek_a', createdAt: new Date('2026-09-01T00:00:00Z') }),
      seek({ id: 'seek_b', createdAt: new Date('2026-09-02T00:00:00Z') }),
    ],
    accept: (seekId) =>
      seekId === 'seek_a'
        ? { status: 409, body: { error: 'seek_taken' } }
        : { status: 410, body: { error: 'challenge_expired' } },
  });
  const result = await quickPairResult(me, JIEQI_1D, deps);
  assert.deepEqual(calls.accept, ['seek_a', 'seek_b']);
  assert.equal(calls.post.length, 1);
  assert.equal(result.body.kind, 'seek');
});

test('quick pair: an accept failure that is not about the seek is the answer', async () => {
  const { deps, calls } = harness({
    board: [seek({ id: 'seek_a' })],
    accept: () => ({ status: 503, body: { error: 'server_draining' } }),
  });
  const result = await quickPairResult(me, JIEQI_1D, deps);
  assert.equal(result.status, 503);
  assert.deepEqual(calls.post, []);
});

test('quick pair: anything but casual 1-day jieqi is rejected before any read', async () => {
  for (const body of [
    { gameSpecId: 'xiangqi', daysPerMove: 1 },
    { gameSpecId: 'jieqi', daysPerMove: 3 },
    { gameSpecId: 'jieqi', daysPerMove: '1' },
    { gameSpecId: 'jieqi', daysPerMove: 1, rated: true },
    {},
  ]) {
    const { deps, calls } = harness({ board: [seek({ id: 'seek_a' })] });
    const result = await quickPairResult(me, body, deps);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(result.body, { error: 'quick_pair_unsupported' });
    assert.deepEqual(calls, { accept: [], post: [] });
  }
});

test('quick pair: refused while correspondence or the jieqi variant is switched off', async () => {
  const off = harness({ correspondenceEnabled: false });
  assert.deepEqual(await quickPairResult(me, JIEQI_1D, off.deps), {
    status: 404,
    body: { error: 'correspondence_disabled' },
  });
  const variantOff = harness({ variantEnabled: false, board: [seek({ id: 'seek_a' })] });
  assert.deepEqual(await quickPairResult(me, JIEQI_1D, variantOff.deps), {
    status: 404,
    body: { error: 'variant_disabled' },
  });
  assert.deepEqual(variantOff.calls, { accept: [], post: [] });
});

test('quick pair: a play-locked account is refused', async () => {
  const locked = { ...me, playDisabledAt: new Date() } as UserAccount;
  const { deps, calls } = harness({ board: [seek({ id: 'seek_a' })] });
  const result = await quickPairResult(locked, JIEQI_1D, deps);
  assert.equal(result.status, 403);
  assert.deepEqual(calls, { accept: [], post: [] });
});

test('quick pair: a refused post (seek cap) is passed through', async () => {
  const { deps } = harness({
    post: () => ({ status: 409, body: { error: 'seek_limit_reached', limit: 6 } }),
  });
  const result = await quickPairResult(me, JIEQI_1D, deps);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'seek_limit_reached');
});
