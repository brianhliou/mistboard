import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type AcceptedStartNotice,
  type ChallengeNotice,
  type CorrespondencePlayerEmailDeps,
  challengeTargetStatus,
  type GameOverNotice,
  gameOverLetters,
  type PlayerEmailRecipient,
  sendCorrespondenceChallengeEmail,
  sendCorrespondenceGameOverEmails,
  sendCorrespondenceHostStartEmails,
  sendCorrespondenceJoinedStartEmail,
} from './correspondence-player-emails.js';
import type { PlayerEmail } from './player-email.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-10T12:00:00Z');

type Sent = { to: string; email: PlayerEmail; kind: string; ref: string };

// A fake mail transport and user table: every id below has a mailbox unless it
// is listed in `optedOut`, which stands for the query returning null (opted out,
// closed, or no address: the caller cannot tell which).
function fakeDeps(
  options: {
    optedOut?: string[];
    enabled?: boolean;
    recipients?: Record<string, PlayerEmailRecipient>;
  } = {},
): { deps: Partial<CorrespondencePlayerEmailDeps>; sent: Sent[]; asked: string[] } {
  const sent: Sent[] = [];
  const asked: string[] = [];
  const names: Record<string, { name: string; handle: string | null }> = {
    'u-alice': { name: 'Alice', handle: 'alice' },
    'u-bob': { name: 'Bob', handle: 'bob' },
    'u-host': { name: 'Host Player', handle: 'host' },
  };
  return {
    sent,
    asked,
    deps: {
      enabled: options.enabled ?? true,
      loadRecipient: async (userId) => {
        asked.push(userId);
        if (options.optedOut?.includes(userId)) return null;
        return options.recipients?.[userId] ?? { email: `${userId}@example.com` };
      },
      loadName: async (userId) => names[userId] ?? null,
      reviewPath: (roomId) => `/xiangqi/review/${roomId}`,
      send: async (to, email, kind, ref) => {
        sent.push({ to, email, kind, ref });
        return true;
      },
    },
  };
}

function challenge(overrides: Partial<ChallengeNotice> = {}): ChallengeNotice {
  return {
    seekId: 'seek_1',
    gameSpecId: 'jieqi',
    targetUserId: 'u-bob',
    challengerName: 'Alice',
    challengerHandle: 'alice',
    daysPerMove: 3,
    rated: false,
    expiresAt: new Date(NOW + 7 * DAY_MS),
    ...overrides,
  };
}

function accepted(overrides: Partial<AcceptedStartNotice> = {}): AcceptedStartNotice {
  return {
    roomId: 'xq_room',
    gameSpecId: 'xiangqi',
    daysPerMove: 2,
    creatorUserId: 'u-host',
    accepter: { id: 'u-alice', displayName: 'Alice', handle: 'alice' },
    accepterOnMove: true,
    ...overrides,
  };
}

function gameOver(overrides: Partial<GameOverNotice> = {}): GameOverNotice {
  return {
    roomId: 'xq_room',
    gameSpecId: 'xiangqi',
    result: 'red-wins',
    aborted: false,
    termination: 'checkmate',
    seats: [
      { color: 'red', userId: 'u-alice', name: 'Alice' },
      { color: 'black', userId: 'u-bob', name: 'Bob' },
    ],
    ...overrides,
  };
}

// ── Challenge ───────────────────────────────────────────────────────────────

test('a direct challenge emails its target, with a link to the challenge', async () => {
  const { deps, sent, asked } = fakeDeps();
  assert.equal(await sendCorrespondenceChallengeEmail(challenge(), deps, NOW), true);
  assert.deepEqual(asked, ['u-bob']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, 'u-bob@example.com');
  assert.equal(sent[0]?.kind, 'correspondence_challenge_email');
  assert.match(sent[0]!.email.text, /https:\/\/mistboard\.com\/challenge\/seek_1/);
  assert.match(sent[0]!.email.text, /It stays open for 7 days/);
});

