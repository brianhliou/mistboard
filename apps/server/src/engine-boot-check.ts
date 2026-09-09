// Boot-time engine-binary self-check: the deploy tripwire.
//
// Each variant's PvE / analysis engine is a binary (a Rust "Misty*" engine, Pikafish, or
// Fairy-Stockfish) fetched into the image at build time behind a flag (see railpack.json).
// If a variant is switched ON at runtime but its engine binary was never provisioned, the
// old behavior was to silently fall back to a weaker in-process engine (PvE) or silently
// serve nothing (analysis) — a fail-open that hides a broken deploy. This check runs once
// at startup, verifies every ENABLED variant's binary is actually present, and alerts
// loudly (error log + engine alert email) for any that is intended-but-missing. It is
// read-only: it never changes serving behavior, only observes and reports.

import { banqiEnginePath } from './banqi-engine.js';
import { duckXiangqiFsfPath } from './duck-xiangqi-fsf-engine.js';
import { sendEngineAlertNotification } from './engine-alert-email.js';
import {
  banqiEnabled,
  duckXiangqiEnabled,
  fortressXiangqiEnabled,
  jieqiEnabled,
  jungleEnabled,
  jungleFlipEnabled,
  xiangqiEnabled,
} from './feature-flags.js';
import { pikaJieqiPath } from './jieqi-engine.js';
import { jungleEnginePath } from './jungle-engine.js';
import { jungleFlipEnginePath } from './jungle-flip-engine.js';
import { logger } from './obs.js';
import { fairyStockfishPath } from './uci-engine-harness.js';
import { pikafishXiangqiPath } from './xiangqi-pikafish-engine.js';

type EngineProbe = {
  /** Variant this engine serves (label for logs/alerts). */
  variant: string;
  /** The engine binary's human name (e.g. 'jungle-engine', 'pikafish'). */
  binary: string;
  /** True when the variant is switched on and therefore needs its engine present. */
  enabled: () => boolean;
  /** Resolves the binary's path; THROWS when it is not on the box. */
  resolvePath: () => string;
};

// One probe per variant whose engine is an external binary. Perfect-info variants
// (xiangqi/fortress via FSF/Pikafish) and the hidden-identity ones (jieqi/banqi/
// jungle-flip) and jungle all go here. The fog variants are served by the separate
// engine-worker, not a web-service binary, so they are intentionally absent.
const ENGINE_PROBES: readonly EngineProbe[] = [
  {
    variant: 'xiangqi',
    binary: 'pikafish',
    enabled: xiangqiEnabled,
    resolvePath: pikafishXiangqiPath,
  },
  {
    variant: 'fortress-xiangqi',
    binary: 'fairy-stockfish',
    enabled: fortressXiangqiEnabled,
    resolvePath: fairyStockfishPath,
  },
  {
    // Its OWN binary, not the shared Fairy-Stockfish: stock FSF cannot play this
    // variant at all (MAX_MOVES = 1024 against a 4,901-turn peak), so
    // duckXiangqiFsfPath deliberately has no fallback and this probe reports a
    // missing patched build as missing rather than as a quietly wrong engine.
    variant: 'duck-xiangqi',
    binary: 'fairy-stockfish-duck-xiangqi',
    enabled: duckXiangqiEnabled,
    resolvePath: duckXiangqiFsfPath,
  },
  { variant: 'jieqi', binary: 'pikafish-jieqi', enabled: jieqiEnabled, resolvePath: pikaJieqiPath },
  { variant: 'banqi', binary: 'banqi-engine', enabled: banqiEnabled, resolvePath: banqiEnginePath },
  {
    variant: 'jungle',
    binary: 'jungle-engine',
    enabled: jungleEnabled,
    resolvePath: jungleEnginePath,
  },
  {
    variant: 'jungle-flip',
    binary: 'jungle-flip-engine',
    enabled: jungleFlipEnabled,
    resolvePath: jungleFlipEnginePath,
  },
];

export type EngineBootCheckResult = {
  checked: number;
  present: string[];
  missing: Array<{ variant: string; binary: string; error: string }>;
};

type BootLogger = {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
};

type BootCheckDeps = {
  logger?: BootLogger;
  alert?: typeof sendEngineAlertNotification;
};

/**
 * Verify that every ENABLED variant's engine binary is present, alerting for any that is
 * intended-but-missing. Returns the tally (also useful for tests). Probes and deps are
 * injectable so the check can be unit-tested without touching the filesystem or email.
 */
export function verifyEngineBinariesAtBoot(
  probes: readonly EngineProbe[] = ENGINE_PROBES,
  deps: BootCheckDeps = {},
): EngineBootCheckResult {
  const log = deps.logger ?? logger;
  const alert = deps.alert ?? sendEngineAlertNotification;
  const present: string[] = [];
  const missing: EngineBootCheckResult['missing'] = [];

  for (const probe of probes) {
    if (!probe.enabled()) continue;
    try {
      probe.resolvePath();
      present.push(probe.variant);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      missing.push({ variant: probe.variant, binary: probe.binary, error: message });
      log.error(
        {
          kind: 'engine_binary_missing',
          variant: probe.variant,
          binary: probe.binary,
          error: message,
        },
        `Engine binary missing for enabled variant '${probe.variant}': ${probe.binary}`,
      );
      // Fire-and-forget: sendEngineAlertNotification self-guards on config + throttles,
      // so a missing binary pages once (per throttle window) without blocking boot.
      void alert({
        severity: 'critical',
        alert_kind: 'engine_binary_missing',
        variant: probe.variant,
        binary: probe.binary,
        error: message,
      });
    }
  }

  const checked = present.length + missing.length;
  if (missing.length === 0) {
    log.info(
      { kind: 'engine_boot_check', checked, present: present.length, missing: 0 },
      `Engine boot check: all ${checked} enabled engine binaries present`,
    );
  } else {
    log.error(
      { kind: 'engine_boot_check', checked, present: present.length, missing: missing.length },
      `Engine boot check: ${missing.length} of ${checked} enabled engine binaries MISSING`,
    );
  }
  return { checked, present, missing };
}
