import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRetiredGameSpec } from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import { correspondenceEnabled, correspondenceHostHandle } from './../feature-flags.js';
import { logger } from './../obs.js';
import type { UserAccount } from './../persistence.js';
import * as persistence from './../persistence.js';
import { correspondenceTenantForSpecId } from './../variant-tenant/registry.js';
import { CORRESPONDENCE_ELIGIBLE_SPECS } from './correspondence-rooms.js';
import {
  acceptSeekResult,
  createSeekResult,
  parseSeekColorPreference,
  type SeekRouteResult,
} from './correspondence-seeks.js';
import { type HttpApiContext, readJsonBody, requirePersistence, writeJson } from './lib.js';

// ── Play the host (2026-10-23) ────────────────────────────────────────────────
// The site owner offers himself as a correspondence opponent: a signed-in player
// picks a variant and a side on /correspondence and a casual game starts at once
// against the host account (MISTBOARD_CORRESPONDENCE_HOST_HANDLE). The game is
// made the way any directed challenge is: a private seek posted as the host and
// aimed at the player, then accepted as the player. So every post and accept
// gate (play locks, blocks, variant flags, the drain, the delete-once race) and
// the start email to the seek's creator, which is the host's notice, are the
// board's own; this route adds only the fixed terms and the caps.
//   GET  /api/correspondence/host   is it on, who is the host, room left for you
//   POST /api/correspondence/host   start a game: { gameSpecId, side }
export const HOST_PATH = '/api/correspondence/host';
export const HOST_DAYS_PER_MOVE = 2;
// The host's load: active correspondence games he is seated in, any opponent.
export const HOST_MAX_ACTIVE_GAMES = 15;
// One player cannot take every slot.
export const HOST_MAX_GAMES_PER_PLAYER = 2;

export type HostCounts = { total: number; withPlayer: number };

export type HostDeps = {
  correspondenceEnabled: () => boolean;
  hostHandle: () => string | null;
  findHost: (handle: string) => Promise<UserAccount | null>;
  countGames: (hostUserId: string, playerUserId: string) => Promise<HostCounts>;
  /** Variants the host plays: correspondence-eligible, live, server flag on. */
  specIds: () => readonly string[];
  post: (host: UserAccount, body: Record<string, unknown>) => Promise<SeekRouteResult>;
  accept: (player: UserAccount, seekId: string) => Promise<SeekRouteResult>;
  /** Withdraw the host's seek when the accept refuses it, so it never stands. */
  cancel: (host: UserAccount, seekId: string) => Promise<void>;
};

export function hostSpecIds(): string[] {
  return [...CORRESPONDENCE_ELIGIBLE_SPECS].filter(
    (specId) =>
      !isRetiredGameSpec(specId) && correspondenceTenantForSpecId(specId)?.enabled() === true,
  );
}

function defaultHostDeps(ctx: HttpApiContext): HostDeps {
  return {
    correspondenceEnabled,
    hostHandle: correspondenceHostHandle,
    findHost: (handle) => persistence.findUserByHandle(handle),
    countGames: (hostUserId, playerUserId) =>
      persistence.countHostCorrespondenceGames(hostUserId, playerUserId),
    specIds: hostSpecIds,
    post: (host, body) => createSeekResult(ctx, host, body, 'board', { skipOpenSeekCap: true }),
    accept: (player, seekId) => acceptSeekResult(ctx, player, seekId),
    cancel: async (host, seekId) => {
      await persistence.closeCorrespondenceSeek(seekId, 'cancelled', host.id);
    },
  };
}

export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname !== HOST_PATH) return false;
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST') {
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }
  if (!requirePersistence(response)) return true;
  const user = await currentAccountUser(request);
  const deps = defaultHostDeps(ctx);
  const result =
    method === 'GET'
      ? await hostInfoResult(user, deps)
      : await hostChallengeResult(user, user ? await readJsonBody(request) : {}, deps);
  writeJson(response, result.status, result.body);
  return true;
}

type HostResolution = { ok: true; host: UserAccount } | { ok: false; result: SeekRouteResult };

// Off unless correspondence is on, the handle is set and names a live account.
async function resolveHost(deps: HostDeps): Promise<HostResolution> {
  const notFound: HostResolution = {
    ok: false,
    result: { status: 404, body: { error: 'host_disabled' } },
  };
  if (!deps.correspondenceEnabled()) return notFound;
  const handle = deps.hostHandle();
  if (!handle) return notFound;
  const host = await deps.findHost(handle);
  if (!host) {
    logger.warn({ handle }, 'correspondence host: handle names no open account');
    return notFound;
  }
  return { ok: true, host };
}

