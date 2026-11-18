import { logger } from './obs.js';
import { getPool } from './persistence-db.js';
import {
  type SendTransactionalEmailResult,
  sendTransactionalEmail,
  type TransactionalEmail,
} from './send-email.js';

export type CorrespondenceEmailNotification = {
  kind: string;
  userId: string;
  roomIds: string[];
  // A directed challenge precedes the game: no room or seat exists yet.
  seekId?: string;
};

/** Provider acceptance, tagged and durably correlated without blocking on an audit failure. */
export async function sendCorrespondenceNotificationEmail(
  message: TransactionalEmail,
  notification: CorrespondenceEmailNotification,
): Promise<SendTransactionalEmailResult> {
  const result = await sendTransactionalEmail({
    ...message,
    tags: [...(message.tags ?? []), { name: 'kind', value: notification.kind }],
  });
  if (!result.ok) return result;
  const sentAt = new Date();
  try {
    // Seat tokens outlive a finished game's deadline row. Use the recipient's
    // latest token, including a revoked one, so postgame mail still has a seat.
    // A digest's rows are inserted atomically and share the same acceptance ID.
    await getPool().query(
      `INSERT INTO correspondence_notifications
         (room_id, seat, user_id, kind, channel, sent_at, provider_email_id, seek_id)
       SELECT r.room_id,
         (SELECT s.seat FROM room_seat_tokens s
          WHERE s.room_id = r.room_id AND s.user_id = $2
          ORDER BY s.issued_at DESC LIMIT 1),
         $2, $3, 'email', $4, $5, $6
       FROM unnest($1::text[]) AS r(room_id)`,
      [
        notification.roomIds.length ? [...new Set(notification.roomIds)] : [null],
        notification.userId,
        notification.kind,
        sentAt,
        result.providerEmailId ?? null,
        notification.seekId ?? null,
      ],
    );
  } catch {
    // Never log the message/recipient or raw driver error (which can include
    // query values). Acceptance remains successful so sweeps do not resend.
    logger.error(
      { kind: 'correspondence_notification_log_failure', notification_kind: notification.kind },
      'correspondence notification log failure',
    );
  }
  return result;
}
