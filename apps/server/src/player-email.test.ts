import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { accountCodeEmail } from './account-session.js';
import { renderEmail } from './email-layout.js';
import {
  correspondenceDeadlineEmail,
  correspondenceDigestEmail,
  correspondenceStartEmail,
  EMAIL_VARIANT_NAMES,
  type EmailLocale,
  emailLocale,
  notificationSettingsUrl,
  type PlayerEmail,
  variantName,
} from './player-email.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LOCALES: EmailLocale[] = ['en', 'zh-Hans', 'zh-Hant'];
const NOW = new Date('2026-10-08T15:00:00Z');

function startEmail(locale: EmailLocale, overrides: { creatorOnMove?: boolean } = {}) {
  return correspondenceStartEmail(
    {
      roomId: 'bq_room',
      gameSpecId: 'banqi',
      opponentName: 'rebirthfox333',
      creatorOnMove: overrides.creatorOnMove ?? true,
      daysPerMove: 3,
    },
    locale,
  );
}

function deadlineEmail(locale: EmailLocale) {
  return correspondenceDeadlineEmail(
    {
      roomId: 'dxq_room',
      gameSpecId: 'dark-xiangqi',
      opponentName: 'mistwalker',
      allowanceMs: DAY_MS,
      remainingMs: 8 * HOUR_MS,
    },
    locale,
  );
}

function digestEmail(locale: EmailLocale, count = 2) {
  const games = [
    { roomId: 'jq_one', gameSpecId: 'jieqi', opponentName: 'flipper' },
    { roomId: 'xq_two', gameSpecId: 'xiangqi', opponentName: null },
  ].slice(0, count);
  return correspondenceDigestEmail(
    games.map((game) => ({ ...game, dueAt: new Date(NOW.getTime() + 2 * DAY_MS) })),
    NOW,
    locale,
  );
}

function correspondenceEmails(locale: EmailLocale): Array<[string, PlayerEmail]> {
  return [
    ['start (on move)', startEmail(locale)],
    ['start (waiting)', startEmail(locale, { creatorOnMove: false })],
    ['deadline', deadlineEmail(locale)],
    ['digest (one game)', digestEmail(locale, 1)],
    ['digest (two games)', digestEmail(locale)],
  ];
}

const CODE_PURPOSES = ['login', 'email-change', 'account-closure'] as const;

test('English subjects name the variant and the opponent', () => {
  assert.equal(startEmail('en').subject, 'Banqi with rebirthfox333 has started: your move');
  assert.equal(
    startEmail('en', { creatorOnMove: false }).subject,
    'Banqi with rebirthfox333 has started',
  );
  assert.equal(
    deadlineEmail('en').subject,
    'Your move against mistwalker in Fog Xiangqi is running out of time',
  );
  assert.equal(digestEmail('en', 1).subject, 'Your move in jieqi against flipper');
  assert.equal(digestEmail('en').subject, 'Your move in jieqi against flipper and 1 other game');
});

test('zh subjects name the variant and the opponent', () => {
  for (const locale of ['zh-Hans', 'zh-Hant'] as const) {
    const start = startEmail(locale).subject;
    assert.match(start, /暗棋/);
    assert.match(start, /rebirthfox333/);
    const deadline = deadlineEmail(locale).subject;
    assert.match(deadline, locale === 'zh-Hans' ? /迷雾象棋/ : /迷霧象棋/);
    assert.match(deadline, /mistwalker/);
    const digest = digestEmail(locale).subject;
    assert.match(digest, /揭棋/);
    assert.match(digest, /flipper/);
  }
  assert.equal(startEmail('zh-Hans').subject, '与 rebirthfox333 的暗棋对局已开始：轮到你走');
  assert.equal(startEmail('zh-Hant').subject, '與 rebirthfox333 的暗棋對局已開始：輪到你走');
});

test('bodies say which game it is: variant, opponent and pace', () => {
  const start = startEmail('en');
  assert.match(start.text, /Banqi with rebirthfox333 has started/);
  assert.match(start.text, /3 days per move/);
  const deadline = deadlineEmail('en');
  assert.match(deadline.text, /Fog Xiangqi game against mistwalker \(1 day per move\)/);
  assert.match(deadline.text, /about 8 hours/);
  assert.match(startEmail('zh-Hans').text, /每步 3 天/);
});

test('every correspondence email links to the notification settings, in text and html', () => {
  for (const locale of LOCALES) {
    for (const [kind, email] of correspondenceEmails(locale)) {
      assert.ok(
        email.text.includes(notificationSettingsUrl),
        `${locale} ${kind}: text footer link`,
      );
      assert.ok(
        email.html.includes(`href="${notificationSettingsUrl}"`),
        `${locale} ${kind}: html footer link`,
      );
    }
  }
  assert.equal(notificationSettingsUrl, 'https://mistboard.com/account/settings/notifications');
});

test('every correspondence email says why it was sent', () => {
  assert.match(startEmail('en').text, /because someone accepted a correspondence seek you posted/);
  assert.match(deadlineEmail('en').text, /because your clock is running low/);
  assert.match(digestEmail('en').text, /at most one of these a day/);
});

test('login, email-change and closure codes carry no settings link', () => {
  for (const purpose of CODE_PURPOSES) {
    const email = accountCodeEmail('01234567', purpose);
    assert.ok(!email.text.includes('/account/settings'), `${purpose}: text`);
    assert.ok(!email.html.includes('/account/settings'), `${purpose}: html`);
    assert.ok(email.text.includes('01234567'), `${purpose}: code in text`);
    assert.ok(email.html.includes('01234567'), `${purpose}: code in html`);
    assert.match(email.text, /expires in 10 minutes/);
  }
  assert.equal(accountCodeEmail('1', 'login').subject, 'Your Mistboard login code');
});

