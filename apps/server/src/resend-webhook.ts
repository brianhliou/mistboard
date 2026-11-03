import type { IncomingHttpHeaders } from 'node:http';
import { Webhook } from 'standardwebhooks';

export const EMAIL_DELIVERY_TYPES = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
] as const;
export type EmailDeliveryType = (typeof EMAIL_DELIVERY_TYPES)[number];
export type EmailDeliveryStatus = EmailDeliveryType extends `email.${infer Status}`
  ? Status
  : never;
export type EmailBounce = {
  type: string;
  subType?: string;
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
  if (!normalized) throw new Error('invalid_email_address');
  return normalized;
}

// Only parser-owned field paths and delivery identifiers may reach the warning.
// This error is created after authentication; signature errors remain separate.
export class ResendWebhookPayloadError extends Error {
  constructor(
    readonly field: string,
    readonly eventType: EmailDeliveryType | null = null,
    readonly providerEmailId: string | null = null,
  ) {
    super('invalid_payload');
  }
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
  new Webhook(secret).verify(
    raw,
    {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    },
    { jsonParse: false },
  );
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    throw new ResendWebhookPayloadError('payload');
  }
  return parseDeliveryEvent(payload, id);
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ResendWebhookPayloadError(field);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ResendWebhookPayloadError(field);
  return value;
}

// Only retain delivery metadata from the official event schemas; extra provider
// fields (subject, tags, from, etc.) are intentionally discarded.
// https://resend.com/docs/webhooks/event-types (delivery event references)
function parseDeliveryEvent(value: unknown, eventId: string): EmailDeliveryEvent | null {
  const payload = object(value, 'payload');
  const type = string(payload.type, 'type');
  if (!EMAIL_DELIVERY_TYPES.includes(type as EmailDeliveryType)) return null;
  let providerEmailId: string | null = null;
  try {
    const data = object(payload.data, 'data');
    providerEmailId = string(data.email_id, 'data.email_id');
    return parseKnownDeliveryEvent(
      payload,
      data,
      eventId,
      providerEmailId,
      type as EmailDeliveryType,
    );
  } catch (error) {
    if (error instanceof ResendWebhookPayloadError) {
      throw new ResendWebhookPayloadError(error.field, type as EmailDeliveryType, providerEmailId);
    }
    throw error;
  }
}

function parseKnownDeliveryEvent(
  payload: Record<string, unknown>,
  data: Record<string, unknown>,
  eventId: string,
  providerEmailId: string,
  type: EmailDeliveryType,
): EmailDeliveryEvent {
  const occurredAt = new Date(string(payload.created_at, 'created_at'));
  if (!Number.isFinite(occurredAt.getTime())) throw new ResendWebhookPayloadError('created_at');
  if (!Array.isArray(data.to)) throw new ResendWebhookPayloadError('data.to');
  const recipients = [
    ...new Set(
      data.to
        .map((email, index) => {
          if (typeof email !== 'string') throw new ResendWebhookPayloadError(`data.to[${index}]`);
          return email.trim() ? normalizeDeliveryEmail(email) : '';
        })
        .filter(Boolean),
    ),
  ].sort();
  if (!recipients.length) throw new ResendWebhookPayloadError('data.to');
  let bounce: EmailBounce | null = null;
  let failureReason: string | null = null;
  if (type === 'email.bounced') {
    const details = object(data.bounce, 'data.bounce');
    bounce = {
      type: string(details.type, 'data.bounce.type'),
      message: string(details.message, 'data.bounce.message'),
    };
    if (details.subType !== undefined)
      bounce.subType = string(details.subType, 'data.bounce.subType');
    if (details.diagnosticCode !== undefined) {
      if (!Array.isArray(details.diagnosticCode))
        throw new ResendWebhookPayloadError('data.bounce.diagnosticCode');
      bounce.diagnosticCode = details.diagnosticCode.map((code, index) =>
        string(code, `data.bounce.diagnosticCode[${index}]`),
      );
    }
  }
  if (type === 'email.failed' && data.failed !== undefined) {
    const details = object(data.failed, 'data.failed');
    if (details.reason !== undefined) failureReason = string(details.reason, 'data.failed.reason');
  }
  return {
    eventId,
    providerEmailId,
    type,
    recipients,
    occurredAt,
    bounce,
    failureReason,
  };
}
