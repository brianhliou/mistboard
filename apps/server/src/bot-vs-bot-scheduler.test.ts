import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BOT_VS_BOT_DEFAULT_VARIANTS,
  type BotVsBotSchedulerConfig,
  type BotVsBotSchedulerDeps,
  type BotVsBotVariantPlan,
  botVsBotConfigFromEnv,
  botVsBotEnvKey,
  botVsBotJobConfig,
  botVsBotOpeningPolicy,
  botVsBotResourcePolicy,
  botVsBotTaskConfig,
  clampBotVsBotDailyMax,
  clampBotVsBotTarget,
  clampCalibrationRatio,
  createBotVsBotScheduler,
  type EnqueueBotVsBotGameInput,
} from './bot-vs-bot-scheduler.js';
import { loadEngine } from './engine-registry.js';
import { eveAdapterFor } from './variant-eve-registry.js';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

// dailyMax 24 → one game every hour; forced pair keeps pairing deterministic.
const FORCED: BotVsBotVariantPlan = {
  variant: 'xiangqi',
  targetActive: 3,
  maxPlies: 300,
  calibrationRatio: 0,
  dailyMax: 24,
  ladder: ['fsf-1', 'fsf-2', 'fsf-3'],
  anchorEngineId: 'random-legal-xiangqi',
  requiredCapability: null,
  forcedPairing: { redEngineId: 'fsf-7', blackEngineId: 'fsf-8' },
};

function only(plan: BotVsBotVariantPlan): BotVsBotSchedulerConfig {
  return { plans: [plan], skipped: [] };
}

// A number for every variant, or one per variant by name.
type PerVariant<T> = T | Record<string, T>;

function perVariant<T>(value: PerVariant<T> | undefined, variant: string, fallback: T): T {
  if (value !== null && typeof value === 'object') {
    return (value as Record<string, T>)[variant] ?? fallback;
  }
  return (value as T | undefined) ?? fallback;
}

function harness(
  overrides: Partial<BotVsBotSchedulerDeps> & {
    active?: PerVariant<number>;
    lastAt?: PerVariant<number | null>;
    lastSuccess?: PerVariant<number | null>;
  } = {},
) {
  const enqueued: EnqueueBotVsBotGameInput[] = [];
  const logs: Record<string, unknown>[] = [];
  const active = new Map<string, number>();
  const activeFor = (variant: string) =>
    active.get(variant) ?? perVariant(overrides.active, variant, 0);
  const deps: BotVsBotSchedulerDeps = {
    enabled: overrides.enabled ?? (() => true),
    config: overrides.config ?? (() => only(FORCED)),
    countActiveTasks: overrides.countActiveTasks ?? (async (variant) => activeFor(variant)),
    lastEnqueueAt:
      overrides.lastEnqueueAt ?? (async (variant) => perVariant(overrides.lastAt, variant, null)),
    lastSuccessAt:
      overrides.lastSuccessAt ??
      (async (variant) => perVariant(overrides.lastSuccess, variant, null)),
    enqueueGame:
      overrides.enqueueGame ??
      (async (input) => {
        enqueued.push(input);
        active.set(input.variant, activeFor(input.variant) + 1);
      }),
    random: overrides.random ?? (() => 0.5),
    now: overrides.now ?? (() => NOW),
    log: (line) => logs.push(line),
  };
  return { deps, enqueued, logs };
}

test('enqueues one game per eligible tick', async () => {
  const { deps, enqueued } = harness({ active: 0 });
  await createBotVsBotScheduler(deps).tick();
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]?.variant, 'xiangqi');
  assert.deepEqual(enqueued[0]?.pairing, FORCED.forcedPairing);
  assert.equal(enqueued[0]?.lane, 'content');
  assert.equal(enqueued[0]?.maxPlies, 300);
  assert.equal(enqueued[0]?.anchorEngineId, 'random-legal-xiangqi');
});

test('does nothing when already at or above the concurrency target', async () => {
  const { deps, enqueued } = harness({ active: 3 });
  await createBotVsBotScheduler(deps).tick();
  assert.equal(enqueued.length, 0);
});

