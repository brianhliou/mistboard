// Washington Xiangqi announcement sign-up (issue #629). Logic and copy live in
// ../club-signup.ts; this module is the HTTP surface:
//
//   POST /api/club/washington/subscribe  { email, locale, website }
//     202 { ok: true }          confirm mail sent (also the honeypot answer)
//     400 { error: 'invalid_email' }
//     429 { error: 'rate_limited' }
//     502 { error: 'send_failed' }
//     503 { error: 'signup_unavailable' }   config missing
//   GET  /api/club/washington/confirm?t=<token>
//     a plain localized HTML page; only here does the address become a contact.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeEmail } from './../account-identity.js';
import type { AuthRateLimiter } from './../auth-rate-limit.js';
import { createAuthRateLimiter } from './../auth-rate-limit.js';
import {
  addClubContact,
  CLUB_CONFIRM_PATH,
  CLUB_SUBSCRIBE_PATH,
  type ClubConfirmOutcome,
  type ClubSignupLocale,
  clubConfirmEmail,
  clubConfirmPage,
  clubConfirmUrl,
  clubSignupConfig,
  clubSignupLocale,
  signClubToken,
  verifyClubToken,
} from './../club-signup.js';
import { sendTransactionalEmail, type TransactionalEmail } from './../send-email.js';
import { clientIpForRateLimit, isProductionLikeRuntime } from './../server-policy.js';
import { RequestBodyTooLargeError, readJsonBody, requireMethod, writeJson } from './lib.js';

const HOUR_MS = 60 * 60 * 1000;

export type ClubSignupDeps = {
  env?: Record<string, string | undefined>;
  // Defaults to the shared Resend sender; tests pass a mock so nothing is sent.
  sendEmail?: (
    message: TransactionalEmail,
  ) => Promise<{ ok: true } | { ok: false; error?: string; statusCode?: number }>;
  // The contacts call; tests pass a mock.
  fetchImpl?: typeof fetch;
  now?: () => number;
  // Per client IP: every POST counts, honeypot hits included.
  ipLimiter?: AuthRateLimiter;
  // Per address: stops one inbox being mail-bombed from many IPs.
  emailLimiter?: AuthRateLimiter;
};

function log(kind: string, extra: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'error', kind, ...extra, at: Date.now() }));
}

function writePage(
  response: ServerResponse,
  status: number,
  locale: ClubSignupLocale,
  outcome: ClubConfirmOutcome,
): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
    // The token is in the URL; keep it out of any Referer.
    'referrer-policy': 'no-referrer',
  });
  response.end(clubConfirmPage(locale, outcome));
}

export function createClubSignupRoute(deps: ClubSignupDeps = {}) {
  const env = deps.env ?? process.env;
  const sendEmail = deps.sendEmail ?? ((message) => sendTransactionalEmail(message));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const ipLimiter =
    deps.ipLimiter ?? createAuthRateLimiter(isProductionLikeRuntime() ? 5 : 100, HOUR_MS);
  const emailLimiter = deps.emailLimiter ?? createAuthRateLimiter(3, 24 * HOUR_MS);

  async function subscribe(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const configured = clubSignupConfig(env);
    if (!configured.ok) {
      log('club_signup_unconfigured', { missing: configured.missing });
      writeJson(response, 503, { error: 'signup_unavailable' });
      return;
    }
    const { config } = configured;

    if (!ipLimiter.check(clientIpForRateLimit(request), now())) {
      writeJson(response, 429, { error: 'rate_limited' });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request, 2048);
    } catch (err) {
      writeJson(response, err instanceof RequestBodyTooLargeError ? 413 : 400, {
        error: 'invalid_body',
      });
      return;
    }

    // Honeypot: hidden from people, filled by form bots. Answer exactly as a
    // real sign-up so a bot learns nothing, and send nothing.
    if (typeof body.website === 'string' && body.website.trim().length > 0) {
      writeJson(response, 202, { ok: true });
      return;
    }

    const email = normalizeEmail(typeof body.email === 'string' ? body.email : null);
    if (!email) {
      writeJson(response, 400, { error: 'invalid_email' });
      return;
    }
    if (!emailLimiter.check(email, now())) {
      writeJson(response, 429, { error: 'rate_limited' });
      return;
    }

    const locale = clubSignupLocale(body.locale);
    const token = signClubToken(email, locale, config.secret, now());
    const mail = clubConfirmEmail(locale, clubConfirmUrl(config.publicHost, token, locale));
    const result = await sendEmail({
      from: config.from,
      to: [email],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if (!result.ok) {
      // Status only: the provider's body can echo the address.
      log('club_signup_send_failure', {
        status: result.statusCode ?? null,
        error: result.error ?? null,
      });
      writeJson(response, 502, { error: 'send_failed' });
      return;
    }
    writeJson(response, 202, { ok: true });
  }

  async function confirm(response: ServerResponse, parsedUrl: URL): Promise<void> {
    const configured = clubSignupConfig(env);
    const hinted = clubSignupLocale(parsedUrl.searchParams.get('lang'));
    if (!configured.ok) {
      log('club_signup_unconfigured', { missing: configured.missing });
      writePage(response, 503, hinted, 'unavailable');
      return;
    }
    const claim = verifyClubToken(parsedUrl.searchParams.get('t'), configured.config.secret, now());
    if (!claim) {
      // Bad signature or past its 7 days: either way, sign up again.
      writePage(response, 400, hinted, 'invalid');
      return;
    }
    const added = await addClubContact(configured.config, claim.email, fetchImpl);
    if (!added.ok) {
      log('club_signup_contact_failure', { status: added.status ?? null });
      writePage(response, 502, claim.locale, 'error');
      return;
    }
    writePage(response, 200, claim.locale, 'done');
  }

  return {
    async tryHandle(
      _ctx: unknown,
      request: IncomingMessage,
      response: ServerResponse,
      pathname: string,
      parsedUrl?: URL,
    ): Promise<boolean> {
      if (pathname === CLUB_SUBSCRIBE_PATH) {
        if (!requireMethod(request, response, 'POST')) return true;
        await subscribe(request, response);
        return true;
      }
      if (pathname === CLUB_CONFIRM_PATH) {
        // GET alone: a HEAD from a link checker must not subscribe anyone.
        if (!requireMethod(request, response, 'GET')) return true;
        await confirm(response, parsedUrl ?? new URL(request.url ?? '/', 'http://localhost'));
        return true;
      }
      return false;
    },
  };
}

const defaultRoute = createClubSignupRoute();

export const tryHandle = defaultRoute.tryHandle;
