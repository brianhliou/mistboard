import type { IncomingHttpHeaders } from 'node:http';
import { Webhook } from 'standardwebhooks';

export const EMAIL_DELIVERY_TYPES = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
] as const;
export type EmailDeliveryType = (typeof EMAIL_DELIVERY_TYPES)[number];
export type EmailDeliveryStatus = EmailDeliveryType extends `email.${infer Status}`
  ? Status
  : never;
export type EmailBounce = {
  type: string;
  subType: string;
  message: string;
  diagnosticCode?: string[];
};
export type EmailDeliveryEvent = {
  eventId: string;
  providerEmailId: string;
  type: EmailDeliveryType;
  recipients: string[];
  occurredAt: Date;
  bounce: EmailBounce | null;
  failureReason: string | null;
};

export function normalizeDeliveryEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || !/^[^\s@<>]+@[^\s@<>]+$/.test(normalized)) {
    throw new Error('invalid_email_address');
  }
  return normalized;
}

// Resend uses Svix's header names for the Standard Webhooks signing protocol.
// Verify the original bytes before parsing JSON; never log bodies or secrets.
// https://resend.com/docs/webhooks/verify-webhooks-requests
export function verifyResendWebhook(
  raw: Buffer,
  headers: IncomingHttpHeaders,
  secret: string,
): EmailDeliveryEvent | null {
  const id = singleHeader(headers['svix-id']);
  const timestamp = singleHeader(headers['svix-timestamp']);
  const signature = singleHeader(headers['svix-signature']);
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) {
    throw new Error('invalid_signature');
  }
  const payload = new Webhook(secret).verify(raw, {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': signature,
  });
  return parseDeliveryEvent(payload, id);
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid_payload');
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('invalid_payload');
  return value;
}

// Only retain delivery metadata from the official event schemas; extra provider
// fields (subject, tags, from, etc.) are intentionally discarded.
// https://resend.com/docs/webhooks/event-types (six delivery event references)
function parseDeliveryEvent(value: unknown, eventId: string): EmailDeliveryEvent | null {
  const payload = object(value);
  const type = string(payload.type);
  if (!EMAIL_DELIVERY_TYPES.includes(type as EmailDeliveryType)) return null;
  const data = object(payload.data);
  const occurredAt = new Date(string(payload.created_at));
  if (!Number.isFinite(occurredAt.getTime())) throw new Error('invalid_payload');
  if (!Array.isArray(data.to) || data.to.length === 0) throw new Error('invalid_payload');
  const recipients = [
    ...new Set(data.to.map((email) => normalizeDeliveryEmail(string(email)))),
  ].sort();
  let bounce: EmailBounce | null = null;
  let failureReason: string | null = null;
  if (type === 'email.bounced') {
    const details = object(data.bounce);
    bounce = {
      type: string(details.type),
      subType: string(details.subType),
      message: string(details.message),
    };
    if (details.diagnosticCode !== undefined) {
      if (!Array.isArray(details.diagnosticCode)) throw new Error('invalid_payload');
      bounce.diagnosticCode = details.diagnosticCode.map(string);
    }
  }
  if (type === 'email.failed') failureReason = string(object(data.failed).reason);
  return {
    eventId,
    providerEmailId: string(data.email_id),
    type: type as EmailDeliveryType,
    recipients,
    occurredAt,
    bounce,
    failureReason,
  };
}