test('every kind produces both a plain-text and an html part', () => {
  const all: PlayerEmail[] = [
    ...LOCALES.flatMap((locale) => correspondenceEmails(locale).map(([, email]) => email)),
    ...CODE_PURPOSES.map((purpose) => accountCodeEmail('01234567', purpose)),
  ];
  for (const email of all) {
    assert.ok(email.subject.length > 0);
    assert.ok(email.text.length > 0);
    assert.match(email.html, /^<!doctype html>/);
    assert.ok(!/<[a-z]/i.test(email.text), 'the text part carries no markup');
  }
  // The game link is written out in full in the text part.
  assert.match(startEmail('en').text, /Play your move: https:\/\/mistboard\.com\/room\/bq_room/);
});

test('no em dash in any subject, text or html, in any locale or variant', () => {
  const outputs: PlayerEmail[] = [];
  for (const locale of LOCALES) {
    outputs.push(...correspondenceEmails(locale).map(([, email]) => email));
    for (const gameSpecId of Object.keys(EMAIL_VARIANT_NAMES)) {
      outputs.push(
        correspondenceStartEmail(
          { roomId: 'r', gameSpecId, opponentName: null, creatorOnMove: false, daysPerMove: 1 },
          locale,
        ),
        correspondenceDeadlineEmail(
          { roomId: 'r', gameSpecId, opponentName: null, allowanceMs: 7 * DAY_MS, remainingMs: 1 },
          locale,
        ),
      );
    }
  }
  outputs.push(...CODE_PURPOSES.map((purpose) => accountCodeEmail('01234567', purpose)));
  for (const email of outputs) {
    for (const part of [email.subject, email.text, email.html]) {
      assert.ok(!part.includes('\u2014'), `em dash in: ${email.subject}`);
    }
  }
});

test('player-supplied names are escaped in the html part', () => {
  const email = correspondenceStartEmail(
    {
      roomId: 'r"><x',
      gameSpecId: 'xiangqi',
      opponentName: '<img src=x onerror=alert(1)>',
      creatorOnMove: true,
      daysPerMove: 1,
    },
    'en',
  );
  assert.ok(!email.html.includes('<img'));
  assert.ok(email.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(email.html.includes('/room/r%22%3E%3Cx'));
});

test('English running prose lowercases the common-noun variant names only', () => {
  assert.equal(variantName('xiangqi', 'en', true), 'xiangqi');
  assert.equal(variantName('jieqi', 'en', true), 'jieqi');
  assert.equal(variantName('banqi', 'en', true), 'banqi');
  assert.equal(variantName('dark-xiangqi', 'en', true), 'Fog Xiangqi');
  assert.equal(variantName('jungle', 'en', true), 'Jungle Chess');
  assert.equal(variantName('xiangqi', 'en'), 'Xiangqi');
});

test('emailLocale maps users.locale and defaults to English', () => {
  assert.equal(emailLocale('zh-Hans'), 'zh-Hans');
  assert.equal(emailLocale('zh-Hant'), 'zh-Hant');
  assert.equal(emailLocale('en'), 'en');
  assert.equal(emailLocale(null), 'en');
  assert.equal(emailLocale('ja'), 'en');
});

test('variant names match the site catalogs', () => {
  // The server has no catalog; this keeps its copy of the names honest. Reads
  // the web sources as text (the server build cannot import web modules).
  const web = resolve(import.meta.dirname, '../../web/src');
  const display = readFileSync(resolve(web, 'game-display.ts'), 'utf8');
  const keysStart = display.indexOf('export const VARIANT_NAME_KEYS');
  const keys = display.slice(keysStart, display.indexOf('\n};', keysStart));
  assert.ok(keysStart >= 0, 'VARIANT_NAME_KEYS is still in game-display.ts');
  const catalog = (file: string) => readFileSync(resolve(web, 'i18n/catalogs', file), 'utf8');
  const catalogs: Record<EmailLocale, string> = {
    en: catalog('play.ts'),
    'zh-Hans': catalog('play.zh-hans.ts'),
    'zh-Hant': catalog('play.zh-hant.ts'),
  };
  for (const [gameSpecId, names] of Object.entries(EMAIL_VARIANT_NAMES)) {
    const keyMatch = new RegExp(
      `\\n\\s+'?${gameSpecId}'?: (null|'(variant\\.[A-Za-z]+\\.name)')`,
    ).exec(keys);
    assert.ok(keyMatch, `${gameSpecId} is in VARIANT_NAME_KEYS`);
    const key = keyMatch[2];
    if (!key) {
      assert.equal(names, null, `${gameSpecId} has no site name, so none here`);
      continue;
    }
    assert.ok(names, `${gameSpecId} has a site name (${key})`);
    for (const locale of LOCALES) {
      const value = new RegExp(`'${key.replaceAll('.', '\\.')}': '([^']+)'`).exec(
        catalogs[locale],
      )?.[1];
      assert.equal(names[locale], value, `${gameSpecId} ${locale}`);
    }
  }
});

test('the layout renders without a button or settings link', () => {
  const email = renderEmail({
    headline: 'Hello',
    paragraphs: ['One line.'],
    footer: { reason: 'Because.', manage: null },
  });
  assert.equal(email.text, 'Mistboard\n\nHello\n\nOne line.\n\n--\nBecause.');
  assert.ok(!email.html.includes('mb-button'));
});