test('does nothing when disabled (does not even count)', async () => {
  let counted = false;
  const { deps, enqueued } = harness({
    enabled: () => false,
    countActiveTasks: async () => {
      counted = true;
      return 0;
    },
  });
  await createBotVsBotScheduler(deps).tick();
  assert.equal(enqueued.length, 0);
  assert.equal(counted, false);
});

test('daily cadence: skips when the last SUCCESS is within the interval', async () => {
  // dailyMax 2 → 12h spacing; last successful game 1h ago → too soon.
  const { deps, enqueued } = harness({
    active: 0,
    lastSuccess: NOW - HOUR,
    lastAt: NOW - HOUR,
    config: () => only({ ...FORCED, dailyMax: 2 }),
  });
  await createBotVsBotScheduler(deps).tick();
  assert.equal(enqueued.length, 0);
});

test('daily cadence: enqueues once the interval since the last SUCCESS has elapsed', async () => {
  const { deps, enqueued } = harness({
    active: 0,
    lastSuccess: NOW - 13 * HOUR, // > 12h
    lastAt: NOW - 13 * HOUR, // past the retry cooldown too
    config: () => only({ ...FORCED, dailyMax: 2 }),
  });
  await createBotVsBotScheduler(deps).tick();
  assert.equal(enqueued.length, 1);
});

test('a FAILED game does not blackhole the day: no success, but retries after the cooldown', async () => {
  // The failure case that used to block 12h: an attempt happened but produced no
  // successful game. dailyMax 2 (12h). Attempt 5 min ago → still in the cooldown.
  const soon = harness({
    active: 0,
    lastSuccess: null,
    lastAt: NOW - 5 * MINUTE,
    config: () => only({ ...FORCED, dailyMax: 2 }),
  });
  await createBotVsBotScheduler(soon.deps).tick();
  assert.equal(soon.enqueued.length, 0, 'within retry cooldown → wait');

  // Same failure, attempt 20 min ago → past the 15-min cooldown → retries (NOT 12h).
  const later = harness({
    active: 0,
    lastSuccess: null,
    lastAt: NOW - 20 * MINUTE,
    config: () => only({ ...FORCED, dailyMax: 2 }),
  });
  await createBotVsBotScheduler(later.deps).tick();
  assert.equal(later.enqueued.length, 1, 'past cooldown, no success → retry');
});

test('the very first game enqueues immediately (no success, no attempt)', async () => {
  const { deps, enqueued } = harness({
    active: 0,
    lastSuccess: null,
    lastAt: null,
    config: () => only({ ...FORCED, dailyMax: 1 }),
  });
  await createBotVsBotScheduler(deps).tick();
  assert.equal(enqueued.length, 1);
});

test('without a forced pairing, calibration ratio selects the lane', async () => {
  const ladder = ['a', 'b', 'c', 'd', 'e'];
  const { deps, enqueued } = harness({
    active: 0,
    config: () =>
      only({
        ...FORCED,
        targetActive: 2,
        calibrationRatio: 1,
        dailyMax: 100,
        ladder,
        forcedPairing: null,
      }),
    random: () => 0,
  });
  await createBotVsBotScheduler(deps).tick();
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]?.lane, 'calibration');
  assert.notEqual(enqueued[0]?.pairing.redEngineId, enqueued[0]?.pairing.blackEngineId);
});

// ── Per-variant plans (#488) ────────────────────────────────────────────────

const JIEQI_PLAN: BotVsBotVariantPlan = {
  ...FORCED,
  variant: 'jieqi',
  targetActive: 1,
  dailyMax: 2,
  ladder: ['pikafish-jieqi-level-1', 'pikafish-jieqi-level-2'],
  anchorEngineId: 'random-legal-jieqi',
  forcedPairing: null,
};

test('each variant keeps its own in-flight limit and daily cap', async () => {
  // Xiangqi is full (3 of 3 in flight) and jieqi played 1h ago on a 12h cadence;
  // duck has room and no history. Only duck enqueues.
  const duck: BotVsBotVariantPlan = { ...JIEQI_PLAN, variant: 'duck-xiangqi', dailyMax: 1 };
  const { deps, enqueued } = harness({
    config: () => ({ plans: [FORCED, JIEQI_PLAN, duck], skipped: [] }),
    active: { xiangqi: 3, jieqi: 0, 'duck-xiangqi': 0 },
    lastSuccess: { jieqi: NOW - HOUR },
    lastAt: { jieqi: NOW - HOUR },
  });
  await createBotVsBotScheduler(deps).tick();
  assert.deepEqual(
    enqueued.map((game) => game.variant),
    ['duck-xiangqi'],
  );
});

