/**
 * Emails the scheduled operating readout.
 *
 * The readout has always been generated and stored; its only delivery was a
 * comment on a GitHub issue, which is a surface you have to remember to open.
 * This is the interrupt half: the weekly report lands in the inbox, and a daily
 * check that finds something wrong does too.
 *
 * Policy lives here rather than in send-email.ts, per that module's contract:
 * recipients, enablement, and the send rule are the caller's business.
 */
import type { MistboardReadoutV1 } from './mistboard-readout.js';
import { readoutDelta, renderReadoutEmail } from './readout-email-render.js';
import { sendTransactionalEmail, transactionalEmailConfigured } from './send-email.js';

const fromAddress =
  process.env.MISTBOARD_READOUT_FROM ??
  process.env.MISTBOARD_FEEDBACK_FROM ??
  process.env.MISTBOARD_AUTH_EMAIL_FROM ??
  process.env.RESEND_FROM_EMAIL;
// Falls back to the feedback recipient so a deploy that already receives
// operator mail starts receiving this with no new variable.
const readoutTo = process.env.MISTBOARD_READOUT_TO ?? process.env.MISTBOARD_FEEDBACK_TO;

export const readoutEmailEnabled = transactionalEmailConfigured && !!fromAddress && !!readoutTo;

export type ReadoutEmailDecision =
  | {
      send: false;
      reason:
        | 'disabled'
        | 'reused'
        | 'dry-run'
        | 'healthy-daily'
        | 'same-problem'
        | 'delivery-failed';
    }
  | { send: true; reason: 'weekly' | 'daily-alert' };

/**
 * Weekly reports always go out; they are the point of the exercise. A daily
 * only goes out when it found something, and then only when the problem is not
 * the one the last report already reported: a week-long outage should not send
 * seven identical emails, which is the failure mode that made the GitHub
 * comments unreadable in the first place.
 */
export function decideReadoutEmail(input: {
  report: MistboardReadoutV1;
  reused: boolean;
  previousAlertKey: string | null;
  dryRun?: boolean;
  enabled?: boolean;
}): ReadoutEmailDecision {
  if (!(input.enabled ?? readoutEmailEnabled)) return { send: false, reason: 'disabled' };
  if (input.dryRun) return { send: false, reason: 'dry-run' };
  if (input.reused) return { send: false, reason: 'reused' };
  if (input.report.trigger === 'weekly') return { send: true, reason: 'weekly' };
  const verdict = input.report.verdict;
  if (verdict !== 'action' && verdict !== 'blocked' && verdict !== 'unknown') {
    return { send: false, reason: 'healthy-daily' };
  }
  if (input.previousAlertKey === input.report.alertKey) {
    return { send: false, reason: 'same-problem' };
  }
  return { send: true, reason: 'daily-alert' };
}

export function readoutEmailSubject(report: MistboardReadoutV1): string {
  const date = report.generatedAt.slice(0, 10);
  const verdict = report.verdict.toUpperCase();
  if (report.trigger !== 'weekly') return `Mistboard daily check ${date}: ${verdict}`;
  if (!report.product || report.verdict === 'unknown' || report.verdict === 'blocked') {
    return `Mistboard weekly readout ${date}: ${verdict}`;
  }
  return `Mistboard weekly ${date}: games ${readoutDelta(report.product.completedGames, report.product.previousCompletedGames)}; ${report.actions.length ? `${report.actions.length} to review` : 'no action needed'}`;
}

export async function sendReadoutEmail(
  input: {
    report: MistboardReadoutV1;
    reused: boolean;
    previousAlertKey: string | null;
    dryRun?: boolean;
  },
  dependencies: {
    enabled?: boolean;
    send?: typeof sendTransactionalEmail;
  } = {},
): Promise<ReadoutEmailDecision> {
  const decision = decideReadoutEmail({ ...input, enabled: dependencies.enabled });
  if (!decision.send) return decision;
  const rendered = renderReadoutEmail(input.report);
  const result = await (dependencies.send ?? sendTransactionalEmail)({
    from: fromAddress as string,
    to: [readoutTo as string],
    subject: readoutEmailSubject(input.report),
    ...rendered,
  });
  if (!result.ok) return { send: false, reason: 'delivery-failed' };
  return decision;
}
