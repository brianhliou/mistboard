import type { Color, GameEvent } from '@mistboard/game';
import { getBuildInfo } from './build-info.js';
import { getPool } from './persistence-db.js';

export type PersistedRoomEvent = {
  type: string;
  roomId: string;
};

export type GameMode = 'pvp' | 'pve' | 'eve' | 'imported' | 'manual';
export type GameTermination =
  | 'king-captured'
  | 'general-captured'
  | 'timeout'
  | 'checkmate'
  | 'draw'
  | 'resignation'
  | 'engine-failure'
  | 'worker-aborted'
  | 'server-restarted'
  | 'abandoned'
  | 'abandonment'
  | 'no-legal-moves'
  | 'stalemate'
  | 'repetition'
  | 'progress-clock'
  | 'truncated'
  | 'race'
  | 'chasing'
  | 'dead-position';
export type GameReviewStatus = 'unreviewed' | 'flagged' | 'reviewed' | 'training' | 'rejected';
export type GameVisibility = 'private' | 'link' | 'unlisted' | 'public';

export type RunningGameSummary = {
  variant: string;
  mode: GameMode;
  startedAt: Date;
  whiteClient: string | null;
  blackClient: string | null;
  whiteName: string | null;
  blackName: string | null;
  corpusId: string | null;
  region?: string | null;
  reviewStatus?: GameReviewStatus;
  visibility?: GameVisibility;
};

/**
 * Artifact type written per move by LIVE PvE (room-manager's
 * `recordLiveEngineDecisionArtifact`) and requestable through the review
 * artifacts API (routes/games.ts). Writer and reader share this constant on
 * purpose: they previously agreed on the string by coincidence, drifted, and
 * every live PvE artifact became unreachable without anything failing loudly
 * (#287).
 */
export const LIVE_ENGINE_DECISION_ARTIFACT_TYPE = 'live-engine-decision';

export type GameDebugArtifactSummary = {
  artifactType: string;
  count: number;
  engineColors: Color[];
  minPly: number | null;
  maxPly: number | null;
  snapshotKinds: string[];
};

