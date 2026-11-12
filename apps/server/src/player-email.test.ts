import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { accountCodeEmail } from './account-session.js';
import { renderEmail } from './email-layout.js';
import {
  challengeUrl,
  correspondenceChallengeEmail,
  correspondenceDeadlineEmail,
  correspondenceDigestEmail,
  correspondenceGameOverEmail,
  correspondenceHostReceiptEmail,
  correspondenceHostStartEmail,
  correspondenceJoinedStartEmail,
  correspondencePlayAgainUrl,
  correspondenceStartEmail,
  EMAIL_VARIANT_NAMES,
  type EmailLocale,
  emailLocale,
  inboxNoticeEmail,
  notificationSettingsUrl,
  type PlayerEmail,
  variantName,
} from './player-email.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LOCALES: EmailLocale[] = ['en', 'zh-Hans', 'zh-Hant'];
const NOW = new Date('2026-10-08T15:00:00Z');

const INBOX_COPY = {
  en: {
    subject: 'Unread message from Fox <Chess> (@fox333)',
    button: 'Open your inbox',
    reason: 'You received this email because you have an unread message on Mistboard.',
    unsubscribe: 'Unsubscribe from message emails',
  },
  'zh-Hans': {
    subject: 'Fox <Chess>（@fox333）发来的未读私信',
    button: '打开收件箱',
    reason: '你收到这封邮件，是因为你在 Mistboard 有未读私信。',
    unsubscribe: '退订私信邮件通知',
  },
  'zh-Hant': {
    subject: 'Fox <Chess>（@fox333）發來的未讀私訊',
    button: '打開收件匣',
    reason: '你收到這封電子郵件，是因為你在 Mistboard 有未讀私訊。',
    unsubscribe: '取消訂閱私訊郵件通知',
  },
};

for (const locale of LOCALES) {
  test(`${locale} inbox notice localizes all copy, escapes identity, and ignores message bodies`, () => {
    const forbidden = 'FORBIDDEN-DM-BODY-913: private words must stay in the inbox';
    const input = {
      senderHandle: 'fox333',
      senderName: 'Fox <Chess>',
      unsubscribeUrl: 'https://mistboard.com/api/inbox/email/unsubscribe?t=test-token',
      // Untrusted extra properties must never become content or a preview.
      bodyText: forbidden,
      lastText: forbidden,
      text: forbidden,
    };
    const email = inboxNoticeEmail(input, locale);
    assert.deepEqual(
      email,
      inboxNoticeEmail(
        {
          senderHandle: input.senderHandle,
          senderName: input.senderName,
          unsubscribeUrl: input.unsubscribeUrl,
        },
        locale,
      ),
      'extra body fields cannot affect any part of the email, even as a truncated preview',
    );
    const copy = INBOX_COPY[locale];
    assert.equal(email.subject, copy.subject);
    assert.ok(email.text.includes(copy.subject));
    assert.ok(email.html.includes(`<html lang="${locale}">`));
    assert.ok(email.html.includes('Fox &lt;Chess&gt;'));
    assert.ok(!email.html.includes('Fox <Chess>'));
    for (const part of [email.text, email.html]) {
      for (const expected of [
        '@fox333',
        copy.button,
        copy.reason,
        copy.unsubscribe,
        'https://mistboard.com/inbox',
        input.unsubscribeUrl,
      ])
        assert.ok(part.includes(expected), expected);
      assert.ok(!part.includes('\u2014'));
    }
    assert.ok(
      email.text.includes(`--\n${copy.reason}\n${copy.unsubscribe}: ${input.unsubscribeUrl}`),
    );
    assert.ok(email.html.includes(`href="${input.unsubscribeUrl}"`));
    assert.ok(!JSON.stringify(email).includes(forbidden));
    assert.ok(!JSON.stringify(email).includes('FORBIDDEN-DM'));
  });
}