test('every eligible variant gets one game per tick, each from its own ladder', async () => {
  const { deps, enqueued } = harness({
    config: () => ({ plans: [FORCED, JIEQI_PLAN], skipped: [] }),
  });
  await createBotVsBotScheduler(deps).tick();
  assert.deepEqual(
    enqueued.map((game) => game.variant),
    ['xiangqi', 'jieqi'],
  );
  const jieqi = enqueued[1]!;
  assert.ok(JIEQI_PLAN.ladder.includes(jieqi.pairing.redEngineId));
  assert.ok(JIEQI_PLAN.ladder.includes(jieqi.pairing.blackEngineId));
  assert.equal(jieqi.anchorEngineId, 'random-legal-jieqi');
});

test('one variant failing does not stop the others', async () => {
  const { deps, enqueued } = harness({
    config: () => ({ plans: [FORCED, JIEQI_PLAN], skipped: [] }),
    countActiveTasks: async (variant) => {
      if (variant === 'xiangqi') throw new Error('boom');
      return 0;
    },
  });
  const original = console.error;
  console.error = () => undefined;
  try {
    await createBotVsBotScheduler(deps).tick();
  } finally {
    console.error = original;
  }
  assert.deepEqual(
    enqueued.map((game) => game.variant),
    ['jieqi'],
  );
});

test('a skipped variant is logged once, not every tick', async () => {
  const { deps, logs } = harness({
    config: () => ({ plans: [], skipped: [{ variant: 'banqi', reason: 'no-eve-adapter' }] }),
  });
  const scheduler = createBotVsBotScheduler(deps);
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(
    logs.filter((line) => line.kind === 'bot_vs_bot_variant_skipped'),
    [
      {
        level: 'warn',
        kind: 'bot_vs_bot_variant_skipped',
        variant: 'banqi',
        reason: 'no-eve-adapter',
      },
    ],
  );
});

test('the default plan: five variants, modest caps (fortress and atomic cut, 2026-10-01)', () => {
  const config = botVsBotConfigFromEnv({} as NodeJS.ProcessEnv);
  assert.deepEqual(
    config.plans.map((plan) => [plan.variant, plan.dailyMax, plan.targetActive]),
    [
      ['xiangqi', 2, 2],
      ['jieqi', 2, 1],
      ['duck-xiangqi', 1, 1],
      ['jungle', 1, 1],
      ['banqi', 1, 1],
    ],
  );
  assert.deepEqual(config.skipped, []);
  assert.deepEqual(
    [...BOT_VS_BOT_DEFAULT_VARIANTS],
    config.plans.map((plan) => plan.variant),
  );
  for (const plan of config.plans) {
    const adapter = eveAdapterFor(plan.variant)!;
    // Every rung is the variant's own: the worker can play it.
    assert.ok(plan.ladder.length >= 1, plan.variant);
    for (const engineId of plan.ladder) {
      assert.ok(adapter.tierFor(engineId), `${plan.variant}: ${engineId}`);
      // The worker loads each rung from the engine registry.
      assert.equal(loadEngine(engineId).gameSpecId, plan.variant, engineId);
    }
    assert.equal(plan.anchorEngineId, adapter.randomEngineId ?? null);
    assert.equal(plan.forcedPairing, null);
  }
  // No variant borrows the xiangqi ladder.
  const xiangqi = new Set(config.plans[0]!.ladder);
  for (const plan of config.plans.slice(1)) {
    assert.ok(
      plan.ladder.every((id) => !xiangqi.has(id)),
      `${plan.variant} ladder overlaps xiangqi`,
    );
  }
});

