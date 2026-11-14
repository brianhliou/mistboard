// Push-only transaction adapter. No request headers or credential values cross
// this boundary; writer diagnostics contain board data and a constant source.
import type {
  XiangqiBroadcastBoard,
  XiangqiBroadcastPlayerTag,
  XiangqiMove,
} from '@mistboard/game';
import { withTransaction } from './persistence-db.js';
import {
  applyXiangqiBroadcastBoardUpdateOn,
  listXiangqiBroadcastBoards,
  listXiangqiBroadcastRounds,
} from './persistence-xiangqi-broadcasts.js';

export type PushGame = {
  round: number | string;
  board: number;
  red?: XiangqiBroadcastPlayerTag;
  black?: XiangqiBroadcastPlayerTag;
  moves: XiangqiMove[];
  status: 'live' | 'finished';
  result: XiangqiBroadcastBoard['result'];
  seq?: number;
  clock?: XiangqiBroadcastBoard['clock'];
  timeControl?: string;
};
export type PushFailure = {
  ok: false;
  error: string;
  message: string;
  ply?: number;
  move?: string;
};
export type PushApplied = {
  ok: true;
  changed: boolean;
  corrected: boolean;
  stale: boolean;
  board: {
    id: string;
    round: string;
    board: number;
    plies: number;
    status: 'live' | 'finished';
    result: XiangqiBroadcastBoard['result'];
  };
};

/** Canonical limiter key for numeric rounds and either returned id spelling. */
export function broadcastPushRoundKey(tourSlug: string, round: number | string): string {
  if (typeof round === 'number') return `${tourSlug}-r${round}`;
  return /^r[1-9]\d*$/.test(round) ? `${tourSlug}-${round}` : round;
}

export async function applyBroadcastPushGame(
  tourSlug: string,
  game: PushGame,
): Promise<PushApplied | PushFailure> {
  return withTransaction(async (client) => {
    const fail = (error: string, message: string): PushFailure => ({ ok: false, error, message });
    const { rows: tours } = await client.query<{ source_url: string | null; poll_mode: string }>(
      'SELECT source_url, poll_mode FROM xiangqi_broadcast_tours WHERE slug = $1 FOR SHARE',
      [tourSlug],
    );
    if (!tours[0]) return fail('unauthorized', 'The token event no longer exists.');
    if (tours[0].source_url !== null && tours[0].poll_mode !== 'off')
      return fail('event_not_pushable', 'The event is filled from another source.');
    const publicRound =
      typeof game.round === 'number'
        ? `r${game.round}`
        : game.round.startsWith(`${tourSlug}-r`) &&
            /^r[1-9]\d*$/.test(game.round.slice(tourSlug.length + 1))
          ? game.round.slice(tourSlug.length + 1)
          : game.round;
    // Existing schema uses a GLOBAL round primary key, whereas the push API
    // numbers rounds within an event. Scope only the stored key, keeping the
    // public numeric-round identifier and board URL promised by the guide.
    let roundId = typeof game.round === 'number' ? `${tourSlug}-${publicRound}` : game.round;
    let { rows: rounds } = await client.query<{ id: string; tour_slug: string }>(
      'SELECT id, tour_slug FROM xiangqi_broadcast_rounds WHERE id = $1',
      [roundId],
    );
    // The public rN returned from a numbered push is also a usable round id.
    // Prefer an actual existing id; otherwise resolve the event-scoped alias.
    if (!rounds[0] && typeof game.round === 'string' && /^r[1-9]\d*$/.test(game.round)) {
      roundId = broadcastPushRoundKey(tourSlug, game.round);
      ({ rows: rounds } = await client.query<{ id: string; tour_slug: string }>(
        'SELECT id, tour_slug FROM xiangqi_broadcast_rounds WHERE id = $1',
        [roundId],
      ));
    }
    if (
      (typeof game.round === 'string' && !rounds[0]) ||
      (rounds[0] && rounds[0].tour_slug !== tourSlug)
    )
      return fail('invalid_body', 'round must name an existing round of this event.');
    const sourceBoardId = `${publicRound}-b${String(game.board).padStart(2, '0')}`;
    const id = `${tourSlug}-${sourceBoardId}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]);
    const { rows: existing } = await client.query<{
      tour_slug: string;
      round_id: string;
      red: XiangqiBroadcastPlayerTag;
      black: XiangqiBroadcastPlayerTag;
    }>(
      'SELECT tour_slug, round_id, red, black FROM xiangqi_broadcast_boards WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (existing[0] && (existing[0].tour_slug !== tourSlug || existing[0].round_id !== roundId))
      return fail('invalid_body', 'round and board collide with an existing game.');
    const red = game.red ?? existing[0]?.red;
    const black = game.black ?? existing[0]?.black;
    if (!red || !black)
      return fail('invalid_body', 'red and black are required on the first post.');
    if (!rounds[0]) {
      const round = {
        schema: 'mistboard.xiangqi.broadcast.v1',
        id: roundId,
        tourSlug,
        name: `Round ${game.round}`,
      };
      await client.query(
        `INSERT INTO xiangqi_broadcast_rounds (id, tour_slug, name, payload) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (id) DO NOTHING`,
        [roundId, tourSlug, round.name, JSON.stringify(round)],
      );
    }
    const board: XiangqiBroadcastBoard = {
      schema: 'mistboard.xiangqi.broadcast.v1',
      id,
      tourSlug,
      roundId,
      sourceBoardId,
      boardNumber: game.board,
      red,
      black,
      moves: game.moves,
      status: game.status === 'finished' ? 'complete' : 'live',
      result: game.result,
      ...(game.clock ? { clock: game.clock } : {}),
      ...(game.timeControl !== undefined ? { details: { timeControl: game.timeControl } } : {}),
    };
    const applied = await applyXiangqiBroadcastBoardUpdateOn(client, board, {
      push: { seq: game.seq },
      allowTakeback: true,
      allowCorrection: true,
      source: 'broadcast-push',
    });
    if (!applied.ok)
      return fail(
        applied.kind === 'event_not_pushable' ? applied.kind : 'invalid_body',
        'The game could not be saved.',
      );
    // Re-read the authoritative result: stale and sticky-finished posts can
    // legitimately differ from the incoming snapshot.
    const { rows } = await client.query<{
      status: 'live' | 'complete' | 'scheduled';
      result: XiangqiBroadcastBoard['result'];
      ply_count: number;
    }>('SELECT status, result, ply_count FROM xiangqi_broadcast_boards WHERE id = $1', [id]);
    const saved = rows[0]!;
    return {
      ok: true,
      changed: applied.status !== 'unchanged',
      corrected: applied.status === 'corrected',
      stale: applied.stale ?? false,
      board: {
        id,
        round: publicRound,
        board: game.board,
        plies: saved.ply_count,
        status: saved.status === 'complete' ? 'finished' : 'live',
        result: saved.result,
      },
    };
  });
}

export async function broadcastPushStatus(tourSlug: string) {
  const rounds = await listXiangqiBroadcastRounds(tourSlug);
  return {
    rounds: await Promise.all(
      rounds.map(async (round) => ({
        id: round.id,
        name: round.name,
        boards: (await listXiangqiBroadcastBoards(round.id)).map((board) => ({
          id: board.id,
          board: board.boardNumber,
          plies: board.plyCount,
          status: board.status === 'complete' ? 'finished' : 'live',
          result: board.result,
        })),
      })),
    ),
  };
}
