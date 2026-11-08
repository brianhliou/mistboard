/**
 * Shared Resend transactional-email sender — the single place the platform
 * talks to the email provider. Auth login codes, feedback notifications,
 * engine alerts, and (correspondence C2) turn nudges / deadline warnings all
 * go through sendTransactionalEmail. Policy stays caller-owned: recipients,
 * From-address fallbacks, throttles, templates, enablement flags, and
 * failure logging all live with the caller; this module only does the wire
 * call and never logs (the API key must not leak into any log path).
 */

const resendApiKey = process.env.RESEND_API_KEY;

export const transactionalEmailConfigured = !!resendApiKey;

export type TransactionalEmail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export type SendTransactionalEmailResult =
  | { ok: true; providerEmailId?: string }
  | { ok: false; error?: string; statusCode?: number };

export async function sendTransactionalEmail(
  message: TransactionalEmail,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<SendTransactionalEmailResult> {
  if (!resendApiKey) return { ok: false, error: 'not_configured' };
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
      }),
    });
    if (response.ok) {
      // Acceptance is not delivery: only a signed webhook can establish that.
      // Keep legacy acceptance behavior if the provider omits a usable ID.
      const body: unknown = await response.json().catch(() => null);
      const id = body && typeof body === 'object' && 'id' in body ? body.id : null;
      const providerEmailId = typeof id === 'string' ? id.trim() : '';
      return { ok: true, ...(providerEmailId ? { providerEmailId } : {}) };
    }
    return { ok: false, statusCode: response.status };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
