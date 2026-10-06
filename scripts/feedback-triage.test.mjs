import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatInbox,
  maskEmail,
  parseInboxArgs,
  parseMarkArgs,
  presentRow,
} from './lib/feedback-triage.mjs';

const ID = '0717761d-6536-4b09-b0df-83edc90621d9';

function row(overrides = {}) {
  return {
    id: ID,
    created_at: new Date('2026-10-06T03:00:00Z'),
    path: '/zh-hans/blog/cao-yanlei',
    message: 'The board flips.\nAlso: eval graph?',
    email: 'jane.doe@protonmail.com',
    user_id: null,
    account_handle: null,
    triage_status: 'new',
    triage_class: null,
    triage_note: null,
    triaged_at: null,
    ...overrides,
  };
}

test('maskEmail keeps the first letter and the domain only', () => {
  assert.equal(maskEmail('jane.doe@protonmail.com'), 'j***@protonmail.com');
  assert.equal(maskEmail('x@y.io'), 'x***@y.io');
  assert.equal(maskEmail('not-an-address'), '***');
  assert.equal(maskEmail(null), null);
  assert.equal(maskEmail(''), null);
});

test('the inbox masks reply addresses unless --show-email', () => {
  const masked = formatInbox([row()], parseInboxArgs([]));
  assert.match(masked, /email left: j\*\*\*@protonmail\.com/);
  assert.doesNotMatch(masked, /jane\.doe/);
  const json = JSON.parse(formatInbox([row()], parseInboxArgs(['--json'])));
  assert.equal(json[0].email, 'j***@protonmail.com');
  assert.equal(json[0].emailLeft, true);
  const shown = JSON.parse(formatInbox([row()], parseInboxArgs(['--json', '--show-email'])));
  assert.equal(shown[0].email, 'jane.doe@protonmail.com');
});

test('the inbox says who wrote and how to reply without an address', () => {
  const guest = presentRow(row({ email: null }));
  assert.equal(guest.from, 'guest');
  assert.equal(guest.emailLeft, false);
  const account = presentRow(row({ email: null, user_id: 'u1', account_handle: 'kim' }));
  assert.equal(account.from, '@kim');
  const text = formatInbox([row({ email: null, user_id: 'u1', account_handle: 'kim' })], {
    ...parseInboxArgs([]),
  });
  assert.match(text, /reply via account email/);
  assert.match(text, /\| The board flips\.\n {3}\| Also: eval graph\?/);
});

test('inbox flags parse and reject bad values', () => {
  assert.deepEqual(parseInboxArgs(['--since', '2026-10-01', '--limit', '5', '--all']), {
    since: '2026-10-01',
    limit: 5,
    json: false,
    showEmail: false,
    all: true,
  });
  assert.throws(() => parseInboxArgs(['--since', '10/01/2026']), /YYYY-MM-DD/);
  assert.throws(() => parseInboxArgs(['--limit', '0']), /whole number/);
  assert.throws(() => parseInboxArgs(['--skip-log', 'x']), /unknown argument/);
});

test('mark requires a full id and a known status and class', () => {
  assert.deepEqual(parseMarkArgs([ID, '--status', 'done', '--class', 'bug', '--note', ' fixed ']), {
    id: ID,
    status: 'done',
    triageClass: 'bug',
    note: 'fixed',
  });
  assert.throws(() => parseMarkArgs(['0717761d', '--status', 'done']), /full submission id/);
  assert.throws(() => parseMarkArgs([ID]), /--status is required/);
  assert.throws(() => parseMarkArgs([ID, '--status', 'closed']), /--status is required/);
  assert.throws(() => parseMarkArgs([ID, '--status', 'done', '--class', 'rant']), /--class/);
});

test('mark defaults spam to the spam class and keeps addresses out of notes', () => {
  assert.equal(parseMarkArgs([ID, '--status', 'spam']).triageClass, 'spam');
  assert.throws(
    () => parseMarkArgs([ID, '--status', 'triaged', '--note', 'reply to jane@protonmail.com']),
    /email address/,
  );
  // A handle is not an address.
  assert.equal(
    parseMarkArgs([ID, '--status', 'triaged', '--note', 'ask @brianhliou-dev']).note,
    'ask @brianhliou-dev',
  );
});