test('fail closed: an admin-only, adapterless or unknown variant is skipped, never defaulted', () => {
  const config = botVsBotConfigFromEnv({
    MISTBOARD_BOT_VS_BOT_VARIANTS:
      'mahjong, crazyhouse-xiangqi, jungle-flip, dark-xiangqi, nope, jieqi, jieqi, fortress-xiangqi',
  } as NodeJS.ProcessEnv);
  // Cut from the defaults, fortress still runs when named: its adapter stays.
  assert.deepEqual(
    config.plans.map((plan) => [plan.variant, plan.dailyMax]),
    [
      ['jieqi', 2],
      ['fortress-xiangqi', 1],
    ],
  );
  assert.deepEqual(config.skipped, [
    // Built, but hidden (publicSurface 'hidden'): never scheduled.
    { variant: 'mahjong', reason: 'not-public' },
    // Public with an EvE adapter, but no scheduled ladder in BOT_LADDERS.
    { variant: 'crazyhouse-xiangqi', reason: 'no-ladder' },
    { variant: 'jungle-flip', reason: 'no-eve-adapter' },
    { variant: 'dark-xiangqi', reason: 'no-eve-adapter' },
    { variant: 'nope', reason: 'unknown-variant' },
  ]);
});

test('banqi plays itself for data, jungle pairs its tiers, and neither can be rated', () => {
  const config = botVsBotConfigFromEnv({} as NodeJS.ProcessEnv);
  const banqi = config.plans.find((plan) => plan.variant === 'banqi')!;
  // One bot: the content lane only, a mirror every game, no anchor.
  assert.deepEqual(banqi.ladder, ['misty-banqi']);
  assert.equal(banqi.calibrationRatio, 0);
  assert.equal(banqi.anchorEngineId, null);
  assert.equal(banqi.requiredCapability, 'banqi_engine');
  const jungle = config.plans.find((plan) => plan.variant === 'jungle')!;
  // Weakest first by node budget; the offered bot (level 2) is the strongest.
  assert.deepEqual(jungle.ladder, [
    'misty-jungle-level-1',
    'misty-jungle-level-3',
    'misty-jungle-level-2',
  ]);
  assert.equal(jungle.anchorEngineId, null);
  assert.equal(jungle.requiredCapability, 'jungle_engine');

  // Whatever lane a tick picks, a job without an anchor carries no rating_policy,
  // which is the only thing the Elo report (and so bot-rating-import) selects on.
  for (const plan of [banqi, jungle]) {
    for (const lane of ['content', 'calibration'] as const) {
      const job = botVsBotJobConfig({
        variant: plan.variant,
        lane,
        pairing: { redEngineId: plan.ladder[0]!, blackEngineId: plan.ladder.at(-1)! },
        anchorEngineId: plan.anchorEngineId,
      });
      assert.equal(job.rating_policy, undefined, `${plan.variant} ${lane}`);
    }
  }
});

test('a scheduled banqi or jungle game requires a worker that has the binary', async () => {
  const banqiPlan: BotVsBotVariantPlan = {
    ...FORCED,
    variant: 'banqi',
    ladder: ['misty-banqi'],
    calibrationRatio: 0,
    anchorEngineId: null,
    requiredCapability: 'banqi_engine',
    forcedPairing: null,
  };
  const { deps, enqueued } = harness({ config: () => only(banqiPlan) });
  await createBotVsBotScheduler(deps).tick();
  const input = enqueued[0]!;
  assert.deepEqual(input.pairing, { redEngineId: 'misty-banqi', blackEngineId: 'misty-banqi' });
  assert.deepEqual(botVsBotResourcePolicy(input), {
    providers: ['local', 'railway'],
    concurrency: 1,
    required_capabilities: ['banqi_engine'],
  });
  // Variants whose engines every worker image carries require nothing extra.
  assert.deepEqual(botVsBotResourcePolicy({ ...input, requiredCapability: null }), {
    providers: ['local', 'railway'],
    concurrency: 1,
  });
});

