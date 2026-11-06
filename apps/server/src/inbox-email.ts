/** Unread DM notices (#913). Eligibility and delivery watermarks live in
 * persistence-inbox-email.ts; no query or renderer in this path reads DM text.
 * Called by the correspondence deadline tick, with no separate timer. */
import { dmEmailUnsubscribe, dmEmailUnsubscribeSecret } from './inbox-email-unsubscribe.js';
import { logger } from './obs.js';
import * as persistence from './persistence-inbox-email.js';
import { emailLocale, inboxNoticeEmail } from './player-email.js';
import { sendTransactionalEmail, transactionalEmailConfigured } from './send-email.js';

const fromAddress = process.env.MISTBOARD_AUTH_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;

// Off unless MISTBOARD_DM_EMAIL_ENABLED=1: the unsubscribe key reuses a secret
// prod already has, so without this switch the deploy that ships the code
// would also start mailing players. Turning it on is a non-secret env change.
export function inboxEmailEnabled(
  env: Record<string, string | undefined> = process.env,
  transactionalConfigured: boolean = transactionalEmailConfigured,
): boolean {
  const from = env.MISTBOARD_AUTH_EMAIL_FROM ?? env.RESEND_FROM_EMAIL;
  return (
    env.MISTBOARD_DM_EMAIL_ENABLED === '1' &&
    transactionalConfigured &&
    !!from &&
    !!dmEmailUnsubscribeSecret(env)
  );
}

const enabled = inboxEmailEnabled();

export type InboxEmailDeps = {
  enabled: boolean;
  fromAddress: string | undefined;
  listCandidates: typeof persistence.listInboxEmailCandidates;
  unsubscribe: typeof dmEmailUnsubscribe;
  send: typeof sendTransactionalEmail;
  markSent: typeof persistence.markInboxEmailSent;
};

// A slow provider can outlast the minute tick. Keep one pass in flight so the
// same unmarked candidate cannot be sent twice by overlapping ticks. Like the
// deadline sweeper this assumes a single web instance.
let sweeping = false;

export async function sweepInboxEmails(
  now: Date,
  deps: Partial<InboxEmailDeps> = {},
): Promise<void> {
  const from = deps.fromAddress ?? fromAddress;
  if (!(deps.enabled ?? enabled) || !from || sweeping) return;
  const listCandidates = deps.listCandidates ?? persistence.listInboxEmailCandidates;
  const unsubscribe = deps.unsubscribe ?? dmEmailUnsubscribe;
  const send = deps.send ?? sendTransactionalEmail;
  const markSent = deps.markSent ?? persistence.markInboxEmailSent;

  sweeping = true;
  try {
    let candidates: persistence.InboxEmailCandidate[];
    try {
      candidates = await listCandidates({ now });
    } catch (err) {
      logger.error(
        { kind: 'inbox_email_list_failure', error: (err as Error).message, at: now.getTime() },
        'inbox email list failure',
      );
      return;
    }
    for (const candidate of candidates) {
      try {
        const optOut = unsubscribe(candidate.userId);
        // Project identity explicitly. The renderer never receives a message
        // body, preview, message identity, or the persistence row itself.
        const email = inboxNoticeEmail(
          {
            senderHandle: candidate.senderHandle,
            senderName: candidate.senderName,
            unsubscribeUrl: optOut.url,
          },
          emailLocale(candidate.locale),
        );
        const result = await send({
          from,
          to: [candidate.email],
          subject: email.subject,
          text: email.text,
          html: email.html,
          headers: optOut.headers,
        });
        if (result.ok) {
          // Provider acceptance is the only event that advances the cap and
          // message watermark. A rejection stays eligible for the next tick.
          await markSent(candidate.userId, candidate.messageId, now);
        } else {
          logger.error(
            {
              kind: 'inbox_email_send_failure',
              user_id: candidate.userId,
              status_code: result.statusCode,
            },
            'inbox email provider rejected send',
          );
        }
      } catch (err) {
        logger.error(
          {
            kind: 'inbox_email_user_failure',
            user_id: candidate.userId,
            error: (err as Error).message,
            at: now.getTime(),
          },
          'inbox email user failure',
        );
      }
    }
  } finally {
    sweeping = false;
  }
}
