import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import {
  loadBotRatingPins,
  readBotRatingStamp,
  stampBotRatingSourceRef,
} from './bot-rating-provenance.js';
import {
  buildCalibrationRatingRefresh,
  type LatestCalibrationRating,
  refreshCalibrationBotRatings,
} from './bot-rating-refresh.js';
import { botVsBotConfigFromEnv } from './bot-vs-bot-scheduler.js';
import type { EngineEloGameRow } from './engine-elo-report.js';

const engineId = 'pikafish-xiangqi-level-8';
const anchor = 'random-legal-xiangqi';
const pins = loadBotRatingPins([engineId, anchor]);
const sourceRef = stampBotRatingSourceRef('engine-elo', pins);
const now = new Date('2026-11-13T18:00:00Z');
const plans = botVsBotConfigFromEnv({ MISTBOARD_BOT_VS_BOT_VARIANTS: 'xiangqi' }).plans;
const bots = [{ id: 'pikafish', activeEngineId: engineId, defaultGameSpecId: 'xiangqi' }];
const previous: LatestCalibrationRating = {
  botId: 'pikafish',
  engineId,
  gameSpecId: 'xiangqi',
  timeClass: 'blitz',
  rating: 1600,
  sourceRef,
  publishedAt: new Date('2026-11-01T18:00:00Z'),
};

function games(n = 256): EngineEloGameRow[] {
  return Array.from({ length: n }, (_, i) => ({
    anchorEngineId: anchor,
    whiteEngineId: i % 2 ? anchor : engineId,
    blackEngineId: i % 2 ? engineId : anchor,
    gameId: `game-${i}`,
    jobId: 'calibration',
    result: 'red-wins',
    status: 'completed',
    termination: 'checkmate',
    timeControl: { kind: 'none' },
    tournamentId: null,
    variant: 'xiangqi',
    stamps: {
      white: { recipe: pins.recipe, netSha256: pins.nets[i % 2 ? anchor : engineId]! },
      black: { recipe: pins.recipe, netSha256: pins.nets[i % 2 ? engineId : anchor]! },
    },
  }));
}

function fit(rows = games(), latest = [previous]) {
  return buildCalibrationRatingRefresh({ rows, latest, bots, plans, pins, now });
}

test('only games with both current worker stamps enter the fit; old and absent stamps cannot inflate precision', () => {
  const current = games(8); // Too few on the new build, however many old games exist.
  const old = games().map((row) => ({
    ...row,
    stamps: {
      white: { ...row.stamps!.white, recipe: 'engines-000000000000' },
      black: row.stamps!.black,
    },
  }));
  const absent = games().map((row) => ({ ...row, stamps: null }));
  const wrongNet = games().map((row) => ({
    ...row,
    stamps: {
      white: row.stamps!.white,
      black: { ...row.stamps!.black, netSha256: 'f'.repeat(64) },
    },
  }));
  for (const planted of [old, absent, wrongNet]) {
    assert.equal(
      fit([...current, ...planted], [{ ...previous, sourceRef: null }]).drafts.length,
      0,
    );
  }
  const accepted = fit([...games(), ...old, ...absent, ...wrongNet]);
  assert.equal(accepted.drafts.length, 1);
  assert.equal(accepted.drafts[0]!.games, 256);
  assert.equal(accepted.drafts[0]!.rating, 1500);
});

test('95% interval above 50 Elo blocks publication even when a snapshot is stale', () => {
  assert.equal(fit(games(180), [{ ...previous, sourceRef: null }]).drafts.length, 0);
  assert.equal(fit(games(256), [{ ...previous, sourceRef: null }]).drafts.length, 1);
});

test('unrounded interval controls the precision gate', () => {
  // 184 balanced games yield a Wilson half-width just over 50 (rounds to 50).
  assert.equal(fit(games(184), [{ ...previous, sourceRef: null }]).drafts.length, 0);
});

test('movement over 200 Elo holds, on the same build or a new one; a stale rating within 200 refreshes', () => {
  const held = fit(games(), [{ ...previous, rating: 1800 }]);
  assert.equal(held.drafts.length, 0);
  assert.equal(held.heldRatings.length, 1);
  assert.equal(held.heldRatings[0]!.estimatedRating, 1500);
  assert.equal(held.heldRatings[0]!.previousRating, 1800);
  assert.equal(fit(games(), [{ ...previous, rating: 1700 }]).drafts.length, 1);
  // A stale baseline is the case right after a pin bump, where a wrong fit would
  // publish unreviewed; the big move waits for a person like any other.
  const staleHeld = fit(games(), [{ ...previous, rating: 1800, sourceRef: null }]);
  assert.equal(staleHeld.drafts.length, 0);
  assert.equal(staleHeld.heldRatings.length, 1);
  assert.equal(fit(games(), [{ ...previous, rating: 1650, sourceRef: null }]).drafts.length, 1);
});

