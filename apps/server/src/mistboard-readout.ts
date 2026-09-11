import { createHash } from 'node:crypto';
import type { ElephantChessPuzzleQualityReport } from './elephantchess-puzzle-quality-report.js';

export const MISTBOARD_READOUT_SCHEMA_VERSION = 2 as const;
// v1 snapshots are still the comparison baseline the day after a deploy, so
// reads accept them and fill the fields they predate.
export const SUPPORTED_MISTBOARD_READOUT_SCHEMA_VERSIONS = [1, 2] as const;
export const ELEPHANTCHESS_PILOT_RUN_ID = 'xqpmr_dae53626bf845f80a72aa671';
export const ELEPHANTCHESS_QUALITY_ISSUE = 156;

// Week-over-week swings are Poisson noise at low volume, so the drop rule needs
// a floor before it can call a halving a signal. The surge rule needs both a
// ratio and an absolute step so 2 games to 5 stays quiet.
const PRODUCT_DROP_FLOOR = 15;
const PRODUCT_SURGE_FLOOR = 3;
const PRODUCT_SURGE_ABSOLUTE_STEP = 15;
// Engine task failures are a windowed rate (they age out of the period), so
// unlike the latching counters below they can be judged on level.
const ENGINE_FAILED_TASK_FLOOR = 5;

export type MistboardReadoutTrigger = 'daily' | 'weekly' | 'manual';
export type MistboardReadoutVerdict = 'healthy' | 'watch' | 'action' | 'blocked' | 'unknown';
export type MistboardReadoutActionSeverity = 'watch' | 'action' | 'blocked';

export type MistboardReadoutAction = {
  code: string;
  severity: MistboardReadoutActionSeverity;
  dedupeKey: string;
  ownerIssue: number | null;
  text: string;
};

export type MistboardReadoutProduct = {
  accountsCreated: number;
  previousAccountsCreated: number;
  completedGames: number;
  previousCompletedGames: number;
  completedGamesByMode: Record<string, number>;
  completedGamesByVariant: Array<{ variant: string; count: number }>;
  // Games that reached a terminal row without a result (engine failure, guest
  // abort). Demand that the completed count cannot see.
  abortedGames: number;
  // Distinct counted players (accounts, plus guest browsers since migration
  // 137) that finished a game in the period. Unlike PostHog this sees
  // visitors who send Do Not Track.
  humanPlayers: number;
  previousHumanPlayers: number;
  // Of humanPlayers, how many had finished a game before this period started.
  returningPlayers: number;
  // The account share of humanPlayers.
  signedInPlayers: number;
  // Distinct counted players in the 28 days ending at periodEnd, and in the
  // 28 days before that. The rolling figure on /metrics, sampled once per
  // readout. Named for what it counted when added (2026-09-11, accounts only;
  // guest browsers joined the same day); optional so older snapshots parse.
  activeAccounts28d?: number;
  previousActiveAccounts28d?: number;
};

// One prior weekly period, oldest first, so a weekly readout carries a trend
// instead of a two-point delta. Fields are nullable because v1 snapshots did
// not record a player count.
export type MistboardReadoutTrendPoint = {
  periodEnd: string;
  completedGames: number | null;
  humanPlayers: number | null;
  activeAccounts28d?: number | null;
};

export type MistboardReadoutMining = {
  runId: string;
  status: string;
  selectedGames: number;
  shards: Record<string, number>;
  remainingGames: number;
  candidates: Record<string, number>;
  staleLeases: number;
};

export type MistboardReadoutEngines = {
  tasks: Record<string, number>;
  failedTasks: number;
  staleWorkers: number;
  activeWorkers: number;
};

export type MistboardReadoutCollectorError = {
  section: 'product' | 'puzzles' | 'mining' | 'engines';
  code: 'collector_failed';
};

