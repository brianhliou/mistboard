/**
 * Washington Xiangqi announcement list (issue #629): stateless double opt-in.
 *
 * The pattern is brianhliou.com's api/subscribe.js + api/confirm.js. The form
 * posts an address; the server mails an HMAC-signed confirm link and stores
 * nothing. Only when the link is clicked does the address become a contact in
 * the club's own Resend audience, so club addresses never mix with any other
 * list and nobody is mailed an announcement they did not ask for twice. The
 * pending sign-up lives in the token, not a table.
 *
 * Env (names, not values):
 * - RESEND_API_KEY: the server's existing key; sends the confirm mail.
 * - MISTBOARD_AUTH_EMAIL_FROM or RESEND_FROM_EMAIL: the existing sender.
 * - MISTBOARD_CLUB_SIGNUP_SECRET: HMAC secret for the confirm token (secret).
 * - MISTBOARD_CLUB_RESEND_AUDIENCE_ID: the club audience/segment id (not secret).
 * - MISTBOARD_CLUB_RESEND_API_KEY: optional. Creating a contact needs a
 *   full-access Resend key; a sending-only RESEND_API_KEY cannot, so this
 *   overrides it for the contacts call alone.
 * Any required one missing: the endpoints answer 503 and say which is missing
 * in the log (names are not secrets), never crash.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { escapeHtml, renderEmail } from './email-layout.js';

export type ClubSignupLocale = 'en' | 'zh-Hans' | 'zh-Hant';

export const CLUB_SIGNUP_LOCALES: readonly ClubSignupLocale[] = ['en', 'zh-Hans', 'zh-Hant'];
export const CLUB_SIGNUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CLUB_CONTACT_EMAIL = 'hello@washingtonxiangqi.org';
export const CLUB_PAGE_PATH = '/washington-xiangqi';
export const CLUB_SUBSCRIBE_PATH = '/api/club/washington/subscribe';
export const CLUB_CONFIRM_PATH = '/api/club/washington/confirm';

// Bound into every MAC so a token minted for another purpose with the same
// secret can never pass here.
const TOKEN_PURPOSE = 'club-washington.v1';

export function clubSignupLocale(value: unknown): ClubSignupLocale {
  return CLUB_SIGNUP_LOCALES.includes(value as ClubSignupLocale)
    ? (value as ClubSignupLocale)
    : 'en';
}

export type ClubSignupConfig = {
  sendApiKey: string;
  contactsApiKey: string;
  from: string;
  secret: string;
  audienceId: string;
  publicHost: string;
};

export type ClubSignupConfigResult =
  | { ok: true; config: ClubSignupConfig }
  | { ok: false; missing: string[] };

export function clubSignupConfig(
  env: Record<string, string | undefined> = process.env,
): ClubSignupConfigResult {
  const from = env.MISTBOARD_AUTH_EMAIL_FROM ?? env.RESEND_FROM_EMAIL;
  const missing: string[] = [];
  if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!from) missing.push('MISTBOARD_AUTH_EMAIL_FROM');
  if (!env.MISTBOARD_CLUB_SIGNUP_SECRET) missing.push('MISTBOARD_CLUB_SIGNUP_SECRET');
  if (!env.MISTBOARD_CLUB_RESEND_AUDIENCE_ID) missing.push('MISTBOARD_CLUB_RESEND_AUDIENCE_ID');
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      sendApiKey: env.RESEND_API_KEY as string,
      contactsApiKey: env.MISTBOARD_CLUB_RESEND_API_KEY || (env.RESEND_API_KEY as string),
      from: from as string,
      secret: env.MISTBOARD_CLUB_SIGNUP_SECRET as string,
      audienceId: env.MISTBOARD_CLUB_RESEND_AUDIENCE_ID as string,
      publicHost: (env.MISTBOARD_HOST ?? 'https://mistboard.com').replace(/\/+$/, ''),
    },
  };
}

// ── Token ──────────────────────────────────────────────────────────────────

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function mac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${TOKEN_PURPOSE}.${payload}`).digest('base64url');
}

export function signClubToken(
  email: string,
  locale: ClubSignupLocale,
  secret: string,
  now: number = Date.now(),
): string {
  const payload = b64url(
    JSON.stringify({ e: email, l: locale, x: now + CLUB_SIGNUP_TOKEN_TTL_MS }),
  );
  return `${payload}.${mac(payload, secret)}`;
}

export function verifyClubToken(
  token: unknown,
  secret: string,
  now: number = Date.now(),
): { email: string; locale: ClubSignupLocale } | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload = '', given = ''] = parts;
  const a = Buffer.from(given);
  const b = Buffer.from(mac(payload, secret));
  // Length first: timingSafeEqual throws on a mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { e, l, x } = data as { e?: unknown; l?: unknown; x?: unknown };
  if (typeof e !== 'string' || typeof x !== 'number' || x < now) return null;
  return { email: e, locale: clubSignupLocale(l) };
}

// ── Confirm mail ───────────────────────────────────────────────────────────

const MAIL: Record<
  ClubSignupLocale,
  { subject: string; headline: string; paragraphs: string[]; button: string; reason: string }
> = {
  en: {
    subject: 'Confirm your Washington Xiangqi sign-up',
    headline: 'Confirm your sign-up',
    paragraphs: [
      'Confirm that you want announcements from Washington Xiangqi (华州象棋), the casual xiangqi group in Bellevue, by email. We write when there is a game or meetup to announce.',
      'The link works for 7 days. Every announcement has an unsubscribe link at the bottom.',
    ],
    button: 'Confirm sign-up',
    reason:
      'Someone entered this address on mistboard.com/washington-xiangqi. If it was not you, ignore this email and nothing happens.',
  },
  'zh-Hans': {
    subject: '确认订阅华州象棋活动通知',
    headline: '确认订阅',
    paragraphs: [
      '请确认你想通过邮件接收华州象棋的活动通知。华州象棋是贝尔维尤的休闲象棋聚会，有对局或聚会时我们会发邮件通知。',
      '此链接 7 天内有效。每封通知邮件底部都有退订链接。',
    ],
    button: '确认订阅',
    reason:
      '有人在 mistboard.com/washington-xiangqi 填写了这个邮箱。如果不是你本人，忽略这封邮件即可，不会有任何后续。',
  },
  'zh-Hant': {
    subject: '確認訂閱華州象棋活動通知',
    headline: '確認訂閱',
    paragraphs: [
      '請確認你想透過電子郵件接收華州象棋的活動通知。華州象棋是貝爾維尤的休閒象棋聚會，有對局或聚會時我們會寄信通知。',
      '此連結 7 天內有效。每封通知郵件底部都有取消訂閱連結。',
    ],
    button: '確認訂閱',
    reason:
      '有人在 mistboard.com/washington-xiangqi 填寫了這個信箱。如果不是你本人，忽略這封郵件即可，不會有任何後續。',
  },
};

// `lang` only picks the language of the error page when the token itself is
// refused; a valid token's own locale wins.
export function clubConfirmUrl(
  publicHost: string,
  token: string,
  locale: ClubSignupLocale = 'en',
): string {
  return `${publicHost}${CLUB_CONFIRM_PATH}?t=${encodeURIComponent(token)}&lang=${locale}`;
}

export function clubConfirmEmail(
  locale: ClubSignupLocale,
  url: string,
): { subject: string; text: string; html: string } {
  const copy = MAIL[locale];
  const rendered = renderEmail({
    lang: locale,
    headline: copy.headline,
    paragraphs: copy.paragraphs,
    button: { label: copy.button, url },
    // No manage link: nobody is on the list yet. The unsubscribe link rides
    // every announcement (Resend's own contact unsubscribe).
    footer: { reason: copy.reason, manage: null },
  });
  return { subject: copy.subject, ...rendered };
}

// ── Resend contact ─────────────────────────────────────────────────────────

export type AddClubContactResult = { ok: true; existed: boolean } | { ok: false; status?: number };

export async function addClubContact(
  config: Pick<ClubSignupConfig, 'contactsApiKey' | 'audienceId'>,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AddClubContactResult> {
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.resend.com/audiences/${encodeURIComponent(config.audienceId)}/contacts`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.contactsApiKey}`,
          'content-type': 'application/json',
          // Resend sits behind Cloudflare, which 403s some default agents with
          // an error that reads like a permissions failure (brianhliou.com).
          'user-agent': 'mistboard-server (+https://mistboard.com)',
        },
        body: JSON.stringify({ email, unsubscribed: false }),
      },
    );
  } catch {
    return { ok: false };
  }
  if (response.ok) return { ok: true, existed: false };
  // Confirming twice is a normal thing for a person to do. Resend reports an
  // existing contact as a 4xx; read the body only to recognise that case,
  // never to log it (it can echo the address).
  if (response.status === 409) return { ok: true, existed: true };
  if (response.status >= 400 && response.status < 500) {
    const body = await response.text().catch(() => '');
    if (/already exists/i.test(body)) return { ok: true, existed: true };
  }
  return { ok: false, status: response.status };
}

// ── Confirm page ───────────────────────────────────────────────────────────

export type ClubConfirmOutcome = 'done' | 'invalid' | 'error' | 'unavailable';

const PAGE: Record<
  ClubSignupLocale,
  Record<ClubConfirmOutcome, { title: string; body: string }> & { back: string }
> = {
  en: {
    done: {
      title: 'You are on the list',
      body: 'Washington Xiangqi will email you when there is a game or meetup to announce. Every email has an unsubscribe link.',
    },
    invalid: {
      title: 'This link has expired or is not valid',
      body: 'Confirm links work for 7 days. Sign up again on the Washington Xiangqi page and we will send a new one.',
    },
    error: {
      title: 'Something went wrong',
      body: 'We could not add you to the list just now. Try the link again in a few minutes.',
    },
    unavailable: {
      title: 'Sign-up is not available right now',
      body: `Write to ${CLUB_CONTACT_EMAIL} and we will add you.`,
    },
    back: 'Back to Washington Xiangqi',
  },
  'zh-Hans': {
    done: {
      title: '订阅成功',
      body: '有对局或聚会时，华州象棋会发邮件通知你。每封邮件都附有退订链接。',
    },
    invalid: {
      title: '链接已过期或无效',
      body: '确认链接 7 天内有效。请回到华州象棋页面重新订阅，我们会再发一封。',
    },
    error: {
      title: '出了点问题',
      body: '暂时无法完成订阅，请过几分钟再点一次链接。',
    },
    unavailable: {
      title: '订阅暂时无法使用',
      body: `请写信到 ${CLUB_CONTACT_EMAIL}，我们会帮你加入。`,
    },
    back: '返回华州象棋',
  },
  'zh-Hant': {
    done: {
      title: '訂閱成功',
      body: '有對局或聚會時，華州象棋會寄信通知你。每封郵件都附有取消訂閱連結。',
    },
    invalid: {
      title: '連結已過期或無效',
      body: '確認連結 7 天內有效。請回到華州象棋頁面重新訂閱，我們會再寄一封。',
    },
    error: {
      title: '出了點問題',
      body: '暫時無法完成訂閱，請過幾分鐘再點一次連結。',
    },
    unavailable: {
      title: '訂閱暫時無法使用',
      body: `請寫信到 ${CLUB_CONTACT_EMAIL}，我們會幫你加入。`,
    },
    back: '返回華州象棋',
  },
};

/** A plain, self-contained page: no app shell, no script, the site's colours. */
export function clubConfirmPage(locale: ClubSignupLocale, outcome: ClubConfirmOutcome): string {
  const copy = PAGE[locale];
  const { title, body } = copy[outcome];
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · 华州象棋</title>
<style>
:root { --bg: #eeeae3; --panel: #ffffff; --text: #4f4d4a; --heading: #34322d; --border: #d8d7d4; --link: #228169; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #161512; --panel: #262521; --text: #bababa; --heading: #d1d1d1; --border: #42413d; --link: #55c3a8; }
}
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
main { max-width: 560px; margin: 48px auto; padding: 28px 24px; background: var(--panel); border: 1px solid var(--border); border-radius: 7px; box-sizing: border-box; }
@media (max-width: 600px) { main { margin: 16px; } }
h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.3; color: var(--heading); }
p { margin: 0 0 16px; }
a { color: var(--link); }
</style>
</head>
<body>
<main data-outcome="${outcome}">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<p><a href="${CLUB_PAGE_PATH}">${escapeHtml(copy.back)}</a></p>
</main>
</body>
</html>
`;
}
