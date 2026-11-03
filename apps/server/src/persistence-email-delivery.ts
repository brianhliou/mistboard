import { getPool, withTransaction } from './persistence-db.js';
import {
  type EmailBounce,
  type EmailDeliveryEvent,
  type EmailDeliveryStatus,
  normalizeDeliveryEmail,
} from './resend-webhook.js';

// At the same provider timestamp, terminal events outrank transport progress.
// Event id breaks ties deterministically regardless of webhook arrival order.
const STATUS_RANK: Record<EmailDeliveryStatus, number> = {
  sent: 0,
  delivery_delayed: 1,
  delivered: 2,
  failed: 3,
  bounced: 4,
  complained: 5,
};

export type EmailDeliveryAddress = {
  email: string;
  status: EmailDeliveryStatus;
  eventCount: number;
  counts: Partial<Record<EmailDeliveryStatus, number>>;
  firstEventAt: Date;
  lastEventAt: Date;
  lastDeliveredAt: Date | null;
  lastBouncedAt: Date | null;
  lastComplainedAt: Date | null;
  bounce: EmailBounce | null;
  failureReason: string | null;
};

export async function getEmailDeliveryAddress(email: string): Promise<EmailDeliveryAddress | null> {
  const { rows } = await getPool().query(
    `SELECT email, status, event_count AS "eventCount", counts,
       first_event_at AS "firstEventAt", last_event_at AS "lastEventAt",
       last_delivered_at AS "lastDeliveredAt", last_bounced_at AS "lastBouncedAt",
       last_complained_at AS "lastComplainedAt", bounce, failure_reason AS "failureReason"
     FROM email_delivery_addresses WHERE email = $1`,
    [normalizeDeliveryEmail(email)],
  );
  return rows[0] ?? null;
}

