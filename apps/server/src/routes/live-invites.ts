import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRetiredGameSpec, maybeGameSpecForId } from '@mistboard/game';
import { createWithAccountSeats } from '../account-room.js';
import { currentAccountUser } from '../account-session.js';
import { isFairPlayMarked } from '../fair-play.js';
import { ratedEnabled } from '../feature-flags.js';
import { LiveGameAdmission, type LiveGameReservation } from '../live-game-admission.js';
import {
  LIVE_INVITE_POLL_MS,
  LIVE_INVITE_TTL_MS,
  type LiveInvite,
  LiveInviteStore,
  type LiveInviteTerms,
  liveInvites,
  liveInviteView,
} from '../live-invites.js';
import * as persistence from '../persistence.js';
import {
  heartbeatLiveInvites,
  LIVE_INVITE_LEASE_MS,
  leaveLiveInvites,
  liveInviteReachable,
} from '../presence.js';
import { createWithPairing } from '../room-pairing.js';
import { seatDecorationsForAccount } from '../seat-decorations.js';
import { registeredVariantTenants, variantTenantForSpecId } from '../variant-tenant/registry.js';
import {
  type HttpApiContext,
  isAllowedRatedTimeControl,
  isAllowedTimeControl,
  parseRoomTimeControl,
  RequestBodyTooLargeError,
  readJsonBody,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

type InviteUser = persistence.UserAccount;
export type LiveInviteDependencies = {
  currentUser: typeof currentAccountUser;
  findUser: typeof persistence.findUserByHandle;
  hasFollow: typeof persistence.hasFollow;
  hasBlock: typeof persistence.hasBlock;
  available: typeof requirePersistence;
};

// Include disconnected seat owners, across every variant and private room.
// A correspondence game does not occupy the real-time player's availability.
export function busyLiveInviteUsers(ctx: HttpApiContext): Set<string> {
  const busy = new Set<string>();
  const rooms = [
    ...ctx.rooms.values(),
    ...registeredVariantTenants().flatMap((tenant) => [...tenant.rooms.values()]),
  ];
  for (const room of rooms) {
    if (
      room.projection?.state.status.type !== 'playing' ||
      room.projection.timeControl?.daysPerMove
    )
      continue;
    for (const token of Object.values(room.seatTokens ?? {})) {
      if (token?.userId) busy.add(token.userId);
    }
    for (const client of room.clients) {
      if (client.userId && client.seat && client.seat !== 'spectator') busy.add(client.userId);
    }
  }
  return busy;
}

export async function liveInviteTermsError(
  sender: InviteUser,
  target: InviteUser,
  terms: LiveInviteTerms,
): Promise<string | null> {
  const spec = maybeGameSpecForId(terms.gameSpecId);
  if (!spec || isRetiredGameSpec(spec.id)) return 'unsupported_game_spec';
  const tenant = variantTenantForSpecId(spec.id);
  if (spec.id !== 'dark-chess' && (!tenant?.enabled() || !tenant.lobby))
    return 'unsupported_game_spec';
  if (
    !(await persistence.mayPlayVariant(sender, spec.id)) ||
    !(await persistence.mayPlayVariant(target, spec.id))
  )
    return 'variant_not_granted';
  if (
    !(tenant?.lobby
      ? tenant.lobby.allowsTimeControl(terms.timeControl)
      : isAllowedTimeControl(terms.timeControl))
  )
    return 'time_control_unsupported';
  if (terms.rated) {
    if (!ratedEnabled()) return 'rated_disabled';
    if (spec.id !== 'dark-chess' && !tenant?.lobby?.supportsRated)
      return 'rated_unsupported_surface';
    if (!isAllowedRatedTimeControl(terms.timeControl)) return 'rated_time_control_unsupported';
    // Two stats-excluded accounts never form a rated game (2026-11-26).
    if (persistence.isStatsExcluded(sender) && persistence.isStatsExcluded(target))
      return 'rated_requires_counted_account';
    if (isFairPlayMarked(sender) || isFairPlayMarked(target)) return 'rated_account_marked';
  }
  return null;
}

export function createLiveInviteHandler(
  deps: LiveInviteDependencies,
  store = new LiveInviteStore(),
) {
  const admissions = new WeakMap<HttpApiContext, LiveGameAdmission>();
  function admissionFor(ctx: HttpApiContext): LiveGameAdmission {
    let admission = admissions.get(ctx);
    if (!admission) {
      admission = new LiveGameAdmission({ rooms: ctx.rooms });
      admissions.set(ctx, admission);
    }
    return admission;
  }
  async function policyEligible(sender: InviteUser, target: InviteUser): Promise<boolean> {
    if (
      sender.closedAt ||
      target.closedAt ||
      persistence.isPlayDisabled(sender) ||
      persistence.isPlayDisabled(target) ||
      !target.accountPreferences.liveInvites
    )
      return false;
    // A directed invite may travel along either existing follow edge. Both
    // block directions override it, and failure never discloses whose policy.
    if ((await deps.hasBlock(sender.id, target.id)) || (await deps.hasBlock(target.id, sender.id)))
      return false;
    if (
      !(await deps.hasFollow(sender.id, target.id)) &&
      !(await deps.hasFollow(target.id, sender.id))
    )
      return false;
    return true;
  }

  async function eligible(
    sender: InviteUser,
    target: InviteUser,
    ctx: HttpApiContext,
    now: number,
  ) {
    if (!(await policyEligible(sender, target))) return false;
    const busy = busyLiveInviteUsers(ctx);
    return !busy.has(sender.id) && !busy.has(target.id) && liveInviteReachable(target.id, now);
  }

  async function resolveEligible(invite: LiveInvite, ctx: HttpApiContext) {
    const [sender, target] = await Promise.all([
      deps.findUser(invite.sender.handle),
      deps.findUser(invite.target.handle),
    ]);
    const now = ctx.now?.() ?? Date.now();
    if (
      !sender ||
      !target ||
      sender.id !== invite.sender.userId ||
      target.id !== invite.target.userId ||
      !liveInviteReachable(sender.id, now) ||
      !(await eligible(sender, target, ctx, now)) ||
      (await liveInviteTermsError(sender, target, invite))
    )
      return null;
    // Policy reads can wait on the database. Recheck leases after all awaits,
    // and never fall back to a snapshot that aged out while we were waiting.
    const finishedAt = ctx.now?.() ?? Date.now();
    if (
      !liveInviteReachable(invite.sender.userId, finishedAt) ||
      !liveInviteReachable(invite.target.userId, finishedAt)
    )
      return null;
    return { sender, target };
  }

  async function refresh(invite: LiveInvite, ctx: HttpApiContext): Promise<LiveInvite | null> {
    if (invite.status !== 'pending') return invite;
    if (!(await resolveEligible(invite, ctx)))
      store.invalidate(invite.id, ctx.now?.() ?? Date.now());
    const finishedAt = ctx.now?.() ?? Date.now();
    return store.getFor(invite.id, invite.sender.userId, finishedAt);
  }

  return async (
    ctx: HttpApiContext,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<boolean> => {
    const base = '/api/live-invites';
    if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
    response.setHeader('Cache-Control', 'no-store');
    if (!deps.available(response)) return true;
    const suffix = pathname.slice(base.length);
    const match = suffix.match(/^\/([a-zA-Z0-9-]{1,64})(?:\/(decline|accept))?$/);
    const heartbeat = suffix === '/heartbeat';
    const availability = suffix === '/availability';
    if (suffix !== '' && !heartbeat && !availability && !match) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    const methods = availability
      ? ['GET']
      : heartbeat
        ? ['POST', 'DELETE']
        : suffix === ''
          ? ['GET', 'POST']
          : match?.[2]
            ? ['POST']
            : ['GET', 'DELETE'];
    if (!requireMethod(request, response, ...methods)) return true;
    const method = request.method ?? 'GET';
    // Mutations are same-origin JSON requests. Fetch metadata remains correct
    // behind the development proxy, whose Host may differ from the page.
    if (method !== 'GET') {
      const site = request.headers['sec-fetch-site'];
      const origin = request.headers.origin;
      let allowed = site === undefined;
      if (site !== undefined) allowed = site === 'same-origin';
      else if (origin) {
        try {
          allowed = new URL(origin).host === request.headers.host;
        } catch {
          allowed = false;
        }
      }
      if (!allowed) {
        writeJson(response, 403, { error: 'forbidden_origin' });
        return true;
      }
      if (
        method === 'POST' &&
        request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
      ) {
        writeJson(response, 415, { error: 'json_required' });
        return true;
      }
    }
    const user = await deps.currentUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    try {
      const now = ctx.now?.() ?? Date.now();
      if (availability) {
        const handles = new URL(request.url ?? pathname, 'http://localhost').searchParams.getAll(
          'handle',
        );
        if (
          !handles.length ||
          handles.length > 50 ||
          handles.some((handle) => !/^[a-zA-Z0-9_-]{1,40}$/.test(handle))
        ) {
          writeJson(response, 400, { error: 'invalid_handles' });
          return true;
        }
        const admission = admissionFor(ctx);
        const senderBusy =
          busyLiveInviteUsers(ctx).has(user.id) || !!(await admission.find({ userId: user.id }));
        const players = [];
        for (const handle of new Set(handles)) {
          const target = await deps.findUser(handle);
          let state: 'available' | 'busy' | 'offline' | 'unavailable' = 'unavailable';
          // This is a private connection lookup, never a public presence oracle.
          // Withheld profiles and policy failures share one opaque outcome.
          if (
            target &&
            target.id !== user.id &&
            target.profileVisibility !== 'private' &&
            !senderBusy &&
            (await policyEligible(user, target))
          ) {
            const targetBusy =
              busyLiveInviteUsers(ctx).has(target.id) ||
              !!(await admission.find({ userId: target.id }));
            state = !liveInviteReachable(target.id, ctx.now?.() ?? Date.now())
              ? 'offline'
              : targetBusy
                ? 'busy'
                : 'available';
          }
          players.push({ handle, availability: state });
        }
        writeJson(response, 200, { players });
        return true;
      }
      if (heartbeat) {
        if (method === 'DELETE') {
          leaveLiveInvites(user.id);
          writeJson(response, 200, { ok: true });
        } else if (persistence.isPlayDisabled(user) || user.closedAt)
          writeJson(response, 403, { error: 'play_disabled' });
        else if (!heartbeatLiveInvites(user.id, now))
          writeJson(response, 503, { error: 'invite_capacity' });
        else
          writeJson(response, 200, {
            pollAfterMs: LIVE_INVITE_POLL_MS,
            leaseMs: LIVE_INVITE_LEASE_MS,
          });
        return true;
      }
      if (suffix === '' && method === 'GET') {
        const incoming: ReturnType<typeof liveInviteView>[] = [];
        const outgoing: ReturnType<typeof liveInviteView>[] = [];
        for (const invite of store.listFor(user.id, now)) {
          const fresh = await refresh(invite, ctx);
          if (fresh && ['pending', 'accepting', 'accepted'].includes(fresh.status))
            (fresh.sender.userId === user.id ? outgoing : incoming).push(
              liveInviteView(fresh, user.id),
            );
        }
        writeJson(response, 200, { incoming, outgoing, pollAfterMs: LIVE_INVITE_POLL_MS });
        return true;
      }
      if (suffix === '' && method === 'POST') {
        if (persistence.isPlayDisabled(user) || user.closedAt) {
          writeJson(response, 403, { error: 'play_disabled' });
          return true;
        }
        if (!store.allowSend(user.id, now)) {
          writeJson(
            response,
            429,
            { error: 'rate_limited' },
            { 'Retry-After': String(LIVE_INVITE_TTL_MS / 1000) },
          );
          return true;
        }
        const body = await readJsonBody(request);
        const timeControl = parseRoomTimeControl(body.timeControl);
        if (
          typeof body.targetHandle !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,40}$/.test(body.targetHandle) ||
          typeof body.gameSpecId !== 'string' ||
          !timeControl ||
          (body.rated !== undefined && typeof body.rated !== 'boolean') ||
          (body.preferredColor !== undefined &&
            (typeof body.preferredColor !== 'string' ||
              !['first', 'second', 'random'].includes(body.preferredColor)))
        ) {
          writeJson(response, 400, { error: 'invalid_invite' });
          return true;
        }
        const target = await deps.findUser(body.targetHandle);
        if (
          !target ||
          target.id === user.id ||
          !(await eligible(user, target, ctx, ctx.now?.() ?? Date.now()))
        ) {
          writeJson(response, 409, { error: 'target_unavailable' });
          return true;
        }
        const terms: LiveInviteTerms = {
          gameSpecId: body.gameSpecId,
          timeControl,
          rated: body.rated === true,
          preferredColor: (body.preferredColor ?? 'random') as LiveInviteTerms['preferredColor'],
        };
        const error = await liveInviteTermsError(user, target, terms);
        if (error) {
          writeJson(response, 400, { error });
          return true;
        }
        const admission = admissionFor(ctx);
        if (
          (await admission.find({ userId: user.id })) ||
          (await admission.find({ userId: target.id }))
        ) {
          writeJson(response, 409, { error: 'target_unavailable' });
          return true;
        }
        // No await between the last liveness check and the synchronous insert.
        const createdAt = ctx.now?.() ?? Date.now();
        const busy = busyLiveInviteUsers(ctx);
        if (
          !liveInviteReachable(target.id, createdAt) ||
          busy.has(user.id) ||
          busy.has(target.id)
        ) {
          writeJson(response, 409, { error: 'target_unavailable' });
          return true;
        }
        if (ctx.refusesCreate()) {
          writeJson(response, 503, { error: 'server_draining' });
          return true;
        }
        if (!heartbeatLiveInvites(user.id, createdAt)) {
          writeJson(response, 503, { error: 'invite_capacity' });
          return true;
        }
        const party = (account: InviteUser) => ({
          userId: account.id,
          handle: account.handle,
          displayName: account.displayName,
        });
        const result = store.create(party(user), party(target), terms, createdAt);
        if (!result.ok)
          writeJson(response, result.error === 'invite_capacity' ? 503 : 409, {
            error: result.error,
          });
        else writeJson(response, 201, { invite: liveInviteView(result.invite, user.id) });
        return true;
      }
      const id = match![1]!;
      let invite = store.getFor(id, user.id, now);
      if (!invite) {
        writeJson(response, 404, { error: 'not_found' });
        return true;
      }
      if (match?.[2] === 'accept') {
        if (invite.target.userId !== user.id) {
          writeJson(response, 404, { error: 'not_found' });
          return true;
        }
        if (invite.status === 'accepted') {
          writeJson(response, 200, { invite: liveInviteView(invite, user.id) });
          return true;
        }
        if (!store.beginAccept(id, user.id, now)) {
          writeJson(response, 409, { error: 'invite_unavailable' });
          return true;
        }
        const reservations: LiveGameReservation[] = [];
        try {
          if (!persistence.isInitialized()) {
            writeJson(response, 503, { error: 'persistence_disabled' });
            return true;
          }
          let accounts = await resolveEligible(invite, ctx);
          if (!accounts) {
            store.retryAccept(id, ctx.now?.() ?? Date.now());
            store.invalidate(id, ctx.now?.() ?? Date.now());
            writeJson(response, 409, { error: 'invite_unavailable' });
            return true;
          }
          for (const account of [accounts.sender, accounts.target]) {
            const result = await admissionFor(ctx).reserve({ userId: account.id }, id);
            if (!result.ok) {
              store.retryAccept(id, ctx.now?.() ?? Date.now());
              store.invalidate(id, ctx.now?.() ?? Date.now());
              writeJson(response, 409, { error: 'invite_unavailable' });
              return true;
            }
            reservations.push(result.reservation);
          }
          // Durable ownership reads can wait. Re-read account policy and
          // variant access after both reservations, before admitting creation.
          accounts = await resolveEligible(invite, ctx);
          if (!accounts) {
            store.retryAccept(id, ctx.now?.() ?? Date.now());
            store.invalidate(id, ctx.now?.() ?? Date.now());
            writeJson(response, 409, { error: 'invite_unavailable' });
            return true;
          }
          const admittedAt = ctx.now?.() ?? Date.now();
          const busy = busyLiveInviteUsers(ctx);
          if (
            admittedAt >= invite.expiresAt ||
            !liveInviteReachable(accounts.sender.id, admittedAt) ||
            !liveInviteReachable(accounts.target.id, admittedAt) ||
            busy.has(accounts.sender.id) ||
            busy.has(accounts.target.id)
          ) {
            store.retryAccept(id, admittedAt);
            store.invalidate(id, admittedAt);
            writeJson(response, 409, { error: 'invite_unavailable' });
            return true;
          }
          if (ctx.refusesCreate()) {
            writeJson(response, 503, { error: 'server_draining' });
            return true;
          }
          const senderFirst =
            invite.preferredColor === 'first' ||
            (invite.preferredColor === 'random' && randomInt(2) === 0);
          const identity = (account: InviteUser) => ({
            userId: account.id,
            userHandle: account.handle,
            userDisplayName: account.displayName,
            ...seatDecorationsForAccount(account),
          });
          const tenant = variantTenantForSpecId(invite.gameSpecId);
          const terms = invite;
          const created = await createWithAccountSeats(
            identity(senderFirst ? accounts.sender : accounts.target),
            identity(senderFirst ? accounts.target : accounts.sender),
            // An accepted live challenge (#1229 pairing tag).
            () =>
              createWithPairing('live-challenge', async () => {
                if (tenant?.lobby) return tenant.lobby.createRoom(terms.timeControl, terms.rated);
                if (terms.gameSpecId !== 'dark-chess') throw new Error('unsupported invite spec');
                return ctx.createRoom(
                  'pvp',
                  'dark-chess',
                  ctx.pveBuiltinEngineClientId,
                  terms.timeControl,
                  terms.rated,
                );
              }),
          );
          store.accept(
            id,
            {
              id: created.room.id,
              senderSeat: senderFirst ? created.seats.first : created.seats.second,
              targetSeat: senderFirst ? created.seats.second : created.seats.first,
            },
            ctx.now?.() ?? Date.now(),
          );
          invite = store.getFor(id, user.id, ctx.now?.() ?? Date.now())!;
          writeJson(response, 200, { invite: liveInviteView(invite, user.id) });
        } catch {
          writeJson(response, 503, { error: 'room_create_failed' });
        } finally {
          for (const reservation of reservations) reservation.release();
          store.retryAccept(id, ctx.now?.() ?? Date.now());
        }
        return true;
      }
      if (method === 'DELETE' || match?.[2] === 'decline') {
        invite = store.closeFor(id, user.id, method === 'DELETE' ? 'cancelled' : 'declined', now);
        if (!invite) writeJson(response, 404, { error: 'not_found' });
        else writeJson(response, 200, { invite: liveInviteView(invite, user.id) });
      } else {
        const fresh = await refresh(invite, ctx);
        if (!fresh) writeJson(response, 404, { error: 'not_found' });
        else writeJson(response, 200, { invite: liveInviteView(fresh, user.id) });
      }
    } catch (error) {
      if (error instanceof SyntaxError) writeJson(response, 400, { error: 'invalid_body' });
      else if (error instanceof RequestBodyTooLargeError)
        writeJson(response, 413, { error: 'request_body_too_large' });
      else throw error;
    }
    return true;
  };
}

export const tryHandle = createLiveInviteHandler(
  {
    currentUser: currentAccountUser,
    findUser: persistence.findUserByHandle,
    hasFollow: persistence.hasFollow,
    hasBlock: persistence.hasBlock,
    available: requirePersistence,
  },
  liveInvites,
);
