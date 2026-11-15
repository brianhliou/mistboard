import type { MistboardReadoutAction } from './mistboard-readout.js';

export const MILESTONE_METRICS = {
  completedGames: 'Completed human games',
  players: 'Players (accounts plus guest browsers)',
  accounts: 'Accounts',
  pvpGames: 'PvP games',
  ratedGames: 'Rated human-vs-human games',
  puzzlesSolved: 'Puzzles solved (first solves; accounts plus recorded guest browsers)',
  puzzlesOffered: 'Puzzles offered',
  broadcasts: 'Published broadcast events',
  articles: 'Published articles',
  studies: 'Public studies',
} as const;

export type MilestoneMetric = keyof typeof MILESTONE_METRICS;
export type MilestoneObservation = { total: number; last30Days: number };
// Missing/null means the metric could not be collected, never zero.
export type ReadoutMilestones = Partial<Record<MilestoneMetric, MilestoneObservation | null>>;
export type MilestoneTotals = Partial<Record<MilestoneMetric, number>>;

export function milestoneActions(
  observations: ReadoutMilestones | undefined,
  previousTotals: MilestoneTotals | undefined,
  headsUpsSeen: readonly string[],
  now: Date,
): MistboardReadoutAction[] {
  const actions: MistboardReadoutAction[] = [];
  for (const metric of Object.keys(MILESTONE_METRICS) as MilestoneMetric[]) {
    const current = observations?.[metric];
    const previous = previousTotals?.[metric];
    // Bootstrap each metric independently; old snapshots predate these totals.
    if (!validMilestoneObservation(current) || previous === undefined) continue;
    let milestone = 10;
    while (milestone <= current.total / 10) milestone *= 10;
    const label = MILESTONE_METRICS[metric];
    const formatted = () => milestone.toLocaleString('en-US');
    if (current.total >= milestone && previous < milestone) {
      actions.push({
        code: 'site-milestone-crossed',
        severity: 'action',
        dedupeKey: `site-milestone-crossed:${metric}:${milestone}`,
        ownerIssue: null,
        text: `${label} reached ${formatted()} as of ${now.toISOString().slice(0, 10)} UTC. Draft the milestone post.`,
      });
      // A backfill emits only its highest crossing, without also forecasting.
      continue;
    }
    if (current.total >= milestone) milestone *= 10;
    const key = `site-milestone-near:${metric}:${milestone}`;
    if (headsUpsSeen.includes(key) || current.last30Days <= 0) continue;
    const days = Math.ceil(((milestone - current.total) * 30) / current.last30Days);
    if (days > 14) continue;
    const date = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    actions.push({
      code: 'site-milestone-near',
      severity: 'watch',
      dedupeKey: key,
      ownerIssue: null,
      text: `${label}: projected to reach ${formatted()} by ${date} UTC (${days} days at the last-30-days pace). Draft the milestone post.`,
    });
  }
  return actions;
}

export function validMilestoneObservation(
  value: MilestoneObservation | null | undefined,
): value is MilestoneObservation {
  return (
    value !== null &&
    value !== undefined &&
    Number.isSafeInteger(value.total) &&
    value.total >= 0 &&
    Number.isSafeInteger(value.last30Days) &&
    value.last30Days >= 0
  );
}

export function milestoneTotalsSeen(
  observations: ReadoutMilestones | undefined,
  previous: MilestoneTotals | undefined,
): MilestoneTotals {
  const totals = { ...previous };
  for (const metric of Object.keys(MILESTONE_METRICS) as MilestoneMetric[]) {
    const observation = observations?.[metric];
    if (validMilestoneObservation(observation)) totals[metric] = observation.total;
  }
  return totals;
}
