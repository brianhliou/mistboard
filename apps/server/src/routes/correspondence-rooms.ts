import type { ServerResponse } from 'node:http';
import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  correspondenceTimeControl,
  DARK_CHESS_SPEC_ID,
  DAY_MS,
  DAYS_PER_MOVE_OPTIONS,
  type DaysPerMove,
  type RoomTimeControl,
} from '@mistboard/game';
import { correspondenceEnabled } from './../feature-flags.js';
import type { UserAccount } from './../persistence.js';
import * as persistence from './../persistence.js';
import { isProductionLikeRuntime } from './../server-policy.js';
import { writeJson } from './lib.js';

// Correspondence eligibility: a fail-closed hand-coded allowlist — a new spec is
// correspondence-ineligible until deliberately added here.
//
// Fork-6 (2026-06-11) originally limited this to HIDDEN-INFORMATION specs, since at
// days-per-move cadence engine assistance is unenforceable. PARTIALLY REVERSED 2026-07-04
// (Brian): perfect-information correspondence is allowed, on the then-argument that the
// cheating harm concentrates on RATINGS and correspondence was casual-only.
//
// RATED CORRESPONDENCE, 2026-10-02 (Brian, explicit gate clearance): a seek or challenge
// may now be rated, chosen at creation, and a rated game writes the variant's OWN
// 'correspondence' pool (rating-buckets.ts), never a live ladder, so engine assistance at
// days-per-move cadence can inflate only that pool. Live paces still never admit a
// correspondence time control (isOfficialTimeControl short-circuits on daysPerMove).
// Which specs may be rated: isCorrespondenceRatedSpec (@mistboard/game). This direct
// create route (dark chess, friend rooms) stays casual.
//
// Deliberately NOT derived from a capability (e.g. GameSpec.visibility): xiangqi is
// visibility 'open', so any visibility-derived rule would exclude exactly the spec this
// reversal is for. Membership is a product decision, so it stays written down.
//
// Each member MUST also supply sweepDueDeadline AND createCorrespondenceGameForSeek on its
// registration — a correspondence game with no deadline sweeper never times out.
// correspondence-eligibility.test.ts holds that pairing.
//
// The member list lives in @mistboard/game (CORRESPONDENCE_ELIGIBLE_SPEC_IDS) so the web
// pickers derive from the same source; this Set is just its lookup form.
export const CORRESPONDENCE_ELIGIBLE_SPECS: ReadonlySet<string> = new Set(
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
);

// Dev/test only: accept compressed non-official allowances (fractional
// daysPerMove, e.g. 0.002 ≈ 3 minutes) so a full deadline cycle is testable
// without waiting days. Hard-disabled in production-like runtimes, matching
// the dev auth-code pattern.
export function devCorrespondenceTimeControlsEnabled(): boolean {
  return process.env.MISTBOARD_DEV_CORRESPONDENCE_TC === 'true' && !isProductionLikeRuntime();
}

export type CorrespondenceCreateContext = {
  databaseRequired: boolean;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  // Defaults to the real persistence module; injectable for tests.
  isPersistenceInitialized?(): boolean;
  createCorrespondenceRoom(
    timeControl: RoomTimeControl,
    creatorPreference?: 'white' | 'black' | 'random',
  ): Promise<
    | { ok: true; room: { id: string; gameSpecId: string } }
    | { ok: false; error: 'disabled' | 'persistence_failure' | 'room_id_collision' }
  >;
};

// Disjoint from the chess fallback (which serves plain dark-chess live
// creates) and from the other tenants' matchers (which claim on their own
// gameSpecId): correspondence claims only the explicit mode.
export function requestsCorrespondence(body: Record<string, unknown>): boolean {
  return body.mode === 'correspondence' && body.gameSpecId === DARK_CHESS_SPEC_ID;
}

export async function handleCorrespondenceCreate(
  ctx: CorrespondenceCreateContext,
  response: ServerResponse,
  body: Record<string, unknown>,
  accountUser: UserAccount | null,
): Promise<void> {
  if (!correspondenceEnabled()) {
    writeJson(response, 404, { error: 'correspondence_disabled' });
    return;
  }
  // The matcher already narrows to dark chess; this is the fork-6 allowlist
  // staying fail-closed even if a future matcher widens.
  if (typeof body.gameSpecId !== 'string' || !CORRESPONDENCE_ELIGIBLE_SPECS.has(body.gameSpecId)) {
    writeJson(response, 501, { error: 'correspondence_unsupported_spec' });
    return;
  }
  // Account-only by decision: durable identity for cross-device reseating and
  // notifications. The deliberate exception to account-optional v1.
  if (!accountUser) {
    writeJson(response, 401, { error: 'correspondence_requires_account' });
    return;
  }
  const timeControl = parseCorrespondenceTimeControl(body.daysPerMove);
  if (!timeControl) {
    writeJson(response, 400, { error: 'invalid_days_per_move' });
    return;
  }
  const preferredColor = parsePreferredColor(body.preferredColor);
  // Correspondence games are durable by definition: without persistence the
  // event log, deadline enforcement, and reseating all vanish on restart.
  // Hard requirement regardless of ctx.databaseRequired.
  if (!(ctx.isPersistenceInitialized ?? persistence.isInitialized)()) {
    writeJson(response, 503, { error: 'persistence_disabled' });
    return;
  }
  if (ctx.isDraining()) {
    writeJson(response, 503, { error: 'server_draining', restartAt: ctx.drainDeadlineMs() });
    return;
  }

  const created = await ctx.createCorrespondenceRoom(timeControl, preferredColor);
  if (!created.ok) {
    const status =
      created.error === 'disabled' ? 404 : created.error === 'persistence_failure' ? 503 : 500;
    writeJson(response, status, {
      error: created.error === 'disabled' ? 'correspondence_disabled' : created.error,
    });
    return;
  }
  writeJson(response, 201, {
    roomId: created.room.id,
    url: `/room/${encodeURIComponent(created.room.id)}`,
    mode: 'correspondence',
    gameSpecId: created.room.gameSpecId,
    rated: false,
    region: 'global',
    timeControl,
  });
}

export function parseCorrespondenceTimeControl(daysPerMove: unknown): RoomTimeControl | null {
  if (typeof daysPerMove !== 'number' || !Number.isFinite(daysPerMove)) return null;
  if ((DAYS_PER_MOVE_OPTIONS as readonly number[]).includes(daysPerMove)) {
    return correspondenceTimeControl(daysPerMove as DaysPerMove);
  }
  if (devCorrespondenceTimeControlsEnabled() && daysPerMove > 0 && daysPerMove <= 14) {
    return { initialMs: Math.round(daysPerMove * DAY_MS), incrementMs: 0, daysPerMove };
  }
  return null;
}

export function parsePreferredColor(value: unknown): 'white' | 'black' | 'random' | undefined {
  if (value === 'white' || value === 'black' || value === 'random') return value;
  return undefined;
}
