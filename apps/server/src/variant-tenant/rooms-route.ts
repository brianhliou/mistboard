// Generic room-creation route factory for variant tenants.
//
// The per-variant `routes/<variant>-rooms.ts` handlers were ~73% identical
// boilerplate: the fail-closed game-spec + launch-flag gate, request parsing,
// the supported-surface gate (mode / rated / engine-id rejections), the
// PvE-engine seating, persistence + drain guards, room-factory result mapping,
// and the 201 envelope. This factory single-sources that logic; each route file
// keeps its exported names (`requests<Variant>`, `handle<Variant>Create`, the
// `<Variant>CreateContext` type, the PvE seat helper) and supplies a small
// config + a closure that maps the resolved inputs onto its concrete
// `create<Variant>Room` signature.
//
// Fail-closed invariant (see CLAUDE.md "Variant dispatch is fail-closed"): each
// instance binds exactly one gameSpecId and its own matcher. There is NO
// catch-all default; an unknown spec never resolves to a tenant here — the
// game-spec gate and the disjoint per-tenant matchers keep unknown ids out.
//
// NOT covered here (left as one-offs): live-engine-seat RESERVATION tenants
// (dark-xiangqi, dark-mini-xiangqi — they reserve a seat before the persistence
// gate, a different step order) and
// correspondence (days-per-move allowlist, account-required, mode-based
// matcher). Those keep their bespoke handlers.

import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import {
  defaultClockIncrementMs,
  defaultClockInitialMs,
  type RoomTimeControl,
} from '@mistboard/game';
import { ratedEnabled } from '../feature-flags.js';
import { gateGameSpecRequest } from '../game-spec-request-gate.js';
import type { UserAccount } from '../persistence.js';
import * as persistence from '../persistence.js';
import { isAllowedRatedTimeControl, parseRoomTimeControl, writeJson } from '../routes/lib.js';

// The HTTP-context slice every tenant create handler reads. Each tenant's
// concrete `<Variant>CreateContext` (which also carries its bound
// `create<Variant>Room`) structurally satisfies this.
export type TenantRoomCreateBaseContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
};

// The type-erased room-factory result the route maps onto HTTP. A tenant's
// concrete result (`{ ok: true; room: {...} } | { ok: false; error: '<x>_disabled' | ... }`)
// is assignable to this: the room's `rated` is optional and the error union
// widens to `string`.
export type TenantRoomCreateResult =
  | { ok: true; room: { id: string; gameSpecId: string; rated?: boolean } }
  | { ok: false; error: string };

// Inputs the route resolves from the request body. The tenant closure maps
// these onto its real `create<Variant>Room` signature (arg order/shape varies).
export type TenantRoomCreateParams<Pref extends string, Seat extends string> = {
  timeControl: RoomTimeControl | undefined;
  preferredColor: Pref | undefined;
  rated: boolean;
  engine: { engineId: string; seat: Seat; botId?: string } | undefined;
};

// Rated policy. Governs the rejection error string AND the surface-gate order:
// `reject-as-surface` tenants check the invalid-time-control guard first
// (banqi/jieqi/jungle/PvP-only); `reject-as-rated` and `account-gated` tenants
// check the mode surface first (fortress/drop-mini/mini).
export type TenantRatedPolicy =
  // rated → `${errorPrefix}_unsupported_surface`, folded into the surface gate.
  // The rated flag is never forwarded to the factory.
  | { kind: 'reject-as-surface' }
  // rated → `rated_unsupported_surface` (casual-only, e.g. Mini Xiangqi). The
  // rated flag is never forwarded (always casual).
  | { kind: 'reject-as-rated' }
  // Full account-gated rated: PvE+rated rejected at the surface gate; PvP+rated
  // runs the flag/account/time-control gates and the resolved flag forwards.
  | { kind: 'account-gated' };

// Engine policy for the PvE branch.
export type TenantEnginePolicy<Seat extends string> =
  // PvP-only: no engine branch. `rejectEngineId` mirrors the tenants that fold
  // `body.engineId !== undefined` into their unsupported-surface gate.
  | { kind: 'none'; rejectEngineId: boolean }
  // The server seats the bots itself, always, and the client never asks for
  // one. Mahjong: a table needs four players, so every room is bot-seated and
  // 'pvp' vs 'pve' is not a choice anybody makes. Both modes are accepted and
  // mean the same room, because a player clicking "play the computer" and a
  // player following a bare create link should not get different answers.
  | { kind: 'always-seated' }
  // Server-owned engine seated opposite the human. `seats` is
  // [firstMover, secondMover]; the human keeps the first-mover seat by default.
  | {
      kind: 'seated';
      defaultEngineId: string;
      isEngineClientId(engineId: string): boolean;
      seats: readonly [Seat, Seat];
    };

export type TenantRoomsRouteConfig<
  Ctx extends TenantRoomCreateBaseContext,
  Pref extends string,
  Seat extends string,
