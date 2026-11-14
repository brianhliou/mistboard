import { renderMistboardReadoutMarkdown } from './mistboard-readout.js';
import { getPool } from './persistence-db.js';
import {
  collectBotTiming,
  collectDeploys,
  collectMistboardReadoutFacts,
  generateMistboardReadout,
  latestMistboardReadout,
} from './persistence-mistboard-readout.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

type ParticipantFixture = {
  color: 'white' | 'black' | 'red';
  subjectType: 'guest' | 'user' | 'engine-version' | 'bot';
  subjectId: string;
};

async function insertGame(input: {
  roomId: string;
  variant: string;
  mode: 'pvp' | 'pve' | 'eve';
  endedAt: string;
  status?: 'completed' | 'aborted';
  result?: string;
  termination?: string;
  participants: ParticipantFixture[];
}): Promise<void> {
  const status = input.status ?? 'completed';
  await getPool().query(
    `INSERT INTO games
       (room_id, variant, mode, status, result, termination, ply_count, started_at, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, 20, $7::timestamptz - interval '10 minutes', $7)`,
    [
      input.roomId,
      input.variant,
      input.mode,
      status,
      // games_status_shape_check: a completed row carries a result, an aborted
      // row carries a termination and no result.
      status === 'completed' ? (input.result ?? 'white-wins') : null,
      status === 'completed' ? (input.termination ?? 'checkmate') : 'engine-failure',
      input.endedAt,
    ],
  );
  for (const participant of input.participants) {
    await getPool().query(
      `INSERT INTO game_participants (game_id, color, subject_type, subject_id, display_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.roomId,
        participant.color,
        participant.subjectType,
        participant.subjectId,
        participant.subjectId,
      ],
    );
  }
}

definePersistenceTests('Mistboard readout', () => {
  const deliveryRuntime = {
    revision: null,
    activeGames: 0,
    databaseRequired: true,
    persistence: 'enabled' as const,
    persistenceErrors: { count1m: 0, lastAt: null },
  };
  const deliveryNow = new Date('2026-11-03T17:23:00Z');
  const deliveryReport = (now = deliveryNow) =>
    generateMistboardReadout({
      trigger: 'manual',
      now,
      runtime: deliveryRuntime,
      db: getPool(),
    });
  async function sends(count: number) {
    await getPool().query(
      `INSERT INTO login_email_requests (request_id, email, requested_at, provider_email_id)
      SELECT 'login-' || n, 'player@example.com', $1::timestamptz - interval '1 hour', 'provider-' || n
      FROM generate_series(1, $2::int) n ON CONFLICT DO NOTHING`,
      [deliveryNow, count],
    );
    await getPool().query(
      `INSERT INTO email_delivery_events
      (event_id, provider_email_id, event_type, recipients, occurred_at)
      SELECT 'sent-' || n, 'provider-' || n, 'email.sent', ARRAY['player@example.com'], $1::timestamptz - interval '1 hour'
      FROM generate_series(1, $2::int) n ON CONFLICT DO NOTHING`,
      [deliveryNow, count],
    );
  }
  async function deliveryEvent(
    id: string,
    provider: string,
    type: string,
    at = new Date(deliveryNow.getTime() - 1000),
  ) {
    await getPool().query(
      `INSERT INTO email_delivery_events
      (event_id, provider_email_id, event_type, recipients, occurred_at)
      VALUES ($1, $2, $3, ARRAY['player@example.com'], $4)`,
      [id, provider, type, at],
    );
  }

  test('login delivery aggregates enforce rate boundaries, dedupe snapshots, recover, and re-cross', async () => {
    const zero = await deliveryReport();
    assert.equal(zero.report.loginEmailDelivery?.last7d.sent, 0);
    assert.ok(!zero.report.collectorErrors.some((e) => e.section === 'loginEmailDelivery'));
    await sends(19);
    await deliveryEvent('bounce-1', 'provider-1', 'email.bounced');
    await deliveryEvent('suppressed-1', 'provider-2', 'email.suppressed');
    await deliveryEvent('bounce-retry', 'provider-1', 'email.bounced');
    await deliveryEvent('unrelated', 'non-login', 'email.complained');
    const belowFloor = await deliveryReport();
    assert.equal(belowFloor.report.loginEmailDelivery?.last7d.sent, 19);
    assert.equal(belowFloor.report.loginEmailDelivery?.last7d.bounced, 1);
    assert.ok(!belowFloor.report.actions.some((a) => a.code === 'login-email-delivery-rate'));
    await sends(20);
    const crossed = await deliveryReport();
    assert.ok(crossed.report.actions.some((a) => a.code === 'login-email-delivery-rate'));
    const unchanged = await deliveryReport();
    assert.equal(unchanged.report.alertKey, crossed.report.alertKey);
    assert.equal(unchanged.previousAlertKey, crossed.report.alertKey);
    await sends(40);
    const exactly = await deliveryReport();
    assert.ok(!exactly.report.actions.some((a) => a.code === 'login-email-delivery-rate'));
    await deliveryEvent('bounce-2', 'provider-3', 'email.bounced');
    const recrossed = await deliveryReport();
    assert.ok(recrossed.report.actions.some((a) => a.code === 'login-email-delivery-rate'));
    assert.notEqual(recrossed.report.alertKey, exactly.report.alertKey);
    assert.doesNotMatch(
      JSON.stringify(recrossed.report.loginEmailDelivery),
      /player@example|provider-/,
    );
    const input = {
      trigger: 'daily' as const,
      now: deliveryNow,
      runtime: deliveryRuntime,
      db: getPool(),
    };
    const first = await generateMistboardReadout(input);
    const reused = await generateMistboardReadout(input);
    assert.equal(reused.reused, true);
    assert.deepEqual(reused.report.loginEmailDelivery, first.report.loginEmailDelivery);
  });

  test('login complaints alert on new messages even when the rolling count stays flat', async () => {
    await sends(20);
    await deliveryEvent(
      'old-complaint',
      'provider-1',
      'email.complained',
      new Date(deliveryNow.getTime() - 7 * 86400000 + 1000),
    );
    const first = await deliveryReport();
    assert.equal(first.report.loginEmailDelivery?.last7d.complained, 1);
    assert.equal(
      first.report.actions.find((a) => a.code === 'login-email-complaint-new')?.dedupeKey,
      'login-email-complaint-new:1',
    );
    const unchanged = await deliveryReport();
    assert.ok(!unchanged.report.actions.some((a) => a.code === 'login-email-complaint-new'));
    await deliveryEvent('old-retry', 'provider-1', 'email.complained');
    const retry = await deliveryReport();
    assert.equal(retry.report.loginEmailDelivery?.complaintsReceived, 1);
    assert.ok(!retry.report.actions.some((a) => a.code === 'login-email-complaint-new'));
    // Age the first complaint and its duplicate out before a different message
    // arrives. Occurrence counts stay at one; cumulative arrivals rise to two.
    const later = new Date(deliveryNow.getTime() + 8 * 86400000);
    await deliveryEvent(
      'new-complaint',
      'provider-2',
      'email.complained',
      new Date(later.getTime() - 1000),
    );
    const next = await deliveryReport(later);
    assert.equal(next.report.loginEmailDelivery?.last7d.complained, 1);
    assert.equal(next.report.loginEmailDelivery?.complaintsReceived, 2);
    assert.ok(next.report.actions.some((a) => a.code === 'login-email-complaint-new'));
    assert.notEqual(next.report.alertKey, first.report.alertKey);
    // A late webhook for a third message predating both rolling windows still
    // counts as a new complaint at collection time.
    await deliveryEvent(
      'late-complaint',
      'provider-3',
      'email.complained',
      new Date('2026-09-01T00:00:00Z'),
    );
    const late = await deliveryReport(later);
    assert.equal(late.report.loginEmailDelivery?.last30d.complained, 2);
    assert.equal(late.report.loginEmailDelivery?.complaintsReceived, 3);
    assert.ok(late.report.actions.some((a) => a.code === 'login-email-complaint-new'));
  });

  test('login collector failure is null and unknown; recovery retains complaint observations', async (t) => {
    await sends(20);
    await deliveryEvent('complaint', 'provider-1', 'email.complained');
    const initial = await deliveryReport();
    const pool = getPool();
    const mock = t.mock.method(
      pool,
      'query',
      new Proxy(pool.query, {
        apply(target, self, args) {
          if (typeof args[0] === 'string' && args[0].includes('FROM email_delivery_events')) {
            throw new Error('collector test failure');
          }
          return Reflect.apply(target, self, args);
        },
      }),
    );
    try {
      const facts = await collectMistboardReadoutFacts(pool, deliveryNow);
      assert.equal(facts.loginEmailDelivery, null);
      assert.ok(facts.collectorErrors?.some((e) => e.section === 'loginEmailDelivery'));
      const failed = await deliveryReport();
      assert.equal(failed.report.verdict, 'unknown');
      assert.equal(failed.report.loginEmailComplaintsSeen, 1);
    } finally {
      mock.mock.restore();
    }
    const recovered = await deliveryReport();
    assert.equal(recovered.report.loginEmailDelivery?.complaintsReceived, 1);
    assert.ok(!recovered.report.actions.some((a) => a.code === 'login-email-complaint-new'));
    assert.equal(
      initial.report.loginEmailComplaintsSeen,
      recovered.report.loginEmailComplaintsSeen,
    );
  });

  test('stored older snapshots without login delivery facts remain usable', async () => {
    const first = await deliveryReport();
    await getPool().query(
      `UPDATE ops_readout_snapshots SET schema_version = 1,
      payload = (payload - 'loginEmailDelivery' - 'loginEmailComplaintsSeen') || '{"schemaVersion":1}'::jsonb
      WHERE id = $1`,
      [first.report.snapshotId],
    );
    const old = await latestMistboardReadout();
    assert.equal(old?.schemaVersion, 1);
    assert.equal(old?.loginEmailDelivery, undefined);
    await sends(20);
    await deliveryEvent('new-complaint', 'provider-1', 'email.complained');
    const next = await deliveryReport();
    assert.ok(next.report.actions.some((a) => a.code === 'login-email-complaint-new'));
  });

  // #1065: per-variant bot timing. Window for 2026-11-12: 11-05 to 11-12.
  const botNow = new Date('2026-11-12T17:23:00Z');
  const botReport = () =>
    generateMistboardReadout({
      trigger: 'manual',
      now: botNow,
      runtime: deliveryRuntime,
      db: getPool(),
    });
  const human = { color: 'red' as const, subjectType: 'guest' as const, subjectId: 'guest-1' };
  const bot = { color: 'black' as const, subjectType: 'bot' as const, subjectId: 'misty' };
  async function event(roomId: string, seq: number, type: string, payload: object) {
    await getPool().query(
      'INSERT INTO events (room_id, seq, type, payload) VALUES ($1, $2, $3, $4::jsonb)',
      [roomId, seq, type, JSON.stringify(payload)],
    );
  }
  async function decision(
    roomId: string,
    ply: number,
    payload: Record<string, unknown>,
    type = 'live-engine-decision',
  ) {
    await getPool().query(
      `INSERT INTO game_debug_artifacts (game_id, ply, artifact_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [roomId, ply, type, JSON.stringify(payload)],
    );
  }
  async function seedBotTiming() {
    await getPool().query(
      `INSERT INTO users (id, email, handle, display_name, created_at, stats_excluded_at)
       VALUES ('owner', 'owner@example.com', 'owner', 'Owner', '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z')`,
    );
    const at = '2026-11-10T12:00:00Z';
    const flag = (roomId: string, extra: Partial<Parameters<typeof insertGame>[0]> = {}) =>
      insertGame({
        roomId,
        variant: 'xiangqi',
        mode: 'pve',
        endedAt: at,
        result: 'red-wins',
        termination: 'timeout',
        participants: [human, bot],
        ...extra,
      });
    // Planted: the bot's clock ran out (the clock-expired event names its seat).
    await flag('bt-flag');
    await event('bt-flag', 1, 'clock-expired', { color: 'black' });
    // Planted: no clock-expired event, the bot seat (an unprofiled engine) lost.
    await flag('bt-flag-noevent', {
      variant: 'jieqi',
      participants: [
        human,
        { color: 'black', subjectType: 'engine-version', subjectId: 'pikafish-jieqi' },
      ],
    });
    // The human flagged: a timeout, but not the bot's.
    await flag('bt-human-flag', { result: 'black-wins' });
    await event('bt-human-flag', 1, 'clock-expired', { color: 'red' });
    // A drawn timeout with no event names no flagged seat.
    await flag('bt-draw-noevent', { result: 'draw' });
    // Excluded game modes and accounts: bot-vs-bot, PvP, the operator's own game.
    await flag('bt-eve', {
      mode: 'eve',
      participants: [{ ...bot, color: 'red' }, bot],
    });
    await event('bt-eve', 1, 'clock-expired', { color: 'black' });
    await flag('bt-pvp', {
      mode: 'pvp',
      participants: [human, { color: 'black', subjectType: 'guest', subjectId: 'guest-2' }],
    });
    await flag('bt-owner', {
      participants: [{ color: 'red', subjectType: 'user', subjectId: 'owner' }, bot],
    });
    await event('bt-owner', 1, 'clock-expired', { color: 'black' });
    // Outside the window.
    await flag('bt-old', { endedAt: '2026-10-30T12:00:00Z' });
    await event('bt-old', 1, 'clock-expired', { color: 'black' });

    // Replies: think 100..2000 ms, the even ones paced 1000 ms more. Compute
    // alone has p95 1900; compute plus wait has p95 2800.
    await insertGame({
      roomId: 'bt-replies',
      variant: 'xiangqi',
      mode: 'pve',
      endedAt: at,
      participants: [human, bot],
    });
    for (let i = 1; i <= 20; i++) {
      await decision('bt-replies', i, {
        think_time_ms: i * 100,
        ...(i % 2 === 0 ? { pace_wait_ms: 1000, pace_reason: 'paced' } : {}),
      });
    }
    // Not replies the percentile may read: no think time, another artifact type,
    // a correspondence game's day-long reply, the operator's game.
    await decision('bt-replies', 21, { think_time_ms: null });
    await decision('bt-replies', 22, { think_time_ms: 900_000 }, 'live-engine-fail-closed');
    await insertGame({
      roomId: 'bt-corr',
      variant: 'xiangqi',
      mode: 'pve',
      endedAt: at,
      participants: [human, bot],
    });
    await event('bt-corr', 0, 'room-created', { timeControl: { daysPerMove: 3 } });
    await decision('bt-corr', 1, { think_time_ms: 900_000, pace_reason: 'correspondence' });
    await decision('bt-owner', 1, { think_time_ms: 900_000 });
  }

  test('bot timing counts bot losses on time and p95 replies per variant over counted PvE games', async () => {
    await seedBotTiming();
    const timing = await collectBotTiming(getPool(), botNow);
    assert.deepEqual(timing.variants, [
      {
        variant: 'jieqi',
        botGames: 1,
        timeLosses: 1,
        timeLossRoomIds: ['bt-flag-noevent'],
        replies: 0,
        p95ReplyMs: null,
        pacedReplies: 0,
      },
      {
        variant: 'xiangqi',
        // bt-flag, bt-human-flag, bt-draw-noevent, bt-replies, bt-corr.
        botGames: 5,
        timeLosses: 1,
        timeLossRoomIds: ['bt-flag'],
        replies: 20,
        p95ReplyMs: 2800,
        pacedReplies: 10,
      },
    ]);
  });

  test('a bot loss on time alerts once across stored readouts, survives a failed collector, and old snapshots', async (t) => {
    await seedBotTiming();
    const first = await botReport();
    assert.deepEqual(
      first.report.actions.filter((a) => a.code === 'bot-time-losses').map((a) => a.dedupeKey),
      ['bot-time-losses:jieqi:bt-flag-noevent', 'bot-time-losses:xiangqi:bt-flag'],
    );
    assert.match(
      renderMistboardReadoutMarkdown(first.report),
      /- Bot timing, last 7 days[^\n]*xiangqi 5 games, 1 lost on time, p95 reply 2\.8 s/,
    );
    const again = await botReport();
    assert.ok(!again.report.actions.some((a) => a.code === 'bot-time-losses'));

    const pool = getPool();
    const mock = t.mock.method(
      pool,
      'query',
      new Proxy(pool.query, {
        apply(target, self, args) {
          if (typeof args[0] === 'string' && args[0].includes('JOIN game_debug_artifacts a')) {
            throw new Error('collector test failure');
          }
          return Reflect.apply(target, self, args);
        },
      }),
    );
    try {
      const facts = await collectMistboardReadoutFacts(pool, botNow);
      assert.equal(facts.botTiming, null);
      assert.ok(facts.collectorErrors?.some((e) => e.section === 'botTiming'));
    } finally {
      mock.mock.restore();
    }

    // A snapshot stored before the section existed: parses, and the next
    // readout tells the window's losses (it cannot know they were told).
    const stored = await latestMistboardReadout();
    await getPool().query(
      `UPDATE ops_readout_snapshots SET payload = payload - 'botTiming' WHERE id = $1`,
      [stored?.snapshotId],
    );
    const old = await latestMistboardReadout();
    assert.equal(old?.botTiming, undefined);
    const afterOld = await botReport();
    assert.equal(afterOld.report.actions.filter((a) => a.code === 'bot-time-losses').length, 2);
  });

  test('weekly generation is durable and idempotent', async () => {
    const input = {
      trigger: 'weekly' as const,
      now: new Date('2026-07-20T17:23:00Z'),
      runtime: {
        revision: 'revision-1',
        activeGames: 0,
        databaseRequired: true,
        persistence: 'enabled' as const,
        persistenceErrors: { count1m: 0, lastAt: null },
      },
      db: getPool(),
    };
    const first = await generateMistboardReadout(input);
    const second = await generateMistboardReadout(input);

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.report.snapshotId, first.report.snapshotId);
    assert.equal((await latestMistboardReadout())?.snapshotId, first.report.snapshotId);
    const stored = await getPool().query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ops_readout_snapshots`,
    );
    assert.equal(stored.rows[0]?.count, 1);
  });

  test('product facts count people and periods, not just finished games', async () => {
    // periodStart 2026-07-13, periodEnd 2026-07-20, previous week from 07-06.
    // A counted seat needs a users row behind it (the exclusion flag lives
    // there), so the signed-in player exists as an account, created before the
    // previous period so it does not count as a new account.
    await getPool().query(
      `INSERT INTO users (id, email, handle, display_name, created_at)
       VALUES ('user-1', 'one@example.com', 'one', 'One', '2026-06-01T09:00:00Z')`,
    );
    await insertGame({
      roomId: 'room-current-pvp',
      variant: 'xiangqi',
      mode: 'pvp',
      endedAt: '2026-07-15T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'guest', subjectId: 'guest-1' },
        { color: 'black', subjectType: 'user', subjectId: 'user-1' },
      ],
    });
    await insertGame({
      roomId: 'room-current-pve',
      variant: 'xiangqi',
      mode: 'pve',
      endedAt: '2026-07-16T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'user', subjectId: 'user-1' },
        { color: 'black', subjectType: 'engine-version', subjectId: 'engine-1' },
      ],
    });
    await insertGame({
      roomId: 'room-previous-pvp',
      variant: 'jieqi',
      mode: 'pvp',
      endedAt: '2026-07-10T12:00:00Z',
      participants: [
        { color: 'white', subjectType: 'guest', subjectId: 'guest-2' },
        { color: 'black', subjectType: 'user', subjectId: 'user-1' },
      ],
    });
    await insertGame({
      roomId: 'room-current-aborted',
      variant: 'xiangqi',
      mode: 'pvp',
      status: 'aborted',
      endedAt: '2026-07-17T12:00:00Z',
      participants: [{ color: 'white', subjectType: 'guest', subjectId: 'guest-3' }],
    });
    // A prod smoke probe: a pve room created and pregame-aborted by a script,
    // with no guest or user seat at all. It is not demand (#424).
    await insertGame({
      roomId: 'room-current-probe',
      variant: 'fortress-xiangqi',
      mode: 'pve',
      status: 'aborted',
      endedAt: '2026-07-17T13:00:00Z',
      participants: [],
    });
    await insertGame({
      roomId: 'room-current-eve',
      variant: 'xiangqi',
      mode: 'eve',
      endedAt: '2026-07-18T12:00:00Z',
      participants: [],
    });
    // An operator account excluded from statistics: neither the account nor
    // its game reaches any product figure.
    await getPool().query(
      `INSERT INTO users (id, email, handle, display_name, created_at, stats_excluded_at)
       VALUES ('user-op', 'op@example.com', 'op', 'Op', '2026-07-14T09:00:00Z', now())`,
    );
    await insertGame({
      roomId: 'room-current-internal',
      variant: 'jieqi',
      mode: 'pvp',
      endedAt: '2026-07-18T13:00:00Z',
      participants: [
        { color: 'white', subjectType: 'user', subjectId: 'user-op' },
        { color: 'black', subjectType: 'guest', subjectId: 'guest-4' },
      ],
    });

    const { report } = await generateMistboardReadout({
      trigger: 'manual',
      now: new Date('2026-07-20T17:23:00Z'),
      dryRun: true,
      runtime: {
        revision: null,
        activeGames: 0,
        databaseRequired: true,
        persistence: 'enabled',
        persistenceErrors: { count1m: 0, lastAt: null },
      },
      db: getPool(),
    });

    const product = report.product;
    assert.ok(product);
    // Bot-vs-bot and aborted rows stay out of the headline count, and out of
    // the player count: neither is a person choosing to play. The aborted
    // count itself holds guest-3's abort and not the seatless probe.
    assert.equal(product.completedGames, 2);
    assert.equal(product.previousCompletedGames, 1);
    assert.equal(product.abortedGames, 1);
    // Players are accounts plus guest browsers (a guest seat's subject id is
    // the device id since migration 137): guest-1 and user-1 this week,
    // guest-2 and user-1 the week before. The aborted guest-3 seat and the
    // excluded user-op / guest-4 game count for nobody.
    assert.equal(product.humanPlayers, 2);
    assert.equal(product.previousHumanPlayers, 2);
    assert.equal(product.signedInPlayers, 1);
    // user-1 played in the previous week too; guest-1 is new.
    assert.equal(product.returningPlayers, 1);
    // 28 days back from periodEnd (07-20) covers both weeks.
    assert.equal(product.activeAccounts28d, 3);
    assert.equal(product.previousActiveAccounts28d, 0);
    assert.deepEqual(product.completedGamesByMode, { eve: 1, pve: 1, pvp: 1 });
    assert.deepEqual(product.completedGamesByVariant, [{ variant: 'xiangqi', count: 2 }]);
    assert.equal(product.accountsCreated, 0);
  });

  test('the weekly trend reads prior weekly snapshots and skips daily ones', async () => {
    const runtime = {
      revision: null,
      activeGames: 0,
      databaseRequired: true,
      persistence: 'enabled' as const,
      persistenceErrors: { count1m: 0, lastAt: null },
    };
    await generateMistboardReadout({
      trigger: 'weekly',
      now: new Date('2026-07-13T17:23:00Z'),
      runtime,
      db: getPool(),
    });
    await generateMistboardReadout({
      trigger: 'daily',
      now: new Date('2026-07-19T17:23:00Z'),
      runtime,
      db: getPool(),
    });
    const { report } = await generateMistboardReadout({
      trigger: 'weekly',
      now: new Date('2026-07-20T17:23:00Z'),
      runtime,
      db: getPool(),
    });
    assert.equal(report.trend.length, 1);
    assert.equal(report.trend[0]?.completedGames, 0);
  });

  test('dry run does not store a snapshot', async () => {
    const result = await generateMistboardReadout({
      trigger: 'manual',
      now: new Date('2026-07-22T17:23:00Z'),
      dryRun: true,
      runtime: {
        revision: null,
        activeGames: 0,
        databaseRequired: true,
        persistence: 'enabled',
        persistenceErrors: { count1m: 0, lastAt: null },
      },
      db: getPool(),
    });
    assert.match(result.report.snapshotId, /^readout_dry_/);
    assert.equal(await latestMistboardReadout(), null);
  });

  test('deploys reads the week of drain summaries and keeps the disruptive ones', async () => {
    const summary = (occurredAt: string, payload: Record<string, unknown>) =>
      getPool().query(
        `INSERT INTO room_lifecycle_audit (kind, occurred_at, build_revision, payload)
         VALUES ('drain_summary', $1, 'rev-1', $2::jsonb)`,
        [occurredAt, JSON.stringify(payload)],
      );
    const at = Date.parse('2026-10-16T21:34:00Z');
    // Committed after 4 minutes, nobody refused: not disruptive.
    await summary('2026-10-16T21:57:00Z', {
      outcome: 'lapsed',
      activatedAt: at,
      endedAt: at + 900_000,
      durationMs: 900_000,
      committed: true,
      commitWaitMs: 241_000,
      refusedCreates: 0,
    });
    // Refused a create: disruptive however short.
    await summary('2026-10-16T23:53:00Z', {
      outcome: 'shutdown',
      activatedAt: at + 8_000_000,
      endedAt: at + 8_040_000,
      durationMs: 40_000,
      committed: true,
      commitWaitMs: 31_000,
      refusedCreates: 1,
    });
    // Outside the week.
    await summary('2026-10-01T00:00:00Z', {
      outcome: 'cancelled',
      activatedAt: at - 20 * 86_400_000,
      endedAt: at - 20 * 86_400_000 + 900_000,
      durationMs: 900_000,
      committed: false,
      refusedCreates: 9,
    });
    await getPool().query(
      `INSERT INTO room_lifecycle_audit (kind, occurred_at, payload) VALUES ('drain_restart_committed', $1, '{}'::jsonb)`,
      ['2026-10-16T21:38:00Z'],
    );

    const deploys = await collectDeploys(getPool(), new Date('2026-10-17T17:23:00Z'));
    assert.equal(deploys.drains, 2);
    assert.deepEqual(
      deploys.disruptive.map((drain) => [drain.heldMs, drain.refusedCreates, drain.buildRevision]),
      [[31_000, 1, 'rev-1']],
    );
  });
});
