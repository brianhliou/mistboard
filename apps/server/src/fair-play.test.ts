import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { calculateFairPlayRefunds, type RefundGame } from './fair-play.js';
import type { UserAccount } from './persistence.js';
import { ratedSeekError } from './routes/correspondence-seeks.js';
import { gateRatedRoomRequest } from './variant-tenant/rooms-route.js';
import { assignTenantSeat, type TenantSeatRoom } from './variant-tenant/seat-session.js';

const marked = { id: 'marked', fairPlayMarkedAt: new Date() } as unknown as UserAccount;

test('fair play: a marked account cannot create a rated friend room; casual stays open', () => {
  process.env.MISTBOARD_RATED_ENABLED = 'true';
  const args = {
    requested: true,
    mode: 'pvp' as const,
    offered: true,
    accountUser: marked,
    timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    unsupportedSurfaceError: 'unsupported',
  };
  assert.deepEqual(gateRatedRoomRequest(args), {
    ok: false,
    status: 403,
    error: 'rated_account_marked',
  });
  assert.deepEqual(gateRatedRoomRequest({ ...args, requested: false }), { ok: true, rated: false });
});

test('fair play: marked accounts take no new rated seat but retain existing games', () => {
  const tenant = { colors: ['white', 'black'] as const };
  const room: TenantSeatRoom<'white' | 'black'> = {
    rated: true,
    clients: new Set(),
    projection: { seats: {} },
    seatTokens: {},
  };
  assert.deepEqual(assignTenantSeat(tenant, room, 'new', undefined, marked), {
    ok: false,
    reason: 'rated_account_marked',
  });
  room.rated = false;
  assert.ok(assignTenantSeat(tenant, room, 'first', undefined, marked).ok);
  room.rated = true;
  assert.ok(assignTenantSeat(tenant, room, 'reconnect', undefined, marked).ok);
});

function game(overrides: Partial<RefundGame> = {}): RefundGame {
  return {
    gameId: 'g',
    beneficiaryId: 'opponent',
    handle: 'opponent',
    bucket: { variant: 'xiangqi', timeClass: 'blitz' },
    outcome: 'loss',
    before: 1500,
    after: 1490,
    currentRd: 100,
    ...overrides,
  };
}

test('refunds: only the newest 40 games count, even when earlier games do not pay', () => {
  const games = Array.from({ length: 41 }, (_, i) =>
    game({ gameId: `g${i}`, beneficiaryId: `p${i}`, outcome: i < 40 ? 'win' : 'loss' }),
  );
  assert.deepEqual(calculateFairPlayRefunds(games), []);
  assert.equal(calculateFairPlayRefunds(games.map((g) => ({ ...g, outcome: 'loss' }))).length, 40);
});

test('refunds: the window counts games, not rows, so a three-seat game uses one slot', () => {
  // Game 0 has two opponents (one row each); games 1-39 one each: 40 games, 41 rows.
  const games = [
    game({ gameId: 'g0', beneficiaryId: 'a' }),
    game({ gameId: 'g0', beneficiaryId: 'b' }),
    ...Array.from({ length: 39 }, (_, i) => game({ gameId: `g${i + 1}`, beneficiaryId: `p${i}` })),
    game({ gameId: 'g40', beneficiaryId: 'late' }),
  ];
  const paid = calculateFairPlayRefunds(games).map((r) => r.beneficiaryId);
  assert.equal(paid.length, 41);
  assert.ok(paid.includes('p38'));
  assert.ok(!paid.includes('late'));
});

test('refunds: wins, draws, non-loss deltas, guests and provisional pools pay nothing', () => {
  assert.deepEqual(
    calculateFairPlayRefunds([
      game({ outcome: 'win' }),
      game({ outcome: 'draw' }),
      game({ after: 1510 }),
      game({ after: 1500 }),
      game({ beneficiaryId: null }),
      game({ currentRd: 111 }),
      game({ currentRd: null }),
      game({ bucket: null }),
      game({ after: null }),
    ]),
    [],
  );
  assert.equal(calculateFairPlayRefunds([game({ currentRd: 110 })])[0]?.points, 10);
});

test('refunds: 200 lost points cap at 150 separately for each opponent and pool', () => {
  const refunds = calculateFairPlayRefunds([
    game({ gameId: 'live1', after: 1400 }),
    game({ gameId: 'live2', after: 1400 }),
    game({
      gameId: 'cx1',
      after: 1300,
      bucket: { variant: 'xiangqi', timeClass: 'correspondence' },
    }),
    game({ gameId: 'variant', after: 1300, bucket: { variant: 'jieqi', timeClass: 'blitz' } }),
    game({ gameId: 'other', beneficiaryId: 'other', after: 1300 }),
  ]);
  assert.deepEqual(
    refunds.map((r) => r.points),
    [100, 50, 150, 150, 150],
  );
});

test('refunds: already refunded games consume the cap without paying twice', () => {
  assert.deepEqual(
    calculateFairPlayRefunds([
      game({ gameId: 'new', after: 1400 }),
      game({ gameId: 'old', refunded: 100 }),
    ]).map((r) => [r.gameId, r.points]),
    [['new', 50]],
  );
});

test('fair play: rated correspondence gate refuses marked accounts', () => {
  assert.equal(
    ratedSeekError(
      'xiangqi',
      { initialMs: 86400000, incrementMs: 0, daysPerMove: 1 },
      true,
      marked,
    ),
    'rated_account_marked',
  );
});

test('account flags: dry run cannot mix account writes, and plain node loads the fair-play helper', () => {
  const script = fileURLToPath(new URL('../../../scripts/account-flags.mjs', import.meta.url));
  for (const [flags, expected] of [
    [['--mark-fair-play', '--unmark-fair-play'], /Pass one of --mark-fair-play/],
    [
      ['--mark-fair-play', '--dry-run', '--grant-admin'],
      /--dry-run requires --mark-fair-play alone/,
    ],
    [['--dry-run'], /--dry-run requires --mark-fair-play alone/],
    [['--mark-fair-play', '--dry-run'], /DATABASE_URL is not set/],
  ] as const) {
    const result = spawnSync(process.execPath, [script, '@test', ...flags], {
      encoding: 'utf8',
      env: {},
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});