export type GameDebugArtifactPayload = {
  id: number;
  gameId: string;
  ply: number | null;
  engineColor: Color | null;
  artifactType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type GameDebugArtifactInput = {
  artifactType: string;
  engineColor?: Color | null;
  gameId: string;
  payload: Record<string, unknown>;
  ply?: number | null;
};

export type StalePausedFinalizeRecord = {
  roomId: string;
  mode: GameMode;
  startedAt: Date;
  pauseSeq: number;
  pausedAtMs: number;
  pauseReason: string | null;
  plyCount: number;
};

export type RoomLifecycleAuditInput = {
  roomId?: string | null;
  kind: string;
  atMs?: number | null;
  eventSeq?: number | null;
  payload?: Record<string, unknown>;
};

export type RoomLifecycleAuditRecord = {
  id: number;
  roomId: string | null;
  kind: string;
  occurredAt: Date;
  atMs: number | null;
  eventSeq: number | null;
  buildRevision: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type RoomLifecycleTimelineEvent = {
  seq: number;
  type: string;
  atMs: number | null;
  reason: string | null;
  createdAt: Date;
};

export type RoomLifecycleTimeline = {
  roomId: string;
  game: {
    mode: GameMode;
    status: 'running' | 'completed' | 'aborted';
    result: string | null;
    termination: GameTermination | null;
    startedAt: Date;
    endedAt: Date | null;
    plyCount: number;
    visibility: GameVisibility;
  } | null;
  events: RoomLifecycleTimelineEvent[];
  audit: RoomLifecycleAuditRecord[];
};

export async function recordRoomLifecycleAudit(input: RoomLifecycleAuditInput): Promise<void> {
  const atMs = typeof input.atMs === 'number' && Number.isFinite(input.atMs) ? input.atMs : null;
  const payload = input.payload ?? {};
  await getPool().query(
    `INSERT INTO room_lifecycle_audit
       (room_id, kind, occurred_at, at_ms, event_seq, build_revision, payload)
     VALUES ($1, $2, COALESCE(to_timestamp($3::double precision / 1000.0), now()), $3, $4, $5, $6)`,
    [
      input.roomId ?? null,
      input.kind,
      atMs,
      input.eventSeq ?? null,
      getBuildInfo().revision,
      payload,
    ],
  );
}

export async function listRoomLifecycleAudit(
  options: { roomId?: string | null; limit?: number } = {},
): Promise<RoomLifecycleAuditRecord[]> {
  const limit =
    typeof options.limit === 'number' && Number.isInteger(options.limit)
      ? Math.min(Math.max(options.limit, 1), 500)
      : 100;
  const { rows } = await getPool().query<{
    id: string;
    room_id: string | null;
    kind: string;
    occurred_at: Date;
    at_ms: string | null;
    event_seq: number | null;
    build_revision: string | null;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, room_id, kind, occurred_at, at_ms, event_seq, build_revision, payload, created_at
     FROM room_lifecycle_audit
     WHERE ($1::text IS NULL OR room_id = $1)
     ORDER BY occurred_at DESC, id DESC
     LIMIT $2`,
    [options.roomId ?? null, limit],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    roomId: row.room_id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    atMs: row.at_ms === null ? null : Number(row.at_ms),
    eventSeq: row.event_seq,
    buildRevision: row.build_revision,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}

// Server-wide audit rows of the given kinds since a moment, oldest first: the
// deploy history reads drains, shutdowns and the resumes that followed them.
export async function listRoomLifecycleAuditByKinds(
  kinds: readonly string[],
  sinceMs: number,
  limit = 2000,
): Promise<RoomLifecycleAuditRecord[]> {
  const { rows } = await getPool().query<{
    id: string;
    room_id: string | null;
    kind: string;
    occurred_at: Date;
    at_ms: string | null;
    event_seq: number | null;
    build_revision: string | null;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, room_id, kind, occurred_at, at_ms, event_seq, build_revision, payload, created_at
     FROM room_lifecycle_audit
     WHERE kind = ANY($1::text[]) AND occurred_at >= to_timestamp($2::double precision / 1000.0)
     ORDER BY occurred_at ASC, id ASC
     LIMIT $3`,
    [kinds, sinceMs, limit],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    roomId: row.room_id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    atMs: row.at_ms === null ? null : Number(row.at_ms),
    eventSeq: row.event_seq,
    buildRevision: row.build_revision,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}

export async function getRoomLifecycleTimeline(
  roomId: string,
  options: { auditLimit?: number } = {},
): Promise<RoomLifecycleTimeline> {
  const gameResult = await getPool().query<{
    mode: GameMode;
    status: 'running' | 'completed' | 'aborted';
    result: string | null;
    termination: GameTermination | null;
    started_at: Date;
    ended_at: Date | null;
    ply_count: number;
    visibility: GameVisibility;
  }>(
    `SELECT mode, status, result, termination, started_at, ended_at, ply_count, visibility
     FROM games
     WHERE room_id = $1
     LIMIT 1`,
    [roomId],
  );
  const eventResult = await getPool().query<{
    seq: number;
    type: string;
    at_ms: string | null;
    reason: string | null;
    created_at: Date;
  }>(
    `SELECT seq, type, payload->>'at' AS at_ms, payload->>'reason' AS reason, created_at
     FROM events
     WHERE room_id = $1
     ORDER BY seq ASC`,
    [roomId],
  );
  const gameRow = gameResult.rows[0] ?? null;
  return {
    roomId,
    game: gameRow
      ? {
          mode: gameRow.mode,
          status: gameRow.status,
          result: gameRow.result,
          termination: gameRow.termination,
          startedAt: gameRow.started_at,
          endedAt: gameRow.ended_at,
          plyCount: gameRow.ply_count,
          visibility: gameRow.visibility,
        }
      : null,
    events: eventResult.rows.map((row) => ({
      seq: row.seq,
      type: row.type,
      atMs: row.at_ms === null ? null : Number(row.at_ms),
      reason: row.reason,
      createdAt: row.created_at,
    })),
    audit: await listRoomLifecycleAudit({ roomId, limit: options.auditLimit }),
  };
}

export async function loadRoom(roomId: string): Promise<GameEvent[] | null> {
  return loadRoomEvents<GameEvent>(roomId);
}

export async function loadRoomEvents<T extends PersistedRoomEvent>(
  roomId: string,
): Promise<T[] | null> {
  const { rows } = await getPool().query<{ payload: T }>(
    'SELECT payload FROM events WHERE room_id = $1 ORDER BY seq ASC',
    [roomId],
  );
  if (rows.length === 0) return null;
  return rows.map((row) => row.payload);
}

export async function appendEvent(roomId: string, seq: number, event: GameEvent): Promise<void> {
  await appendRoomEvent(roomId, seq, event);
}

export async function appendRoomEvent<T extends PersistedRoomEvent>(
  roomId: string,
  seq: number,
  event: T,
): Promise<void> {
  if (event.roomId !== roomId) {
    throw new Error(`event roomId mismatch: expected ${roomId}, got ${event.roomId}`);
  }
  await getPool().query(
    'INSERT INTO events (room_id, seq, type, payload) VALUES ($1, $2, $3, $4)',
    [roomId, seq, event.type, event],
  );
}

export async function recordGameDebugArtifact(artifact: GameDebugArtifactInput): Promise<void> {
  await getPool().query(
    `INSERT INTO game_debug_artifacts
       (game_id, ply, engine_color, artifact_type, storage, payload)
     VALUES ($1, $2, $3, $4, 'jsonb', $5)`,
    [
      artifact.gameId,
      artifact.ply ?? null,
      artifact.engineColor ?? null,
      artifact.artifactType,
      artifact.payload,
    ],
  );
}

export async function listActiveRoomIds(since: Date): Promise<string[]> {
  const { rows } = await getPool().query<{ room_id: string }>(
    `SELECT DISTINCT room_id FROM events
     WHERE created_at >= $1
       AND room_id NOT IN (
         SELECT room_id FROM games WHERE status IN ('completed', 'aborted')
       )
     ORDER BY room_id`,
    [since],
  );
  return rows.map((row) => row.room_id);
}

export async function getGameLifecycleStatus(
  roomId: string,
): Promise<{ mode: GameMode; status: 'running' | 'completed' | 'aborted' } | null> {
  const { rows } = await getPool().query<{
    mode: GameMode;
    status: 'running' | 'completed' | 'aborted';
  }>(
    `SELECT mode, status
     FROM games
     WHERE room_id = $1
     LIMIT 1`,
    [roomId],
  );
  return rows[0] ?? null;
}

export async function abortRunningGame(
  roomId: string,
  options: {
    abortedReason: string;
    endedAt?: Date;
    termination: Extract<
      GameTermination,
      'abandoned' | 'engine-failure' | 'server-restarted' | 'worker-aborted'
    >;
  },
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE games
     SET status = 'aborted',
         result = NULL,
         termination = $2,
         ended_at = $3,
         aborted_reason = $4
     WHERE room_id = $1
       AND status = 'running'`,
    [roomId, options.termination, options.endedAt ?? new Date(), options.abortedReason],
  );
  return (rowCount ?? 0) > 0;
}

export async function abortStaleGuestPrestartGames(
  now = new Date(),
  staleAfterMs = 15 * 60 * 1000,
): Promise<{ aborted: number; roomIds: string[] }> {
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const { rows } = await getPool().query<{ room_id: string }>(
    `WITH candidates AS (
       SELECT games.room_id
       FROM games
       WHERE games.status = 'running'
         AND games.mode IN ('pvp', 'pve')
         AND games.started_at < $1
         -- "the game never actually began" = no move was ever played.
         --
         -- This used to also exclude rooms carrying a 'clock-started' event,
         -- which meant "both seats filled" on the legacy chess stack. The
         -- variant-tenant runtime emits the SAME event at ROOM CREATION for any
         -- room with a time control, so that exclusion fired at birth and this
         -- sweep could never claim a timed tenant room -- a safety net that
         -- read as working and did nothing. Key on move-played, which means the
         -- same thing on both stacks.
         AND NOT EXISTS (
           SELECT 1
           FROM events
           WHERE events.room_id = games.room_id
             AND events.type = 'move-played'
         )
         -- Correspondence is exempt: an open days-per-move challenge sitting
         -- unfilled for days is normal, and room_deadlines holds exactly one
         -- row per in-flight correspondence room. Their enforcement is the
         -- deadline sweeper's job, not this one's.
         AND NOT EXISTS (
           SELECT 1
           FROM room_deadlines
           WHERE room_deadlines.room_id = games.room_id
         )
         -- Still guest-scoped. A room somebody signed in actually sat down in
         -- is handled in memory by the 'unjoined' join window, which knows
         -- about live socket presence; this query cannot see that.
         AND NOT EXISTS (
           SELECT 1
           FROM room_seat_tokens
           WHERE room_seat_tokens.room_id = games.room_id
             AND room_seat_tokens.revoked_at IS NULL
             AND room_seat_tokens.user_id IS NOT NULL
         )
       FOR UPDATE SKIP LOCKED
     ),
     repaired AS (
       UPDATE games
       SET status = 'aborted',
           result = NULL,
           termination = 'abandoned',
           ended_at = $2,
           aborted_reason = 'guest pre-start timeout'
       FROM candidates
       WHERE games.room_id = candidates.room_id
       RETURNING games.room_id
     )
     SELECT room_id
     FROM repaired
     ORDER BY room_id`,
    [staleBefore, now],
  );
  return { aborted: rows.length, roomIds: rows.map((row) => row.room_id) };
}

/**
 * Finalize paused rooms whose last event is `pause` older than `staleAfterMs`.
 *
 * Marks the games row as completed with `result = 'draw'`, `termination =
 * 'server-restarted'`. Idempotent via `WHERE games.status = 'running'` — a
 * concurrent reconnect-triggered finalize races the sweep at the row level and
 * first-writer wins.
 *
 * Returns one row per finalized game with enough context to log each as an
 * investigable event (paused rooms shouldn't accumulate; every occurrence is
 * a yellow flag).
 */
export async function finalizeStalePausedRooms(
  now = new Date(),
  staleAfterMs = 24 * 60 * 60 * 1000,
): Promise<{ finalized: number; rooms: StalePausedFinalizeRecord[] }> {
  const stalePauseBeforeMs = now.getTime() - staleAfterMs;
  const { rows } = await getPool().query<{
    room_id: string;
    mode: GameMode;
    started_at: Date;
    pause_seq: number;
    paused_at_ms: string;
    pause_reason: string | null;
    ply_count: number;
  }>(
    `WITH running_rooms AS (
       SELECT room_id, mode, started_at
       FROM games
       WHERE status = 'running'
     ),
     last_events AS (
       SELECT DISTINCT ON (e.room_id) e.room_id, e.seq, e.type, e.payload
       FROM events e
       JOIN running_rooms r ON r.room_id = e.room_id
       ORDER BY e.room_id, e.seq DESC
     ),
     candidates AS (
       SELECT
         r.room_id,
         r.mode,
         r.started_at,
         le.seq AS pause_seq,
         (le.payload->>'at')::bigint AS paused_at_ms,
         le.payload->>'reason' AS pause_reason
       FROM running_rooms r
       JOIN last_events le ON le.room_id = r.room_id
       WHERE le.type = 'pause'
         AND (le.payload->>'at')::bigint < $1
     ),
     finalized AS (
       UPDATE games
       SET status = 'completed',
           result = 'draw',
           termination = 'server-restarted',
           ended_at = $2,
           ply_count = (
             SELECT COUNT(*)::int
             FROM events e2
             WHERE e2.room_id = candidates.room_id
               AND e2.type = 'move-played'
           )
       FROM candidates
       WHERE games.room_id = candidates.room_id
         AND games.status = 'running'
       RETURNING
         games.room_id,
         games.mode,
         games.started_at,
         games.ply_count,
         candidates.pause_seq,
         candidates.paused_at_ms,
         candidates.pause_reason
     ),
     audited AS (
       INSERT INTO room_lifecycle_audit
         (room_id, kind, occurred_at, at_ms, event_seq, build_revision, payload)
       SELECT
         room_id,
         'stale_paused_finalized',
         $2,
         $3,
         pause_seq,
         $4,
         jsonb_build_object(
           'mode', mode,
           'pauseReason', pause_reason,
           'pausedAtMs', paused_at_ms,
           'pausedDurationMs', $3 - paused_at_ms,
           'startedAtMs', FLOOR(EXTRACT(EPOCH FROM started_at) * 1000)::bigint,
           'plyCount', ply_count
         )
       FROM finalized
       RETURNING room_id
     )
     SELECT room_id, mode, started_at, pause_seq, paused_at_ms, pause_reason, ply_count
     FROM finalized
     ORDER BY room_id`,
    [stalePauseBeforeMs, now, now.getTime(), getBuildInfo().revision],
  );
  return {
    finalized: rows.length,
    rooms: rows.map((row) => ({
      roomId: row.room_id,
      mode: row.mode,
      startedAt: row.started_at,
      pauseSeq: row.pause_seq,
      pausedAtMs: Number(row.paused_at_ms),
      pauseReason: row.pause_reason,
      plyCount: row.ply_count,
    })),
  };
}

export async function recordGameStart(roomId: string, summary: RunningGameSummary): Promise<void> {
  await getPool().query(
    `INSERT INTO games
       (room_id, variant, result, termination, ply_count, started_at, ended_at,
        white_client, black_client, white_name, black_name, corpus_id,
        mode, status, review_status, visibility, region)
     VALUES ($1, $2, NULL, NULL, 0, $3, NULL, $4, $5, $6, $7, $8,
        $9, 'running', $10, $11, $12)
     ON CONFLICT (room_id) DO NOTHING`,
    [
      roomId,
      summary.variant,
      summary.startedAt,
      summary.whiteClient,
      summary.blackClient,
      summary.whiteName,
      summary.blackName,
      summary.corpusId,
      summary.mode,
      summary.reviewStatus ?? 'unreviewed',
      summary.visibility ?? 'public',
      summary.region ?? 'global',
    ],
  );
}

export async function listGameDebugArtifactSummaries(
  gameId: string,
): Promise<GameDebugArtifactSummary[]> {
  const { rows } = await getPool().query<{
    artifact_type: string;
    count: string;
    engine_colors: Color[] | null;
    min_ply: number | null;
    max_ply: number | null;
    snapshot_kinds: string[] | null;
  }>(
    `SELECT artifact_type,
            COUNT(*)::text AS count,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT engine_color ORDER BY engine_color), NULL) AS engine_colors,
            MIN(ply) AS min_ply,
            MAX(ply) AS max_ply,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT payload->>'snapshot_kind' ORDER BY payload->>'snapshot_kind')
              FILTER (WHERE storage = 'jsonb' AND payload ? 'snapshot_kind'), NULL) AS snapshot_kinds
     FROM game_debug_artifacts
     WHERE game_id = $1
     GROUP BY artifact_type
     ORDER BY artifact_type`,
    [gameId],
  );

  return rows.map((row) => ({
    artifactType: row.artifact_type,
    count: Number.parseInt(row.count, 10),
    engineColors: row.engine_colors ?? [],
    minPly: row.min_ply,
    maxPly: row.max_ply,
    snapshotKinds: row.snapshot_kinds ?? [],
  }));
}

export async function listGameDebugArtifactPayloads(
  gameId: string,
  filters: {
    artifactType: string;
    engineColors?: Color[];
    limit?: number;
  },
): Promise<GameDebugArtifactPayload[]> {
  const boundedLimit = Math.max(1, Math.min(filters.limit ?? 500, 2000));
  const colors =
    filters.engineColors && filters.engineColors.length > 0 ? filters.engineColors : null;
  const { rows } = await getPool().query<{
    id: string;
    game_id: string;
    ply: number | null;
    engine_color: Color | null;
    artifact_type: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id::text, game_id, ply, engine_color, artifact_type, payload, created_at
     FROM game_debug_artifacts
     WHERE game_id = $1
       AND artifact_type = $2
       AND storage = 'jsonb'
       AND ($3::text[] IS NULL OR engine_color = ANY($3::text[]))
     ORDER BY ply NULLS LAST, engine_color NULLS LAST, id
     LIMIT $4`,
    [gameId, filters.artifactType, colors, boundedLimit],
  );
  return rows.map((row) => ({
    id: Number.parseInt(row.id, 10),
    gameId: row.game_id,
    ply: row.ply,
    engineColor: row.engine_color,
    artifactType: row.artifact_type,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}