export async function recordEmailDeliveryEvent(event: EmailDeliveryEvent): Promise<boolean> {
  const recipients = [...new Set(event.recipients.map(normalizeDeliveryEmail))].sort();
  const status = event.type.slice('email.'.length) as EmailDeliveryStatus;
  const rank = STATUS_RANK[status];
  if (rank === undefined || !recipients.length || !event.eventId || !event.providerEmailId) {
    throw new Error('invalid_delivery_event');
  }
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `INSERT INTO email_delivery_events
         (event_id, provider_email_id, event_type, recipients, occurred_at, bounce, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.eventId,
        event.providerEmailId,
        event.type,
        recipients,
        event.occurredAt,
        event.bounce,
        event.failureReason,
      ],
    );
    if (!rowCount) return false;
    // Sorted locks prevent deadlocks on multi-recipient events. Claim + every
    // projection share a transaction, so a failure remains safe to retry.
    for (const email of recipients) {
      await client.query(
        `INSERT INTO email_delivery_addresses AS a
           (email, status, status_rank, counts, first_event_at, last_event_at, last_event_id,
            last_delivered_at, last_bounced_at, last_complained_at, last_bounce_event_id,
            bounce, failure_reason)
         VALUES ($1, $2, $3, jsonb_build_object($2::text, 1), $4, $4, $5,
           CASE WHEN $2 = 'delivered' THEN $4::timestamptz END,
           CASE WHEN $2 = 'bounced' THEN $4::timestamptz END,
           CASE WHEN $2 = 'complained' THEN $4::timestamptz END,
           CASE WHEN $2 = 'bounced' THEN $5::text END, $6, $7)
         ON CONFLICT (email) DO UPDATE SET
           event_count = a.event_count + 1,
           counts = jsonb_set(a.counts, ARRAY[$2::text],
             to_jsonb(COALESCE((a.counts ->> $2::text)::integer, 0) + 1)),
           first_event_at = LEAST(a.first_event_at, EXCLUDED.first_event_at),
           last_delivered_at = GREATEST(a.last_delivered_at, EXCLUDED.last_delivered_at),
           last_complained_at = GREATEST(a.last_complained_at, EXCLUDED.last_complained_at),
           bounce = CASE WHEN EXCLUDED.last_bounced_at IS NOT NULL AND
             (a.last_bounced_at IS NULL OR
               (EXCLUDED.last_bounced_at, EXCLUDED.last_bounce_event_id) >
               (a.last_bounced_at, a.last_bounce_event_id))
             THEN EXCLUDED.bounce ELSE a.bounce END,
           last_bounce_event_id = CASE WHEN EXCLUDED.last_bounced_at IS NOT NULL AND
             (a.last_bounced_at IS NULL OR
               (EXCLUDED.last_bounced_at, EXCLUDED.last_bounce_event_id) >
               (a.last_bounced_at, a.last_bounce_event_id))
             THEN EXCLUDED.last_bounce_event_id ELSE a.last_bounce_event_id END,
           last_bounced_at = GREATEST(a.last_bounced_at, EXCLUDED.last_bounced_at),
           status = CASE WHEN (EXCLUDED.last_event_at, EXCLUDED.status_rank, EXCLUDED.last_event_id)
             > (a.last_event_at, a.status_rank, a.last_event_id) THEN EXCLUDED.status ELSE a.status END,
           status_rank = CASE WHEN (EXCLUDED.last_event_at, EXCLUDED.status_rank, EXCLUDED.last_event_id)
             > (a.last_event_at, a.status_rank, a.last_event_id) THEN EXCLUDED.status_rank ELSE a.status_rank END,
           failure_reason = CASE WHEN (EXCLUDED.last_event_at, EXCLUDED.status_rank, EXCLUDED.last_event_id)
             > (a.last_event_at, a.status_rank, a.last_event_id) THEN EXCLUDED.failure_reason ELSE a.failure_reason END,
           last_event_id = CASE WHEN (EXCLUDED.last_event_at, EXCLUDED.status_rank, EXCLUDED.last_event_id)
             > (a.last_event_at, a.status_rank, a.last_event_id) THEN EXCLUDED.last_event_id ELSE a.last_event_id END,
           last_event_at = GREATEST(a.last_event_at, EXCLUDED.last_event_at)`,
        [email, status, rank, event.occurredAt, event.eventId, event.bounce, event.failureReason],
      );
    }
    return true;
  });
}

export type LoginEmailRequest = {
  requestId: string;
  email: string;
  requestedAt: Date;
  providerEmailId: string | null;
  completedAt: Date | null;
};

export async function recordLoginEmailRequest(
  input: Pick<LoginEmailRequest, 'requestId' | 'email' | 'requestedAt'>,
): Promise<void> {
  await getPool().query(
    `INSERT INTO login_email_requests (request_id, email, requested_at)
     VALUES ($1, $2, $3) ON CONFLICT (request_id) DO NOTHING`,
    [input.requestId, normalizeDeliveryEmail(input.email), input.requestedAt],
  );
}

export async function correlateLoginEmailRequest(
  requestId: string,
  providerEmailId: string,
): Promise<boolean> {
  if (!providerEmailId.trim()) throw new Error('invalid_provider_email_id');
  const { rowCount } = await getPool().query(
    `UPDATE login_email_requests SET provider_email_id = $2
     WHERE request_id = $1 AND (provider_email_id IS NULL OR provider_email_id = $2)`,
    [requestId, providerEmailId],
  );
  return (rowCount ?? 0) > 0;
}

export async function completeLoginEmailRequest(requestId: string, at: Date): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE login_email_requests SET completed_at = COALESCE(completed_at, $2)
     WHERE request_id = $1 AND requested_at <= $2`,
    [requestId, at],
  );
  return (rowCount ?? 0) > 0;
}

export async function getLoginEmailRequest(requestId: string): Promise<LoginEmailRequest | null> {
  const { rows } = await getPool().query(
    `SELECT request_id AS "requestId", email, requested_at AS "requestedAt",
       provider_email_id AS "providerEmailId", completed_at AS "completedAt"
     FROM login_email_requests WHERE request_id = $1`,
    [requestId],
  );
  return rows[0] ?? null;
}