export type MistboardReadoutV1 = {
  kind: 'mistboard-readout';
  // Not the current version literal: a report read back from storage can carry
  // any supported version, and the type has to admit that.
  schemaVersion: number;
  snapshotId: string;
  snapshotKey: string | null;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  trigger: MistboardReadoutTrigger;
  verdict: MistboardReadoutVerdict;
  production: {
    revision: string | null;
    activeGames: number;
    databaseRequired: boolean;
    persistence: 'enabled' | 'disabled';
    persistenceErrors: { count1m: number; lastAt: number | null };
  };
  product: MistboardReadoutProduct | null;
  puzzles: ElephantChessPuzzleQualityReport | null;
  mining: MistboardReadoutMining | null;
  engines: MistboardReadoutEngines | null;
  actions: MistboardReadoutAction[];
  collectorErrors: MistboardReadoutCollectorError[];
  trend: MistboardReadoutTrendPoint[];
  decisionFingerprint: string;
  // Stable while the same problem persists, so a daily alert can be posted once
  // per distinct problem instead of once per day. decisionFingerprint cannot do
  // this: it moves whenever any counter moves.
  alertKey: string;
};

export type MistboardReadoutFacts = {
  product: MistboardReadoutProduct | null;
  puzzles: ElephantChessPuzzleQualityReport | null;
  mining: MistboardReadoutMining | null;
  engines: MistboardReadoutEngines | null;
  collectorErrors?: MistboardReadoutCollectorError[];
  trend?: MistboardReadoutTrendPoint[];
};

export type MistboardReadoutRuntime = MistboardReadoutV1['production'];

const DAY_MS = 24 * 60 * 60 * 1_000;

export function readoutPeriods(now: Date): {
  periodStart: Date;
  periodEnd: Date;
  previousPeriodStart: Date;
} {
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const periodStart = new Date(periodEnd.getTime() - 7 * DAY_MS);
  const previousPeriodStart = new Date(periodStart.getTime() - 7 * DAY_MS);
  return { periodStart, periodEnd, previousPeriodStart };
}

export function scheduledReadoutTrigger(now: Date): Exclude<MistboardReadoutTrigger, 'manual'> {
  return now.getUTCDay() === 1 ? 'weekly' : 'daily';
}

export function readoutSnapshotKey(trigger: MistboardReadoutTrigger, now: Date): string | null {
  const date = now.toISOString().slice(0, 10);
  if (trigger === 'daily') return `readout:v1:daily:${date}`;
  if (trigger === 'weekly') return `readout:v1:weekly:${isoWeekKey(now)}`;
  return null;
}

export function buildMistboardReadout(input: {
  snapshotId: string;
  trigger: MistboardReadoutTrigger;
  now: Date;
  runtime: MistboardReadoutRuntime;
  facts: MistboardReadoutFacts;
  previousReport?: MistboardReadoutV1 | null;
}): MistboardReadoutV1 {
  const periods = readoutPeriods(input.now);
  const collectorErrors = [...(input.facts.collectorErrors ?? [])].sort((a, b) =>
    a.section.localeCompare(b.section),
  );
  const actions = buildActions(input.facts, input.previousReport ?? null).sort((a, b) =>
    a.dedupeKey.localeCompare(b.dedupeKey),
  );
  const verdict = readoutVerdict(actions, collectorErrors, input.runtime);
  const reportWithoutFingerprint = {
    kind: 'mistboard-readout' as const,
    schemaVersion: MISTBOARD_READOUT_SCHEMA_VERSION,
    snapshotId: input.snapshotId,
    snapshotKey: readoutSnapshotKey(input.trigger, input.now),
    generatedAt: input.now.toISOString(),
    periodStart: periods.periodStart.toISOString(),
    periodEnd: periods.periodEnd.toISOString(),
    previousPeriodStart: periods.previousPeriodStart.toISOString(),
    trigger: input.trigger,
    verdict,
    production: input.runtime,
    product: input.facts.product,
    puzzles: input.facts.puzzles,
    mining: input.facts.mining,
    engines: input.facts.engines,
    actions,
    collectorErrors,
    trend: input.facts.trend ?? [],
  };
  return {
    ...reportWithoutFingerprint,
    decisionFingerprint: decisionFingerprint(reportWithoutFingerprint),
    alertKey: alertKey(verdict, actions),
  };
}

