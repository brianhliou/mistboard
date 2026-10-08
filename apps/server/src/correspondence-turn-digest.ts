/**
 * Daily correspondence "your move" digest (#370). Once a day, at most, an
 * account with games stalled on its move gets one email listing them.
 *
 * This is NOT the per-ply turn nudge, which correspondence-deadline-warning.ts
 * records as never done, and it stays that way by construction: the send is
 * keyed to the account, not the game, and throttled by a per-user timestamp
 * (users.correspondence_digest_sent_at, migration 145) to one send per UTC
 * digest day. Two games or ten, moves made or not, an account can receive at
 * most one of these between successive DIGEST_HOUR_UTC marks.
 *
 * Who gets one: an account with at least one game waiting on its move for
 * MIN_WAIT_MS, that has not been seen on the site for that long either (a
 * player who was just here has seen the board), and whose waiting games are
 * not all already covered by a deadline warning. The sweeper tick calls this
 * every minute; the day key is what makes it daily.
 */

import { logger } from './obs.js';
import * as persistence from './persistence.js';
import type { CorrespondenceDigestCandidate } from './persistence-correspondence-digest.js';
import { correspondenceDigestEmail, emailLocale, type PlayerEmail } from './player-email.js';
import { sendTransactionalEmail, transactionalEmailConfigured } from './send-email.js';

const fromAddress = process.env.MISTBOARD_AUTH_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;

export const correspondenceTurnDigestEnabled = transactionalEmailConfigured && !!fromAddress;

const HOUR_MS = 60 * 60 * 1000;
// 14:00 UTC: morning in the Americas, afternoon in Europe, evening in East
// Asia. One fixed mark rather than a rolling gap so the send time does not
// drift earlier by the sweep interval every day.
export const DIGEST_HOUR_UTC = 14;
// A move that became yours an hour ago is not stalled; twelve hours is.
export const MIN_WAIT_MS = 12 * HOUR_MS;

// The most recent DIGEST_HOUR_UTC mark at or before `now`. An account whose
// last digest predates it is due again.
export function digestWindowStart(now: Date): Date {
  const mark = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC),
  );
  if (mark.getTime() > now.getTime()) mark.setUTCDate(mark.getUTCDate() - 1);
  return mark;
}

export type CorrespondenceDigestDeps = {
  enabled: boolean;
  listCandidates: typeof persistence.listCorrespondenceDigestCandidates;
  send: (candidate: CorrespondenceDigestCandidate) => Promise<boolean>;
  markSent: (userId: string, at: Date) => Promise<void>;
};

export async function sweepCorrespondenceTurnDigests(
  now: Date,
  deps: Partial<CorrespondenceDigestDeps> = {},
): Promise<void> {
  if (!(deps.enabled ?? correspondenceTurnDigestEnabled)) return;
  const listCandidates = deps.listCandidates ?? persistence.listCorrespondenceDigestCandidates;
  const send = deps.send ?? sendCorrespondenceDigestEmail;
  const markSent = deps.markSent ?? persistence.markCorrespondenceDigestSent;

  let candidates: CorrespondenceDigestCandidate[];
  try {
    candidates = await listCandidates({
      now,
      sentBefore: digestWindowStart(now),
      idleSince: new Date(now.getTime() - MIN_WAIT_MS),
    });
  } catch (err) {
    logger.error(
      { kind: 'turn_digest_list_failure', error: (err as Error).message, at: now.getTime() },
      'turn digest list failure',
    );
    return;
  }

  for (const candidate of candidates) {
    // Every waiting game already carried a deadline warning: that email said
    // what this one would, so the day's nudge has been sent.
    if (candidate.games.every((game) => game.warned)) continue;
    try {
      // Mark only after a successful send so a provider blip retries next tick.
      if (await send(candidate)) await markSent(candidate.userId, now);
    } catch (err) {
      logger.error(
        {
          kind: 'turn_digest_user_failure',
          user_id: candidate.userId,
          error: (err as Error).message,
          at: now.getTime(),
        },
        'turn digest user failure',
      );
    }
  }
}

export function digestEmail(candidate: CorrespondenceDigestCandidate, now: Date): PlayerEmail {
  return correspondenceDigestEmail(candidate.games, now, emailLocale(candidate.locale));
}

async function sendCorrespondenceDigestEmail(
  candidate: CorrespondenceDigestCandidate,
): Promise<boolean> {
  if (!fromAddress) return false;
  const email = digestEmail(candidate, new Date());
  const result = await sendTransactionalEmail({
    from: fromAddress,
    to: [candidate.email],
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  if (!result.ok) {
    logger.error(
      {
        kind: 'turn_digest_email_failure',
        user_id: candidate.userId,
        status_code: result.statusCode,
        error: result.error,
      },
      'turn digest email failure',
    );
    return false;
  }
  logger.info(
    { kind: 'turn_digest_email_sent', user_id: candidate.userId, games: candidate.games.length },
    'turn digest email sent',
  );
  return true;
}
