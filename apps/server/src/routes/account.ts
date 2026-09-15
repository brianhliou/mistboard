import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeEmail, normalizeProfileHandle } from './../account-identity.js';
import {
  accountSessionsFromRequest,
  authEmailDeliveryEnabled,
  currentAccountUser,
  devAuthCodesEnabled,
  emailLoginCodeTtlMs,
  expiredAccountSessionCookie,
  hashSecret,
  legacyHostOnlyAccountSessionEviction,
  publicUser,
  randomEmailLoginCode,
  sendAccountClosureCode,
  sendEmailChangeCode,
} from './../account-session.js';
import { clientIpForRateLimit, createAuthRateLimiter } from './../auth-rate-limit.js';
import { type FlairKey, parseFlair } from './../flair.js';
import * as persistence from './../persistence.js';
import { readJsonBody, requireMethod, requirePersistence, writeJson } from './lib.js';

const emailChangeRateWindowMs = 10 * 60 * 1000;
const emailChangeStartRateLimiter = createAuthRateLimiter(5, emailChangeRateWindowMs);
const emailChangeConfirmRateLimiter = createAuthRateLimiter(10, emailChangeRateWindowMs);
const accountClosureStartRateLimiter = createAuthRateLimiter(3, emailChangeRateWindowMs);
const accountClosureConfirmRateLimiter = createAuthRateLimiter(10, emailChangeRateWindowMs);
const booleanAccountPreferenceKeys = new Set<persistence.AccountPreferenceKey>([
  'lowTimeSound',
  'premoves',
  'confirmGameActions',
  'inboxBell',
  'correspondenceBell',
  'challengesBell',
  'forumBell',
  'followersBell',
  'correspondenceDeadlineEmail',
  'correspondenceStartEmail',
  'correspondenceTurnDigest',
  'forumAutoTranslate',
]);

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/account/closure/start') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    if (!accountClosureStartRateLimiter.check(clientIpForRateLimit(request))) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }
    if (user.patronSince) {
      writeJson(response, 409, { error: 'active_subscription' });
      return true;
    }
    if (!authEmailDeliveryEnabled && !devAuthCodesEnabled) {
      writeJson(response, 503, { error: 'email_delivery_not_configured' });
      return true;
    }
    const closureId = randomUUID();
    const code = randomEmailLoginCode();
    const expiresAt = new Date(Date.now() + emailLoginCodeTtlMs);
    await persistence.createAccountClosureChallenge({
      id: closureId,
      userId: user.id,
      codeHash: hashSecret(code),
      expiresAt,
    });
    if (authEmailDeliveryEnabled) {
      const delivery = await sendAccountClosureCode(user.email, code);
      if (!delivery.ok) {
        await persistence.deleteAccountClosureChallenge(closureId);
        writeJson(response, 502, { error: 'email_delivery_failed' });
        return true;
      }
    }
    writeJson(response, 202, {
      closureId,
      expiresAt: expiresAt.toISOString(),
      delivery: authEmailDeliveryEnabled ? 'email' : 'dev-response',
      ...(devAuthCodesEnabled ? { devCode: code } : {}),
    });
    return true;
  }

  if (pathname === '/api/account/closure/confirm') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    if (!accountClosureConfirmRateLimiter.check(clientIpForRateLimit(request))) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }
    const body = await readJsonBody(request);
    const closureId = typeof body.closureId === 'string' ? body.closureId.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!closureId || !code) {
      writeJson(response, 400, { error: 'invalid_account_closure_code' });
      return true;
    }
    const now = new Date();
    const verified = await persistence.consumeAccountClosureChallenge(
      closureId,
      user.id,
      hashSecret(code),
      now,
    );
    if (!verified) {
      writeJson(response, 400, { error: 'invalid_account_closure_code' });
      return true;
    }
    const closedHandle = `closed-${hashSecret(user.id).slice(0, 16)}`;
    const closed = await persistence.closeUserAccount(
      user.id,
      {
        closedEmailHash: hashSecret(user.email),
        closedHandle,
        placeholderEmail: `${closedHandle}@closed.mistboard.invalid`,
      },
      now,
    );
    if (!closed.ok) {
      const status = closed.error === 'active_subscription' ? 409 : 404;
      writeJson(response, status, { error: closed.error });
      return true;
    }
    writeJson(response, 200, { closed: true }, { 'set-cookie': expiredSessionCookies() });
    return true;
  }

  if (pathname === '/api/account/sessions') {
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const currentSessionIds = accountSessionsFromRequest(request).map(
      (session) => session.sessionId,
    );
    if (request.method === 'DELETE') {
      const revoked = await persistence.revokeOtherUserAccountSessions(
        user.id,
        currentSessionIds,
        new Date(),
      );
      writeJson(response, 200, { revoked });
      return true;
    }
    const userAgent = request.headers['user-agent'];
    if (typeof userAgent === 'string' && userAgent.trim()) {
      await persistence.backfillUserAccountSessionAgent(
        user.id,
        currentSessionIds,
        userAgent.trim().slice(0, 500),
      );
    }
    const sessions = await persistence.listActiveAccountSessions(user.id, new Date());
    const currentIds = new Set(currentSessionIds);
    writeJson(response, 200, {
      sessions: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        userAgent: session.userAgent,
        current: currentIds.has(session.id),
      })),
    });
    return true;
  }

  if (pathname.startsWith('/api/account/sessions/')) {
    if (!requireMethod(request, response, 'DELETE')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const sessionId = pathname.slice('/api/account/sessions/'.length).trim();
    if (!sessionId || sessionId.includes('/')) {
      writeJson(response, 400, { error: 'invalid_session' });
      return true;
    }
    const currentSessionIds = new Set(
      accountSessionsFromRequest(request).map((session) => session.sessionId),
    );
    if (currentSessionIds.has(sessionId)) {
      writeJson(response, 400, { error: 'current_session' });
      return true;
    }
    const revoked = await persistence.revokeUserAccountSession(user.id, sessionId, new Date());
    if (!revoked) {
      writeJson(response, 404, { error: 'session_not_found' });
      return true;
    }
    writeJson(response, 200, { revoked: true });
    return true;
  }

  if (pathname === '/api/account/email/start') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    if (!emailChangeStartRateLimiter.check(clientIpForRateLimit(request))) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }
    if (!authEmailDeliveryEnabled && !devAuthCodesEnabled) {
      writeJson(response, 503, { error: 'email_delivery_not_configured' });
      return true;
    }
    const body = await readJsonBody(request);
    const email = normalizeEmail(typeof body.email === 'string' ? body.email : null);
    if (!email) {
      writeJson(response, 400, { error: 'invalid_email' });
      return true;
    }
    if (email === user.email.toLowerCase()) {
      writeJson(response, 400, { error: 'email_unchanged' });
      return true;
    }
    if (await persistence.findUserByEmail(email)) {
      writeJson(response, 409, { error: 'email_taken' });
      return true;
    }

    const changeId = randomUUID();
    const code = randomEmailLoginCode();
    const expiresAt = new Date(Date.now() + emailLoginCodeTtlMs);
    await persistence.createEmailChangeChallenge({
      id: changeId,
      userId: user.id,
      email,
      codeHash: hashSecret(code),
      expiresAt,
    });
    if (authEmailDeliveryEnabled) {
      const delivery = await sendEmailChangeCode(email, code);
      if (!delivery.ok) {
        await persistence.deleteEmailChangeChallenge(changeId);
        writeJson(response, 502, { error: 'email_delivery_failed' });
        return true;
      }
    }
    writeJson(response, 202, {
      changeId,
      email,
      expiresAt: expiresAt.toISOString(),
      delivery: authEmailDeliveryEnabled ? 'email' : 'dev-response',
      ...(devAuthCodesEnabled ? { devCode: code } : {}),
    });
    return true;
  }

  if (pathname === '/api/account/email/confirm') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    if (!emailChangeConfirmRateLimiter.check(clientIpForRateLimit(request))) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }
    const body = await readJsonBody(request);
    const changeId = typeof body.changeId === 'string' ? body.changeId.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!changeId || !code) {
      writeJson(response, 400, { error: 'invalid_email_change_code' });
      return true;
    }
    const now = new Date();
    const challenge = await persistence.consumeEmailChangeChallenge(
      changeId,
      user.id,
      hashSecret(code),
      now,
    );
    if (!challenge) {
      writeJson(response, 400, { error: 'invalid_email_change_code' });
      return true;
    }
    const updated = await persistence.updateUserEmail(user.id, challenge.email, now);
    if (!updated.ok) {
      writeJson(response, updated.error === 'email_taken' ? 409 : 404, {
        error: updated.error,
      });
      return true;
    }
    writeJson(response, 200, { user: publicUser(updated.user) });
    return true;
  }

  if (pathname === '/api/account/display-preferences') {
    if (!requireMethod(request, response, 'PATCH')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const body = await readJsonBody(request);
    const keys = Object.keys(body);
    if (
      keys.length !== 1 ||
      keys[0] !== 'pieceAnimation' ||
      !persistence.isPieceAnimationPreference(body.pieceAnimation)
    ) {
      writeJson(response, 400, { error: 'invalid_display_preferences' });
      return true;
    }
    const updated = await persistence.updateUserPieceAnimationPreference(
      user.id,
      body.pieceAnimation,
      new Date(),
    );
    if (!updated) {
      writeJson(response, 404, { error: 'user_not_found' });
      return true;
    }
    writeJson(response, 200, { user: publicUser(updated) });
    return true;
  }

  if (pathname === '/api/account/preferences') {
    if (!requireMethod(request, response, 'PATCH')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const body = await readJsonBody(request);
    const keys = Object.keys(body);

    // Profiles are public identities on Mistboard. Preserve historical values
    // in storage, but do not let the general account-preferences endpoint hide
    // or unlist a profile.
    if ('profileVisibility' in body) {
      writeJson(response, 400, { error: 'profile_visibility_not_configurable' });
      return true;
    }

    if (keys.length !== 1) {
      writeJson(response, 400, { error: 'invalid_account_preferences' });
      return true;
    }

    const key = keys[0];

    // DM policy rides the same preferences PATCH as locale; branch on which
    // key the client sent so the two settings stay independently updatable.
    if (key === 'dmPolicy') {
      if (!persistence.isDmPolicy(body.dmPolicy)) {
        writeJson(response, 400, { error: 'invalid_dm_policy' });
        return true;
      }
      const updated = await persistence.updateUserDmPolicy(user.id, body.dmPolicy, new Date());
      if (!updated) {
        writeJson(response, 404, { error: 'user_not_found' });
        return true;
      }
      writeJson(response, 200, { user: publicUser(updated) });
      return true;
    }

    if (
      key === 'clockTenths' ||
      booleanAccountPreferenceKeys.has(key as persistence.AccountPreferenceKey)
    ) {
      const valid =
        key === 'clockTenths'
          ? persistence.isClockTenthsPreference(body[key])
          : typeof body[key] === 'boolean';
      if (!valid) {
        writeJson(response, 400, { error: 'invalid_account_preferences' });
        return true;
      }
      const updated = await persistence.updateUserAccountPreference(
        user.id,
        key as persistence.AccountPreferenceKey,
        body[key] as string | boolean,
        new Date(),
      );
      if (!updated) {
        writeJson(response, 404, { error: 'user_not_found' });
        return true;
      }
      writeJson(response, 200, { user: publicUser(updated) });
      return true;
    }

    if (key !== 'locale') {
      writeJson(response, 400, { error: 'invalid_account_preferences' });
      return true;
    }
    const locale = body.locale;
    if (locale !== null && !persistence.isAccountLocale(locale)) {
      writeJson(response, 400, { error: 'invalid_locale' });
      return true;
    }
    const updated = await persistence.updateUserLocale(user.id, locale, new Date());
    if (!updated) {
      writeJson(response, 404, { error: 'user_not_found' });
      return true;
    }
    writeJson(response, 200, { user: publicUser(updated) });
    return true;
  }

  if (pathname === '/api/account/public-profile') {
    if (!requireMethod(request, response, 'PATCH')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const details = parsePublicProfileDetails(await readJsonBody(request), user);
    if (!details) {
      writeJson(response, 400, { error: 'invalid_public_profile' });
      return true;
    }
    const updated = await persistence.updateUserPublicProfileDetails(user.id, details, new Date());
    if (!updated) {
      writeJson(response, 404, { error: 'user_not_found' });
      return true;
    }
    writeJson(response, 200, { user: publicUser(updated) });
    return true;
  }

  if (pathname !== '/api/account/profile') return false;
  if (!requireMethod(request, response, 'PATCH')) return true;
  if (!requirePersistence(response)) return true;
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  const body = await readJsonBody(request);
  const handle = normalizeProfileHandle(typeof body.handle === 'string' ? body.handle : null);
  if (!handle) {
    writeJson(response, 400, { error: 'invalid_handle' });
    return true;
  }
  // Single-username model: the public display name always mirrors the handle, so
  // there is no separate display-name input to validate.
  const result = await persistence.updateUserProfile(
    user.id,
    { handle, displayName: handle },
    new Date(),
  );
  if (!result.ok) {
    writeJson(response, result.error === 'handle_taken' ? 409 : 429, {
      error: result.error,
      ...(result.availableAt ? { availableAt: result.availableAt.toISOString() } : {}),
    });
    return true;
  }
  writeJson(response, 200, { user: publicUser(result.user) });
  return true;
}

function expiredSessionCookies(): string | string[] {
  const canonical = expiredAccountSessionCookie();
  const legacy = legacyHostOnlyAccountSessionEviction();
  return legacy ? [canonical, legacy] : canonical;
}

function parsePublicProfileDetails(
  body: Record<string, unknown>,
  current: { flair: FlairKey | null },
): { bio: string; location: string; profileLinks: string[]; flair: FlairKey | null } | null {
  if (typeof body.bio !== 'string' || typeof body.location !== 'string') return null;
  if (!Array.isArray(body.profileLinks) || body.profileLinks.length > 5) return null;

  // Flair is optional on this endpoint: a client that predates it (or a form
  // that only edits the bio) omits the key entirely and must keep whatever
  // flair the account already had. Only an explicit null or '' clears it, and
  // an unrecognized key is a 400 rather than a silent clear.
  let flair = current.flair;
  if ('flair' in body) {
    const parsed = parseFlair(body.flair);
    if (parsed === undefined) return null;
    flair = parsed;
  }

  const bio = body.bio.trim();
  const location = body.location.trim();
  if (bio.length > 500 || location.length > 80) return null;

  const profileLinks: string[] = [];
  for (const candidate of body.profileLinks) {
    if (typeof candidate !== 'string') return null;
    const raw = candidate.trim();
    if (!raw || raw.length > 300) return null;
    try {
      const url = new URL(raw);
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
        return null;
      }
      const normalized = url.toString();
      if (!profileLinks.includes(normalized)) profileLinks.push(normalized);
    } catch {
      return null;
    }
  }
  return { bio, location, profileLinks, flair };
}
