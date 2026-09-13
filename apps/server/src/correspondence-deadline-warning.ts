/**
 * Correspondence deadline-warning email (C2). Each tick, the room_deadlines
 * sweeper hands the approaching, un-warned games to sweepDeadlineWarnings; this
 * module decides whether the per-game lead has been reached, sends the warning
 * through the shared Resend helper, and marks the row so it sends once per
 * deadline. The candidate query honors the account's deadline-email preference;
 * the turn nudge is deferred, and per-ply email is never done.
 */

import { DAY_MS } from '@mistboard/game';
import { logger } from './obs.js';
import * as persistence from './persistence.js';
import type { DeadlineWarningCandidate } from './persistence-room-deadlines.js';
import { sendTransactionalEmail, transactionalEmailConfigured } from './send-email.js';

const fromAddress = process.env.MISTBOARD_AUTH_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;
const publicHost = process.env.MISTBOARD_HOST ?? 'https://mistboard.com';

export const correspondenceDeadlineWarningEnabled = transactionalEmailConfigured && !!fromAddress;

// Warn this far ahead of forfeit, but never more than a third of the per-move
// allowance — so a 1-day game warns ~8h out, not the instant the move starts
// (which would be per-move spam). 3- and 7-day games warn a full day out.
export const WARNING_MAX_LEAD_MS = DAY_MS;
export function deadlineWarningLeadMs(allowanceMs: number): number {
  return Math.min(WARNING_MAX_LEAD_MS, Math.round(allowanceMs / 3));
}

export type DeadlineWarningDeps = {
  // Defaults to the env-derived flag; injectable so the orchestration logic is
  // testable without configuring a provider.
  enabled: boolean;
  listCandidates: (now: Date, maxLeadMs: number) => Promise<DeadlineWarningCandidate[]>;
  send: (candidate: DeadlineWarningCandidate, remainingMs: number) => Promise<boolean>;
  markWarned: (roomId: string, at: Date) => Promise<void>;
};

export async function sweepDeadlineWarnings(
  now: Date,
  deps: Partial<DeadlineWarningDeps> = {},
): Promise<void> {
  if (!(deps.enabled ?? correspondenceDeadlineWarningEnabled)) return;
  const listCandidates = deps.listCandidates ?? persistence.listDeadlineWarningCandidates;
  const send = deps.send ?? sendDeadlineWarningEmail;
  const markWarned = deps.markWarned ?? persistence.markRoomDeadlineWarned;

  let candidates: DeadlineWarningCandidate[];
  try {
    candidates = await listCandidates(now, WARNING_MAX_LEAD_MS);
  } catch (err) {
    logger.error(
      { kind: 'deadline_warning_list_failure', error: (err as Error).message, at: now.getTime() },
      'deadline warning list failure',
    );
    return;
  }

  for (const candidate of candidates) {
    const remainingMs = candidate.dueAt.getTime() - now.getTime();
    // Already-due rows are the timeout pass's job; rows not yet inside this
    // game's lead window wait for a later sweep.
    if (remainingMs <= 0 || remainingMs > deadlineWarningLeadMs(candidate.allowanceMs)) continue;
    try {
      // Mark only after a successful send, so a transient email failure retries
      // next sweep instead of silently dropping the load-bearing warning.
      if (await send(candidate, remainingMs)) await markWarned(candidate.roomId, now);
    } catch (err) {
      logger.error(
        {
          kind: 'deadline_warning_room_failure',
          room_id: candidate.roomId,
          error: (err as Error).message,
          at: now.getTime(),
        },
        'deadline warning room failure',
      );
    }
  }
}

async function sendDeadlineWarningEmail(
  candidate: DeadlineWarningCandidate,
  remainingMs: number,
): Promise<boolean> {
  if (!fromAddress) return false;
  const url = `${publicHost}/room/${encodeURIComponent(candidate.roomId)}`;
  const opponent = candidate.opponentName ?? 'your opponent';
  const left = formatRemaining(remainingMs);
  const subject = 'Your move is running out of time';
  const text =
    `It's your move against ${opponent}, and your clock runs out in about ${left}.\n\n` +
    `Play your move: ${url}\n\n` +
    // Before the opening moves the sweeper aborts the room (lifecycle
    // tenantAbortPhaseFor), so "forfeited" would be untrue for exactly the
    // recipient most likely to read this: someone who never played a move.
    'If the clock runs out, the game is forfeited, or cancelled if the opening moves were never played.';
  const result = await sendTransactionalEmail({
    from: fromAddress,
    to: [candidate.recipientEmail],
    subject,
    text,
  });
  if (!result.ok) {
    logger.error(
      {
        kind: 'deadline_warning_email_failure',
        room_id: candidate.roomId,
        status_code: result.statusCode,
        error: result.error,
      },
      'deadline warning email failure',
    );
    return false;
  }
  logger.info(
    { kind: 'deadline_warning_email_sent', room_id: candidate.roomId },
    'deadline warning email sent',
  );
  return true;
}

function formatRemaining(ms: number): string {
  const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
  if (hours < 36) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}
