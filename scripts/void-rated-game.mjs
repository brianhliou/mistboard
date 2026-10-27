#!/usr/bin/env node
// Void one rated game: undo what it did to both players' ratings and mark the
// game unrated, as if it had been played casual. For a rated game that should
// never have rated (2026-10-26: a stats-excluded account rated an XMJ match).
// Without --yes it only shows what would change; with it, one transaction:
//
//   user_ratings       each player's row in the game's bucket goes back to its
//                      pre-game state (deleted when this was its only rated
//                      game, so the player is back on the 1500 default)
//   game_participants  elo_before/elo_after/rd_before/rd_after cleared on both
//                      seats, so no profile, history or achievement reads it
//   games              rated = false
//
//   node scripts/void-rated-game.mjs <roomId>                  # show it, change nothing
//   node scripts/void-rated-game.mjs <roomId> --yes            # void it
//   node scripts/void-rated-game.mjs <roomId> --yes --allow-later
//
// Against production, through the SSH tunnel wrapper (CLAUDE.md, prod:db):
//
//   npm run prod:db -- node scripts/void-rated-game.mjs <roomId>
//
// A player with a later rated game in the same bucket has a rating built on
// top of this one, so the exact restore would also erase that later game. The
// script refuses then. --allow-later instead takes this game's own swing
// (elo_after - elo_before) off the current rating and one game off the count,
// leaving RD as it is: an approximation, said so in the output. The same
// applies when the current row no longer matches this game's elo_after.
//
// Volatility before the game is not stored anywhere, so a restored row (one
// that had earlier games) keeps its current volatility; the change from one
// game is small. A first-rated-game achievement earned from this game is not
// revoked: the player did play the game. Running it twice does nothing the
// second time and says so.
//
// Needs a server build (npm run build --workspace @mistboard/server) for the
// bucket rule.

