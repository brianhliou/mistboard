/**
 * "Someone posted a correspondence seek" email to the operator.
 *
 * The public seek board only works if somebody takes a seek while its poster
 * still cares. At Mistboard's liquidity that somebody is the operator, who
 * cannot watch the board all day: the homepage jieqi correspondence test
 * (2026-10-03) depends on a guest's first seek being accepted within hours,
 * not discovered a week later. So every public board post mails one operator
 * address with a direct link to the accept page.
 *
 * Off unless MISTBOARD_SEEK_ALERT_EMAIL is set (non-secret: an address). The
 * From address and provider key are the same ones the other correspondence
 * mails use. Fire-and-forget: a mail failure never touches the post.
 */

import { logger } from './obs.js';
import {
  type SendTransactionalEmailResult,
  sendTransactionalEmail,
  type TransactionalEmail,
} from './send-email.js';

const publicHost = process.env.MISTBOARD_HOST ?? 'https://mistboard.com';

export type SeekAlertNotice = {
  seekId: string;
  gameSpecId: string;
  daysPerMove: number;
  creatorName: string | null;
  // Which surface posted it ('board' for the ordinary seek form, 'quick-pair'
  // for the homepage button), so the operator can tell the test's seeks apart.
  source: 'board' | 'quick-pair';
};

export type SeekAlertDeps = {
  recipient: string | null;
  fromAddress: string | null;
  host: string;
  send: (message: TransactionalEmail) => Promise<SendTransactionalEmailResult>;
};

/** The operator address, or null when the alert is off. Blank counts as unset. */
export function seekAlertRecipient(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.MISTBOARD_SEEK_ALERT_EMAIL?.trim();
  return value ? value : null;
}

/** The accept page for a seek. A public board seek has no target, so the
 *  /challenge landing admits any signed-in account but its creator. */
export function seekAcceptUrl(seekId: string, host: string = publicHost): string {
  return `${host.replace(/\/+$/, '')}/challenge/${encodeURIComponent(seekId)}`;
}

export function seekAlertMessage(
  notice: SeekAlertNotice,
  options: { from: string; to: string; host?: string },
): TransactionalEmail {
  const url = seekAcceptUrl(notice.seekId, options.host ?? publicHost);
  const who = notice.creatorName ?? 'Someone';
  const pace = notice.daysPerMove === 1 ? '1 day per move' : `${notice.daysPerMove} days per move`;
  return {
    from: options.from,
    to: [options.to],
    subject: `New ${notice.gameSpecId} correspondence seek from ${who}`,
    text:
      `${who} posted a public ${notice.gameSpecId} correspondence seek (${pace}, via ${notice.source}).\n\n` +
      `Accept it: ${url}\n`,
  };
}

/**
 * Fire-and-forget wrapper for the post route: never rejects, never delays the
 * response. The posted seek is the durable outcome.
 */
export function notifySeekPosted(notice: SeekAlertNotice, deps: Partial<SeekAlertDeps> = {}): void {
  void sendSeekAlertEmail(notice, deps).catch((err) => {
    logger.error(
      { kind: 'seek_alert_email_failure', seek_id: notice.seekId, error: (err as Error).message },
      'seek alert email failure',
    );
  });
}

export async function sendSeekAlertEmail(
  notice: SeekAlertNotice,
  deps: Partial<SeekAlertDeps> = {},
): Promise<boolean> {
  const recipient = deps.recipient !== undefined ? deps.recipient : seekAlertRecipient();
  if (!recipient) return false;
  const fromAddress =
    deps.fromAddress !== undefined
      ? deps.fromAddress
      : (process.env.MISTBOARD_AUTH_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL ?? null);
  if (!fromAddress) {
    logger.warn(
      { kind: 'seek_alert_email_skipped', seek_id: notice.seekId, reason: 'no_from_address' },
      'seek alert email skipped',
    );
    return false;
  }
  const send = deps.send ?? ((message) => sendTransactionalEmail(message));
  const result = await send(
    seekAlertMessage(notice, { from: fromAddress, to: recipient, host: deps.host ?? publicHost }),
  );
  if (!result.ok) {
    logger.error(
      {
        kind: 'seek_alert_email_rejected',
        seek_id: notice.seekId,
        status_code: result.statusCode,
        error: result.error,
      },
      'seek alert email rejected',
    );
    return false;
  }
  logger.info({ kind: 'seek_alert_email_sent', seek_id: notice.seekId }, 'seek alert email sent');
  return true;
}
