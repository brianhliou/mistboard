import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { handleBaseForEmail, maxHandleLength, randomFallbackHandle } from './account-identity.js';
import * as persistence from './persistence.js';
import { touchPresence } from './presence.js';
import { sendTransactionalEmail, transactionalEmailConfigured } from './send-email.js';
import { isProductionLikeRuntime } from './server-policy.js';

const accountSessionCookieName = 'mistboard_session';
export const accountSessionTtlMs = 30 * 24 * 60 * 60 * 1000;
export const emailLoginCodeTtlMs = 10 * 60 * 1000;
export const devAuthCodesEnabled =
  !isProductionLikeRuntime() || process.env.MISTBOARD_DEV_AUTH_CODES === 'true';
const authEmailFrom = process.env.MISTBOARD_AUTH_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;
export const authEmailDeliveryEnabled = transactionalEmailConfigured && !!authEmailFrom;

export async function currentAccountUser(
  request: IncomingMessage,
): Promise<persistence.UserAccount | null> {
  if (!persistence.isInitialized()) return null;
  const now = new Date();
  // A request can carry more than one `mistboard_session` cookie: a legacy
  // host-only cookie (from before MISTBOARD_COOKIE_DOMAIN) coexists with the
  // newer Domain-scoped one, and the browser sends both. First-match parsing
  // could pick the dead one and report the user as signed out. Resolve every
  // candidate and take the first that maps to a live session.
  for (const session of accountSessionsFromRequest(request)) {
    const user = await persistence.getUserByAccountSession(
      session.sessionId,
      hashSecret(session.token),
      now,
    );
    if (user) {
      // Presence feed: every authed HTTP request and both WS upgrade paths
      // resolve through here, so this one touch powers /api/players/online.
      touchPresence(user, now.getTime());
      return user;
    }
  }
  return null;
}

export async function ensureUserForEmail(
  email: string,
  now: Date,
): Promise<{ user: persistence.UserAccount; isNew: boolean } | { closed: true }> {
  const existing = await persistence.findUserByEmail(email);
  if (existing)
    return { user: await persistence.markUserEmailVerified(existing.id, now), isNew: false };
  if (await persistence.closedAccountExistsForEmailHash(hashSecret(email))) return { closed: true };

  const baseHandle = handleBaseForEmail(email);
  // Candidate handle per attempt: the email-derived base first, then numeric
  // suffixes on that base, then fully-random `player-xxxxx` fallbacks. The
  // random tail (≈60M space) means handle congestion alone can never exhaust
  // the loop and hard-fail signup.
  const candidateHandle = (attempt: number): string => {
    if (attempt === 0) return baseHandle;
    if (attempt < 8) return handleCollisionAttempt(baseHandle);
    return randomFallbackHandle();
  };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const handle = candidateHandle(attempt);
    try {
      const user = await persistence.createUser({
        id: `user_${randomUUID()}`,
        email,
        emailVerifiedAt: now,
        handle,
        // Single-username model: display name always mirrors the handle.
        displayName: handle,
        now,
      });
      return { user, isNew: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await persistence.findUserByEmail(email);
      if (raced)
        return { user: await persistence.markUserEmailVerified(raced.id, now), isNew: false };
      if (await persistence.closedAccountExistsForEmailHash(hashSecret(email))) {
        return { closed: true };
      }
    }
  }
  throw new Error('failed to allocate user handle');
}

export function handleCollisionAttempt(baseHandle: string): string {
  const suffix = String(randomInt(10_000, 99_999));
  // Reserve room for the "-" separator and strip any trailing hyphen the slice
  // exposes, so we never produce "foo--12345" or a hyphen butting the suffix.
  const stem = baseHandle.slice(0, maxHandleLength - suffix.length - 1).replace(/-+$/g, '');
  return `${stem}-${suffix}`;
}

export function publicUser(user: persistence.UserAccount): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    emailVerified: !!user.emailVerifiedAt,
    handle: user.handle,
    handleChangedAt: user.handleChangedAt?.toISOString() ?? null,
    displayName: user.displayName,
    displayNameChangedAt: user.displayNameChangedAt?.toISOString() ?? null,
    bio: user.bio,
    location: user.location,
    profileLinks: user.profileLinks,
    displayPreferences: user.displayPreferences,
    accountPreferences: user.accountPreferences,
    profileVisibility: user.profileVisibility,
    accountRole: user.accountRole,
    // Play lock (126). Exposed so the client can explain a refusal it would
    // otherwise render as a generic error; the server never trusts it back.
    playDisabled: user.playDisabledAt !== null,
    // Stats exclusion: the owner's and test accounts. The client uses it only
    // to tag its own browser as internal in PostHog, so the owner's visits stay
    // out of the dashboards the way their games stay out of /stats.
    statsExcluded: (user.statsExcludedAt ?? null) !== null,
    flair: user.flair,
    locale: user.locale,
    dmPolicy: user.dmPolicy,
    // Patron program: entitlement is server-derived (patron_since is only set by
    // the Stripe webhook). isPatron drives the cosmetic badge; the client never
    // asserts it. stripe_customer_id is intentionally NOT exposed.
    isPatron: user.patronSince !== null,
    patronSince: user.patronSince?.toISOString() ?? null,
  };
}

export function randomEmailLoginCode(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, '0');
}

export async function sendEmailLoginCode(
  email: string,
  code: string,
): Promise<{ ok: true } | { ok: false }> {
  return sendAccountEmailCode(email, code, 'login');
}

