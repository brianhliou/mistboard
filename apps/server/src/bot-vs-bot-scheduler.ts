// In-server scheduler that keeps a small, steady flow of engine-vs-engine (EvE)
// games between the site's own bots, one plan per variant (#488; xiangqi only
// before it). Each tick, for every planned variant, tops that variant's queue up
// to its in-flight limit rather than blindly enqueueing, and spaces its games to
// its daily cap, so the /watch Engines channel stays populated without
// unbounded growth. The worker (engine-worker service) runs the games and
// persists them as mode='eve'; this module only enqueues.
//
// Gated by botVsBotEnabled() (read at tick time so ops can flip it without a
// restart). Generation is deliberately independent of the variant launch flags,
// which control /watch visibility (#196). Pairing is delegated to the two-lane
// policy (content vs calibration) in bot-vs-bot-pairing.ts over the variant's
// own bot ladder.
//
// Fail closed: a variant with no EvE adapter, no ladder rung the adapter can
// play, or no public surface (a hidden spec such as mahjong, a retired spec) is
// skipped and logged, never mapped to another variant's ladder.
// A variant whose engine is a binary the worker may lack (banqi, jungle) queues
// its games with that capability required, so a worker without the binary never
// claims them: they wait (and, holding the in-flight slot, stop more being
// queued) instead of failing every 15 minutes.
//
// Ratings: only a plan with a random-floor anchor and at least two rungs can
// stamp a rating_policy. Banqi (one bot, no floor) and jungle (no floor) never
// do, so their games never reach the Elo report or a bot rating.
//
// Environment (all optional; MISTBOARD_BOT_VS_BOT_ENABLED=true turns it on):
//   MISTBOARD_BOT_VS_BOT_VARIANTS         comma list; default BOT_VS_BOT_DEFAULT_VARIANTS
//   MISTBOARD_BOT_VS_BOT_<V>_DAILY_MAX    games per rolling 24h for variant <V>
//   MISTBOARD_BOT_VS_BOT_<V>_TARGET       games in flight for variant <V>
//     <V> is the spec id upper-cased with - as _, e.g. JIEQI, DUCK_XIANGQI.
//   MISTBOARD_BOT_VS_BOT_DAILY_MAX / _TARGET   the pre-#488 names: xiangqi's,
//     read when the per-variant xiangqi var is unset, so prod's settings carry on.
//   MISTBOARD_BOT_VS_BOT_MAX_PLIES, _CALIBRATION_RATIO   every variant.
//   MISTBOARD_BOT_VS_BOT_RED_ENGINE + _BLACK_ENGINE      a fixed xiangqi pair
//     (demos/tests), honoured only when the xiangqi adapter plays both.

import { maybeGameSpecForId } from '@mistboard/game';
import {
  type BotVsBotLane,
  type BotVsBotPairing,
  botLadderFor,
  pickPairing,
} from './bot-vs-bot-pairing.js';
import {
  countActiveEngineGameTasks,
  createEngineGameTask,
  createExperimentJob,
} from './engine-experiments.js';
import { upsertBuiltinEngineVersions } from './engine-registry.js';
import { timeControlBucket } from './engine-time-policy.js';
import { botVsBotEnabled } from './feature-flags.js';
import { getPool, withTransaction } from './persistence-db.js';
import { eveAdapterFor } from './variant-eve-registry.js';

const TICK_MS = 30_000;
const DAY_MS = 86_400_000;
// After an ATTEMPT (whether it produced a finished game or failed), wait at least
// this long before enqueueing again. The daily cadence paces off SUCCESSFUL games,
// so a failed game doesn't blackhole the day; this cooldown is the floor that
// keeps a persistently-failing pairing from re-enqueueing every tick.
const RETRY_COOLDOWN_MS = 900_000; // 15 min

export const BOT_VS_BOT_SOURCE = 'bot-vs-bot-scheduler';