function buildActions(
  facts: MistboardReadoutFacts,
  previousReport: MistboardReadoutV1 | null,
): MistboardReadoutAction[] {
  const actions: MistboardReadoutAction[] = [
    ...productActions(facts.product, previousReport),
    ...operationsActions(facts, previousReport),
  ];
  const quality = facts.puzzles;
  // A checkpoint is a level that never falls back: sessions only go up, so
  // `plumbing === 'ready'` stays true forever once crossed. Emitting it on the
  // level pinned every verdict from 2026-07-27 onward at watch and buried the
  // list under a line no one could clear. Emit on the crossing instead.
  if (
    quality?.checkpoint.plumbing === 'ready' &&
    checkpointJustCrossed(previousReport, 'plumbing')
  ) {
    actions.push({
      code: 'puzzle-plumbing-ready',
      severity: 'watch',
      dedupeKey: 'puzzle-plumbing-ready:elephantchess-pilot-v1',
      ownerIssue: ELEPHANTCHESS_QUALITY_ISSUE,
      text: 'ElephantChess puzzle telemetry crossed 100 sessions. Verify the funnel, then keep collecting.',
    });
  }
  if (
    quality?.checkpoint.meaningful === 'ready' &&
    checkpointJustCrossed(previousReport, 'meaningful')
  ) {
    actions.push({
      code: 'puzzle-quality-gate-ready',
      severity: 'action',
      dedupeKey: 'puzzle-quality-gate-ready:elephantchess-pilot-v1',
      ownerIssue: ELEPHANTCHESS_QUALITY_ISSUE,
      text: 'ElephantChess puzzle quality crossed 1,000 meaningful starts. Review the gate before expanding the corpus.',
    });
  }
  if (quality && quality.outliers.length > 0) {
    const outlierFingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          quality.outliers.map((outlier) => ({
            puzzleId: outlier.puzzleId,
            flags: [...outlier.flags].sort(),
          })),
        ),
      )
      .digest('hex')
      .slice(0, 16);
    actions.push({
      code: 'puzzle-outlier-set-changed',
      severity: 'action',
      dedupeKey: `puzzle-outliers:${outlierFingerprint}`,
      ownerIssue: ELEPHANTCHESS_QUALITY_ISSUE,
      text: `${quality.outliers.length} sample-qualified ElephantChess puzzle outlier${quality.outliers.length === 1 ? '' : 's'} need review.`,
    });
  } else if (quality) {
    const previousOutliers = previousReport?.actions.find(
      (action) => action.code === 'puzzle-outlier-set-changed',
    );
    if (previousOutliers) {
      actions.push({
        code: 'puzzle-outliers-resolved',
        severity: 'watch',
        dedupeKey: `puzzle-outliers-resolved:${previousOutliers.dedupeKey.split(':').at(-1)}`,
        ownerIssue: ELEPHANTCHESS_QUALITY_ISSUE,
        text: 'The previously qualified ElephantChess puzzle outlier set has cleared.',
      });
    }
  }
  return actions;
}

// A previous report whose collector failed says nothing about the level, so
// treat it as "no comparison available" and stay quiet rather than
// re-announcing a crossing from months ago.
function checkpointJustCrossed(
  previousReport: MistboardReadoutV1 | null,
  key: 'plumbing' | 'meaningful',
): boolean {
  if (!previousReport) return true;
  if (!previousReport.puzzles) return false;
  return previousReport.puzzles.checkpoint[key] !== 'ready';
}

// The number this project steers by is play volume, and until now it could 4x
// or halve without the readout raising anything: the counters were printed and
// the action list only ever spoke about puzzles.
function productActions(
  product: MistboardReadoutProduct | null,
  previousReport: MistboardReadoutV1 | null,
): MistboardReadoutAction[] {
  if (!product) return [];
  const current = product.completedGames;
  const before = product.previousCompletedGames;
  const actions: MistboardReadoutAction[] = [];
  if (before >= PRODUCT_DROP_FLOOR && current * 2 <= before) {
    actions.push({
      code: current === 0 ? 'product-activity-stopped' : 'product-activity-dropped',
      severity: 'action',
      dedupeKey: `product-activity-dropped:${before}-${current}`,
      ownerIssue: null,
      text:
        current === 0
          ? `No games finished this week, after ${before} the week before. Check that games are still being recorded.`
          : `Completed games fell to ${current} from ${before} week over week.`,
    });
  } else if (
    before >= PRODUCT_SURGE_FLOOR &&
    current >= before * 2 &&
    current - before >= PRODUCT_SURGE_ABSOLUTE_STEP
  ) {
    actions.push({
      code: 'product-activity-surged',
      severity: 'watch',
      dedupeKey: `product-activity-surged:${before}-${current}`,
      ownerIssue: null,
      text: `Completed games rose to ${current} from ${before} week over week${typeof product.humanPlayers === 'number' ? `, across ${product.humanPlayers} players` : ''}. Find out where they came from while the trail is warm.`,
    });
  }
  // Retention is the half of the funnel that a volume count hides: a week can
  // double on new arrivals while every previous player leaves.
  if (
    product.humanPlayers >= PRODUCT_DROP_FLOOR &&
    product.returningPlayers === 0 &&
    previousPlayerCount(previousReport) > 0
  ) {
    actions.push({
      code: 'product-no-returning-players',
      severity: 'watch',
      dedupeKey: `product-no-returning-players:${product.humanPlayers}`,
      ownerIssue: null,
      text: `All ${product.humanPlayers} players this week were new. Nobody came back.`,
    });
  }
  return actions;
}

