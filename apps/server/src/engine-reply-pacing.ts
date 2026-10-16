/**
 * How long a bot waits before its move goes out (#389).
 *
 * A node- or depth-anchored rung answers in ~80 ms whatever the time control, so
 * the board changes again before the player has seen their own move land, and
 * they have to take in a new position they never got to look at. So once the
 * engine has its move, the loop holds it until a target reply time. The wait runs
 * on the bot's own clock: it is time spent, not time faked.
 *
 * Every reply waits at least about `beatMs`, the moment to see your own move on the
 * board. On top of that comes a thinking pause, skipped when there is nothing to
 * think about: one legal move, a forced mate for either side, or an eval so
 * lopsided the game is decided (a pause in a lost position only wastes the
 * player's time). Only a short bot clock skips the beat too.
 *
 * Off unless MISTBOARD_BOT_PACING=true. Every number lives in PACING so tuning by
 * feel is one edit. Jitter is seeded on room id + ply, never Math.random(), so a
 * replayed decision computes the same wait.
 */

export const PACING = {
  /** The short reply (one legal move, a decided game), before jitter: ~0.45-0.95 s. */
  beatMs: 700,
  /** Reply target in an untimed game, before complexity and jitter. */
  untimedBaseMs: 2_200,
  /** Timed: this share of the remaining clock, plus `incrementShare` of the increment. */
  clockShare: 0.025,
  incrementShare: 0.5,
  /**
   * The base caps at `maxBaseMs` before complexity and jitter apply, so a long
   * time control still varies move to move instead of sitting on one flat
   * ceiling (10-15: 5+5 and up all read 6.0 s on every move). Every target then
   * lands in [minTargetMs, maxTargetMs].
   */
  maxBaseMs: 4_500,
  minTargetMs: 700,
  maxTargetMs: 8_000,
  /** ± fraction of the target, seeded per room and ply. */
  jitter: 0.35,
  /** Opening plies reply faster: a player expects the first moves to be quick. */
  openingPlies: 6,
  openingFactor: 0.6,
  /** Legal-move count that reads as an average position (factor 1). */
  averageLegalMoves: 40,
  /**
   * |eval| at or past this many centipawns means the game is decided: the short
   * reply only. Set high on purpose: a weak rung is often several pawns down by
   * move 3 of jieqi, and that game is far from over for the player (10-15 local).
   */
  decisiveCp: 1_500,
  /** The bot's clock under this: no wait. */
  lowClockMs: 10_000,
  /** Never let a wait take the bot's clock under this. */
  clockReserveMs: 5_000,
} as const;

export function botPacingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MISTBOARD_BOT_PACING === 'true';
}

export type ReplyPaceReason =
  | 'paced'
  | 'off'
  | 'engine-vs-engine'
  | 'single-move'
  | 'decisive'
  | 'low-clock';

// 'single-move' and 'decisive' still wait out the beat; 'off', 'engine-vs-engine'
// and 'low-clock' do not wait at all.

export type ReplyPaceInput = {
  roomId: string;
  ply: number;
  legalCount: number;
  /** Engine's eval of the move it chose (side-to-move POV); null when it gave none. */
  cp: number | null;
  mate: number | null;
  /** Bot's clock when the turn started, null when untimed. */
  remainingMs: number | null;
  incrementMs: number;
  /** Wall time the engine already spent on this move. */
  computeMs: number;
  /** Both seats are engines: nobody is waiting to be convinced. */
  engineVsEngine?: boolean;
  enabled?: boolean;
};

export type ReplyPace = {
  /** How long to hold the move before playing it. */
  waitMs: number;
  /** Total reply time aimed for (compute + wait); 0 when not paced. */
  targetMs: number;
  reason: ReplyPaceReason;
};

export function replyPace(input: ReplyPaceInput): ReplyPace {
  const instant = (reason: ReplyPaceReason): ReplyPace => ({ waitMs: 0, targetMs: 0, reason });
  if (!(input.enabled ?? botPacingEnabled())) return instant('off');
  if (input.engineVsEngine) return instant('engine-vs-engine');

  let baseMs: number = PACING.untimedBaseMs;
  let usableMs = Number.POSITIVE_INFINITY;
  if (input.remainingMs !== null) {
    const leftMs = input.remainingMs - input.computeMs;
    if (leftMs < PACING.lowClockMs) return instant('low-clock');
    baseMs = leftMs * PACING.clockShare + input.incrementMs * PACING.incrementShare;
    usableMs = leftMs - PACING.clockReserveMs;
  }
  const jitter = 1 + (seededUnit(input.roomId, input.ply) * 2 - 1) * PACING.jitter;
  const waitFor = (targetMs: number, reason: ReplyPaceReason): ReplyPace => ({
    waitMs: Math.round(clamp(targetMs - input.computeMs, 0, usableMs)),
    targetMs,
    reason,
  });

  const beatMs = Math.round(PACING.beatMs * jitter);
  if (input.legalCount <= 1) return waitFor(beatMs, 'single-move');
  if (input.mate !== null || (input.cp !== null && Math.abs(input.cp) >= PACING.decisiveCp)) {
    return waitFor(beatMs, 'decisive');
  }

  const complexity = clamp(input.legalCount / PACING.averageLegalMoves, 0.7, 1.4);
  const phase = input.ply < PACING.openingPlies ? PACING.openingFactor : 1;
  const targetMs = Math.round(
    clamp(
      Math.min(baseMs, PACING.maxBaseMs) * complexity * phase * jitter,
      PACING.minTargetMs,
      PACING.maxTargetMs,
    ),
  );
  return waitFor(targetMs, 'paced');
}

/** The pace as it rides in a `live-engine-decision` payload. */
export function replyPacePayload(pace: ReplyPace): Record<string, unknown> {
  return { pace_wait_ms: pace.waitMs, pace_target_ms: pace.targetMs, pace_reason: pace.reason };
}

export function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/** Uniform [0, 1) from room id + ply: FNV-1a over the id, then a splitmix finaliser. */
function seededUnit(roomId: string, ply: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < roomId.length; i++) {
    h ^= roomId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let x = BigInt.asUintN(64, (BigInt(h >>> 0) << 32n) ^ BigInt(ply) ^ 0x9e3779b97f4a7c15n);
  x = BigInt.asUintN(64, (x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n);
  x = BigInt.asUintN(64, (x ^ (x >> 27n)) * 0x94d049bb133111ebn);
  x = x ^ (x >> 31n);
  return Number(x >> 11n) / 2 ** 53;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
