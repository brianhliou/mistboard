import type { TimeClass } from '@mistboard/game';
import type pg from 'pg';
import {
  type BotRatingImportBot,
  type BotRatingSnapshotDraft,
  buildBotRatingSnapshotPlan,
  insertBotRatingSnapshotDraftsOn,
  loadBotRatingImportBots,
} from './bot-rating-import.js';
import {
  type BotRatingPins,
  findStaleBotRatings,
  loadBotRatingPins,
  requiresBotRatingPolicy,
} from './bot-rating-provenance.js';
import { type BotVsBotVariantPlan, botVsBotConfigFromEnv } from './bot-vs-bot-scheduler.js';
import {
  buildEngineEloReport,
  type EngineEloGameRow,
  loadRatedEngineEloRows,
} from './engine-elo-report.js';
import { firstPartyBotEngineFor } from './first-party-bots.js';
import { DEFAULT_RATING } from './glicko.js';

export type LatestCalibrationRating = {
  botId: string;
  engineId: string;
  gameSpecId: string;
  timeClass: TimeClass;
  rating: number;
  sourceRef: string | null;
  publishedAt: Date;
};
export type HeldBotRating = {
  botId: string;
  engineId: string;
  gameSpecId: string;
  timeClass: TimeClass;
  recipe: string;
  netSha256: string | null;
  previousRating: number;
  estimatedRating: number;
};
export type CalibrationRatingRefresh = {
  drafts: BotRatingSnapshotDraft[];
  heldRatings: HeldBotRating[];
};

export function heldBotRatingKey(rating: HeldBotRating): string {
  // Stable as more daily games arrive; a new build or reviewed baseline re-arms it.
  return [
    rating.botId,
    rating.gameSpecId,
    rating.timeClass,
    rating.engineId,
    rating.recipe,
    rating.netSha256 ?? 'none',
    rating.previousRating,
  ].join(':');
}

export function currentStampedCalibrationGames(
  rows: readonly EngineEloGameRow[],
  pins: BotRatingPins,
  anchorEngineId: string,
): EngineEloGameRow[] {
  return rows.filter(
    (row) =>
      row.anchorEngineId === anchorEngineId &&
      (
        [
          ['white', row.whiteEngineId],
          ['black', row.blackEngineId],
        ] as const
      ).every(([side, id]) => {
        const stamp = row.stamps?.[side];
        return (
          id !== null &&
          Object.hasOwn(pins.nets, id) &&
          (!requiresBotRatingPolicy(id) || pins.policies?.[id] !== undefined) &&
          stamp != null &&
          stamp.recipe === pins.recipe &&
          stamp.netSha256 === pins.nets[id] &&
          stamp.policy === pins.policies?.[id]
        );
      }),
  );
}