// Both counters below are levels that can latch: a hard-crashed worker leaves a
// running row whose heartbeat never advances, and a dead shard holds its lease
// forever. Alerting on the level would recreate exactly the stuck-action
// problem this file just fixed, so alert on the increase.
function operationsActions(
  facts: MistboardReadoutFacts,
  previousReport: MistboardReadoutV1 | null,
): MistboardReadoutAction[] {
  const actions: MistboardReadoutAction[] = [];
  const engines = facts.engines;
  if (
    engines &&
    grewSinceLastReport(
      previousReport?.engines?.staleWorkers,
      engines.staleWorkers,
      previousReport !== null && previousReport.engines === null,
    )
  ) {
    actions.push({
      code: 'engine-workers-stale',
      severity: 'action',
      dedupeKey: `engine-workers-stale:${engines.staleWorkers}`,
      ownerIssue: null,
      text: `${engines.staleWorkers} engine worker${engines.staleWorkers === 1 ? '' : 's'} stopped heartbeating while still marked running.`,
    });
  }
  if (engines && engines.failedTasks >= ENGINE_FAILED_TASK_FLOOR) {
    actions.push({
      code: 'engine-tasks-failing',
      severity: 'watch',
      dedupeKey: `engine-tasks-failing:${engines.failedTasks}`,
      ownerIssue: null,
      text: `${engines.failedTasks} engine tasks failed this period.`,
    });
  }
  const mining = facts.mining;
  if (
    mining &&
    grewSinceLastReport(
      previousReport?.mining?.staleLeases,
      mining.staleLeases,
      previousReport !== null && previousReport.mining === null,
    )
  ) {
    actions.push({
      code: 'mining-leases-stale',
      severity: 'watch',
      dedupeKey: `mining-leases-stale:${mining.staleLeases}`,
      ownerIssue: null,
      text: `${mining.staleLeases} mining shard lease${mining.staleLeases === 1 ? '' : 's'} expired without being reclaimed.`,
    });
  }
  return actions;
}

// A schema-v1 snapshot carries no player count at all, so the runtime check is
// load-bearing even though the type says otherwise.
function previousPlayerCount(previousReport: MistboardReadoutV1 | null): number {
  const value = previousReport?.product?.humanPlayers;
  return typeof value === 'number' ? value : 0;
}

function grewSinceLastReport(
  previous: number | undefined,
  current: number,
  previousSectionUnknown: boolean,
): boolean {
  if (current === 0) return false;
  if (previousSectionUnknown) return false;
  return current > (previous ?? 0);
}

function readoutVerdict(
  actions: readonly MistboardReadoutAction[],
  errors: readonly MistboardReadoutCollectorError[],
  runtime: MistboardReadoutRuntime,
): MistboardReadoutVerdict {
  if (
    errors.length > 0 ||
    (runtime.databaseRequired && runtime.persistence !== 'enabled') ||
    runtime.persistenceErrors.count1m > 0
  ) {
    return 'unknown';
  }
  if (actions.some((action) => action.severity === 'blocked')) return 'blocked';
  if (actions.some((action) => action.severity === 'action')) return 'action';
  if (actions.some((action) => action.severity === 'watch')) return 'watch';
  return 'healthy';
}

