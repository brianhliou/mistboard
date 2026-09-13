import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  censusDeployGate,
  countDeployGatingRooms,
  type DeployGateCensus,
  mergeDeployGateCensus,
} from './deploy-gate.js';
import { recordRoomLifecycleAuditSafe } from './room-lifecycle-audit.js';
import { readJsonBody, writeJson } from './routes/lib.js';
import { clientIpForRateLimit, isDrainToken, isProductionLikeRuntime } from './server-policy.js';
import type { Room } from './server-types.js';
import {
  variantTenantActiveGameCount,
  variantTenantBroadcast,
  variantTenantDeployGateCensus,
} from './variant-tenant/registry.js';

export type DrainController = {
  activeGameCount(): number;
  deployGateCensus(): DeployGateCensus;
  drainDeadlineMs(): number | null;
  restartPhase(): DrainPhase | null;
  handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void>;
  isDraining(): boolean;
};

export type DrainControllerOptions = {
  drainWindowDefaultMs: number;
  drainWindowMaxMs: number;
  rooms: Map<string, Room>;
};

type DrainState = {
  phase: DrainPhase | null;
  restartAt: number | null;
  // Who asked for this drain. Set from the activating request so a cancel from
  // a DIFFERENT automated release cannot take it away: two sessions releasing
  // at once, where the first fails before pushing and runs its cleanup, used to
  // cancel the second session's drain and let it deploy into live games.
  owner: string | null;
};

export type DrainPhase = 'pending' | 'restarting';

const drainRateLimit = 10;
const drainRateWindowMs = 60_000;