test('a target who opted out gets no challenge email', async () => {
  const { deps, sent } = fakeDeps({ optedOut: ['u-bob'] });
  assert.equal(await sendCorrespondenceChallengeEmail(challenge(), deps, NOW), false);
  assert.equal(sent.length, 0);
});

test('nothing is sent when player email is off on the server', async () => {
  const { deps, sent, asked } = fakeDeps({ enabled: false });
  assert.equal(await sendCorrespondenceChallengeEmail(challenge(), deps, NOW), false);
  assert.equal(await sendCorrespondenceJoinedStartEmail(accepted(), deps), false);
  assert.deepEqual(await sendCorrespondenceHostStartEmails(accepted(), deps), {
    host: false,
    player: false,
  });
  assert.equal(await sendCorrespondenceGameOverEmails(gameOver(), deps), 0);
  assert.equal(sent.length, 0);
  assert.equal(asked.length, 0);
});

test('the challenge email follows the target locale', async () => {
  const { deps, sent } = fakeDeps({
    recipients: { 'u-bob': { email: 'bob@example.com', locale: 'zh-Hant' } },
  });
  await sendCorrespondenceChallengeEmail(challenge(), deps, NOW);
  assert.match(sent[0]!.email.subject, /挑戰/);
});

test("the creator's page learns whether the target was emailed, never why not", async () => {
  const on = fakeDeps();
  assert.deepEqual(await challengeTargetStatus('u-bob', on.deps), {
    name: 'Bob',
    handle: 'bob',
    emailed: true,
  });
  const off = fakeDeps({ optedOut: ['u-bob'] });
  assert.deepEqual(await challengeTargetStatus('u-bob', off.deps), {
    name: 'Bob',
    handle: 'bob',
    emailed: false,
  });
  const disabled = fakeDeps({ enabled: false });
  assert.equal((await challengeTargetStatus('u-bob', disabled.deps)).emailed, false);
  assert.equal(disabled.sent.length, 0);
});

// ── Start ───────────────────────────────────────────────────────────────────

test('the joiner of a seek gets a start email naming the creator', async () => {
  const { deps, sent, asked } = fakeDeps();
  const notice = accepted({ creatorUserId: 'u-bob' });
  assert.equal(await sendCorrespondenceJoinedStartEmail(notice, deps), true);
  assert.deepEqual(asked, ['u-alice']);
  assert.equal(sent[0]?.to, 'u-alice@example.com');
  assert.equal(sent[0]?.kind, 'correspondence_joined_email');
  assert.match(sent[0]!.email.subject, /Bob/);
  assert.match(sent[0]!.email.text, /you have the first move/);
  assert.match(sent[0]!.email.text, /https:\/\/mistboard\.com\/room\/xq_room/);
});

test('a joiner who opted out gets no start email', async () => {
  const { deps, sent } = fakeDeps({ optedOut: ['u-alice'] });
  assert.equal(await sendCorrespondenceJoinedStartEmail(accepted(), deps), false);
  assert.equal(sent.length, 0);
});

test('Play the host: the host gets "New game", the player a receipt', async () => {
  const { deps, sent } = fakeDeps();
  const result = await sendCorrespondenceHostStartEmails(accepted(), deps);
  assert.deepEqual(result, { host: true, player: true });
  const host = sent.find((s) => s.to === 'u-host@example.com');
  const player = sent.find((s) => s.to === 'u-alice@example.com');
  assert.equal(host?.kind, 'correspondence_host_start_email');
  assert.equal(
    host?.email.subject,
    'New game: Alice (@alice) started Xiangqi against you, 2 days per move',
  );
  assert.equal(player?.kind, 'correspondence_host_receipt_email');
  assert.match(player!.email.text, /Your game against Host Player has started/);
  assert.match(player!.email.text, /Host Player replies to each move within 2 days/);
  for (const s of sent) assert.match(s.email.text, /https:\/\/mistboard\.com\/room\/xq_room/);
});

