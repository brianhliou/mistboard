import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineAlertEmailPayload } from './engine-alert-email.js';
import { missingEngineBinaries, verifyEngineBinariesAtBoot } from './engine-boot-check.js';

function harness() {
  const errors: Array<Record<string, unknown>> = [];
  const infos: Array<Record<string, unknown>> = [];
  const alerts: EngineAlertEmailPayload[] = [];
  const deps = {
    logger: {
      info: (obj: object) => {
        infos.push(obj as Record<string, unknown>);
      },
      error: (obj: object) => {
        errors.push(obj as Record<string, unknown>);
      },
    },
    alert: async (payload: EngineAlertEmailPayload) => {
      alerts.push(payload);
      return { status: 'disabled' as const };
    },
  };
  return { deps, errors, infos, alerts };
}

const presentEngine = (variant: string) => ({
  variant,
  binary: `${variant}-engine`,
  enabled: () => true,
  resolvePath: () => `/app/bin/${variant}-engine`,
});

const missingEngine = (variant: string) => ({
  variant,
  binary: `${variant}-engine`,
  enabled: () => true,
  resolvePath: (): string => {
    throw new Error(`${variant}-engine not found`);
  },
});

const disabledEngine = (variant: string) => ({
  variant,
  binary: `${variant}-engine`,
  enabled: () => false,
  resolvePath: (): string => {
    throw new Error('should never be called for a disabled variant');
  },
});

test('all enabled binaries present → no alerts, info summary logged', () => {
  const { deps, errors, infos, alerts } = harness();
  const result = verifyEngineBinariesAtBoot(
    [presentEngine('jungle'), presentEngine('banqi')],
    deps,
  );

  assert.deepEqual(result.present, ['jungle', 'banqi']);
  assert.equal(result.missing.length, 0);
  assert.equal(result.checked, 2);
  assert.equal(alerts.length, 0);
  assert.equal(errors.length, 0);
  assert.equal(infos.length, 1);
  assert.equal(infos[0]!.kind, 'engine_boot_check');
});

test('an enabled-but-missing binary alerts (critical) and logs an error per variant', () => {
  const { deps, errors, alerts } = harness();
  const result = verifyEngineBinariesAtBoot(
    [presentEngine('jungle'), missingEngine('jieqi')],
    deps,
  );

  assert.deepEqual(result.present, ['jungle']);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0]!.variant, 'jieqi');
  assert.equal(result.checked, 2);

  // One per-variant error + the aggregate "N of M missing" error.
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => e.kind === 'engine_binary_missing' && e.variant === 'jieqi'));

  // Exactly one critical alert for the missing engine.
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.severity, 'critical');
  assert.equal(alerts[0]!.alert_kind, 'engine_binary_missing');
  assert.equal(alerts[0]!.variant, 'jieqi');
});

test('a disabled variant is skipped entirely (never probed, never alerts)', () => {
  const { deps, errors, alerts } = harness();
  const result = verifyEngineBinariesAtBoot(
    [disabledEngine('banqi'), presentEngine('jungle')],
    deps,
  );

  assert.equal(result.checked, 1);
  assert.deepEqual(result.present, ['jungle']);
  assert.equal(result.missing.length, 0);
  assert.equal(alerts.length, 0);
  assert.equal(errors.length, 0);
});

test('missingEngineBinaries lists enabled-but-missing engines without alerting', () => {
  assert.deepEqual(
    missingEngineBinaries([
      presentEngine('jungle'),
      missingEngine('jieqi'),
      disabledEngine('banqi'),
    ]),
    [{ variant: 'jieqi', binary: 'jieqi-engine' }],
  );
});

// The build soft-fails when the AB-JChess net cannot be fetched from its authors
// (scripts/fetch-abjchess-net.sh), so the image can ship with the binary and no
// net. The real probe must call that missing, which is what the readout reads.
test('the AB-JChess probe reports a binary without its net as missing', (t) => {
  const keys = ['MISTBOARD_JIEQI_ENABLED', 'MISTBOARD_ABJCHESS_PATH', 'MISTBOARD_ABJCHESS_NET'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  const isAbJchess = (entry: { binary: string }) => entry.binary === 'ab-jchess';
  process.env.MISTBOARD_JIEQI_ENABLED = 'true';
  process.env.MISTBOARD_ABJCHESS_PATH = process.execPath;
  process.env.MISTBOARD_ABJCHESS_NET = '/nonexistent/abjchess.nnue';
  assert.ok(missingEngineBinaries().some(isAbJchess));

  process.env.MISTBOARD_ABJCHESS_NET = process.execPath;
  assert.ok(!missingEngineBinaries().some(isAbJchess));
});
