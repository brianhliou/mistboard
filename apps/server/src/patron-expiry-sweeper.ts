// Interval sweep that drops the Patron badge from accounts whose one-time
// payment has run out. Recurring patrons are ended by a Stripe webhook, which
// recomputes the badge cache on the spot; a one-time payment lapses on the
// clock with nothing from Stripe to say so, so something has to look. Hourly
// is plenty: the badge is cosmetic and the period is measured in months.
// Single-instance deployment today; the UPDATE is idempotent, so a second
// instance would only race harmlessly.

import { logger } from './obs.js';
import * as persistence from './persistence.js';

export const PATRON_EXPIRY_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export type PatronExpirySweeperOptions = {
  intervalMs?: number;
  isPersistenceInitialized?: () => boolean;
  expire?: (now: Date) => Promise<number>;
  now?: () => number;
};

export type PatronExpirySweeper = {
  stop(): void;
  // Exposed for tests; the interval calls it.
  tick(): Promise<void>;
};

export function startPatronExpirySweeper(
  options: PatronExpirySweeperOptions = {},
): PatronExpirySweeper {
  const intervalMs = options.intervalMs ?? PATRON_EXPIRY_SWEEP_INTERVAL_MS;
  const isInitialized = options.isPersistenceInitialized ?? persistence.isInitialized;
  const expire = options.expire ?? ((at: Date) => persistence.expireLapsedPatrons(at));
  const now = options.now ?? Date.now;

  async function tick(): Promise<void> {
    if (!isInitialized()) return;
    try {
      const expired = await expire(new Date(now()));
      if (expired > 0) {
        logger.info({ kind: 'patron_expiry_sweep', expired, at: now() }, 'patron badges lapsed');
      }
    } catch (err) {
      logger.error(
        { kind: 'patron_expiry_sweep_failure', error: (err as Error).message, at: now() },
        'patron expiry sweep failure',
      );
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();

  return {
    stop: () => clearInterval(timer),
    tick,
  };
}
