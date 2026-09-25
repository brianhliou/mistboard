import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import {
  DARK_XIANGQI_SPEC_ID,
  defaultEngineTimeControl,
  isAllowedEngineTimeControl,
  type RoomTimeControl,
} from '@mistboard/game';
import {
  DARK_XIANGQI_DEFAULT_ENGINE_ID,
  isDarkXiangqiEngineClientId,
} from './../engines/registry.js';
import { gateGameSpecRequest } from './../game-spec-request-gate.js';
import * as persistence from './../persistence.js';
import { parseRoomTimeControl, writeJson } from './lib.js';

// The slice of server context this route needs; the registry entry binds the
// tenant's room factory in (dark-xiangqi-registration.ts).
export type DarkXiangqiCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  reserveLiveEngineSeat(engineId: string, color: 'white' | 'black'): Promise<string | null>;
  createDarkXiangqiRoom(
    timeControl?: RoomTimeControl,
    creatorPreference?: 'red' | 'black' | 'random',
    engine?: { engineId: string; seat: 'red' | 'black'; reservationId: string; botId?: string },
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string } }
    | { ok: false; error: 'dark_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision' }
  >;
};

export function requestsDarkXiangqi(body: Record<string, unknown>): boolean {
  return body.gameSpecId === DARK_XIANGQI_SPEC_ID;
}

export async function handleDarkXiangqiCreate(
  ctx: DarkXiangqiCreateContext,
  response: ServerResponse,
  body: Record<string, unknown>,
): Promise<void> {
  const gameSpecGate = gateGameSpecRequest({
    gameSpecId: body.gameSpecId,
    variant: body.variant,
  });
  if (body.gameSpecId !== DARK_XIANGQI_SPEC_ID) {
    if (gameSpecGate.type === 'reject') {
      writeJson(response, gameSpecGate.httpStatus, { error: gameSpecGate.error });
      return;
    }
    writeJson(response, 501, { error: 'dark_xiangqi_not_integrated' });
    return;
  }
  if (gameSpecGate.type === 'reject' && gameSpecGate.error === 'dark_xiangqi_disabled') {
    writeJson(response, gameSpecGate.httpStatus, { error: gameSpecGate.error });
    return;
  }
  const mode = parseDarkXiangqiRoomMode(body);
  const preferredColor = parseDarkXiangqiPreferredColor(body.preferredColor);
  const timeControl =
    body.timeControl === undefined ? undefined : parseRoomTimeControl(body.timeControl);
  if (body.timeControl !== undefined && !timeControl) {
    writeJson(response, 400, { error: 'invalid_time_control' });
    return;
  }
  if (mode === null || body.rated === true || (mode === 'pvp' && body.engineId !== undefined)) {
    writeJson(response, 501, { error: 'dark_xiangqi_unsupported_surface' });
    return;
  }
  // An engine that cannot honor a pace must not be handed one (#283). Checked
  // before the seat reservation below, so a rejected request never holds one.
  // Human games are untouched: the floor belongs to the engine, not the variant.
  // An omitted pace resolves to the bot default (10+5) rather than the room
  // factory's default clock, so a caller that names no pace cannot bypass this
  // (see routes/rooms.ts for the same resolution on the fog chess side).
  if (
    mode === 'pve' &&
    timeControl &&
    !isAllowedEngineTimeControl(DARK_XIANGQI_SPEC_ID, timeControl)
  ) {
    writeJson(response, 400, { error: 'engine_time_control_unsupported' });
    return;
  }
  const engineDefault = mode === 'pve' ? defaultEngineTimeControl(DARK_XIANGQI_SPEC_ID) : null;
  const effectiveTimeControl =
    timeControl ??
    (engineDefault
      ? { initialMs: engineDefault.initialMs, incrementMs: engineDefault.incrementMs }
      : null);
  const botId = typeof body.botId === 'string' ? body.botId : undefined;
  let engine:
    | { engineId: string; seat: 'red' | 'black'; reservationId: string; botId?: string }
    | undefined;
  if (mode === 'pve') {
    const engineId =
      typeof body.engineId === 'string' && body.engineId.length > 0
        ? body.engineId
        : DARK_XIANGQI_DEFAULT_ENGINE_ID;
    if (!isDarkXiangqiEngineClientId(engineId)) {
      writeJson(response, 400, { error: 'invalid_engine' });
      return;
    }
    const humanColor = darkXiangqiPveHumanColor(preferredColor);
    const engineSeat: 'red' | 'black' = humanColor === 'red' ? 'black' : 'red';
    let reservationId: string | null = null;
    try {
      reservationId = await ctx.reserveLiveEngineSeat(
        engineId,
        engineSeat === 'red' ? 'white' : 'black',
      );
    } catch {
      reservationId = null;
    }
    if (!reservationId) {
      writeJson(response, 503, { error: 'engine_unavailable' });
      return;
    }
    engine = { engineId, seat: engineSeat, reservationId, ...(botId ? { botId } : {}) };
  }
  if (ctx.databaseRequired && !persistence.isInitialized()) {
    writeJson(response, 503, { error: 'persistence_disabled' });
    return;
  }
  if (ctx.isDraining()) {
    writeJson(response, 503, { error: 'server_draining', restartAt: ctx.drainDeadlineMs() });
    return;
  }

  const created = await ctx.createDarkXiangqiRoom(
    effectiveTimeControl ?? undefined,
    preferredColor,
    engine,
  );
  if (!created.ok) {
    const status =
      created.error === 'dark_xiangqi_disabled'
        ? 404
        : created.error === 'persistence_failure'
          ? 503
          : 500;
    writeJson(response, status, { error: created.error });
    return;
  }
  writeJson(response, 201, {
    roomId: created.room.id,
    url: `/room/${encodeURIComponent(created.room.id)}`,
    mode,
    gameSpecId: created.room.gameSpecId,
    region: 'global',
    // The EFFECTIVE pace, so a caller that named none learns what the pin gave
    // it rather than reading back silence and assuming the house default.
    ...(effectiveTimeControl ? { timeControl: effectiveTimeControl } : {}),
  });
}

function parseDarkXiangqiRoomMode(body: Record<string, unknown>): 'pvp' | 'pve' | null {
  if (body.mode === 'pvp' || body.mode === 'pve') return body.mode;
  return null;
}

function parseDarkXiangqiPreferredColor(value: unknown): 'red' | 'black' | 'random' | undefined {
  if (value === 'red' || value === 'black' || value === 'random') return value;
  return undefined;
}

export function darkXiangqiPveHumanColor(
  preferredColor: 'red' | 'black' | 'random' | undefined,
  randomByte = randomBytes(1)[0]!,
): 'red' | 'black' {
  if (preferredColor === 'black') return 'black';
  if (preferredColor === 'random') return randomByte < 128 ? 'red' : 'black';
  return 'red';
}