export const BOT_VS_BOT_MIN_TARGET = 1;
export const BOT_VS_BOT_MAX_TARGET = 20;
export const BOT_VS_BOT_DEFAULT_TARGET = 2;
export const BOT_VS_BOT_DEFAULT_MAX_PLIES = 300;
export const BOT_VS_BOT_DEFAULT_CALIBRATION_RATIO = 0.3;
// Games per rolling 24h. Deliberately low so we ladder up from a trickle rather
// than saturating the worker; raise the per-variant DAILY_MAX to scale.
export const BOT_VS_BOT_DEFAULT_DAILY_MAX = 2;
export const BOT_VS_BOT_MIN_DAILY_MAX = 1;
export const BOT_VS_BOT_MAX_DAILY_MAX = 5_000;

// The planned variants and their defaults (#488, cut 2026-10-01 by Brian:
// fortress and atomic out, jungle and banqi in). Seven games a day in all,
// against two before. Sized to the engine-worker budget (memory
// bot_hosting_cost_engine_worker): each game is a few engine-minutes on a box
// that is idle most of the day. Fortress and atomic still run if named in
// MISTBOARD_BOT_VS_BOT_VARIANTS (their adapters stay), at 1/day.
// crazyhouse-xiangqi joined at 1/day on 2026-10-02 (Brian: "yes on the bot
// schedule"), so Watch shows the new variant's bot games: eight a day in all.
export const BOT_VS_BOT_VARIANT_DEFAULTS: Readonly<
  Record<string, { dailyMax: number; targetActive: number }>
> = {
  xiangqi: { dailyMax: 2, targetActive: 2 },
  jieqi: { dailyMax: 2, targetActive: 1 },
  'duck-xiangqi': { dailyMax: 1, targetActive: 1 },
  jungle: { dailyMax: 1, targetActive: 1 },
  banqi: { dailyMax: 1, targetActive: 1 },
  'crazyhouse-xiangqi': { dailyMax: 1, targetActive: 1 },
};
export const BOT_VS_BOT_DEFAULT_VARIANTS: readonly string[] = Object.keys(
  BOT_VS_BOT_VARIANT_DEFAULTS,
);

export type BotVsBotVariantPlan = {
  variant: string;
  targetActive: number;
  maxPlies: number;
  calibrationRatio: number;
  // Max games to enqueue per rolling 24h. The scheduler spaces games ~24h/dailyMax
  // apart, so this is both the daily quota and the pacing knob.
  dailyMax: number;
  ladder: string[];
  /** The variant's 0-Elo random mover, the anchor its calibration games rate against.
   *  Null for a data-only variant: its games are never rated. */
  anchorEngineId: string | null;
  /** The worker capability its tasks require (an engine binary the box may lack). */
  requiredCapability: string | null;
  // When set, every game uses this exact pair (labelled content) and overrides the
  // two-lane policy. Xiangqi only, and only when both engine env vars are present.
  forcedPairing: BotVsBotPairing | null;
};

export type BotVsBotSkip = { variant: string; reason: string };