test('per-variant env sets each cap; the pre-#488 names still drive xiangqi', () => {
  const config = botVsBotConfigFromEnv({
    // Prod's existing settings: xiangqi's, as before.
    MISTBOARD_BOT_VS_BOT_DAILY_MAX: '6',
    MISTBOARD_BOT_VS_BOT_TARGET: '4',
    MISTBOARD_BOT_VS_BOT_JIEQI_DAILY_MAX: '5',
    MISTBOARD_BOT_VS_BOT_JIEQI_TARGET: '3',
    MISTBOARD_BOT_VS_BOT_DUCK_XIANGQI_DAILY_MAX: 'nope',
  } as NodeJS.ProcessEnv);
  const byVariant = new Map(config.plans.map((plan) => [plan.variant, plan]));
  assert.equal(byVariant.get('xiangqi')?.dailyMax, 6);
  assert.equal(byVariant.get('xiangqi')?.targetActive, 4);
  // The legacy names do not spill onto the other variants.
  assert.equal(byVariant.get('jieqi')?.dailyMax, 5);
  assert.equal(byVariant.get('jieqi')?.targetActive, 3);
  assert.equal(byVariant.get('duck-xiangqi')?.dailyMax, 1, 'garbage falls back to the default');
  assert.equal(byVariant.get('jungle')?.dailyMax, 1);

  // The per-variant xiangqi name wins over the legacy one.
  const own = botVsBotConfigFromEnv({
    MISTBOARD_BOT_VS_BOT_DAILY_MAX: '6',
    MISTBOARD_BOT_VS_BOT_XIANGQI_DAILY_MAX: '3',
  } as NodeJS.ProcessEnv);
  assert.equal(own.plans.find((plan) => plan.variant === 'xiangqi')?.dailyMax, 3);
  assert.equal(botVsBotEnvKey('fortress-xiangqi'), 'FORTRESS_XIANGQI');
});

test('a forced pair applies to xiangqi only, and only to engines xiangqi plays', () => {
  const config = botVsBotConfigFromEnv({
    MISTBOARD_BOT_VS_BOT_DAILY_MAX: '3',
    MISTBOARD_BOT_VS_BOT_RED_ENGINE: 'fairy-stockfish-xiangqi-level-3',
    MISTBOARD_BOT_VS_BOT_BLACK_ENGINE: 'fairy-stockfish-xiangqi-level-5',
  } as NodeJS.ProcessEnv);
  const xiangqi = config.plans.find((plan) => plan.variant === 'xiangqi')!;
  assert.equal(xiangqi.dailyMax, 3);
  assert.deepEqual(xiangqi.forcedPairing, {
    redEngineId: 'fairy-stockfish-xiangqi-level-3',
    blackEngineId: 'fairy-stockfish-xiangqi-level-5',
  });
  for (const plan of config.plans.filter((p) => p.variant !== 'xiangqi')) {
    assert.equal(plan.forcedPairing, null, plan.variant);
  }
  const foreign = botVsBotConfigFromEnv({
    MISTBOARD_BOT_VS_BOT_RED_ENGINE: 'pikafish-jieqi-level-3',
    MISTBOARD_BOT_VS_BOT_BLACK_ENGINE: 'fairy-stockfish-xiangqi-level-5',
  } as NodeJS.ProcessEnv);
  assert.equal(foreign.plans.find((plan) => plan.variant === 'xiangqi')?.forcedPairing, null);
});

test('clampBotVsBotTarget bounds and defaults', () => {
  assert.equal(clampBotVsBotTarget(5), 5);
  assert.equal(clampBotVsBotTarget(0), 1);
  assert.equal(clampBotVsBotTarget(999), 20);
  assert.equal(clampBotVsBotTarget('nope'), 2);
  assert.equal(clampBotVsBotTarget(undefined, 1), 1);
});

test('clampBotVsBotDailyMax bounds and defaults', () => {
  assert.equal(clampBotVsBotDailyMax(3), 3);
  assert.equal(clampBotVsBotDailyMax(0), 1);
  assert.equal(clampBotVsBotDailyMax(10_000), 5_000);
  assert.equal(clampBotVsBotDailyMax('nope'), 2);
});

test('clampCalibrationRatio bounds and defaults', () => {
  assert.equal(clampCalibrationRatio(0.4), 0.4);
  assert.equal(clampCalibrationRatio(-1), 0);
  assert.equal(clampCalibrationRatio(2), 1);
  assert.equal(clampCalibrationRatio('nope'), 0.3);
});

