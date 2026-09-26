import { clockPolicyKindFor } from '@mistboard/game';

// What counts as a game worth delaying a deploy for. The drain gate exists to
// protect players mid-game: it holds a release until the board empties, and a
// deploy CANNOT proceed while the count is non-zero (safe-deploy gives up and
// blocks after its window). So every room that counts and never resolves is a
// deploy that can never run through the sanctioned path.
//
// Three kinds of room look "in progress" but cost a player nothing when the
// server restarts under them:
//   - paused rooms (already excluded before this module existed),
//   - correspondence games, which are measured in days per move and reconnect
//     to a resumable state,
//   - rooms nobody has touched in DEPLOY_GATE_IDLE_MS: an abandoned tab left
//     open. A live game in real play cannot go quiet this long without its
//     clock flagging, so silence here means the players are gone.
//
// Everything excluded still replays from its event log on reconnect. The gate
// is about interrupting attention, not about correctness.
export const DEPLOY_GATE_IDLE_MS = 10 * 60_000;

export type DeployGateRoom = {
  // Empty/absent logs fail SAFE (the room gates): a room with no readable
  // activity is not evidence that nobody is playing.
  events?: readonly { at?: number }[];
  projection: {
    // Chess rooms carry a boolean; tenant rooms carry the pause record
    // ({ at, activeColor }) while a server stop has them paused. Either way,
    // present and truthy means no clock is running.
    paused?: boolean | object;
    state: { status: { type: string } };
    timeControl?: { daysPerMove?: number } | null;
  };
};

export type DeployGateReason = 'gating' | 'not-playing' | 'paused' | 'correspondence' | 'idle';

export type DeployGateCensus = Record<DeployGateReason, number>;

export function emptyDeployGateCensus(): DeployGateCensus {
  return { gating: 0, 'not-playing': 0, paused: 0, correspondence: 0, idle: 0 };
}

export function deployGateReasonFor(room: DeployGateRoom, nowMs: number): DeployGateReason {
  if (room.projection.state.status.type !== 'playing') return 'not-playing';
  if (room.projection.paused) return 'paused';
  if (clockPolicyKindFor(room.projection.timeControl) !== 'live') return 'correspondence';
  const lastEventAt = lastEventTimestamp(room);
  if (lastEventAt !== null && nowMs - lastEventAt >= DEPLOY_GATE_IDLE_MS) return 'idle';
  return 'gating';
}

/** The number of rooms a deploy would actually interrupt. */
export function countDeployGatingRooms(
  rooms: Iterable<DeployGateRoom>,
  nowMs: number = Date.now(),
): number {
  let count = 0;
  for (const room of rooms) {
    if (deployGateReasonFor(room, nowMs) === 'gating') count += 1;
  }
  return count;
}

/** Same walk, keeping the discarded rooms so a blocked deploy can say why. */
export function censusDeployGate(
  rooms: Iterable<DeployGateRoom>,
  nowMs: number = Date.now(),
): DeployGateCensus {
  const census = emptyDeployGateCensus();
  for (const room of rooms) census[deployGateReasonFor(room, nowMs)] += 1;
  return census;
}

/**
 * Whether a room is a game genuinely in play right now.
 *
 * This is the deploy gate's own classification, re-exported as a predicate so
 * that "is this game real" has ONE definition. It previously had three, and
 * they disagreed: the drain gate used this classifier, Mistboard TV used its
 * own freshness window, and the homepage count (live-room-stats.ts) filtered on
 * `status === 'playing'` alone — so the landing page advertised abandoned tabs
 * and paused rooms as live games while TV, reading the same rooms, showed
 * nothing. Anything reporting a count of live games belongs here.
 *
 * `correspondence` counts: a days-per-move game with nobody connected and no
 * event for hours is genuinely in play, and excluding it on freshness would
 * undercount every correspondence game on the site.
 */
export function isGameInPlay(room: DeployGateRoom, nowMs: number = Date.now()): boolean {
  const reason = deployGateReasonFor(room, nowMs);
  return reason === 'gating' || reason === 'correspondence';
}

export function mergeDeployGateCensus(
  first: DeployGateCensus,
  second: DeployGateCensus,
): DeployGateCensus {
  return {
    gating: first.gating + second.gating,
    'not-playing': first['not-playing'] + second['not-playing'],
    paused: first.paused + second.paused,
    correspondence: first.correspondence + second.correspondence,
    idle: first.idle + second.idle,
  };
}

// The newest timestamp in the log, not the last entry's: events are appended in
// arrival order, and a room whose clock timer fired late could leave an older
// `at` at the tail. Returns null when nothing carries a usable timestamp.
function lastEventTimestamp(room: DeployGateRoom): number | null {
  let newest: number | null = null;
  for (const event of room.events ?? []) {
    const at = event?.at;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest;
}