import { parseArgs } from 'node:util';
import pg from 'pg';
import { bucketForGame } from '../apps/server/dist/rating-buckets.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    yes: { type: 'boolean', default: false },
    'allow-later': { type: 'boolean', default: false },
  },
});

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const roomId = positionals[0];
if (!roomId || positionals.length > 1) {
  fail('Usage: node scripts/void-rated-game.mjs <roomId> [--yes] [--allow-later]');
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('DATABASE_URL is not set.');

const sameBucket = (a, b) => a && b && a.variant === b.variant && a.timeClass === b.timeClass;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let exitCode = 0;
try {
  // Read and write in one transaction, rows locked when writing, so the plan
  // shown is the plan applied. A dry run rolls back.
  await client.query('BEGIN');
  const lock = values.yes ? 'FOR UPDATE' : '';
  const gameResult = await client.query(
    `SELECT room_id, variant, mode, rated, initial_ms, increment_ms, ended_at, result
     FROM games WHERE room_id = $1 ${lock}`,
    [roomId],
  );
  if (gameResult.rowCount === 0) throw new Error(`No game ${roomId}.`);
  const game = gameResult.rows[0];
  const seats = (
    await client.query(
      `SELECT p.color, p.subject_id, p.display_name, u.handle,
              p.elo_before, p.elo_after, p.rd_before, p.rd_after
       FROM game_participants p
       LEFT JOIN users u ON u.id = p.subject_id
       WHERE p.game_id = $1 AND p.subject_type = 'user'
       ORDER BY p.color ${lock ? 'FOR UPDATE OF p' : ''}`,
      [roomId],
    )
  ).rows;

  const bucket = bucketForGame({
    variant: game.variant,
    initialMs: game.initial_ms,
    incrementMs: game.increment_ms,
  });
  console.log(
    JSON.stringify({
      roomId: game.room_id,
      variant: game.variant,
      mode: game.mode,
      rated: game.rated,
      pace: `${game.initial_ms / 1000}+${game.increment_ms / 1000}`,
      endedAt: game.ended_at,
      result: game.result,
      bucket,
      players: seats.map((s) => ({
        color: s.color,
        handle: s.handle,
        eloBefore: s.elo_before,
        eloAfter: s.elo_after,
      })),
    }),
  );

  const moved = seats.filter((s) => s.elo_after !== null);
  if (moved.length === 0 && game.rated !== true) {
    console.log('Already void: the game is unrated and moved no rating. Nothing to change.');
    await client.query('ROLLBACK');
  } else {
    if (moved.length > 0 && !bucket) {
      throw new Error(
        `The game moved ratings but no rating bucket matches ${game.variant} at this pace today; refusing to guess the pool.`,
      );
    }

    const plans = [];
    const refusals = [];
    for (const seat of moved) {
      const row = (
        await client.query(
          `SELECT elo_rating, rating_deviation, volatility, games_played, last_rated_at
           FROM user_ratings WHERE user_id = $1 AND variant = $2 AND time_class = $3 ${lock}`,
          [seat.subject_id, bucket.variant, bucket.timeClass],
        )
      ).rows[0];
      // Every other rated game of this player, to find later ones in the bucket
      // and the previous one (its end time becomes last_rated_at again).
      const others = (
        await client.query(
          `SELECT g.room_id, g.variant, g.initial_ms, g.increment_ms, g.ended_at
           FROM game_participants p JOIN games g ON g.room_id = p.game_id
           WHERE p.subject_type = 'user' AND p.subject_id = $1 AND g.room_id <> $2
             AND g.mode = 'pvp' AND COALESCE(g.rated, false) AND p.elo_after IS NOT NULL
           ORDER BY g.ended_at`,
          [seat.subject_id, roomId],
        )
      ).rows.filter((g) =>
        sameBucket(
          bucketForGame({
            variant: g.variant,
            initialMs: g.initial_ms,
            incrementMs: g.increment_ms,
          }),
          bucket,
        ),
      );
      const later = others.filter((g) => g.ended_at >= game.ended_at);
      const earlier = others.filter((g) => g.ended_at < game.ended_at);
      const current = row
        ? {
            rating: row.elo_rating,
            rd: row.rating_deviation,
            volatility: Number(row.volatility),
            gamesPlayed: row.games_played,
          }
        : null;

      let reason = null;
      if (!current) reason = 'has no rating row in the bucket (reset since?)';
      else if (later.length > 0)
        reason = `has ${later.length} later rated game(s) in this bucket (${later
          .slice(0, 3)
          .map((g) => g.room_id)
          .join(', ')}${later.length > 3 ? ', ...' : ''}), so the exact restore would erase them`;
      else if (current.rating !== seat.elo_after)
        reason = `current rating ${current.rating} is not this game's elo_after ${seat.elo_after}`;

      let restored;
      let action;
      if (reason === null) {
        if (current.gamesPlayed <= 1) {
          action = 'delete';
          restored = { rating: 1500, rd: 350, volatility: 0.06, gamesPlayed: 0, note: 'default' };
        } else {
          action = 'restore';
          restored = {
            rating: seat.elo_before,
            rd: seat.rd_before,
            volatility: current.volatility,
            gamesPlayed: current.gamesPlayed - 1,
            lastRatedAt: earlier.at(-1)?.ended_at ?? row.last_rated_at,
            note: 'volatility kept (pre-game value not stored)',
          };
        }
      } else if (values['allow-later'] && current) {
        action = 'shift';
        restored = {
          rating: current.rating - (seat.elo_after - seat.elo_before),
          rd: current.rd,
          volatility: current.volatility,
          gamesPlayed: Math.max(current.gamesPlayed - 1, 0),
          lastRatedAt: row.last_rated_at,
          note: `approximate: this game's swing ${seat.elo_after - seat.elo_before} taken off; RD and volatility kept`,
        };
      } else {
        refusals.push(`@${seat.handle ?? seat.subject_id} ${reason}`);
      }
      plans.push({ seat, current, restored, action, reason });
      console.log(
        JSON.stringify({
          player: seat.handle ?? seat.subject_id,
          color: seat.color,
          current,
          restored: restored ?? null,
          action: action ?? 'refused',
          ...(reason ? { reason } : {}),
        }),
      );
    }

    const achievements = (
      await client.query(
        `SELECT user_id, achievement_id FROM user_achievements
         WHERE source_kind = 'game' AND source_id = $1`,
        [roomId],
      )
    ).rows;
    if (achievements.length > 0) {
      console.log(
        `Kept (not revoked): ${achievements.map((a) => `${a.achievement_id} for ${a.user_id}`).join(', ')}.`,
      );
    }

    if (refusals.length > 0) {
      await client.query('ROLLBACK');
      console.error(
        `Refused: ${refusals.join('; ')}. Pass --allow-later to take only this game's swing off the current rating instead. Nothing changed.`,
      );
      exitCode = 2;
    } else if (!values.yes) {
      await client.query('ROLLBACK');
      console.log('Nothing changed. Pass --yes to void it.');
    } else {
      for (const { seat, restored, action } of plans) {
        if (action === 'delete') {
          await client.query(
            'DELETE FROM user_ratings WHERE user_id = $1 AND variant = $2 AND time_class = $3',
            [seat.subject_id, bucket.variant, bucket.timeClass],
          );
        } else {
          await client.query(
            `UPDATE user_ratings
             SET elo_rating = $4, rating_deviation = $5, games_played = $6,
                 last_rated_at = $7, updated_at = now()
             WHERE user_id = $1 AND variant = $2 AND time_class = $3`,
            [
              seat.subject_id,
              bucket.variant,
              bucket.timeClass,
              Math.round(restored.rating),
              restored.rd,
              restored.gamesPlayed,
              restored.lastRatedAt,
            ],
          );
        }
      }
      await client.query(
        `UPDATE game_participants
         SET elo_before = NULL, elo_after = NULL, rd_before = NULL, rd_after = NULL
         WHERE game_id = $1`,
        [roomId],
      );
      await client.query('UPDATE games SET rated = false WHERE room_id = $1', [roomId]);
      await client.query('COMMIT');
      console.log(
        `Voided ${roomId}: ${plans.map((p) => `@${p.seat.handle ?? p.seat.subject_id} ${p.action}`).join(', ') || 'no rating rows'}; game marked unrated.`,
      );
    }
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  await client.end();
}
process.exit(exitCode);
