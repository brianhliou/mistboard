import { sendTransactionalEmail, transactionalEmailConfigured } from './send-email.js';

export type EngineAlertEmailPayload = {
  severity: 'critical' | 'warning';
  [field: string]: string | number | undefined;
};

export type SendEngineAlertEmailResult =
  | { status: 'disabled' }
  | { status: 'throttled'; suppressed: number }
  | { status: 'sent' }
  | { status: 'failed'; error?: string; statusCode?: number };

type SendOptions = {
  fetchImpl?: typeof fetch;
  nowMs?: number;
  serviceName?: string;
  /**
   * False for a retry of one deduplicated delivery (the daily wait digest): a
   * throttled try is the same email again, not another alert, so it must not
   * count toward the next email's `suppressed_since_last_email`.
   */
  countSuppressed?: boolean;
};

const alertEmailFrom =
  process.env.MISTBOARD_ALERT_EMAIL_FROM ??
  process.env.MISTBOARD_FEEDBACK_FROM ??
  process.env.MISTBOARD_AUTH_EMAIL_FROM ??
  process.env.RESEND_FROM_EMAIL;
const alertEmailTo = parseRecipients(
  process.env.MISTBOARD_ALERT_EMAIL_TO ?? process.env.MISTBOARD_FEEDBACK_TO,
);
const alertEmailMinIntervalMs = parsePositiveInt(
  process.env.MISTBOARD_ALERT_EMAIL_MIN_INTERVAL_MS,
  10 * 60 * 1000,
);
type ThrottleBucket = { lastEmailAtMs: number; suppressed: number };
const throttleBuckets = new Map<string, ThrottleBucket>();

// The key includes a room id (below), so without a bound these accumulate one entry
// per room that ever paged, for the life of the process. A bucket is dropped once
// its window has closed AND it has no suppressed count still owed to an email.
const MAX_THROTTLE_BUCKETS = 500;

function pruneThrottleBuckets(nowMs: number): void {
  for (const [key, bucket] of throttleBuckets) {
    const expired = nowMs - bucket.lastEmailAtMs >= alertEmailMinIntervalMs;
    if (expired && bucket.suppressed === 0) throttleBuckets.delete(key);
  }
  // Backstop: a pathological spread of one-off bursts can still hold entries open.
  // Evict oldest-first; a lost suppression count is cheaper than an unbounded map.
  while (throttleBuckets.size > MAX_THROTTLE_BUCKETS) {
    const oldest = [...throttleBuckets.entries()].reduce((a, b) =>
      a[1].lastEmailAtMs <= b[1].lastEmailAtMs ? a : b,
    );
    throttleBuckets.delete(oldest[0]);
  }
}

/** The alert's own kind, however the caller spelled it. */
export function alertKindOf(alert: EngineAlertEmailPayload): string {
  if (typeof alert.alert_kind === 'string') return alert.alert_kind;
  if (typeof alert.kind === 'string') return alert.kind;
  return 'engine';
}

// Throttle independently per (kind, severity, subject) so an infra alert (memory /
// loop-lag) can't be masked by an unrelated engine alert sharing the same severity.
//
// SUBJECT is in the key because the throttle is meant to stop ONE wedged room from
// paging you every retry, not to collapse separate incidents. On 2026-09-02 six
// different jieqi PvE games were resigned by the engine inside four minutes and the
// operator got ONE email describing one of them, because a flat (kind, severity)
// bucket cannot tell six failures apart from one failure repeated.
export function alertThrottleKey(alert: EngineAlertEmailPayload): string {
  const subject = typeof alert.room_id === 'string' ? alert.room_id : (alert.pool ?? '');
  return `${alertKindOf(alert)}:${alert.severity}:${subject}`;
}

export const engineAlertEmailEnabled =
  transactionalEmailConfigured && !!alertEmailFrom && alertEmailTo.length > 0;

export async function sendEngineAlertNotification(
  alert: EngineAlertEmailPayload,
  options: SendOptions = {},
): Promise<SendEngineAlertEmailResult> {
  if (!engineAlertEmailEnabled) return { status: 'disabled' };

  const nowMs = options.nowMs ?? Date.now();
  const throttleKey = alertThrottleKey(alert);
  const bucket = throttleBuckets.get(throttleKey);
  if (bucket && nowMs - bucket.lastEmailAtMs < alertEmailMinIntervalMs) {
    if (options.countSuppressed !== false) bucket.suppressed += 1;
    return { status: 'throttled', suppressed: bucket.suppressed };
  }
  // Carry the burst forward: an email that says nothing about the ones it stands in
  // for reads as a single isolated failure.
  const suppressed = bucket?.suppressed ?? 0;
  throttleBuckets.set(throttleKey, { lastEmailAtMs: nowMs, suppressed: 0 });
  pruneThrottleBuckets(nowMs);
  const outgoing: EngineAlertEmailPayload =
    suppressed > 0 ? { ...alert, suppressed_since_last_email: suppressed } : alert;

  const at = new Date(nowMs);
  const serviceName = options.serviceName ?? currentServiceName();
  const result = await sendTransactionalEmail(
    {
      from: alertEmailFrom as string,
      to: alertEmailTo,
      subject: engineAlertEmailSubject(outgoing, serviceName),
      text: engineAlertEmailText(outgoing, at, serviceName),
    },
    { fetchImpl: options.fetchImpl },
  );
  if (result.ok) return { status: 'sent' };
  return {
    status: 'failed',
    ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}

export function engineAlertEmailSubject(
  alert: EngineAlertEmailPayload,
  serviceName = currentServiceName(),
): string {
  return `[Mistboard] ${alert.severity.toUpperCase()} ${alertKindOf(alert)} alert (${serviceName})`;
}

export function engineAlertEmailText(
  alert: EngineAlertEmailPayload,
  at = new Date(),
  serviceName = currentServiceName(),
): string {
  const fields = Object.entries(alert).filter(
    ([key, value]) => key !== 'severity' && value !== undefined,
  );
  const fieldLines =
    fields.length > 0
      ? fields.map(([key, value]) => `- ${key}: ${String(value)}`)
      : ['- (no fields)'];

  return [
    'Mistboard emitted an engine alert.',
    '',
    `Severity: ${alert.severity}`,
    `Service: ${serviceName}`,
    `Time: ${at.toISOString()}`,
    '',
    'Fields:',
    ...fieldLines,
    '',
    'Suggested checks:',
    // Name the kind the SERVER actually logs. "engine_alert" matches nothing in the
    // logs, so the one instruction the email gives you is a dead end.
    `- Search production logs for kind="${alertKindOf(alert)}"${
      typeof alert.room_id === 'string' ? ` room_id="${alert.room_id}"` : ''
    }.`,
    '- Run the production engine playout smoke from apps/server/README.md.',
  ].join('\n');
}

function currentServiceName(): string {
  return (
    process.env.RAILWAY_SERVICE_NAME ?? process.env.MISTBOARD_SERVICE_NAME ?? 'unknown-service'
  );
}

function parseRecipients(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((recipient) => recipient.trim())
    .filter((recipient) => recipient.length > 0);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