test('calibration-lane jobs are rated in their own variant pool; content-lane jobs are not', () => {
  const pairing = {
    redEngineId: 'fairy-stockfish-xiangqi-level-3',
    blackEngineId: 'fairy-stockfish-xiangqi-level-5',
  };

  // The Elo report selects rows on `rating_policy.rated = 'true'`, so this
  // stamp is the whole difference between a calibration game that feeds the
  // ladder and one that is stored and ignored.
  const calibration = botVsBotJobConfig({
    variant: 'xiangqi',
    lane: 'calibration',
    pairing,
    anchorEngineId: 'random-legal-xiangqi',
  }) as {
    variant?: string;
    rating_policy?: { rated?: boolean; anchor_engine_id?: string; pool?: Record<string, unknown> };
  };
  assert.equal(calibration.variant, 'xiangqi');
  assert.equal(calibration.rating_policy?.rated, true);
  assert.equal(calibration.rating_policy?.anchor_engine_id, 'random-legal-xiangqi');
  // Clockless, matching the calibration tournaments, so both pool together.
  assert.deepEqual(calibration.rating_policy?.pool, {
    variant: 'xiangqi',
    time_control_bucket: 'untimed',
  });

  // A jieqi calibration game rates in the jieqi pool against the jieqi anchor.
  const jieqi = botVsBotJobConfig({
    variant: 'jieqi',
    lane: 'calibration',
    pairing: { redEngineId: 'pikafish-jieqi-level-1', blackEngineId: 'pikafish-jieqi-level-2' },
    anchorEngineId: 'random-legal-jieqi',
  }) as { rating_policy?: { anchor_engine_id?: string; pool?: { variant?: string } } };
  assert.equal(jieqi.rating_policy?.anchor_engine_id, 'random-legal-jieqi');
  assert.equal(jieqi.rating_policy?.pool?.variant, 'jieqi');

  // No anchor: unrated, never another variant's anchor.
  const unanchored = botVsBotJobConfig({
    variant: 'jieqi',
    lane: 'calibration',
    pairing,
    anchorEngineId: null,
  }) as { rating_policy?: unknown };
  assert.equal(unanchored.rating_policy, undefined);

  // Content pairings are top-heavy and allow mirrors, which carry no ranking
  // signal: they stay out of the rated set.
  const content = botVsBotJobConfig({
    variant: 'xiangqi',
    lane: 'content',
    pairing,
    anchorEngineId: 'random-legal-xiangqi',
  }) as { rating_policy?: unknown };
  assert.equal(content.rating_policy, undefined);
});

test('scheduled games ask the worker for public visibility and carry a deal seed', () => {
  const input: EnqueueBotVsBotGameInput = {
    variant: 'jieqi',
    lane: 'content',
    pairing: { redEngineId: 'pikafish-jieqi-level-7', blackEngineId: 'ab-jchess-jieqi' },
    maxPlies: 300,
    seed: '1700000000000',
    anchorEngineId: 'random-legal-jieqi',
  };
  assert.deepEqual(botVsBotTaskConfig(input), {
    variant: 'jieqi',
    max_plies: 300,
    white_engine_id: 'pikafish-jieqi-level-7',
    black_engine_id: 'ab-jchess-jieqi',
    source: 'bot-vs-bot-scheduler',
    visibility: 'public',
  });
  // Without the seed every scheduled jieqi game would get the same deal.
  assert.deepEqual(botVsBotOpeningPolicy('1700000000000'), {
    kind: 'standard',
    seed: '1700000000000',
  });
});

test('nothing on the engine-game path can send to PostHog', () => {
  // The site's only server-side PostHog sender is analytics-server.ts (signups,
  // routes/auth.ts). An engine game is queued here, played by worker.ts through
  // engine-runner.ts and variant-eve.ts, and none of them may reach it: a bot
  // game is never a product event. PostHog's game events come from the browser
  // of a person who played.
  // The sources, whether this runs from src/ (tsx) or dist/ (the compiled suite).
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  for (const file of [
    'bot-vs-bot-scheduler.ts',
    'bot-vs-bot-pairing.ts',
    'banqi-eve-adapter.ts',
    'jungle-eve-adapter.ts',
    'worker.ts',
    'engine-runner.ts',
    'variant-eve.ts',
  ]) {
    const source = readFileSync(join(dir, file), 'utf8');
    assert.doesNotMatch(source, /analytics-server|posthog/i, file);
  }
});