test('current measurements need seven days and movement exceeding the new interval', () => {
  assert.equal(fit(games(), [{ ...previous, publishedAt: now }]).drafts.length, 0);
  assert.equal(fit(games(), [{ ...previous, rating: 1520 }]).drafts.length, 0);
  assert.equal(
    fit(games(), [{ ...previous, publishedAt: new Date(now.getTime() - 7 * 86400000) }]).drafts
      .length,
    1,
  );
  assert.equal(fit(games(), [{ ...previous, sourceRef: null, publishedAt: now }]).drafts.length, 1);
});

test('non-calibration plans and wrong anchors never produce a snapshot', () => {
  assert.equal(fit(games(), []).drafts.length, 0, 'a refresh needs a published baseline');
  for (const change of [
    { anchorEngineId: null },
    { calibrationRatio: 0 },
    {
      forcedPairing: { redEngineId: engineId, blackEngineId: engineId },
    },
  ]) {
    assert.deepEqual(
      buildCalibrationRatingRefresh({
        rows: games(),
        latest: [previous],
        bots,
        plans: [{ ...plans[0]!, ...change }],
        pins,
        now,
      }).drafts,
      [],
    );
  }
  assert.equal(
    fit(games().map((row) => ({ ...row, anchorEngineId: 'another-floor' }))).drafts.length,
    0,
  );
});

function fakeDb(rating: number, stale = false) {
  const inserts: unknown[][] = [];
  const db = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT INTO bot_rating_snapshots')) {
        assert.match(sql, /'eve-anchor'/);
        inserts.push(values!);
        return { rows: [] };
      }
      if (sql.includes('FROM bot_profiles'))
        return {
          rows: [{ id: 'pikafish', active_engine_id: engineId, default_game_spec_id: 'xiangqi' }],
        };
      if (sql.includes('FROM bot_rating_snapshots s'))
        return {
          rows: [
            {
              bot_id: 'pikafish',
              active_engine_id: engineId,
              game_spec_id: 'xiangqi',
              time_class: 'blitz',
              rating,
              source_ref: stale ? null : sourceRef,
              published_at: previous.publishedAt,
            },
          ],
        };
      if (sql.includes('FROM eve_games')) {
        assert.match(sql, /rating_policy'->>'rated' = 'true'/);
        assert.match(sql, /job.config->>'source' = 'bot-vs-bot-scheduler'/);
        assert.match(sql, /job.config->>'lane' = 'calibration'/);
        assert.equal(values?.[3], true);
        return {
          rows:
            values?.[2] === 'xiangqi'
              ? games().map((row) => ({
                  white_engine_id: row.whiteEngineId,
                  black_engine_id: row.blackEngineId,
                  game_id: row.gameId,
                  job_id: row.jobId,
                  result: row.result,
                  status: row.status,
                  termination: row.termination,
                  time_control: row.timeControl,
                  tournament_id: null,
                  anchor_engine_id: anchor,
                  variant: row.variant,
                  stamps: row.stamps,
                }))
              : [],
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  } as unknown as Pick<pg.Pool, 'query'>;
  return { db, inserts };
}

test('qualifying calibration writes through the import path with round-trippable lane and stamps', async () => {
  const { db, inserts } = fakeDb(1600);
  const refresh = await refreshCalibrationBotRatings(db, now, true);
  assert.equal(refresh.drafts.length, 1);
  assert.equal(inserts.length, 1);
  const ref = inserts[0]![6] as string;
  assert.match(ref, /(?:^|;)lane=calibration;/);
  assert.match(ref, /anchor=random-legal-xiangqi;anchorRating=1500;/);
  assert.deepEqual(readBotRatingStamp(ref, engineId), {
    recipe: pins.recipe,
    netSha256: pins.nets[engineId],
  });
  assert.equal(inserts[0]![7], true);
  assert.equal(inserts[0]![5], 256);
});

test('held moves never write a snapshot; dry runs never write even when qualifying', async () => {
  const held = fakeDb(1800);
  const result = await refreshCalibrationBotRatings(held.db, now, true);
  assert.equal(result.heldRatings.length, 1);
  assert.equal(held.inserts.length, 0);
  const dry = fakeDb(1600, true);
  assert.equal((await refreshCalibrationBotRatings(dry.db, now, false)).drafts.length, 1);
  assert.equal(dry.inserts.length, 0);
});
