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
import { sendTransactionalEmail, transactionalEmailConfigured } from './send-email.js';

const fromAddress = process.env.MISTBOARD_AUTH_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;
const publicHost = process.env.MISTBOARD_HOST ?? 'https://mistboard.com';

export const correspondenceStartEmailEnabled = transactionalEmailConfigured && !!fromAddress;

export type CorrespondenceStartNotice = {
  roomId: string;
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
  loadRecipient: (userId: string) => Promise<{ email: string } | null>;
  send: (to: string, notice: CorrespondenceStartNotice) => Promise<boolean>;
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
  return send(recipient.email, notice);
}

async function sendEmail(to: string, notice: CorrespondenceStartNotice): Promise<boolean> {
  if (!fromAddress) return false;
  const url = `${publicHost}/room/${encodeURIComponent(notice.roomId)}`;
  const opponent = notice.accepterName ?? 'Someone';
  const pace = notice.daysPerMove === 1 ? '1 day per move' : `${notice.daysPerMove} days per move`;
  const subject = notice.creatorOnMove
    ? 'Your game has started, and it is your move'
    : 'Your game has started';
  const body = notice.creatorOnMove
    ? `${opponent} accepted your correspondence seek, and you have the first move.\n\n` +
      `Play it here: ${url}\n\n` +
      `The pace is ${pace}. If your clock runs out before you play, the game is cancelled.`
    : `${opponent} accepted your correspondence seek and has the first move.\n\n` +
      `Your game: ${url}\n\n` +
      `The pace is ${pace}. If the first move is not played in time, the game is cancelled.`;
  const result = await sendTransactionalEmail({ from: fromAddress, to: [to], subject, text: body });
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