// Keep the renderer's public contract metadata-only, including at compile time.
function inboxRendererRejectsMessageText() {
  inboxNoticeEmail(
    {
      senderHandle: 'fox333',
      senderName: 'Fox',
      unsubscribeUrl: 'https://mistboard.com/unsubscribe',
      // @ts-expect-error Message text is deliberately not a renderer input.
      bodyText: 'FORBIDDEN-DM-BODY-913',
    },
    'en',
  );
}
void inboxRendererRejectsMessageText;

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

const CODE_COPY = {
  en: {
    subjects: [
      'Your Mistboard login code',
      'Confirm your new Mistboard email',
      'Confirm closing your Mistboard account',
    ],
    headings: ['Your login code', 'Your email-change code', 'Your account-closure code'],
    intros: [
      'Your Mistboard login code is',
      'Your Mistboard email-change code is',
      'Your Mistboard account-closure code is',
    ],
    instructions: 'Enter it on Mistboard to continue. The code expires in 10 minutes.',
    footer: 'If you did not request this code, you can ignore this email.',
  },
  'zh-Hans': {
    subjects: [
      '你的 Mistboard 登录验证码',
      '确认你的 Mistboard 新邮箱',
      '确认关闭你的 Mistboard 账号',
    ],
    headings: ['你的登录验证码', '你的邮箱变更验证码', '你的账号关闭验证码'],
    intros: [
      '你的 Mistboard 登录验证码是',
      '你的 Mistboard 邮箱变更验证码是',
      '你的 Mistboard 账号关闭验证码是',
    ],
    instructions: '请在 Mistboard 输入此验证码以继续。验证码将在 10 分钟后过期。',
    footer: '如果你没有请求此验证码，可以忽略这封邮件。',
  },
  'zh-Hant': {
    subjects: [
      '你的 Mistboard 登入驗證碼',
      '確認你的 Mistboard 新信箱',
      '確認關閉你的 Mistboard 帳號',
    ],
    headings: ['你的登入驗證碼', '你的信箱變更驗證碼', '你的帳號關閉驗證碼'],
    intros: [
      '你的 Mistboard 登入驗證碼是',
      '你的 Mistboard 信箱變更驗證碼是',
      '你的 Mistboard 帳號關閉驗證碼是',
    ],
    instructions: '請在 Mistboard 輸入此驗證碼以繼續。驗證碼將在 10 分鐘後過期。',
    footer: '如果你沒有請求此驗證碼，可以忽略這封郵件。',
  },
};

for (const locale of LOCALES) {
  for (const [index, purpose] of CODE_PURPOSES.entries()) {
    test(`${locale} ${purpose} translates every part of the account email`, () => {
      const email = accountCodeEmail('01234567', purpose, locale);
      const copy = CODE_COPY[locale];
      assert.equal(email.subject, copy.subjects[index]);
      assert.ok(email.html.includes(`<html lang="${locale}">`));
      assert.ok(email.html.includes(`${copy.intros[index]} 01234567.`), 'preheader');
      for (const part of [email.text, email.html]) {
        for (const expected of [
          copy.headings[index]!,
          copy.instructions,
          copy.footer,
          '01234567',
        ]) {
          assert.ok(part.includes(expected), `${purpose}: ${expected}`);
        }
        assert.ok(!part.includes('/account/settings'));
        assert.ok(!part.includes('\u2014'));
      }
    });
  }
}

test('all account code purposes default omitted and unsupported locales to English', () => {
  for (const purpose of CODE_PURPOSES) {
    const english = accountCodeEmail('01234567', purpose, 'en');
    for (const locale of [undefined, null, 'fr', 'zh', 'zh-hans']) {
      assert.deepEqual(accountCodeEmail('01234567', purpose, locale), english);
    }
  }
});

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

// ── #1057: challenge, joiner start, Play the host, game over ────────────────