> = {
  gameSpecId: string;
  // snake_case wire prefix: `${errorPrefix}_disabled | _not_integrated | _unsupported_surface`.
  errorPrefix: string;
  // Whether the game-spec gate can report `${errorPrefix}_disabled` (a launch
  // flag). Mini Xiangqi has no flag, so it never runs the disabled branch.
  hasDisabledFlag: boolean;
  // Accepted preferredColor values (validation set); the parsed value forwards
  // to the factory as-is.
  preferredColors: readonly Pref[];
  engine: TenantEnginePolicy<Seat>;
  rated: TenantRatedPolicy;
  // Bind the tenant's concrete `create<Variant>Room` off the per-call context.
  createRoom(ctx: Ctx, params: TenantRoomCreateParams<Pref, Seat>): Promise<TenantRoomCreateResult>;
  // Optional matcher override; defaults to `body.gameSpecId === gameSpecId`.
  matchesCreateRequest?(body: Record<string, unknown>): boolean;
};

export type TenantRoomsRoute<Ctx extends TenantRoomCreateBaseContext> = {
  matchesCreateRequest(body: Record<string, unknown>): boolean;
  handleCreate(
    ctx: Ctx,
    response: ServerResponse,
    body: Record<string, unknown>,
    accountUser?: UserAccount | null,
  ): Promise<void>;
};

// The first-mover seat helper shared by every seated-engine tenant: the human
// keeps the first-mover seat by default, takes the second only when explicitly
// chosen, and coin-flips on 'random'. The engine takes the opposite seat.
export function resolveFirstMoverHumanSeat<Seat extends string>(
  preferred: string | undefined,
  seats: readonly [Seat, Seat],
  randomByte: number = randomBytes(1)[0]!,
): Seat {
  const [first, second] = seats;
  if (preferred === second) return second;
  if (preferred === 'random') return randomByte < 128 ? first : second;
  return first;
}

export function createTenantRoomsRoute<
  Ctx extends TenantRoomCreateBaseContext,
  Pref extends string = string,
  Seat extends string = string,