export function createDrainController(options: DrainControllerOptions): DrainController {
  const drainState: DrainState = { phase: null, restartAt: null, owner: null };
  const drainRateBuckets = new Map<string, number[]>();

  function isDraining(): boolean {
    return drainState.restartAt !== null && drainState.restartAt > Date.now();
  }

  function drainDeadlineMs(): number | null {
    return isDraining() ? drainState.restartAt : null;
  }

  function restartPhase(): DrainPhase | null {
    return isDraining() ? drainState.phase : null;
  }

  // Number of rooms a deploy would actually interrupt, across the chess map AND
  // every registered variant tenant. Used by safe deploys and
  // /api/server-status to gate deploys behind a drain window. Without the
  // tenant sum, a live DMX game is invisible to the gate and a
  // deploy can land mid-game.
  //
  // The predicate lives in deploy-gate.ts, shared with the tenant side. This
  // half used to count any unpaused playing room, so a chess correspondence
  // game or an abandoned open tab pinned the count above zero indefinitely.
  // Since safe-deploy BLOCKS when its window expires with games still active,
  // that made releases impossible rather than merely slow.
  function activeGameCount(): number {
    return variantTenantActiveGameCount() + countDeployGatingRooms(options.rooms.values());
  }

  // The same walk, keeping what was skipped and why, so a stalled deploy (or a
  // gate that reads suspiciously empty) is diagnosable from /api/server-status
  // instead of by guessing. Aggregate counts only: no room ids, no seats.
  function deployGateCensus(): DeployGateCensus {
    const now = Date.now();
    return mergeDeployGateCensus(
      censusDeployGate(options.rooms.values(), now),
      variantTenantDeployGateCensus(now),
    );
  }

  function drainRateAllowed(ip: string): boolean {
    const now = Date.now();
    const bucket = drainRateBuckets.get(ip) ?? [];
    const fresh = bucket.filter((t) => now - t < drainRateWindowMs);
    if (fresh.length >= drainRateLimit) {
      drainRateBuckets.set(ip, fresh);
      return false;
    }
    fresh.push(now);
    drainRateBuckets.set(ip, fresh);
    return true;
  }

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    const ip = clientIpForRateLimit(request);
    if (!drainRateAllowed(ip)) {
      writeJson(response, 429, { error: 'rate_limited' });
      return;
    }
    // Token check: only validate in production-like runtimes so local dev
    // doesn't require setting MISTBOARD_DRAIN_TOKEN.
    if (isProductionLikeRuntime() && !isDrainToken(bearerToken(request))) {
      writeJson(response, 401, { error: 'unauthorized' });
      return;
    }

    if (pathname === '/admin/drain/cancel') {
      const cancelBody = await readJsonBody(request);
      const claimant = typeof cancelBody.owner === 'string' ? cancelBody.owner : null;
      // A caller that names an owner is an automated release cleaning up after
      // itself, and it may only cancel its own drain. A caller that names none
      // is a human at a terminal (the documented `/admin/drain/cancel` escape
      // hatch), who is allowed to cancel anything: the point of an escape hatch
      // is that it opens when the automation is what went wrong.
      const owner = drainState.owner;
      if (claimant !== null && owner !== null && claimant !== owner) {
        writeJson(response, 409, { error: 'drain_owned_by_another', owner });
        return;
      }
      const wasActive = isDraining();
      const hadDrain = drainState.phase !== null;
      const cancelledAt = Date.now();
      const restartAt = drainState.restartAt;
      const phase = drainState.phase;
      drainState.phase = null;
      drainState.restartAt = null;
      drainState.owner = null;
      if (hadDrain) broadcastDrainCancel(options.rooms);
      await recordRoomLifecycleAuditSafe({
        kind: 'drain_cancelled',
        atMs: cancelledAt,
        payload: {
          wasActive,
          hadDrain,
          phase,
          restartAt,
          owner,
          claimant,
          rooms: options.rooms.size,
          activeGames: activeGameCount(),
        },
      });
      console.log(
        JSON.stringify({
          level: 'info',
          kind: 'drain_cancelled',
          owner,
          claimant,
          override: claimant === null && owner !== null,
          at: cancelledAt,
        }),
      );
      writeJson(response, 200, { ok: true, draining: false });
      return;
    }

    const body = await readJsonBody(request);
    if (body.phase === 'restarting') {
      if (!isDraining()) {
        writeJson(response, 409, { error: 'drain_not_active' });
        return;
      }
      const activeGames = activeGameCount();
      if (activeGames !== 0) {
        writeJson(response, 409, { error: 'active_games_remaining', activeGames });
        return;
      }
      const idempotent = drainState.phase === 'restarting';
      drainState.phase = 'restarting';
      if (!idempotent) broadcastRestartNow(options.rooms);
      const committedAt = Date.now();
      await recordRoomLifecycleAuditSafe({
        kind: 'drain_restart_committed',
        atMs: committedAt,
        payload: {
          restartAt: drainState.restartAt,
          rooms: options.rooms.size,
          activeGames,
          idempotent,
        },
      });
      console.log(
        JSON.stringify({
          level: 'info',
          kind: 'drain_restart_committed',
          restartAt: drainState.restartAt,
          idempotent,
          at: committedAt,
        }),
      );
      writeJson(response, 200, {
        ok: true,
        draining: true,
        phase: drainState.phase,
        restartAt: drainState.restartAt,
        idempotent,
      });
      return;
    }

    // /admin/drain: idempotent activation. If already draining, return the
    // existing deadline rather than extending it.
    if (isDraining()) {
      writeJson(response, 200, {
        ok: true,
        draining: true,
        phase: drainState.phase,
        restartAt: drainState.restartAt,
        owner: drainState.owner,
        idempotent: true,
      });
      return;
    }

    const requestedWindowMs =
      typeof body.windowMs === 'number'
        ? body.windowMs
        : typeof body.windowMinutes === 'number'
          ? body.windowMinutes * 60_000
          : options.drainWindowDefaultMs;
    if (!Number.isFinite(requestedWindowMs) || requestedWindowMs <= 0) {
      writeJson(response, 400, { error: 'invalid_window' });
      return;
    }
    const windowMs = Math.min(requestedWindowMs, options.drainWindowMaxMs);
    const activatedAt = Date.now();
    drainState.phase = 'pending';
    drainState.restartAt = activatedAt + windowMs;
    drainState.owner = typeof body.owner === 'string' ? body.owner : null;
    broadcastDrainSchedule(options.rooms, drainState.restartAt);
    await recordRoomLifecycleAuditSafe({
      kind: 'drain_activated',
      atMs: activatedAt,
      payload: {
        windowMs,
        restartAt: drainState.restartAt,
        requestedWindowMs,
        owner: drainState.owner,
        rooms: options.rooms.size,
        activeGames: activeGameCount(),
      },
    });
    console.log(
      JSON.stringify({
        level: 'info',
        kind: 'drain_activated',
        windowMs,
        restartAt: drainState.restartAt,
        at: activatedAt,
      }),
    );
    writeJson(response, 200, {
      ok: true,
      draining: true,
      phase: drainState.phase,
      restartAt: drainState.restartAt,
      owner: drainState.owner,
      idempotent: false,
    });
  }

  return {
    activeGameCount,
    deployGateCensus,
    drainDeadlineMs,
    handleRequest,
    isDraining,
    restartPhase,
  };
}

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
}

// Broadcast restart phase changes to every connected WS client, both chess
// rooms and every registered variant tenant's rooms. Stand-alone messages
// avoid waking every game's snapshot-broadcast path.
function broadcastDrainSchedule(rooms: Map<string, Room>, restartAt: number): void {
  const message = JSON.stringify({ type: 'server_restart_scheduled', phase: 'pending', restartAt });
  sendDrainMessage(rooms, message);
}

function broadcastRestartNow(rooms: Map<string, Room>): void {
  sendDrainMessage(
    rooms,
    JSON.stringify({ type: 'server_restart_scheduled', phase: 'restarting' }),
  );
}

function broadcastDrainCancel(rooms: Map<string, Room>): void {
  sendDrainMessage(rooms, JSON.stringify({ type: 'server_restart_cancelled' }));
}

function sendDrainMessage(rooms: Map<string, Room>, message: string): void {
  for (const room of rooms.values()) {
    for (const client of room.clients) {
      try {
        client.socket.send(message);
      } catch {
        /* socket closed */
      }
    }
  }
  variantTenantBroadcast(message);
}
