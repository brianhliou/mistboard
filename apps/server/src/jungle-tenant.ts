/**
 * Jungle VariantTenant — perfect-information 7×9 Dou Shou Qi on the Layer-3 tenant
 * contract (variant-tenant/tenant.ts).
 *
 * Jungle has NO hidden information: every position and move is public, so this is
 * the simplest tenant shape — no createSetup, no per-seat redaction, the wire
 * events pass straight through, and viewForClient is the open board for a seated
 * player. (Spectators get an empty view for now, matching banqi's /room/ policy;
 * a public spectator view can come with the spectator surface.) PvP-only at this
 * checkpoint: no `engine` block (the in-process α-β bot lands in a later phase).
 *
 * Rules authority: packages/game/src/variants-jungle.ts.
 */

import {
  type AbortReason,
  applyJungleMove,
  createInitialJungleState,
  getJunglePlayerView,
  isJungleLegalMove,
  JUNGLE_COLORS,
  JUNGLE_SPEC_ID,
  type JungleColor,
  type JungleGameState,
  type JungleMove,
  type JunglePlayerView,
  type JungleSquare,
  oppositeJungleColor,
} from '@mistboard/game';
import { jungleEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import {
  isJungleEngineClientId,
  jungleEngineDisplayName,
  jungleEngineVersion,
} from './server-jungle-engine.js';
import { tenantPveEngineId } from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

export const JUNGLE_ROOM_ID_PREFIX = 'jgl_';

export type JungleTenant = VariantTenant<
  'jungle',
  JungleColor,
  JungleMove,
  JungleGameState,
  JunglePlayerView,
  typeof JUNGLE_SPEC_ID
>;

const SQUARE = /^[a-g][1-9]$/;

export function isJungleSquare(value: unknown): value is JungleSquare {
  return typeof value === 'string' && SQUARE.test(value);
}

function isJungleColor(value: unknown): value is JungleColor {
  return value === 'red' || value === 'black';
}

function isJungleMove(value: unknown): value is JungleMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  return isJungleSquare(move.from) && isJungleSquare(move.to);
}

// Perfect information: positions + moves are public, so wire events pass through
// unchanged for EVERY seat including spectators (just stamping move-played with
// its ply). Jungle hides nothing, so a spectator has nothing to leak — this
// matches xiangqi, the open-info reference tenant.
export function jungleClientEventFor(
  event: TenantRoomEvent<JungleColor, JungleMove, typeof JUNGLE_SPEC_ID>,
  _seat: TenantSeat<JungleColor>,
  ply: number,
): TenantClientEvent<JungleColor, JungleMove, typeof JUNGLE_SPEC_ID> | null {
  if (event.type === 'move-played') return { ...event, ply };
  return event;
}

// Open info: the full truth board for the seat's perspective. Spectators get red's
// perspective, which is safe by construction — it is exactly what a seated player
// already sees, and jungle has no per-seat hidden state to differ on.
export function getJungleClientView(
  state: JungleGameState,
  client: TenantSnapshotClient<JungleColor>,
): JunglePlayerView {
  if (client.seat === 'spectator') return getJunglePlayerView(state, 'red');
  return getJunglePlayerView(state, client.seat);
}

export const jungleTenant: JungleTenant = {
  kind: 'jungle',
  gameSpecId: JUNGLE_SPEC_ID,
  roomIdPrefix: JUNGLE_ROOM_ID_PREFIX,
  colors: JUNGLE_COLORS,
  enabled: jungleEnabled,
  oppositeColor: oppositeJungleColor,
  rules: {
    createInitialState: (roomId) => createInitialJungleState(roomId),
    applyMove: (state, move) => applyJungleMove(state, move),
    isLegalMove: isJungleLegalMove,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    finishDraw: (state) => ({
      ...state,
      status: { type: 'finished', winner: null, reason: 'agreement' },
    }),
    abort: (state, reason: AbortReason) => ({
      ...state,
      status: { type: 'aborted', reason },
    }),
    isColor: isJungleColor,
    isMove: isJungleMove,
    moveFromMessage: (message) => {
      if (!isJungleSquare(message.from) || !isJungleSquare(message.to)) return null;
      return { from: message.from, to: message.to };
    },
  },
  visibility: {
    clientEventFor: jungleClientEventFor,
    viewForClient: (state, client) => getJungleClientView(state, client),
  },
  // Mark the in-process Misty Jungle engine seat as always-present so the
  // disconnect-forfeit logic never forfeits it (a PvE engine has no WS client).
  engine: {
    terminalContext: 'repetition-seed',
    isEngineClientId: isJungleEngineClientId,
    displayName: jungleEngineDisplayName,
    engineVersion: jungleEngineVersion,
    reservationReleaseTag: 'jungle',
  },
  // Surface the room mode + engine id so the client's "Play again" can re-create a
  // PvE game vs the same bot (without these it falls back to a PvP invite).
  wire: {
    snapshotExtras: (room) => {
      const pveEngineId = tenantPveEngineId(jungleTenant, room);
      return pveEngineId === null ? { roomMode: 'pvp' } : { roomMode: 'pve', pveEngineId };
    },
  },
  persistence: {
    resultForWinner: (winner: JungleColor | null): persistence.GameResult => {
      if (winner === 'red') return 'red-wins';
      if (winner === 'black') return 'black-wins';
      return 'draw';
    },
    // Map Jungle's win reasons onto the canonical GameTermination set (the
    // games_termination_check CHECK). den-entered ≈ 'race' (a goal-square win, as
    // in Dual Chess); pieces-captured ≈ 'no-legal-moves'; no-progress ≈
    // 'progress-clock'. stalemate / repetition / timeout / resignation /
    // abandonment already match. A blind cast of an unmapped reason would launder
    // an invalid string past TS and only fail at the DB write.
    termination: (reason: string): persistence.GameTermination => {
      if (reason === 'den-entered') return 'race';
      if (reason === 'pieces-captured') return 'no-legal-moves';
      if (reason === 'no-progress') return 'progress-clock';
      if (reason === 'agreement') return 'draw';
      return reason as persistence.GameTermination;
    },
    logKindPrefix: 'jungle',
    logLabel: 'Jungle',
  },
};
