import { createHmac, timingSafeEqual } from 'node:crypto';

export const DM_EMAIL_UNSUBSCRIBE_PATH = '/api/inbox/email/unsubscribe';
const PURPOSE = 'inbox-email-unsubscribe.v1';
function validUserId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !/[^A-Za-z0-9_-]/.test(value);
}

// Reuse only the configured server secret, never live-engine's dev fallback.
// The purpose prefix prevents signatures from authorizing another operation.
export function dmEmailUnsubscribeSecret(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const secret = env.MISTBOARD_ENGINE_SECRET;
  return secret?.trim() ? secret : undefined;
}

function mac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${PURPOSE}.${payload}`).digest();
}

export function signDmEmailUnsubscribeToken(userId: string, secret: string | undefined): string {
  if (!secret?.trim()) throw new Error('inbox_email_unsubscribe_unconfigured');
  if (!validUserId(userId)) throw new Error('invalid_user_id');
  const payload = Buffer.from(userId).toString('base64url');
  // Deliberately long-lived: unsubscribing from an old email must still work.
  // The claim contains only the account id, never email addresses or DM text.
  return `${payload}.${mac(payload, secret).toString('base64url')}`;
}

export function verifyDmEmailUnsubscribeToken(
  token: string | null,
  secret: string | undefined,
): string | null {
  if (!secret?.trim() || !token || token.length > 320) return null;
  const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!parts || parts[0] !== token) return null;
  const payload = parts[1]!;
  const signature = parts[2]!;
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.toString('base64url') !== signature) return null;
  if (!timingSafeEqual(supplied, mac(payload, secret))) return null;
  const userId = Buffer.from(payload, 'base64url').toString('utf8');
  if (!validUserId(userId) || Buffer.from(userId).toString('base64url') !== payload) return null;
  return userId;
}

/** Only unsubscribe metadata: this API never accepts or renders message text. */
export function dmEmailUnsubscribe(
  userId: string,
  env: Record<string, string | undefined> = process.env,
): { url: string; headers: Record<string, string> } {
  const token = signDmEmailUnsubscribeToken(userId, dmEmailUnsubscribeSecret(env));
  let host: URL;
  try {
    host = new URL(env.MISTBOARD_HOST ?? 'https://mistboard.com');
  } catch {
    throw new Error('invalid_email_public_host');
  }
  if (host.protocol !== 'https:' || host.username || host.password) {
    throw new Error('invalid_email_public_host');
  }
  const url = new URL(DM_EMAIL_UNSUBSCRIBE_PATH, host);
  url.searchParams.set('t', token);
  return {
    url: url.href,
    headers: {
      'List-Unsubscribe': `<${url.href}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