function alertKey(
  verdict: MistboardReadoutVerdict,
  actions: readonly MistboardReadoutAction[],
): string {
  const shape = [verdict, ...actions.map((action) => action.code).sort()].join('|');
  return createHash('sha256').update(shape).digest('hex').slice(0, 16);
}

// The trend is history rather than state, so it stays out of the fingerprint:
// including it would change the fingerprint every week even when nothing about
// the current state moved, which is the opposite of what a fingerprint is for.
function decisionFingerprint(
  report: Omit<MistboardReadoutV1, 'decisionFingerprint' | 'alertKey'>,
): string {
  const normalized = {
    schemaVersion: report.schemaVersion,
    verdict: report.verdict,
    production: report.production,
    product: report.product,
    puzzles: report.puzzles
      ? {
          checkpoint: report.puzzles.checkpoint,
          pilot: report.puzzles.pilot,
          baseline: report.puzzles.baseline,
          outliers: report.puzzles.outliers,
          recommendation: report.puzzles.recommendation,
        }
      : null,
    mining: report.mining,
    engines: report.engines,
    actions: report.actions,
    collectorErrors: report.collectorErrors,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function isoWeekKey(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function renderMistboardReadoutMarkdown(report: MistboardReadoutV1): string {
  const lines = [
    `# Mistboard Readout - ${report.generatedAt.slice(0, 10)}`,
    '',
    `**Verdict:** ${report.verdict.toUpperCase()}`,
    '',
    '## Actions',
    '',
  ];
  if (report.actions.length === 0) lines.push('No action needed.');
  else {
    report.actions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action.text}`);
    });
  }

  lines.push('', '## Product', '');
  if (!report.product) lines.push('Product activity unavailable.');
  else {
    const product = report.product;
    lines.push(
      `- Completed games: ${product.completedGames} (${signedDelta(product.completedGames - product.previousCompletedGames)} week over week)`,
    );
    const playersLine = renderPlayers(product);
    if (playersLine) lines.push(playersLine);
    const activeLine = renderActiveAccounts(product);
    if (activeLine) lines.push(activeLine);
    const trendLine = renderTrend(report);
    if (trendLine) lines.push(trendLine);
    const modesLine = renderModes(product.completedGamesByMode);
    if (modesLine) lines.push(modesLine);
    if (product.completedGamesByVariant.length > 0) {
      lines.push(`- Variants: ${renderVariants(product.completedGamesByVariant)}`);
    }
    if (product.abortedGames > 0) {
      lines.push(`- Aborted before a result: ${product.abortedGames}`);
    }
    lines.push(
      `- New accounts: ${product.accountsCreated} (${signedDelta(product.accountsCreated - product.previousAccountsCreated)} week over week)`,
      '- Counts games that reached the database, which happens at game end. Games started, including the ones nobody finished, are a client metric and live in PostHog.',
    );
  }

  lines.push('', '## Puzzles', '');
  if (!report.puzzles) lines.push('Puzzle quality unavailable.');
  else {
    lines.push(
      `- ElephantChess pilot: ${report.puzzles.pilot.sessions} sessions, ${report.puzzles.pilot.starts} starts`,
      `- Checkpoints: ${renderCheckpoints(report.puzzles)}`,
      `- Quality: ${report.puzzles.outliers.length} sample-qualified outliers, recommendation \`${report.puzzles.recommendation}\``,
    );
  }

  lines.push('', '## Operations', '');
  lines.push(
    `- Production revision: \`${report.production.revision ?? 'unknown'}\`; active games: ${report.production.activeGames}`,
  );
  if (!report.mining) lines.push('- Mining status unavailable.');
  else {
    lines.push(
      `- Mining: ${report.mining.status}; ${report.mining.candidates.published ?? 0} published; ${report.mining.remainingGames} games remaining`,
    );
  }
  if (!report.engines) lines.push('- Engine status unavailable.');
  else if (
    Object.values(report.engines.tasks).reduce((sum, count) => sum + count, 0) === 0 &&
    report.engines.activeWorkers === 0
  ) {
    lines.push('- Engines: idle, no queued work.');
  } else {
    lines.push(
      `- Engines: ${report.engines.activeWorkers} active workers, ${report.engines.failedTasks} failed tasks, ${report.engines.staleWorkers} stale workers`,
    );
  }
  if (report.collectorErrors.length > 0) {
    lines.push(
      `- Unknown sections: ${report.collectorErrors.map((error) => error.section).join(', ')}`,
    );
  }
  lines.push('', `<!-- mistboard-readout-snapshot:${report.snapshotId} -->`, '');
  return lines.join('\n');
}

function signedDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

// A two-point delta cannot tell a rebound from a new plateau, and every weekly
// comment so far has carried only that. The stored snapshots already held the
// history; nothing was reading them.
function renderTrend(report: MistboardReadoutV1): string | null {
  if (report.trend.length === 0) return null;
  const points = [
    ...report.trend.map((point) => formatTrendCount(point.completedGames)),
    String(report.product?.completedGames ?? 0),
  ];
  return `- Completed-game trend, oldest first: ${points.join(' ')}`;
}

function formatTrendCount(value: number | null): string {
  return value === null ? '?' : String(value);
}

function renderVariants(entries: ReadonlyArray<{ variant: string; count: number }>): string {
  const top = entries.slice(0, 5).map((entry) => `${entry.variant} ${entry.count}`);
  const remaining = entries.length - top.length;
  return remaining > 0 ? `${top.join(', ')}, and ${remaining} more` : top.join(', ');
}

// A schema-v1 snapshot carries no player counts, and this renderer is used on
// stored reports as well as fresh ones, so it meets v1 payloads long after the
// collector stopped producing them. Omit the line rather than print
// "undefined (NaN week over week)", which is what /readouts showed on the first
// prod load.
function renderPlayers(product: MistboardReadoutProduct): string | null {
  if (typeof product.humanPlayers !== 'number') return null;
  const delta =
    typeof product.previousHumanPlayers === 'number'
      ? ` (${signedDelta(product.humanPlayers - product.previousHumanPlayers)} week over week)`
      : '';
  // Players are accounts plus guest browsers (since migration 137); the
  // signed-in share says how much of the week was accounts.
  const parts = [`- Players: ${product.humanPlayers}${delta}`];
  if (typeof product.returningPlayers === 'number') {
    parts.push(`${product.returningPlayers} returning`);
  }
  if (typeof product.signedInPlayers === 'number') {
    parts.push(`${product.signedInPlayers} signed in`);
  }
  return parts.join(', ');
}

// The rolling 28-day figure is the one that moves slowly enough to steer by;
// the weekly count above it swings on a single returning regular.
function renderActiveAccounts(product: MistboardReadoutProduct): string | null {
  if (typeof product.activeAccounts28d !== 'number') return null;
  const delta =
    typeof product.previousActiveAccounts28d === 'number'
      ? ` (${signedDelta(product.activeAccounts28d - product.previousActiveAccounts28d)} vs the 28 days before)`
      : '';
  return `- Active players, 28 days: ${product.activeAccounts28d}${delta}`;
}

// The by-mode counts include bot-vs-bot, which the headline count deliberately
// excludes, so the two lines have to say why they disagree.
function renderModes(byMode: Record<string, number>): string | null {
  const human = Object.entries(byMode)
    .filter(([mode, count]) => count > 0 && (mode === 'pvp' || mode === 'pve'))
    .sort((left, right) => right[1] - left[1])
    .map(([mode, count]) => `${mode} ${count}`);
  const eve = byMode.eve ?? 0;
  if (human.length === 0 && eve === 0) return null;
  const suffix = eve > 0 ? `, plus ${eve} bot-vs-bot outside the count above` : '';
  return `- Modes: ${human.join(', ')}${suffix}`;
}

// Says what is left to reach, and says "cleared" once there is nothing left,
// rather than printing a permanent "0 remaining".
function renderCheckpoints(puzzles: ElephantChessPuzzleQualityReport): string {
  const parts = [
    puzzles.checkpoint.plumbing === 'ready'
      ? 'plumbing cleared'
      : `${puzzles.checkpoint.sessionsRemaining} sessions to plumbing`,
    puzzles.checkpoint.meaningful === 'ready'
      ? 'quality gate cleared'
      : `${puzzles.checkpoint.startsRemaining} starts to quality gate`,
  ];
  return parts.join(', ');
}
