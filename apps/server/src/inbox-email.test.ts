import assert from 'node:assert/strict';
import test from 'node:test';
import type { InboxEmailDeps } from './inbox-email.js';
import { dmEmailUnsubscribe, verifyDmEmailUnsubscribeToken } from './inbox-email-unsubscribe.js';
import type { InboxEmailCandidate } from './persistence-inbox-email.js';
import type { TransactionalEmail } from './send-email.js';

// This process never has a configured provider. Each send below is injected.
delete process.env.RESEND_API_KEY;
delete process.env.MISTBOARD_AUTH_EMAIL_FROM;
delete process.env.RESEND_FROM_EMAIL;
const { sweepInboxEmails } = await import('./inbox-email.js');

const now = new Date('2026-11-06T18:00:00Z');
const forbidden = 'FORBIDDEN-DM-BODY-913: private words must stay in the inbox';
const signingKey = 'test-only-inbox-email-signing-key';
const unsubscribe = (userId: string) =>
  dmEmailUnsubscribe(userId, {
    MISTBOARD_ENGINE_SECRET: signingKey,
    MISTBOARD_HOST: 'https://mistboard.com',
  });

function candidate(userId = 'recipient', locale: string | null = null): InboxEmailCandidate {
  return {
    userId,
    email: `${userId}@example.com`,
    locale,
    threadId: `thread_${userId}`,
    messageId: `message_${userId}`,
    messageAt: new Date(now.getTime() - 12 * 3_600_000),
    senderHandle: 'fox333',
    senderName: 'Fox Chess',
  };
}

function deps(overrides: Partial<InboxEmailDeps> = {}): InboxEmailDeps {
  return {
    enabled: true,
    fromAddress: 'Mistboard <play@example.com>',
    listCandidates: async (query) => {
      assert.deepEqual(query, { now });
      return [candidate()];
    },
    unsubscribe,
    send: async () => ({ ok: true }),
    markSent: async () => true,
    ...overrides,
  };
}

test('sender passes only localized metadata, inbox and signed unsubscribe links to the provider', async () => {
  const sent: TransactionalEmail[] = [];
  const marked: unknown[] = [];
  const candidates = [
    candidate('en', 'en'),
    candidate('hans', 'zh-Hans'),
    candidate('hant', 'zh-Hant'),
    candidate('fallback', 'fr'),
  ];
  await sweepInboxEmails(
    now,
    deps({
      listCandidates: async () =>
        candidates.map((c) => ({ ...c, bodyText: forbidden, lastText: forbidden })),
      send: async (email) => {
        sent.push(email);
        return { ok: true, providerEmailId: 'accepted' };
      },
      markSent: async (...args) => {
        marked.push(args);
        return true;
      },
    }),
  );
  assert.equal(sent.length, 4);
  for (const [index, c] of candidates.entries()) {
    const email = sent[index]!;
    assert.equal(email.from, 'Mistboard <play@example.com>');
    assert.deepEqual(email.to, [c.email]);
    assert.ok(email.html?.includes(`<html lang="${index === 3 ? 'en' : c.locale}">`));
    assert.ok(email.subject.includes('Fox Chess'));
    assert.ok(email.subject.includes('@fox333'));
    const signed = unsubscribe(c.userId);
    assert.deepEqual(email.headers, signed.headers);
    assert.equal(email.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.equal(
      verifyDmEmailUnsubscribeToken(new URL(signed.url).searchParams.get('t'), signingKey),
      c.userId,
    );
    for (const part of [email.text, email.html!]) {
      assert.ok(part.includes('https://mistboard.com/inbox'));
      assert.ok(part.includes(signed.url));
      assert.ok(!part.includes('\u2014'));
    }
    assert.ok(!JSON.stringify(email).includes(forbidden));
    assert.deepEqual(marked[index], [c.userId, c.messageId, now]);
  }
});

test('unconfigured or disabled email never lists, sends, or marks', async () => {
  const calls: string[] = [];
  const forbiddenDeps = {
    listCandidates: async () => {
      calls.push('list');
      return [candidate()];
    },
    send: async () => {
      calls.push('send');
      return { ok: true } as const;
    },
    markSent: async () => {
      calls.push('mark');
      return true;
    },
  };
  await sweepInboxEmails(now, forbiddenDeps);
  await sweepInboxEmails(now, deps({ ...forbiddenDeps, enabled: false }));
  await sweepInboxEmails(now, deps({ ...forbiddenDeps, fromAddress: undefined }));
  assert.deepEqual(calls, []);
});

test('only accepted sends are marked; rejected and thrown sends retry without stopping other accounts', async () => {
  const marked: string[] = [];
  let attempt = 0;
  const options = deps({
    listCandidates: async () => [candidate('rejected'), candidate('throws'), candidate('ok')],
    send: async (email) => {
      if (attempt === 0 && email.to[0] === 'rejected@example.com')
        return { ok: false, statusCode: 429 };
      if (attempt === 0 && email.to[0] === 'throws@example.com')
        throw new Error('provider unavailable');
      return { ok: true };
    },
    markSent: async (id) => {
      marked.push(id);
      return true;
    },
  });
  await sweepInboxEmails(now, options);
  assert.deepEqual(marked, ['ok']);
  attempt++;
  await sweepInboxEmails(now, options);
  assert.deepEqual(marked, ['ok', 'rejected', 'throws', 'ok']);
});

test('a slow provider is marked after acceptance and overlapping sweeps cannot duplicate it', async () => {
  let accept!: () => void;
  const accepted = new Promise<void>((resolve) => {
    accept = resolve;
  });
  let entered!: () => void;
  const sending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let sends = 0;
  let marks = 0;
  const options = deps({
    send: async () => {
      sends++;
      entered();
      await accepted;
      return { ok: true };
    },
    markSent: async () => {
      marks++;
      return true;
    },
  });
  const first = sweepInboxEmails(now, options);
  await sending;
  try {
    assert.equal(marks, 0);
    await sweepInboxEmails(now, {
      ...options,
      send: async () => {
        sends++;
        return { ok: true };
      },
    });
    assert.equal(sends, 1);
  } finally {
    accept();
    await first;
  }
  assert.equal(marks, 1);
});

test('list, signing, and marking failures are contained and later sweeps still run', async () => {
  await sweepInboxEmails(
    now,
    deps({
      listCandidates: async () => {
        throw new Error('database unavailable');
      },
    }),
  );
  let sent = 0;
  const options = deps({
    send: async () => {
      sent++;
      return { ok: true };
    },
    unsubscribe: () => {
      throw new Error('inbox_email_unsubscribe_unconfigured');
    },
    markSent: async () => {
      throw new Error('database unavailable');
    },
  });
  await sweepInboxEmails(now, options);
  assert.equal(sent, 0);
  await sweepInboxEmails(now, { ...options, unsubscribe });
  assert.equal(sent, 1);
  await sweepInboxEmails(now, deps());
});