export type BotVsBotSchedulerConfig = {
  plans: BotVsBotVariantPlan[];
  skipped: BotVsBotSkip[];
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export function clampBotVsBotTarget(value: unknown, fallback = BOT_VS_BOT_DEFAULT_TARGET): number {
  return clampInt(value, fallback, BOT_VS_BOT_MIN_TARGET, BOT_VS_BOT_MAX_TARGET);
}

export function clampBotVsBotDailyMax(
  value: unknown,
  fallback = BOT_VS_BOT_DEFAULT_DAILY_MAX,
): number {
  return clampInt(value, fallback, BOT_VS_BOT_MIN_DAILY_MAX, BOT_VS_BOT_MAX_DAILY_MAX);
}

export function clampCalibrationRatio(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return BOT_VS_BOT_DEFAULT_CALIBRATION_RATIO;
  return Math.min(1, Math.max(0, n));
}

/** `duck-xiangqi` -> `DUCK_XIANGQI`, the per-variant env var infix. */
export function botVsBotEnvKey(variant: string): string {
  return variant.toUpperCase().replaceAll('-', '_');
}

function requestedVariants(env: NodeJS.ProcessEnv): string[] {
  const raw = env.MISTBOARD_BOT_VS_BOT_VARIANTS;
  if (raw === undefined || raw.trim() === '') return [...BOT_VS_BOT_DEFAULT_VARIANTS];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

// Why a variant cannot be scheduled, or null when it can. Every check fails
// closed: nothing here substitutes a default variant or ladder.
function planSkipReason(variant: string): string | null {
  const spec = maybeGameSpecForId(variant);
  if (!spec) return 'unknown-variant';
  if (spec.runtimeStatus !== 'live') return 'not-live';
  if (spec.publicSurface === 'hidden') return 'not-public';
  if (!eveAdapterFor(variant)) return 'no-eve-adapter';
  if (!botLadderFor(variant)) return 'no-ladder';
  return null;
}

export function botVsBotConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BotVsBotSchedulerConfig {
  const maxPliesRaw = Number.parseInt(env.MISTBOARD_BOT_VS_BOT_MAX_PLIES ?? '', 10);
  const maxPlies =
    Number.isFinite(maxPliesRaw) && maxPliesRaw > 0 ? maxPliesRaw : BOT_VS_BOT_DEFAULT_MAX_PLIES;
  const calibrationRatio = clampCalibrationRatio(env.MISTBOARD_BOT_VS_BOT_CALIBRATION_RATIO);
  const plans: BotVsBotVariantPlan[] = [];
  const skipped: BotVsBotSkip[] = [];
  for (const variant of requestedVariants(env)) {
    const reason = planSkipReason(variant);
    if (reason) {
      skipped.push({ variant, reason });
      continue;
    }
    const adapter = eveAdapterFor(variant)!;
    // Only rungs the adapter can play: a rung it rejects would throw in the worker.
    const ladder = botLadderFor(variant)!.filter((id) => adapter.tierFor(id) !== null);
    if (ladder.length === 0) {
      skipped.push({ variant, reason: 'empty-ladder' });
      continue;
    }
    const key = botVsBotEnvKey(variant);
    const defaults = BOT_VS_BOT_VARIANT_DEFAULTS[variant] ?? { dailyMax: 1, targetActive: 1 };
    // Xiangqi keeps reading the pre-#488 names when its own are unset.
    const legacy = variant === 'xiangqi';
    const dailyMaxRaw =
      env[`MISTBOARD_BOT_VS_BOT_${key}_DAILY_MAX`] ??
      (legacy ? env.MISTBOARD_BOT_VS_BOT_DAILY_MAX : undefined);
    const targetRaw =
      env[`MISTBOARD_BOT_VS_BOT_${key}_TARGET`] ??
      (legacy ? env.MISTBOARD_BOT_VS_BOT_TARGET : undefined);
    const red = env.MISTBOARD_BOT_VS_BOT_RED_ENGINE;
    const black = env.MISTBOARD_BOT_VS_BOT_BLACK_ENGINE;
    const forcedPairing =
      legacy && red && black && adapter.tierFor(red) && adapter.tierFor(black)
        ? { redEngineId: red, blackEngineId: black }
        : null;
    // A one-rung ladder has no cross-tier pairing to calibrate: it is the bot
    // against itself, content only.
    plans.push({
      variant,
      targetActive: clampBotVsBotTarget(targetRaw, defaults.targetActive),
      maxPlies,
      calibrationRatio: ladder.length < 2 ? 0 : calibrationRatio,
      dailyMax: clampBotVsBotDailyMax(dailyMaxRaw, defaults.dailyMax),
      ladder,
      anchorEngineId: ladder.length < 2 ? null : (adapter.randomEngineId ?? null),
      requiredCapability: adapter.requiredCapability ?? null,
      forcedPairing,
    });
  }
  return { plans, skipped };
}

export type EnqueueBotVsBotGameInput = {
  variant: string;
  lane: BotVsBotLane;
  pairing: BotVsBotPairing;
  maxPlies: number;
  seed: string;
  anchorEngineId: string | null;
  requiredCapability?: string | null;
};

export type BotVsBotSchedulerDeps = {
  enabled(): boolean;
  config(): BotVsBotSchedulerConfig;
  countActiveTasks(variant: string): Promise<number>;
  // Epoch-ms of the variant's most recent scheduler ATTEMPT (any job), or null.
  // Drives the short retry cooldown. DB-backed so a restart doesn't re-burst.
  lastEnqueueAt(variant: string): Promise<number | null>;
  // Epoch-ms of the variant's most recent SUCCESSFULLY-COMPLETED scheduler game,
  // or null. Drives the daily cadence, so a failed game never counts against it.
  lastSuccessAt(variant: string): Promise<number | null>;
  enqueueGame(input: EnqueueBotVsBotGameInput): Promise<void>;
  random(): number;
  now(): number;
  log?(line: Record<string, unknown>): void;
};

// Epoch-ms of the variant's newest scheduler-sourced job, or null. Jobs written
// before #488 all carry variant 'xiangqi', so xiangqi's pacing carries over.
async function lastBotVsBotEnqueueAtMs(variant: string): Promise<number | null> {
  const { rows } = await getPool().query<{ at: number | null }>(
    `SELECT EXTRACT(EPOCH FROM MAX(created_at)) * 1000 AS at
       FROM eve_jobs
      WHERE config->>'source' = $1
        AND config->>'variant' = $2`,
    [BOT_VS_BOT_SOURCE, variant],
  );
  const at = rows[0]?.at;
  return at === null || at === undefined ? null : Number(at);
}

// Epoch-ms of the variant's newest COMPLETED scheduler game, or null.
async function lastBotVsBotSuccessAtMs(variant: string): Promise<number | null> {
  const { rows } = await getPool().query<{ at: number | null }>(
    `SELECT EXTRACT(EPOCH FROM MAX(COALESCE(game.ended_at, game.started_at))) * 1000 AS at
       FROM games game
       JOIN eve_games eve ON eve.game_id = game.room_id
       JOIN eve_jobs job ON job.id = eve.job_id
      WHERE job.config->>'source' = $1
        AND job.config->>'variant' = $2
        AND game.status = 'completed'`,
    [BOT_VS_BOT_SOURCE, variant],
  );
  const at = rows[0]?.at;
  return at === null || at === undefined ? null : Number(at);
}

// The rating policy stamped on CALIBRATION-lane jobs, mirroring what
// enqueue-engine-tournament writes. The Elo report selects rows by
// `rating_policy.rated = 'true'` (engine-elo-report.ts), so without this the
// daily calibration trickle was generated, stored, and then ignored by the
// only thing it exists to feed. Content-lane jobs stay unstamped: those
// pairings are picked for watchability (top-heavy, mirrors allowed) and a
// mirror carries no ranking signal.
//
// The pace matches the calibration tournaments (clockless → the `untimed`
// bucket), so trickle games pool with them instead of forming a second bucket.
// The pool is the variant's own, anchored on its own random mover.
function calibrationRatingPolicy(variant: string, anchorEngineId: string): Record<string, unknown> {
  return {
    rated: true,
    method: 'anchor-relative-smoothed-logit-v1',
    anchor_engine_id: anchorEngineId,
    min_anchor_games: 8,
    excluded_terminations: ['truncated'],
    pool: {
      variant,
      time_control_bucket: timeControlBucket({ kind: 'none' }),
    },
  };
}

// The job config for one scheduled game. Pure + exported so the rated stamping
// is testable without a database (the live enqueue path is injected away in the
// scheduler tests). A calibration game of a variant with no random anchor stays
// unrated rather than borrowing another variant's anchor.
export function botVsBotJobConfig(input: {
  variant: string;
  lane: BotVsBotLane;
  pairing: BotVsBotPairing;
  anchorEngineId: string | null;
}): Record<string, unknown> {
  return {
    variant: input.variant,
    source: BOT_VS_BOT_SOURCE,
    lane: input.lane,
    pairing: {
      kind:
        input.pairing.redEngineId === input.pairing.blackEngineId
          ? 'self-play'
          : 'engine-vs-engine',
      white_engine_id: input.pairing.redEngineId,
      black_engine_id: input.pairing.blackEngineId,
    },
    ...(input.lane === 'calibration' && input.anchorEngineId
      ? { rating_policy: calibrationRatingPolicy(input.variant, input.anchorEngineId) }
      : {}),
  };
}

// The task config for one scheduled game: what the worker reads to play it.
// `visibility: 'public'` makes the finished game public data (#488): the
// /games/search Engine games source and the /data engine-game files. The
// worker writes every other EvE game (rating tournaments) as the column
// default, 'link'.
export function botVsBotTaskConfig(input: EnqueueBotVsBotGameInput): Record<string, unknown> {
  return {
    variant: input.variant,
    max_plies: input.maxPlies,
    white_engine_id: input.pairing.redEngineId,
    black_engine_id: input.pairing.blackEngineId,
    source: BOT_VS_BOT_SOURCE,
    visibility: 'public',
  };
}

// Where a scheduled game may run. A variant whose engine is a binary the worker
// may lack requires that worker capability (eveWorkerCapabilities), so a worker
// without the binary leaves the task queued rather than failing it.
export function botVsBotResourcePolicy(input: EnqueueBotVsBotGameInput): Record<string, unknown> {
  return {
    providers: ['local', 'railway'],
    concurrency: 1,
    ...(input.requiredCapability ? { required_capabilities: [input.requiredCapability] } : {}),
  };
}

// The opening policy for one scheduled game. The seed is what a jieqi deal is
// drawn from (variant-eve.ts createSetup): without it every scheduled jieqi game
// would be dealt from the same default seed, the same deal every day.
export function botVsBotOpeningPolicy(seed: string): Record<string, unknown> {
  return { kind: 'standard', seed };
}

// Live enqueue: one job + one task per game, shaped exactly like the enqueue CLI
// so the worker's variant runner picks it up unchanged. The lane is recorded on
// the job so calibration can query only calibration-lane games.
//
// All three writes run in ONE transaction: engine_game_tasks.white/black_engine_id
// are FKs to engine_versions, so the engines MUST be registered before the task
// insert (like the enqueue CLI does) or it throws. Transactional so a failed task
// insert rolls the job back too — otherwise an orphan job would poison the
// rolling-24h rate limiter (which keys off eve_jobs) and block generation for a day.
async function enqueueLiveGame(input: EnqueueBotVsBotGameInput): Promise<void> {
  await withTransaction(async (tx) => {
    await upsertBuiltinEngineVersions(tx, [input.pairing.redEngineId, input.pairing.blackEngineId]);
    const job = await createExperimentJob(tx, {
      purpose: 'calibration',
      targetGames: 1,
      config: botVsBotJobConfig(input),
      createdBy: BOT_VS_BOT_SOURCE,
    });
    await createEngineGameTask(tx, {
      jobId: job.id,
      gameIndex: 0,
      priority: 0,
      whiteEngineId: input.pairing.redEngineId,
      blackEngineId: input.pairing.blackEngineId,
      seed: input.seed,
      timeControl: { kind: 'none' },
      openingPolicy: botVsBotOpeningPolicy(input.seed),
      artifactPolicy: {},
      resourcePolicy: botVsBotResourcePolicy(input),
      config: botVsBotTaskConfig(input),
    });
  });
}

// Exported for the persistence tests, which drive a real tick against the test
// database with their own config.
export const botVsBotLiveDeps: BotVsBotSchedulerDeps = {
  enabled: () => botVsBotEnabled(),
  config: () => botVsBotConfigFromEnv(),
  countActiveTasks: (variant) => countActiveEngineGameTasks(getPool(), { variant }),
  lastEnqueueAt: (variant) => lastBotVsBotEnqueueAtMs(variant),
  lastSuccessAt: (variant) => lastBotVsBotSuccessAtMs(variant),
  enqueueGame: (input) => enqueueLiveGame(input),
  random: () => Math.random(),
  now: () => Date.now(),
  log: (line) => console.log(JSON.stringify(line)),
};

export type BotVsBotScheduler = {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
};

// Pick lane + pairing for one game: a forced pair (labelled content) short-
// circuits the policy, otherwise delegate to the two-lane picker.
function chooseGame(
  plan: BotVsBotVariantPlan,
  random: () => number,
): { lane: BotVsBotLane; pairing: BotVsBotPairing } {
  if (plan.forcedPairing) return { lane: 'content', pairing: plan.forcedPairing };
  return pickPairing(random, plan.ladder, plan.calibrationRatio);
}

function errorLine(error: unknown, at: number, variant?: string): string {
  return JSON.stringify({
    level: 'error',
    kind: 'bot_vs_bot_scheduler_tick_failed',
    ...(variant ? { variant } : {}),
    error: error instanceof Error ? error.message : String(error),
    at,
  });
}

export function createBotVsBotScheduler(
  deps: BotVsBotSchedulerDeps = botVsBotLiveDeps,
): BotVsBotScheduler {
  let ticking = false;
  let interval: NodeJS.Timeout | null = null;
  // Each skipped variant is logged once per reason, not every 30 s.
  const reportedSkips = new Set<string>();
  const log = deps.log ?? (() => undefined);

  // One variant's turn: at most one game per tick.
  async function tickVariant(plan: BotVsBotVariantPlan): Promise<void> {
    // Concurrency ceiling: never exceed targetActive games in flight.
    const active = await deps.countActiveTasks(plan.variant);
    if (active >= plan.targetActive) return;

    const now = deps.now();
    // Daily cadence: space games ~24h/dailyMax apart, measured from the last
    // SUCCESSFUL game so a failed game never counts against the quota (a failure
    // used to blackhole the day). At high dailyMax the interval falls below the
    // tick and it simply keeps the queue topped to targetActive.
    const minIntervalMs = DAY_MS / plan.dailyMax;
    const lastSuccess = await deps.lastSuccessAt(plan.variant);
    if (lastSuccess !== null && now - lastSuccess < minIntervalMs) return;

    // Retry floor: don't re-enqueue within RETRY_COOLDOWN_MS of the last attempt
    // (success OR failure), so a persistently-failing pairing can't hammer the
    // queue every tick while still recovering far sooner than the daily interval.
    const lastAttempt = await deps.lastEnqueueAt(plan.variant);
    if (lastAttempt !== null && now - lastAttempt < RETRY_COOLDOWN_MS) return;

    const { lane, pairing } = chooseGame(plan, deps.random);
    await deps.enqueueGame({
      variant: plan.variant,
      lane,
      pairing,
      maxPlies: plan.maxPlies,
      seed: `${now}`,
      anchorEngineId: plan.anchorEngineId,
      requiredCapability: plan.requiredCapability,
    });
    log({
      level: 'info',
      kind: 'bot_vs_bot_enqueued',
      variant: plan.variant,
      lane,
      activeBefore: active,
      targetActive: plan.targetActive,
      dailyMax: plan.dailyMax,
      minIntervalMs,
      at: now,
    });
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    if (!deps.enabled()) return;
    ticking = true;
    try {
      const config = deps.config();
      for (const skip of config.skipped) {
        const key = `${skip.variant}:${skip.reason}`;
        if (reportedSkips.has(key)) continue;
        reportedSkips.add(key);
        log({ level: 'warn', kind: 'bot_vs_bot_variant_skipped', ...skip });
      }
      // Variants run one after another, and one variant's failure (a database
      // hiccup, a pairing the registry refuses) never stops the others.
      for (const plan of config.plans) {
        try {
          await tickVariant(plan);
        } catch (error) {
          console.error(errorLine(error, deps.now(), plan.variant));
        }
      }
    } catch (error) {
      console.error(errorLine(error, deps.now()));
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    start() {
      if (interval) return;
      interval = setInterval(() => {
        void tick();
      }, TICK_MS);
      interval.unref?.();
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
  };
}

export function startBotVsBotScheduler(
  deps: BotVsBotSchedulerDeps = botVsBotLiveDeps,
): BotVsBotScheduler {
  const scheduler = createBotVsBotScheduler(deps);
  scheduler.start();
  return scheduler;
}