test("Play the host respects each side's opt-out on its own", async () => {
  const hostOff = fakeDeps({ optedOut: ['u-host'] });
  assert.deepEqual(await sendCorrespondenceHostStartEmails(accepted(), hostOff.deps), {
    host: false,
    player: true,
  });
  assert.deepEqual(
    hostOff.sent.map((s) => s.to),
    ['u-alice@example.com'],
  );
  const playerOff = fakeDeps({ optedOut: ['u-alice'] });
  assert.deepEqual(await sendCorrespondenceHostStartEmails(accepted(), playerOff.deps), {
    host: true,
    player: false,
  });
  assert.deepEqual(
    playerOff.sent.map((s) => s.to),
    ['u-host@example.com'],
  );
});

test('the receipt promises the daily email only when the digest is on', async () => {
  const off = fakeDeps({
    recipients: { 'u-alice': { email: 'a@example.com', turnDigest: false } },
  });
  await sendCorrespondenceHostStartEmails(accepted(), off.deps);
  const offReceipt = off.sent.find((s) => s.to === 'a@example.com');
  assert.ok(!offReceipt!.email.text.includes('at most one email a day'));
  const on = fakeDeps({ recipients: { 'u-alice': { email: 'a@example.com', turnDigest: true } } });
  await sendCorrespondenceHostStartEmails(accepted(), on.deps);
  assert.match(
    on.sent.find((s) => s.to === 'a@example.com')!.email.text,
    /at most one email a day/,
  );
});

// ── Game over ───────────────────────────────────────────────────────────────

test('game-over letters: the winner won, the loser lost, each names the other', () => {
  assert.deepEqual(gameOverLetters(gameOver()), [
    { userId: 'u-alice', outcome: 'won', opponentName: 'Bob' },
    { userId: 'u-bob', outcome: 'lost', opponentName: 'Alice' },
  ]);
  assert.deepEqual(
    gameOverLetters(gameOver({ result: 'black-wins' })).map((l) => l.outcome),
    ['lost', 'won'],
  );
  assert.deepEqual(
    gameOverLetters(gameOver({ result: 'draw' })).map((l) => l.outcome),
    ['draw', 'draw'],
  );
  assert.deepEqual(
    gameOverLetters(gameOver({ result: null, aborted: true })).map((l) => l.outcome),
    ['cancelled', 'cancelled'],
  );
  // An abort carries no winner even if a result slipped through.
  assert.deepEqual(
    gameOverLetters(gameOver({ aborted: true })).map((l) => l.outcome),
    ['cancelled', 'cancelled'],
  );
});

test('a seat with no account gets no letter', () => {
  const letters = gameOverLetters(
    gameOver({
      seats: [
        { color: 'red', userId: 'u-alice', name: 'Alice' },
        { color: 'black', userId: null, name: 'Guest' },
      ],
    }),
  );
  assert.deepEqual(letters, [{ userId: 'u-alice', outcome: 'won', opponentName: 'Guest' }]);
});

test('the game-over email goes to both players and links to the review', async () => {
  const { deps, sent } = fakeDeps();
  assert.equal(await sendCorrespondenceGameOverEmails(gameOver(), deps), 2);
  const alice = sent.find((s) => s.to === 'u-alice@example.com')!;
  const bob = sent.find((s) => s.to === 'u-bob@example.com')!;
  assert.equal(alice.email.subject, 'You won your xiangqi game against Bob');
  assert.equal(bob.email.subject, 'You lost your xiangqi game against Alice');
  for (const s of [alice, bob]) {
    assert.equal(s.kind, 'correspondence_game_over_email');
    assert.match(s.email.text, /ended by checkmate/);
    assert.match(s.email.text, /https:\/\/mistboard\.com\/xiangqi\/review\/xq_room/);
  }
});

test('a cancelled game emails both players, a player who opted out is skipped', async () => {
  const { deps, sent } = fakeDeps({ optedOut: ['u-bob'] });
  const count = await sendCorrespondenceGameOverEmails(
    gameOver({ result: null, aborted: true, termination: 'abandoned' }),
    deps,
  );
  assert.equal(count, 1);
  assert.deepEqual(
    sent.map((s) => s.to),
    ['u-alice@example.com'],
  );
  assert.match(sent[0]!.email.subject, /was cancelled/);
});