export async function sendEmailChangeCode(
  email: string,
  code: string,
): Promise<{ ok: true } | { ok: false }> {
  return sendAccountEmailCode(email, code, 'email-change');
}

export async function sendAccountClosureCode(
  email: string,
  code: string,
): Promise<{ ok: true } | { ok: false }> {
  return sendAccountEmailCode(email, code, 'account-closure');
}

async function sendAccountEmailCode(
  email: string,
  code: string,
  purpose: 'account-closure' | 'email-change' | 'login',
): Promise<{ ok: true } | { ok: false }> {
  if (!authEmailDeliveryEnabled || !authEmailFrom) return { ok: false };
  const isEmailChange = purpose === 'email-change';
  const isAccountClosure = purpose === 'account-closure';
  const subject = isAccountClosure
    ? 'Confirm closing your Mistboard account'
    : isEmailChange
      ? 'Confirm your new Mistboard email'
      : 'Your Mistboard login code';
  const intro = isAccountClosure
    ? 'Your Mistboard account-closure code is'
    : isEmailChange
      ? 'Your Mistboard email-change code is'
      : 'Your Mistboard login code is';
  const text = [
    `${intro} ${code}.`,
    '',
    'This code expires in 10 minutes.',
    'If you did not request this code, you can ignore this email.',
  ].join('\n');
  const html = [
    `<p>${intro}:</p>`,
    `<p style="font-size:24px;font-weight:700;letter-spacing:0.12em">${escapeHtml(code)}</p>`,
    '<p>This code expires in 10 minutes.</p>',
    '<p>If you did not request this code, you can ignore this email.</p>',
  ].join('');

  const result = await sendTransactionalEmail({
    from: authEmailFrom,
    to: [email],
    subject,
    text,
    html,
  });
  if (result.ok) return { ok: true };
  console.error(
    JSON.stringify({
      level: 'error',
      kind: 'email_delivery_failure',
      provider: 'resend',
      ...(result.statusCode !== undefined ? { status: result.statusCode } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      at: Date.now(),
    }),
  );
  return { ok: false };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// Every `mistboard_session` candidate in the request, in header order. Plural
// because a host-only and a Domain-scoped cookie of the same name can coexist
// (see currentAccountUser); callers must consider all of them, not just the
// first, or a stale duplicate shadows the live session.
export function accountSessionsFromRequest(
  request: IncomingMessage,
): Array<{ sessionId: string; token: string }> {
  const sessions: Array<{ sessionId: string; token: string }> = [];
  for (const value of cookieValues(request, accountSessionCookieName)) {
    const [sessionId, token] = value.split('.', 2);
    if (sessionId && token) sessions.push({ sessionId, token });
  }
  return sessions;
}

function cookieValues(request: IncomingMessage, name: string): string[] {
  const header = request.headers.cookie;
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey !== name) continue;
    try {
      values.push(decodeURIComponent(rawValue.join('=')));
    } catch {
      // Skip a malformed encoding; other candidates may still be valid.
    }
  }
  return values;
}

export function accountSessionCookie(sessionId: string, token: string, expiresAt: Date): string {
  const maxAgeSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  const value = encodeURIComponent(`${sessionId}.${token}`);
  return cookieWithAttributes(`${accountSessionCookieName}=${value}`, [
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${expiresAt.toUTCString()}`,
  ]);
}

export function expiredAccountSessionCookie(): string {
  return cookieWithAttributes(`${accountSessionCookieName}=`, [
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]);
}

// When a Domain is configured, the canonical cookie is Domain-scoped, but a
// legacy host-only `mistboard_session` (issued before MISTBOARD_COOKIE_DOMAIN
// existed) can still sit alongside it and shadow it on parse. This expires that
// host-only duplicate — same attributes minus Domain, so it targets the
// host-only entry specifically. Returns null when no Domain is set, since the
// canonical cookie is already host-only and there is no duplicate to evict.
// Emit it next to the canonical set-cookie on login and the expiry on logout so
// the pair collapses to one over a user's next auth action.
export function legacyHostOnlyAccountSessionEviction(): string | null {
  if (!accountSessionCookieDomain()) return null;
  const attrs = [
    `${accountSessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (isProductionLikeRuntime()) attrs.push('Secure');
  return attrs.join('; ');
}

// When set (prod), scopes the session cookie to the registrable domain (e.g.
// `mistboard.com`) instead of host-only, so it is also sent to same-site
// subdomains. This is what lets the live-game WebSocket run on a separate,
// non-proxied host (e.g. `play.mistboard.com`, DNS-only/direct-to-origin for
// low latency) while still resolving the logged-in account from the cookie on
// the cross-origin upgrade — cross-origin WS handshakes carry no cookies unless
// the cookie's Domain covers the socket host. Unset in dev/localhost (a Domain
// would not match `localhost` and the cookie would be silently dropped).
function accountSessionCookieDomain(): string | null {
  const domain = process.env.MISTBOARD_COOKIE_DOMAIN?.trim();
  return domain ? domain : null;
}

function cookieWithAttributes(prefix: string, extra: string[]): string {
  const attrs = [prefix, 'Path=/', 'HttpOnly', 'SameSite=Lax', ...extra];
  const domain = accountSessionCookieDomain();
  if (domain) attrs.push(`Domain=${domain}`);
  if (isProductionLikeRuntime()) attrs.push('Secure');
  return attrs.join('; ');
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
