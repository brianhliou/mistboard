/**
 * "Your seek was accepted" email. The one notification a correspondence player
 * cannot get any other way.
 *
 * The seek board is asynchronous by design: you post an offer and leave. When
 * somebody takes it hours or days later, the accepter is looking at the board
 * and the creator is not — and until this module existed, nothing told them.
 * Their first contact with the game was the deadline warning
 * (correspondence-deadline-warning.ts), which fires at min(1 day, allowance/3)
 * before forfeit: 8h on a 1-day game. A player who waited a week for an
 * opponent could learn they had one from an email saying the clock runs out
 * tonight. That happened on 2026-08-31, on the second correspondence game the
 * platform ever had.
 *
 * This is deliberately NOT the per-ply turn nudge, which stays deferred. It
 * fires once, at seat time, for one recipient — so it cannot become per-move
 * mail no matter how the game goes.
 */

import { logger } from './obs.js';
import * as persistence from './persistence.js';
import { correspondenceStartEmail, type EmailLocale, emailLocale } from './player-email.js';
import { sendTransactionalEmail, transactionalEmailConfigured } from './send-email.js';

const fromAddress = process.env.MISTBOARD_AUTH_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;

export const correspondenceStartEmailEnabled = transactionalEmailConfigured && !!fromAddress;

export type CorrespondenceStartNotice = {
  roomId: string;
  // Named in the subject and body: identical subjects threaded different games
  // into one Gmail conversation.
  gameSpecId: string;
  // The account that posted the seek and walked away. The accepter is on the
  // page and gets nothing: mailing them would be noise, and it would double
  // the send volume of the one email nobody can opt back into by visiting.
  creatorUserId: string;
  accepterName: string | null;
  // Whether the creator owes the first move. Drives the call to action: the
  // second player has nothing to do until the opening move lands.
  creatorOnMove: boolean;
  daysPerMove: number;
};

export type CorrespondenceStartEmailDeps = {
  enabled: boolean;
  // Returns a mailbox only when the notice should be sent: the opt-out lives in
  // the query, so this module never re-derives what an unset preference means.
  loadRecipient: (userId: string) => Promise<{ email: string; locale?: string | null } | null>;
  send: (to: string, notice: CorrespondenceStartNotice, locale: EmailLocale) => Promise<boolean>;
};

/**
 * Fire-and-forget wrapper for the accept route: never rejects, never delays the
 * 201. A seated game is the durable outcome; the email is a courtesy on top of
 * it, so a provider outage must not turn a successful accept into an error the
 * accepter sees.
 */
export function notifyCorrespondenceStart(
  notice: CorrespondenceStartNotice,
  deps: Partial<CorrespondenceStartEmailDeps> = {},
): void {
  void sendCorrespondenceStartEmail(notice, deps).catch((err) => {
    logger.error(
      {
        kind: 'correspondence_start_email_failure',
        room_id: notice.roomId,
        error: (err as Error).message,
      },
      'correspondence start email failure',
    );
  });
}

export async function sendCorrespondenceStartEmail(
  notice: CorrespondenceStartNotice,
  deps: Partial<CorrespondenceStartEmailDeps> = {},
): Promise<boolean> {
  if (!(deps.enabled ?? correspondenceStartEmailEnabled)) return false;
  const loadRecipient = deps.loadRecipient ?? persistence.correspondenceStartRecipient;
  const send = deps.send ?? sendEmail;

  const recipient = await loadRecipient(notice.creatorUserId);
  if (!recipient) return false;
  return send(recipient.email, notice, emailLocale(recipient.locale));
}

async function sendEmail(
  to: string,
  notice: CorrespondenceStartNotice,
  locale: EmailLocale,
): Promise<boolean> {
  if (!fromAddress) return false;
  const email = correspondenceStartEmail(
    {
      roomId: notice.roomId,
      gameSpecId: notice.gameSpecId,
      opponentName: notice.accepterName,
      creatorOnMove: notice.creatorOnMove,
      daysPerMove: notice.daysPerMove,
    },
    locale,
  );
  const result = await sendTransactionalEmail({
    from: fromAddress,
    to: [to],
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  if (!result.ok) {
    logger.error(
      {
        kind: 'correspondence_start_email_rejected',
        room_id: notice.roomId,
        status_code: result.statusCode,
        error: result.error,
      },
      'correspondence start email rejected',
    );
    return false;
  }
  logger.info(
    { kind: 'correspondence_start_email_sent', room_id: notice.roomId },
    'correspondence start email sent',
  );
  return true;
}
