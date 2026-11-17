#!/usr/bin/env node
// Owner-only maintenance, never part of a release:
// npm run prod:db -- node scripts/hide-smoke-games.mjs [--yes]
// The normal seat-assigned events and room_seat_tokens retain client ids even
// when game_participants only records a guest's device id. Require that evidence;
// the a1/two-ply fingerprint alone could also describe a real guest's game.
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { RELEASE_SMOKE_CORPUS_ID } from '../apps/server/src/persistence-counted-games.ts';
import { isReleaseSmokeClientId } from '../apps/server/src/release-smoke.ts';

export const CANDIDATES_SQL = `
  SELECT g.room_id, g.variant, g.mode, g.status, g.ply_count, g.ended_at,
    EXISTS (SELECT 1 FROM room_seat_tokens t
            WHERE t.room_id = g.room_id AND t.user_id IS NOT NULL) AS has_account_seat,
    (SELECT jsonb_agg(jsonb_build_object(
      'subjectType', p.subject_type, 'color', p.color,
      'clientIds', (SELECT jsonb_agg(DISTINCT ids.client_id) FROM (
        SELECT t.client_id FROM room_seat_tokens t
          WHERE t.room_id = g.room_id AND t.seat = p.color
        UNION
        SELECT e.payload->>'clientId' FROM events e
          WHERE e.room_id = g.room_id AND e.type = 'seat-assigned'
            AND e.payload->>'seat' = p.color
        UNION
        SELECT CASE p.color WHEN 'black' THEN g.black_client
                            WHEN 'white' THEN g.white_client END
      ) ids WHERE ids.client_id IS NOT NULL)))
     FROM game_participants p WHERE p.game_id = g.room_id) AS participants
  FROM games g
  WHERE g.status = 'completed' AND g.mode = 'pve' AND g.ply_count BETWEEN 0 AND 2
    AND NOT (g.visibility = 'private' AND g.corpus_id IS NOT DISTINCT FROM $1)
  ORDER BY g.ended_at, g.room_id`;

export function selectSmokeGames(games) {
  return games.filter((game) => {
    if (game.status !== 'completed' || game.mode !== 'pve' || game.has_account_seat !== false)
      return false;
    if (!Number.isInteger(game.ply_count) || game.ply_count < 0 || game.ply_count > 2) return false;
    const seats = game.participants;
    if (!Array.isArray(seats) || seats.length < 2) return false;
    const guests = seats.filter((seat) => seat.subjectType === 'guest');
    return (
      guests.length === 1 &&
      seats.every((seat) => ['guest', 'bot', 'engine-version'].includes(seat.subjectType)) &&
      Array.isArray(guests[0].clientIds) &&
      guests[0].clientIds.length > 0 &&
      guests[0].clientIds.every(isReleaseSmokeClientId)
    );
  });
}

export async function hideSmokeGames(client, { yes = false, print = console.log } = {}) {
  await client.query(yes ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const { rows } = await client.query(`${CANDIDATES_SQL}${yes ? ' FOR UPDATE OF g' : ''}`, [
      RELEASE_SMOKE_CORPUS_ID,
    ]);
    const selected = selectSmokeGames(rows);
    for (const game of selected)
      print(
        JSON.stringify({
          roomId: game.room_id,
          variant: game.variant,
          plies: game.ply_count,
          endedAt: game.ended_at,
        }),
      );
    if (yes && selected.length > 0) {
      const ids = selected.map((game) => game.room_id);
      await client.query(
        `UPDATE games SET visibility = 'private', corpus_id = $2 WHERE room_id = ANY($1::text[])`,
        [ids, RELEASE_SMOKE_CORPUS_ID],
      );
      await client.query(
        `UPDATE game_participants SET visibility = 'private' WHERE game_id = ANY($1::text[])`,
        [ids],
      );
    }
    await client.query('COMMIT');
    print(
      `${yes ? 'Hidden' : 'Dry run:'} ${selected.length} smoke games${yes ? '' : '; pass --yes to apply'}`,
    );
    return selected.map((game) => game.room_id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--yes')) throw new Error('Usage: hide-smoke-games.mjs [--yes]');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await hideSmokeGames(client, { yes: args.includes('--yes') });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(
      'hide-smoke-games failed; transaction rolled back; check the database connection and schema',
    );
    process.exitCode = 1;
  });
}