function noticeEmails(locale: EmailLocale): Array<[string, PlayerEmail]> {
  return [
    [
      'challenge',
      correspondenceChallengeEmail(
        {
          seekId: 'seek_1',
          gameSpecId: 'jieqi',
          challengerName: 'Alice',
          challengerHandle: 'alice',
          daysPerMove: 3,
          rated: true,
          openDays: 7,
        },
        locale,
      ),
    ],
    [
      'joined',
      correspondenceJoinedStartEmail(
        {
          roomId: 'jq_room',
          gameSpecId: 'jieqi',
          opponentName: 'Alice',
          recipientOnMove: true,
          daysPerMove: 3,
        },
        locale,
      ),
    ],
    [
      'host',
      correspondenceHostStartEmail(
        {
          roomId: 'xq_room',
          gameSpecId: 'xiangqi',
          playerName: 'Bob',
          playerHandle: 'bob',
          hostOnMove: true,
          daysPerMove: 2,
        },
        locale,
      ),
    ],
    [
      'receipt',
      correspondenceHostReceiptEmail(
        {
          roomId: 'xq_room',
          gameSpecId: 'xiangqi',
          hostName: 'Host',
          playerOnMove: false,
          daysPerMove: 2,
          turnDigest: true,
        },
        locale,
      ),
    ],
    ...(['won', 'lost', 'draw', 'cancelled'] as const).map((outcome): [string, PlayerEmail] => [
      `over-${outcome}`,
      correspondenceGameOverEmail(
        {
          roomId: 'xq_room',
          gameSpecId: 'xiangqi',
          opponentName: 'Bob',
          outcome,
          termination: 'resignation',
          reviewPath: '/xiangqi/review/xq_room',
        },
        locale,
      ),
    ]),
  ];
}

test('#1057 emails: settings link, both parts, no em dash, in every locale', () => {
  for (const locale of LOCALES) {
    for (const [kind, email] of noticeEmails(locale)) {
      assert.ok(email.text.includes(notificationSettingsUrl), `${locale} ${kind}: text footer`);
      assert.ok(email.html.includes(`href="${notificationSettingsUrl}"`), `${locale} ${kind}`);
      assert.match(email.html, /^<!doctype html>/);
      assert.ok(!/<[a-z]/i.test(email.text), `${locale} ${kind}: markup in text`);
      for (const part of [email.subject, email.text, email.html]) {
        assert.ok(!part.includes('\u2014'), `em dash in ${locale} ${kind}`);
      }
      // Text only: no board, no image.
      assert.ok(!email.html.includes('<img'), `${locale} ${kind}: image`);
      assert.ok(!email.html.includes('<svg'), `${locale} ${kind}: svg`);
    }
  }
});

test('the challenge email names the challenger and pace, and links to the challenge', () => {
  const [, email] = noticeEmails('en')[0]!;
  assert.equal(email.subject, 'Alice (@alice) challenged you to Jieqi, 3 days per move');
  assert.match(email.text, /rated correspondence challenge: jieqi, 3 days per move/);
  assert.match(email.text, /It stays open for 7 days/);
  assert.equal(challengeUrl('seek_1'), 'https://mistboard.com/challenge/seek_1');
  assert.match(email.text, /See the challenge: https:\/\/mistboard\.com\/challenge\/seek_1/);
  const zh = noticeEmails('zh-Hans')[0]![1];
  assert.match(zh.text, /计分通信对局挑战/);
  assert.match(zh.text, /https:\/\/mistboard\.com\/challenge\/seek_1/);
});

test('the joiner start email links to the room and says who moves first', () => {
  const email = correspondenceJoinedStartEmail(
    {
      roomId: 'jq_room',
      gameSpecId: 'jieqi',
      opponentName: 'Alice',
      recipientOnMove: false,
      daysPerMove: 3,
    },
    'en',
  );
  assert.match(email.text, /against Alice has started, and Alice has the first move/);
  assert.match(email.text, /https:\/\/mistboard\.com\/room\/jq_room/);
  assert.match(email.text, /because you accepted a correspondence seek or challenge/);
});