>(config: TenantRoomsRouteConfig<Ctx, Pref, Seat>): TenantRoomsRoute<Ctx> {
  const notIntegratedError = `${config.errorPrefix}_not_integrated`;
  const disabledError = `${config.errorPrefix}_disabled`;
  const unsupportedSurfaceError = `${config.errorPrefix}_unsupported_surface`;
  const acceptedColors = config.preferredColors as readonly string[];

  const matchesCreateRequest =
    config.matchesCreateRequest ??
    ((body: Record<string, unknown>): boolean => body.gameSpecId === config.gameSpecId);

  function parseMode(body: Record<string, unknown>): 'pvp' | 'pve' | null {
    if (body.mode === 'pvp' || body.mode === 'pve') return body.mode;
    return null;
  }

  function parsePreferred(value: unknown): Pref | undefined {
    return typeof value === 'string' && acceptedColors.includes(value)
      ? (value as Pref)
      : undefined;
  }

  async function handleCreate(
    ctx: Ctx,
    response: ServerResponse,
    body: Record<string, unknown>,
    accountUser: UserAccount | null = null,
  ): Promise<void> {
    // 1. Fail-closed game-spec + launch-flag gate.
    const gate = gateGameSpecRequest({ gameSpecId: body.gameSpecId, variant: body.variant });
    if (body.gameSpecId !== config.gameSpecId) {
      if (gate.type === 'reject') {
        writeJson(response, gate.httpStatus, { error: gate.error });
        return;
      }
      writeJson(response, 501, { error: notIntegratedError });
      return;
    }
    if (config.hasDisabledFlag && gate.type === 'reject' && gate.error === disabledError) {
      writeJson(response, gate.httpStatus, { error: gate.error });
      return;
    }

    const mode = parseMode(body);
    const preferredColor = parsePreferred(body.preferredColor);
    // Omitting timeControl used to yield a room with NO clock at all
    // (createTenantRuntimeRoom only emits `clock-started` when one is supplied).
    // A clockless room past move 1 with both players gone is reachable by no
    // reaper -- nothing can flag it, the pregame window has passed, and the
    // leaver-forfeit needs exactly one seat absent -- so it sat in `playing`
    // until the process restarted. Defaulting rather than rejecting keeps the
    // long-standing "omit for a casual room" API shape working; it just gets the
    // same default clock the legacy stack already applies. Engine self-play is
    // untimed by design and runs headless in the worker, never through here.
    const parsedTimeControl =
      body.timeControl === undefined ? undefined : parseRoomTimeControl(body.timeControl);
    const timeControl =
      body.timeControl === undefined
        ? { initialMs: defaultClockInitialMs, incrementMs: defaultClockIncrementMs }
        : parsedTimeControl;
    const invalidTimeControl = body.timeControl !== undefined && !parsedTimeControl;

    // Supported-surface gate. Returns true when it has written a response.
    const runSurfaceGate = (): boolean => {
      const modeOk =
        config.engine.kind === 'none'
          ? mode === 'pvp'
          : config.engine.kind === 'always-seated'
            ? true
            : mode !== null;
      if (!modeOk) {
        writeJson(response, 501, { error: unsupportedSurfaceError });
        return true;
      }
      // An engine id is ACCEPTED and ignored where the server picks the seats
      // itself. The picker offers exactly one option for such a variant, so the
      // only id a client can send is the one it would have got anyway;
      // rejecting it instead made the Start button fail.
      if (
        config.engine.kind === 'none' &&
        config.engine.rejectEngineId &&
        body.engineId !== undefined
      ) {
        writeJson(response, 501, { error: unsupportedSurfaceError });
        return true;
      }
      switch (config.rated.kind) {
        case 'reject-as-surface':
          if (body.rated === true) {
            writeJson(response, 501, { error: unsupportedSurfaceError });
            return true;
          }
          break;
        case 'reject-as-rated':
          if (body.rated === true) {
            writeJson(response, 501, { error: 'rated_unsupported_surface' });
            return true;
          }
          break;
        case 'account-gated':
          if (mode === 'pve' && body.rated === true) {
            writeJson(response, 501, { error: unsupportedSurfaceError });
            return true;
          }
          break;
      }
      return false;
    };

    const runInvalidTimeControlGate = (): boolean => {
      if (invalidTimeControl) {
        writeJson(response, 400, { error: 'invalid_time_control' });
        return true;
      }
      return false;
    };

    // `reject-as-surface` tenants check invalid-time-control BEFORE the surface
    // gate; the others check the mode surface first (see TenantRatedPolicy).
    if (config.rated.kind === 'reject-as-surface') {
      if (runInvalidTimeControlGate()) return;
      if (runSurfaceGate()) return;
    } else {
      if (runSurfaceGate()) return;
      if (runInvalidTimeControlGate()) return;
    }

    // Account-gated rated flow (PvP + rated only), after the surface + tc guards.
    let rated = false;
    if (config.rated.kind === 'account-gated') {
      const wantsRated = mode === 'pvp' && body.rated === true;
      if (wantsRated && !ratedEnabled()) {
        writeJson(response, 403, { error: 'rated_disabled' });
        return;
      }
      if (wantsRated && !accountUser) {
        writeJson(response, 401, { error: 'rated_requires_account' });
        return;
      }
      // Fail CLOSED on a missing time control too. This used to read
      // `wantsRated && timeControl && !isAllowed...`, so omitting timeControl
      // skipped the check and produced a RATED room with no clock -- which is
      // incoherent (rated requires a real time control) and, until the
      // 'unjoined' window landed, unreapable as well.
      if (wantsRated && (!timeControl || !isAllowedRatedTimeControl(timeControl))) {
        writeJson(response, 400, { error: 'rated_time_control_unsupported' });
        return;
      }
      rated = wantsRated;
    }

    if (ctx.databaseRequired && !persistence.isInitialized()) {
      writeJson(response, 503, { error: 'persistence_disabled' });
      return;
    }
    if (ctx.isDraining()) {
      writeJson(response, 503, { error: 'server_draining', restartAt: ctx.drainDeadlineMs() });
      return;
    }

    // PvE: seat the server-owned engine opposite the human.
    let engine: { engineId: string; seat: Seat; botId?: string } | undefined;
    if (config.engine.kind === 'seated' && mode === 'pve') {
      const enginePolicy = config.engine;
      const engineId =
        typeof body.engineId === 'string' && body.engineId.length > 0
          ? body.engineId
          : enginePolicy.defaultEngineId;
      if (!enginePolicy.isEngineClientId(engineId)) {
        writeJson(response, 400, { error: 'invalid_engine' });
        return;
      }
      const botId = typeof body.botId === 'string' ? body.botId : undefined;
      const [first, second] = enginePolicy.seats;
      const humanSeat = resolveFirstMoverHumanSeat(preferredColor, enginePolicy.seats);
      engine = {
        engineId,
        seat: humanSeat === first ? second : first,
        ...(botId ? { botId } : {}),
      };
    }

    const created = await config.createRoom(ctx, {
      timeControl: timeControl ?? undefined,
      preferredColor,
      rated,
      engine,
    });
    if (!created.ok) {
      const status =
        created.error === disabledError ? 404 : created.error === 'persistence_failure' ? 503 : 500;
      writeJson(response, status, { error: created.error });
      return;
    }
    const includeRated = config.rated.kind !== 'reject-as-surface';
    writeJson(response, 201, {
      roomId: created.room.id,
      url: `/room/${encodeURIComponent(created.room.id)}`,
      mode,
      gameSpecId: created.room.gameSpecId,
      ...(includeRated ? { rated: created.room.rated } : {}),
      region: 'global',
      ...(timeControl ? { timeControl } : {}),
    });
  }

  return { matchesCreateRequest, handleCreate };
}