function hostPayload(host: UserAccount): Record<string, unknown> {
  return { handle: host.handle, displayName: host.displayName || host.handle };
}

export async function hostInfoResult(
  user: UserAccount | null,
  deps: HostDeps,
): Promise<SeekRouteResult> {
  const resolved = await resolveHost(deps);
  if (!resolved.ok) return resolved.result;
  const { host } = resolved;
  const base = {
    enabled: true,
    host: hostPayload(host),
    daysPerMove: HOST_DAYS_PER_MOVE,
    gameSpecIds: deps.specIds(),
    limits: { perPlayer: HOST_MAX_GAMES_PER_PLAYER, total: HOST_MAX_ACTIVE_GAMES },
  };
  if (!user) return { status: 200, body: { ...base, signedIn: false } };
  if (user.id === host.id) {
    return { status: 200, body: { ...base, signedIn: true, isHost: true, canPlay: false } };
  }
  const counts = await deps.countGames(host.id, user.id);
  const refusal = capRefusal(counts);
  return {
    status: 200,
    body: {
      ...base,
      signedIn: true,
      isHost: false,
      activeWithYou: counts.withPlayer,
      canPlay: refusal === null,
      reason: refusal,
    },
  };
}

function capRefusal(counts: HostCounts): 'player_limit_reached' | 'host_full' | null {
  if (counts.withPlayer >= HOST_MAX_GAMES_PER_PLAYER) return 'player_limit_reached';
  if (counts.total >= HOST_MAX_ACTIVE_GAMES) return 'host_full';
  return null;
}

export async function hostChallengeResult(
  user: UserAccount | null,
  body: Record<string, unknown>,
  deps: HostDeps,
): Promise<SeekRouteResult> {
  const resolved = await resolveHost(deps);
  if (!resolved.ok) return resolved.result;
  const { host } = resolved;
  if (!user) return { status: 401, body: { error: 'not_signed_in' } };
  if (user.id === host.id) return { status: 400, body: { error: 'cannot_challenge_self' } };
  if (persistence.isPlayDisabled(user)) return { status: 403, body: { error: 'play_disabled' } };

  const gameSpecId = typeof body.gameSpecId === 'string' ? body.gameSpecId : '';
  if (!deps.specIds().includes(gameSpecId)) {
    return { status: 400, body: { error: 'host_unsupported_spec' } };
  }
  // The player's side; the host's seek asks for the other one. Random stays
  // random, and the accept path flips the coin.
  const side = parseSeekColorPreference(body.side) ?? 'random';
  const hostSide = side === 'first' ? 'second' : side === 'second' ? 'first' : 'random';

  // Best-effort like the seek cap: two simultaneous requests can both pass at
  // the limit, which costs one extra game, never a wrong one.
  const counts = await deps.countGames(host.id, user.id);
  const refusal = capRefusal(counts);
  if (refusal === 'player_limit_reached') {
    return { status: 409, body: { error: refusal, limit: HOST_MAX_GAMES_PER_PLAYER } };
  }
  if (refusal === 'host_full') {
    return { status: 409, body: { error: refusal, limit: HOST_MAX_ACTIVE_GAMES } };
  }

  const posted = await deps.post(host, {
    gameSpecId,
    daysPerMove: HOST_DAYS_PER_MOVE,
    preferredColor: hostSide,
    targetUserId: user.id,
    rated: false,
  });
  const seek = posted.body.seek as { id?: unknown } | undefined;
  if (posted.status !== 201 || typeof seek?.id !== 'string') {
    // challenge_blocked (the player blocked the host), the host's own play lock,
    // a variant switched off, the drain: the post's own answer.
    return posted;
  }
  const accepted = await deps.accept(user, seek.id);
  if (accepted.status !== 201) {
    await deps.cancel(host, seek.id).catch((err: unknown) => {
      logger.warn({ err, seekId: seek.id }, 'correspondence host: withdrawing the seek failed');
    });
    return accepted;
  }
  return {
    status: 201,
    body: {
      roomId: accepted.body.roomId,
      url: accepted.body.url,
      seat: accepted.body.seat,
      gameSpecId: accepted.body.gameSpecId,
      daysPerMove: HOST_DAYS_PER_MOVE,
      rated: false,
      host: hostPayload(host),
    },
  };
}