test('the host gets "New game", the player a receipt', () => {
  const host = noticeEmails('en')[2]![1];
  assert.equal(
    host.subject,
    'New game: Bob (@bob) started Xiangqi against you, 2 days per move: your move',
  );
  assert.match(host.text, /https:\/\/mistboard\.com\/room\/xq_room/);
  const receipt = noticeEmails('en')[3]![1];
  assert.match(receipt.text, /Your game against Host has started, and Host has the first move/);
  assert.match(receipt.text, /at most one email a day/);
  const noDigest = correspondenceHostReceiptEmail(
    {
      roomId: 'xq_room',
      gameSpecId: 'xiangqi',
      hostName: 'Host',
      playerOnMove: true,
      daysPerMove: 2,
      turnDigest: false,
    },
    'en',
  );
  assert.match(noDigest.text, /Host replies to each move within 2 days/);
  assert.ok(!noDigest.text.includes('at most one email a day'), 'no promise the digest is off');
});

test('the game-over email says the result and links to the review', () => {
  const byKind = new Map(noticeEmails('en'));
  assert.equal(byKind.get('over-won')?.subject, 'You won your xiangqi game against Bob');
  assert.equal(byKind.get('over-lost')?.subject, 'You lost your xiangqi game against Bob');
  assert.equal(byKind.get('over-draw')?.subject, 'Your xiangqi game against Bob was drawn');
  const won = byKind.get('over-won')!;
  assert.match(won.text, /ended by resignation/);
  assert.match(won.text, /Review the game: https:\/\/mistboard\.com\/xiangqi\/review\/xq_room/);
  // Play again is off until #606: no second link.
  assert.equal(correspondencePlayAgainUrl({ roomId: 'xq_room', gameSpecId: 'xiangqi' }), null);
  assert.ok(!won.text.includes('Play again'));
  const cancelled = byKind.get('over-cancelled')!;
  assert.equal(cancelled.subject, 'Your xiangqi game against Bob was cancelled');
  assert.match(cancelled.text, /has no result/);
  assert.ok(!cancelled.text.includes('resignation'));
  assert.match(cancelled.text, /https:\/\/mistboard\.com\/room\/xq_room/);
  // No review page for the variant: the room instead.
  const noReview = correspondenceGameOverEmail(
    {
      roomId: 'r1',
      gameSpecId: 'xiangqi',
      opponentName: null,
      outcome: 'draw',
      termination: 'agreement',
      reviewPath: null,
    },
    'en',
  );
  assert.equal(noReview.subject, 'Your xiangqi game was drawn');
  assert.match(noReview.text, /https:\/\/mistboard\.com\/room\/r1/);
  assert.ok(!noReview.text.includes('ended by'), 'an unlisted termination says nothing');
});

test('#1057 emails escape player names in the html part', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const emails = [
    correspondenceChallengeEmail(
      {
        seekId: 's',
        gameSpecId: 'xiangqi',
        challengerName: evil,
        challengerHandle: null,
        daysPerMove: 1,
        rated: false,
        openDays: 7,
      },
      'en',
    ),
    correspondenceHostStartEmail(
      {
        roomId: 'r',
        gameSpecId: 'xiangqi',
        playerName: evil,
        playerHandle: null,
        hostOnMove: false,
        daysPerMove: 2,
      },
      'en',
    ),
    correspondenceGameOverEmail(
      {
        roomId: 'r',
        gameSpecId: 'xiangqi',
        opponentName: evil,
        outcome: 'won',
        termination: null,
        reviewPath: null,
      },
      'en',
    ),
  ];
  for (const email of emails) {
    assert.ok(!email.html.includes('<img'), email.subject);
    assert.ok(email.html.includes('&lt;img src=x onerror=alert(1)&gt;'), email.subject);
  }
});
