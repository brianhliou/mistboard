import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserAccount } from './persistence.js';
import { close, getPool, init } from './persistence-db.js';
import {
  acceptSeekResult,
  createSeekResult,
  type QuickPairDeps,
  quickPairResult,
} from './routes/correspondence-seeks.js';

const me = { id: 'me', handle: 'me', displayName: 'Me' } as UserAccount;
const ctx = { refusesCreate: () => true, drainDeadlineMs: () => null };
const owed = {
  status: 409,
  body: { error: 'first_move_owed', roomId: 'xq_old', opponentName: 'Lee' },
};

test('first move debt refuses posting, accepting, and sending/accepting challenges', async (t) => {
  // Exercise the real handlers without a database or a listening server. Only
  // the debt lookup reaches the pool; refusal must precede any write.
  init('postgres://unused:unused@localhost/unused');
  t.after(() => close());
  let hasDebt = true;
  const query = t.mock.method(getPool(), 'query', async () => ({
    rows: hasDebt ? [{ room_id: 'xq_old', opponent_name: 'Lee' }] : [],
  }));
  for (const [label, act] of [
    ['post', () => createSeekResult(ctx, me, { gameSpecId: 'xiangqi', daysPerMove: 1 }, 'board')],
    ['accept', () => acceptSeekResult(ctx, me, 'seek_public')],
    ['challenge', () => createSeekResult(ctx, me, { targetUserId: 'friend' }, 'board')],
    ['accept challenge', () => acceptSeekResult(ctx, me, 'seek_direct')],
  ] as const) {
    await t.test(label, async () => {
      assert.deepEqual(await act(), owed);
    });
  }
  assert.equal(query.mock.callCount(), 4, 'one read per refusal, no writes');
  hasDebt = false;
  assert.equal(
    (await acceptSeekResult(ctx, me, 'seek_public')).status,
    503,
    'without debt the handler proceeds to the next gate',
  );
});

test('quick pair checks debt before returning an existing seek or taking/posting another', async () => {
  const unexpected = async (): Promise<never> => {
    throw new Error('must stop at first move debt');
  };
  const deps: QuickPairDeps = {
    correspondenceEnabled: () => true,
    variantEnabled: () => true,
    firstMoveOwed: async () => owed,
    listOwnSeeks: unexpected,
    listBoardSeeks: unexpected,
    accept: unexpected,
    post: unexpected,
  };
  assert.deepEqual(await quickPairResult(me, { gameSpecId: 'jieqi', daysPerMove: 1 }, deps), owed);
});
