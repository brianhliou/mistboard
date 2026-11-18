import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { close, getPool, init } from './persistence-db.js';

// Placeholders only: every provider request and database query is intercepted.
process.env.RESEND_API_KEY = 're_placeholder_for_tests';
process.env.MISTBOARD_AUTH_EMAIL_FROM = 'Mistboard <play@example.com>';
const { sweepDeadlineWarnings } = await import('./correspondence-deadline-warning.js');
const { sweepCorrespondenceTurnDigests } = await import('./correspondence-turn-digest.js');
const { sendCorrespondenceStartEmail } = await import('./correspondence-start-email.js');
const {
  sendCorrespondenceChallengeEmail,
  sendCorrespondenceJoinedStartEmail,
  sendCorrespondenceHostStartEmails,
  sendCorrespondenceGameOverEmails,
} = await import('./correspondence-player-emails.js');

const now = new Date('2026-11-18T15:00:00Z');
const DAY_MS = 86_400_000;
const candidate = {
  roomId: 'xq_warning',
  gameSpecId: 'xiangqi',
  allowanceMs: DAY_MS,
  dueAt: new Date(now.getTime() + 3_600_000),
  recipientEmail: 'player@example.com',
  recipientUserId: 'player',
  recipientLocale: null,
  opponentName: 'Opponent',
};

function capture(
  t: TestContext,
  options: { writeFails?: boolean; rejected?: boolean; noId?: boolean } = {},
) {
  init('postgres://mistboard@127.0.0.1:9/never');
  t.after(close);
  const writes: unknown[][] = [];
  const sent: Record<string, unknown>[] = [];
  t.mock.method(getPool(), 'query', async (sql: string, values: unknown[]) => {
    assert.match(sql, /INSERT INTO correspondence_notifications/);
    writes.push(values);
    if (options.writeFails) throw new Error('audit_unavailable');
    return { rows: [], rowCount: 1 };
  });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, request?: RequestInit) => {
    sent.push(JSON.parse(String(request?.body)));
    return Response.json(options.noId ? {} : { id: `provider-${sent.length}` }, {
      status: options.rejected ? 429 : 200,
    });
  });
  return { writes, sent };
}

test('deadline warning records its kind and accepted provider ID exactly once', async (t) => {
  const { writes, sent } = capture(t);
  const marked: string[] = [];
  await sweepDeadlineWarnings(now, {
    enabled: true,
    listCandidates: async () => [candidate],
    markWarned: async (roomId) => {
      marked.push(roomId);
    },
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.slice(0, 3), [['xq_warning'], 'player', 'deadline-warning']);
  assert.ok(writes[0]?.[3] instanceof Date);
  assert.equal(writes[0]?.[4], 'provider-1');
  assert.deepEqual(sent[0]?.tags, [{ name: 'kind', value: 'deadline-warning' }]);
  assert.deepEqual(marked, ['xq_warning']);
});

test('an audit write failure cannot undo acceptance or prevent marking the warning', async (t) => {
  const { writes, sent } = capture(t, { writeFails: true });
  let marked = false;
  await sweepDeadlineWarnings(now, {
    enabled: true,
    listCandidates: async () => [candidate],
    markWarned: async () => {
      marked = true;
    },
  });
  assert.equal(sent.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(marked, true);
});

test('a rejected warning has no sent audit row and remains eligible for retry', async (t) => {
  const { writes } = capture(t, { rejected: true });
  let marked = false;
  await sweepDeadlineWarnings(now, {
    enabled: true,
    listCandidates: async () => [candidate],
    markWarned: async () => {
      marked = true;
    },
  });
  assert.deepEqual(writes, []);
  assert.equal(marked, false);
});

test('a digest correlates every included room to the same provider message', async (t) => {
  const { writes, sent } = capture(t);
  await sweepCorrespondenceTurnDigests(now, {
    enabled: true,
    listCandidates: async () => [
      {
        userId: 'player',
        email: 'player@example.com',
        locale: null,
        games: ['xq_a', 'xq_b'].map((roomId) => ({
          roomId,
          gameSpecId: 'xiangqi',
          opponentName: 'Opponent',
          dueAt: candidate.dueAt,
          warned: false,
        })),
      },
    ],
    markSent: async () => {},
  });
  assert.equal(sent.length, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.slice(0, 3), [['xq_a', 'xq_b'], 'player', 'digest']);
  assert.equal(writes[0]?.[4], 'provider-1');
  assert.deepEqual(sent[0]?.tags, [{ name: 'kind', value: 'digest' }]);
});

test('all start, challenge and result transports include notification context', async (t) => {
  const { writes, sent } = capture(t);
  const deps = {
    enabled: true,
    loadRecipient: async () => ({ email: 'player@example.com' }),
    loadName: async () => ({ name: 'Host', handle: 'host' }),
  };
  const accepted = {
    roomId: 'xq_start',
    gameSpecId: 'xiangqi',
    daysPerMove: 1,
    creatorUserId: 'host',
    accepter: { id: 'player', displayName: 'Player', handle: 'player' },
    accepterOnMove: true,
  };
  assert.equal(
    await sendCorrespondenceStartEmail(
      {
        ...accepted,
        accepterName: 'Player',
        creatorOnMove: false,
      },
      deps,
    ),
    true,
  );
  assert.equal(await sendCorrespondenceJoinedStartEmail(accepted, deps), true);
  assert.deepEqual(await sendCorrespondenceHostStartEmails(accepted, deps), {
    host: true,
    player: true,
  });
  assert.equal(
    await sendCorrespondenceChallengeEmail(
      {
        seekId: 'seek_1',
        gameSpecId: 'xiangqi',
        targetUserId: 'player',
        challengerName: 'Host',
        challengerHandle: 'host',
        daysPerMove: 1,
        rated: false,
        expiresAt: new Date(now.getTime() + DAY_MS),
      },
      deps,
      now.getTime(),
    ),
    true,
  );
  assert.equal(
    await sendCorrespondenceGameOverEmails(
      {
        roomId: 'xq_start',
        gameSpecId: 'xiangqi',
        result: 'red-wins',
        aborted: false,
        termination: 'timeout',
        seats: [
          { color: 'red', userId: 'host', name: 'Host' },
          { color: 'black', userId: 'player', name: 'Player' },
        ],
      },
      { ...deps, reviewPath: () => null },
    ),
    2,
  );
  assert.deepEqual(
    writes.map((values) => [values[0], values[1], values[2], values[5]]),
    [
      [['xq_start'], 'host', 'start', null],
      [['xq_start'], 'player', 'start', null],
      [['xq_start'], 'host', 'host-start', null],
      [['xq_start'], 'player', 'host-receipt', null],
      [[null], 'player', 'challenge', 'seek_1'],
      [['xq_start'], 'host', 'game-over', null],
      [['xq_start'], 'player', 'game-over', null],
    ],
  );
  assert.deepEqual(
    writes.map((values) => values[4]),
    sent.map((_, i) => `provider-${i + 1}`),
  );
  assert.deepEqual(
    sent.map((body) => body.tags),
    writes.map((values) => [{ name: 'kind', value: values[2] }]),
  );
});

test('acceptance without a provider ID is retained with a null correlation', async (t) => {
  const { writes } = capture(t, { noId: true });
  await sweepDeadlineWarnings(now, {
    enabled: true,
    listCandidates: async () => [candidate],
    markWarned: async () => {},
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.[4], null);
});
