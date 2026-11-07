import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMistboardReadout,
  type MistboardReadoutFacts,
  type MistboardReadoutRuntime,
  type MistboardReadoutTrigger,
} from './mistboard-readout.js';
import { decideReadoutEmail, readoutEmailSubject, sendReadoutEmail } from './readout-email.js';

const runtime: MistboardReadoutRuntime = {
  revision: 'abc123',
  activeGames: 0,
  databaseRequired: true,
  persistence: 'enabled',
  persistenceErrors: { count1m: 0, lastAt: null },
};

const healthyFacts: MistboardReadoutFacts = {
  product: {
    accountsCreated: 1,
    previousAccountsCreated: 1,
    completedGames: 8,
    previousCompletedGames: 7,
    completedGamesByMode: { pvp: 8 },
    completedGamesByVariant: [{ variant: 'xiangqi', count: 8 }],
    abortedGames: 0,
    humanPlayers: 5,
    previousHumanPlayers: 5,
    returningPlayers: 3,
    signedInPlayers: 2,
  },
  puzzles: null,
  mining: null,
  engines: { tasks: {}, failedTasks: 0, activeWorkers: 1, staleWorkers: 0 },
};

function report(trigger: MistboardReadoutTrigger, facts: MistboardReadoutFacts = healthyFacts) {
  return buildMistboardReadout({
    snapshotId: `readout_${trigger}`,
    trigger,
    now: new Date('2026-09-07T17:23:00Z'),
    runtime,
    facts,
  });
}

const brokenFacts: MistboardReadoutFacts = {
  ...healthyFacts,
  product: { ...healthyFacts.product!, completedGames: 0, previousCompletedGames: 46 },
};

test('a weekly readout always goes out and a healthy daily never does', () => {
  assert.deepEqual(
    decideReadoutEmail({
      report: report('weekly'),
      reused: false,
      previousAlertKey: null,
      enabled: true,
    }),
    { send: true, reason: 'weekly' },
  );
  assert.deepEqual(
    decideReadoutEmail({
      report: report('daily'),
      reused: false,
      previousAlertKey: null,
      enabled: true,
    }),
    { send: false, reason: 'healthy-daily' },
  );
});

test('a daily alert sends once and then stays quiet while the problem is unchanged', () => {
  const broken = report('daily', brokenFacts);
  assert.equal(broken.verdict, 'action');
  assert.deepEqual(
    decideReadoutEmail({ report: broken, reused: false, previousAlertKey: null, enabled: true }),
    { send: true, reason: 'daily-alert' },
  );
  // Same problem tomorrow, different counters: no second email.
  assert.deepEqual(
    decideReadoutEmail({
      report: broken,
      reused: false,
      previousAlertKey: broken.alertKey,
      enabled: true,
    }),
    { send: false, reason: 'same-problem' },
  );
});

test('a reused snapshot and a dry run never send', () => {
  assert.equal(
    decideReadoutEmail({
      report: report('weekly'),
      reused: true,
      previousAlertKey: null,
      enabled: true,
    }).send,
    false,
  );
  assert.equal(
    decideReadoutEmail({
      report: report('weekly'),
      reused: false,
      previousAlertKey: null,
      dryRun: true,
      enabled: true,
    }).send,
    false,
  );
});

test('an unconfigured mailer is a decision, not a throw', () => {
  assert.deepEqual(
    decideReadoutEmail({
      report: report('weekly'),
      reused: false,
      previousAlertKey: null,
      enabled: false,
    }),
    { send: false, reason: 'disabled' },
  );
});

test('the subject line carries the date and the verdict', () => {
  assert.equal(
    readoutEmailSubject(report('weekly')),
    'Mistboard weekly 2026-09-07: games +1 (+14%); no action needed',
  );
  assert.equal(
    readoutEmailSubject(report('daily', brokenFacts)),
    'Mistboard daily check 2026-09-07: ACTION',
  );
});

test('provider rejection is not reported as accepted email delivery', async () => {
  const result = await sendReadoutEmail(
    { report: report('weekly'), reused: false, previousAlertKey: null },
    {
      enabled: true,
      send: async () => ({ ok: false, statusCode: 503 }),
    },
  );
  assert.deepEqual(result, { send: false, reason: 'delivery-failed' });
});

test('accepted delivery contains equivalent HTML and plain text', async () => {
  let calls = 0;
  const result = await sendReadoutEmail(
    { report: report('weekly'), reused: false, previousAlertKey: null },
    {
      enabled: true,
      send: async (message) => {
        calls += 1;
        assert.match(message.html ?? '', /Completed human games/);
        assert.match(message.text, /Completed human games/);
        assert.doesNotMatch(message.text, /Mining:|Production revision:/);
        return { ok: true };
      },
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { send: true, reason: 'weekly' });
});

test('login delivery daily mail deduplicates rates, recovers, and sends for each new complaint', () => {
  const build = (
    sent: number,
    bounced: number,
    suppressed: number,
    complaintsReceived = 0,
    previousReport?: ReturnType<typeof report>,
  ) => {
    const counts = {
      requested: sent,
      sent,
      delivered: 0,
      bounced,
      suppressed,
      complained: 0,
      completed: 0,
    };
    return buildMistboardReadout({
      snapshotId: 'delivery',
      trigger: 'daily',
      now: new Date('2026-11-03T17:23:00Z'),
      runtime,
      facts: {
        ...healthyFacts,
        loginEmailDelivery: { last7d: counts, last30d: counts, complaintsReceived },
      },
      previousReport,
    });
  };
  const decision = (current: ReturnType<typeof report>, previous?: ReturnType<typeof report>) =>
    decideReadoutEmail({
      report: current,
      reused: false,
      previousAlertKey: previous?.alertKey ?? null,
      enabled: true,
    });
  for (const current of [build(19, 1, 1), build(20, 1, 0)]) {
    assert.deepEqual(decision(current), { send: false, reason: 'healthy-daily' });
  }
  const first = build(20, 1, 1);
  assert.deepEqual(decision(first), { send: true, reason: 'daily-alert' });
  const unchanged = build(30, 2, 1, 0, first);
  assert.deepEqual(decision(unchanged, first), { send: false, reason: 'same-problem' });
  const recovered = build(40, 1, 1, 0, unchanged);
  assert.deepEqual(decision(recovered, unchanged), { send: false, reason: 'healthy-daily' });
  const recrossed = build(40, 2, 1, 0, recovered);
  assert.deepEqual(decision(recrossed, recovered), { send: true, reason: 'daily-alert' });
  const complaint = build(40, 2, 1, 1, recrossed);
  assert.deepEqual(decision(complaint, recrossed), { send: true, reason: 'daily-alert' });
  const another = build(40, 2, 1, 2, complaint);
  assert.deepEqual(decision(another, complaint), { send: true, reason: 'daily-alert' });
  const quiet = build(40, 2, 1, 2, another);
  assert.deepEqual(decision(quiet, another), { send: false, reason: 'same-problem' });
  const stillQuiet = build(40, 2, 1, 2, quiet);
  assert.deepEqual(decision(stillQuiet, quiet), { send: false, reason: 'same-problem' });
  assert.deepEqual(
    decideReadoutEmail({ report: another, reused: true, previousAlertKey: null, enabled: true }),
    { send: false, reason: 'reused' },
  );
});
