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
//   - PvE games on an engine path that survives a restart (RESUMABLE_PVE_GAME_SPECS
//     below, #559): paused at shutdown, resumed on the new build, the bot
//     searching again. A restart costs that player a reconnect, not the game.
//
// Everything excluded still replays from its event log on reconnect. The gate
// is about interrupting attention, not about correctness.
export const DEPLOY_GATE_IDLE_MS = 10 * 60_000;

// What a create route tells the drain about the game it is about to make.
export type DrainCreate = {
  // A PvE game on an engine path shown to survive a web restart: paused at
  // shutdown, restored on boot, the bot picks its turn back up, clocks frozen
  // across the gap, hidden information still hidden. Such a game is let
  // through a pending drain and is not one the deploy waits for (the deploy
  // gate classifies it 'pve'). Only set it for a spec in
  // RESUMABLE_PVE_GAME_SPECS; anything else is refused and waited for as
  // before.
  resumablePve?: boolean;
};

// PvE on these specs survives a web restart, so a drain lets their PvE creates
// through and does not wait for their PvE games (#559 step 2). Each one runs
// its bot on the web box (a UCI process or warm session, or in-process), and
// shares the tenant runtime's restart path: pauseTenantRoomsOnShutdown freezes
// the clock whoever is on move, the room hydrates from its log on the first
// reconnect, the engine seat counts as present so the room resumes as soon
// as the human is back, and the resume append reschedules the bot. A search
// that lands or fails during the pause is dropped (each engine's
// engineToMove is false while paused), so a restart never resigns the bot.
//
// Not here, refused and waited for as before:
//   - Fog chess PvE (legacy room stack) and Fog xiangqi PvE: their bots run on
//     the engine-worker under a seat reservation that the shutdown neither
//     releases nor persists. The rebuilt room has to reserve again; a full
//     worker (old seats live out their TTL) forfeits the chess bot or leaves
//     the xiangqi room unloadable. Fog chess also appends a bot reply that
//     lands after the pause (#559 audit).
//   - Mahjong: always-seated bots, no restart test yet.
export const RESUMABLE_PVE_GAME_SPECS: ReadonlySet<string> = new Set([
  'xiangqi',
  'jieqi',
  'banqi',
  'jungle',
  'jungle-flip',
  'duck-xiangqi',
  'atomic-xiangqi',
  'fortress-xiangqi',
  'crazyhouse-xiangqi',
]);

// Which rooms of one tenant are resumable PvE games: the spec is listed and an
// engine holds a seat. Undefined when the spec is not listed, so the caller
// counts every room as before.
export function resumablePveRoomPredicate(tenant: {
  gameSpecId: string;
  engine?: { isEngineClientId(clientId: string | undefined): boolean } | null;
}): ((room: DeployGateRoom) => boolean) | undefined {
  const engine = tenant.engine;
  if (!engine || !RESUMABLE_PVE_GAME_SPECS.has(tenant.gameSpecId)) return undefined;
  return (room) =>
    Object.values(room.projection.seats ?? {}).some(
      (clientId) => typeof clientId === 'string' && engine.isEngineClientId(clientId),
    );
}

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
    // Seat -> client id; read only to tell a PvE room from a PvP one.
    seats?: object;
  };
};

export type DeployGateReason =
  | 'gating'
  | 'not-playing'
  | 'paused'
  | 'correspondence'
  | 'idle'
  | 'pve';

// Tells a resumable PvE room apart (resumablePveRoomPredicate). Absent: no
// room is classified 'pve'.
export type ResumablePvePredicate = (room: DeployGateRoom) => boolean;

export type DeployGateCensus = Record<DeployGateReason, number>;

export function emptyDeployGateCensus(): DeployGateCensus {
  return { gating: 0, 'not-playing': 0, paused: 0, correspondence: 0, idle: 0, pve: 0 };
}

export function deployGateReasonFor(
  room: DeployGateRoom,
  nowMs: number,
  isResumablePve?: ResumablePvePredicate,
): DeployGateReason {
  if (room.projection.state.status.type !== 'playing') return 'not-playing';
  if (room.projection.paused) return 'paused';
  if (clockPolicyKindFor(room.projection.timeControl) !== 'live') return 'correspondence';
  const lastEventAt = lastEventTimestamp(room);
  if (lastEventAt !== null && nowMs - lastEventAt >= DEPLOY_GATE_IDLE_MS) return 'idle';
  if (isResumablePve?.(room)) return 'pve';
  return 'gating';
}

/** The number of rooms a deploy would actually interrupt. */
export function countDeployGatingRooms(
  rooms: Iterable<DeployGateRoom>,
  nowMs: number = Date.now(),
  isResumablePve?: ResumablePvePredicate,
): number {
  let count = 0;
  for (const room of rooms) {
    if (deployGateReasonFor(room, nowMs, isResumablePve) === 'gating') count += 1;
  }
  return count;
}

/** Same walk, keeping the discarded rooms so a blocked deploy can say why. */
export function censusDeployGate(
  rooms: Iterable<DeployGateRoom>,
  nowMs: number = Date.now(),
  isResumablePve?: ResumablePvePredicate,
): DeployGateCensus {
  const census = emptyDeployGateCensus();
  for (const room of rooms) census[deployGateReasonFor(room, nowMs, isResumablePve)] += 1;
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
 *
 * `pve` counts too: a resumable PvE game is still a game being played, it is
 * only one a deploy does not wait for.
 */
export function isGameInPlay(room: DeployGateRoom, nowMs: number = Date.now()): boolean {
  const reason = deployGateReasonFor(room, nowMs);
  return reason === 'gating' || reason === 'correspondence' || reason === 'pve';
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
    pve: first.pve + second.pve,
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