/** Uses the report's existing anchor-relative fit and the importer's conversion. */
export function buildCalibrationRatingRefresh(input: {
  rows: readonly EngineEloGameRow[];
  plans: readonly BotVsBotVariantPlan[];
  bots: readonly BotRatingImportBot[];
  latest: readonly LatestCalibrationRating[];
  pins: BotRatingPins;
  now: Date;
}): CalibrationRatingRefresh {
  const result: CalibrationRatingRefresh = { drafts: [], heldRatings: [] };
  for (const plan of input.plans) {
    if (!plan.anchorEngineId || plan.forcedPairing || plan.calibrationRatio <= 0) continue;
    const rows = currentStampedCalibrationGames(
      input.rows.filter((row) => row.variant === plan.variant),
      input.pins,
      plan.anchorEngineId,
    );
    if (rows.length === 0) continue;
    const report = buildEngineEloReport(rows, { anchorEngineId: plan.anchorEngineId });
    // Scheduled games are clockless; keep the existing manual import convention.
    const imported = buildBotRatingSnapshotPlan(report, input.bots, {
      sourceRef: 'lane=calibration',
      timeClass: 'blitz',
      published: true,
      pins: input.pins,
    });
    for (const candidate of imported.drafts) {
      if (!plan.ladder.includes(candidate.engineId)) continue;
      const estimate = report.rows.find((row) => row.engineId === candidate.engineId)!;
      // Test the unrounded 95% Wilson half-width, not the rounded stored deviation.
      const halfWidth = estimate.ciWilson;
      if (halfWidth == null || !Number.isFinite(halfWidth) || halfWidth > 50) continue;
      const latest = input.latest.filter(
        (row) => row.botId === candidate.botId && row.gameSpecId === candidate.gameSpecId,
      );
      // With no published baseline neither refresh condition is satisfied.
      for (const previous of latest) {
        const draft = { ...candidate, timeClass: previous.timeClass };
        const stale = findStaleBotRatings([previous], input.pins).length > 0;
        const difference = Math.abs(DEFAULT_RATING + estimate.elo! - previous.rating);
        // A move this large is held for a person to read, stale baseline or not:
        // an engine or net change is exactly when a wrong fit would publish.
        if (difference > 200) {
          result.heldRatings.push({
            botId: draft.botId,
            engineId: draft.engineId,
            gameSpecId: draft.gameSpecId,
            timeClass: draft.timeClass,
            recipe: input.pins.recipe,
            netSha256: input.pins.nets[draft.engineId]!,
            previousRating: previous.rating,
            estimatedRating: draft.rating,
          });
          continue;
        }
        if (
          stale ||
          (difference > halfWidth &&
            input.now.getTime() - previous.publishedAt.getTime() >= 7 * 86_400_000)
        ) {
          result.drafts.push(draft);
        }
      }
    }
  }
  return result;
}

/** Called under the readout generation lock, in its transaction; dry runs only preview. */
export async function refreshCalibrationBotRatings(
  db: Pick<pg.Pool, 'query'>,
  now: Date,
  publish: boolean,
): Promise<CalibrationRatingRefresh> {
  const plans = botVsBotConfigFromEnv().plans;
  const bots = await loadBotRatingImportBots(db);
  const { rows: stored } = await db.query<{
    bot_id: string;
    active_engine_id: string;
    game_spec_id: string;
    time_class: TimeClass;
    rating: number;
    source_ref: string | null;
    published_at: Date;
  }>(`SELECT DISTINCT ON (s.bot_id, s.game_spec_id, s.time_class)
       s.bot_id, b.active_engine_id, s.game_spec_id, s.time_class,
       s.rating, s.source_ref, COALESCE(s.published_at, s.created_at) AS published_at
     FROM bot_rating_snapshots s JOIN bot_profiles b ON b.id = s.bot_id
     WHERE s.published = true AND b.owner_type = 'system' AND b.visibility = 'public'
       AND s.game_spec_id = ANY(b.supported_game_spec_ids)
     ORDER BY s.bot_id, s.game_spec_id, s.time_class,
       s.published_at DESC NULLS LAST, s.created_at DESC, s.id DESC`);
  const latest = stored.map((row) => ({
    botId: row.bot_id,
    engineId: firstPartyBotEngineFor(row.bot_id, row.game_spec_id) ?? row.active_engine_id,
    gameSpecId: row.game_spec_id,
    timeClass: row.time_class,
    rating: row.rating,
    sourceRef: row.source_ref,
    publishedAt: new Date(row.published_at),
  }));
  const rows: EngineEloGameRow[] = [];
  for (const plan of plans) {
    if (!plan.anchorEngineId || plan.forcedPairing || plan.calibrationRatio <= 0) continue;
    rows.push(
      ...(await loadRatedEngineEloRows(db, {
        variant: plan.variant,
        timeControlBucket: 'untimed',
        calibrationOnly: true,
      })),
    );
  }
  const pins = loadBotRatingPins(
    plans.flatMap((plan) => [
      ...plan.ladder,
      ...(plan.anchorEngineId ? [plan.anchorEngineId] : []),
    ]),
  );
  const refresh = buildCalibrationRatingRefresh({ rows, plans, bots, latest, pins, now });
  if (publish) await insertBotRatingSnapshotDraftsOn(db, refresh.drafts);
  return refresh;
}
