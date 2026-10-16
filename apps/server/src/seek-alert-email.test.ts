import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type SeekAlertNotice,
  seekAcceptUrl,
  seekAlertRecipient,
  sendSeekAlertEmail,
} from './seek-alert-email.js';
import type { TransactionalEmail } from './send-email.js';

const notice: SeekAlertNotice = {
  seekId: 'seek_abc 1',
  gameSpecId: 'jieqi',
  daysPerMove: 1,
  creatorName: 'Guest Player',
  source: 'quick-pair',
};

test('seek alert: the recipient comes from MISTBOARD_SEEK_ALERT_EMAIL; unset or blank is off', () => {
  assert.equal(seekAlertRecipient({}), null);
  assert.equal(seekAlertRecipient({ MISTBOARD_SEEK_ALERT_EMAIL: '   ' }), null);
  assert.equal(
    seekAlertRecipient({ MISTBOARD_SEEK_ALERT_EMAIL: ' ops@example.com ' }),
    'ops@example.com',
  );
});

test('seek alert: no recipient means no send', async () => {
  const sent: TransactionalEmail[] = [];
  const result = await sendSeekAlertEmail(notice, {
    recipient: null,
    fromAddress: 'from@example.com',
    send: async (message) => {
      sent.push(message);
      return { ok: true };
    },
  });
  assert.equal(result, false);
  assert.equal(sent.length, 0);
});

test('seek alert: a recipient gets exactly one email with the direct accept link', async () => {
  const sent: TransactionalEmail[] = [];
  const result = await sendSeekAlertEmail(notice, {
    recipient: 'ops@example.com',
    fromAddress: 'from@example.com',
    host: 'https://mistboard.test/',
    send: async (message) => {
      sent.push(message);
      return { ok: true };
    },
  });
  assert.equal(result, true);
  assert.equal(sent.length, 1);
  const [message] = sent;
  assert.deepEqual(message?.to, ['ops@example.com']);
  assert.equal(message?.from, 'from@example.com');
  assert.match(message?.subject ?? '', /jieqi/);
  assert.match(message?.subject ?? '', /Guest Player/);
  assert.ok(message?.text.includes('https://mistboard.test/challenge/seek_abc%201'), message?.text);
  assert.match(message?.text ?? '', /1 day per move/);
});

test('seek alert: a provider rejection reports false and does not throw', async () => {
  const result = await sendSeekAlertEmail(notice, {
    recipient: 'ops@example.com',
    fromAddress: 'from@example.com',
    send: async () => ({ ok: false, statusCode: 500 }),
  });
  assert.equal(result, false);
});

test('seek alert: the accept URL is the challenge landing, id encoded', () => {
  assert.equal(seekAcceptUrl('seek_x/y', 'https://a.test'), 'https://a.test/challenge/seek_x%2Fy');
});
