// Pure helpers for directed correspondence challenges (#654). Postgame callers
// can check eligibility without importing a dialog or either room stack. The
// server remains authoritative for play locks, blocks and both players' grants.
import { DAYS_PER_MOVE_OPTIONS, officialCorrespondenceDays } from '@mistboard/game';
import {
  type CorrespondenceSpecOffer,
  correspondenceRatedAvailable,
  isCorrespondenceSpecFor,
  type StartGameInput,
  seekRequestBody,
} from './correspondence-model.js';
import type { ProfileIdentity } from './profile-link.js';

export type PostGameChallengeInput = {
  correspondenceEnabled: boolean;
  finished: boolean;
  seated: boolean;
  mode: string;
  gameSpecId: string | undefined;
  viewerHandle: string | null | undefined;
  // Use server-supplied public profile identity, never a display name or id.
  opponent: ProfileIdentity | null | undefined;
};

function normalizedHandle(handle: string | null | undefined): string {
  return (handle ?? '').trim().replace(/^@+/, '');
}

/** A slow rematch needs a signed-in player and an addressable human opponent. */
export function canOfferPostGameChallenge(
  input: PostGameChallengeInput,
  offered?: CorrespondenceSpecOffer,
): boolean {
  if (!input.correspondenceEnabled || !input.finished || !input.seated) return false;
  if (input.mode !== 'pvp' && input.mode !== 'correspondence') return false;
  if (!input.gameSpecId || !isCorrespondenceSpecFor(input.gameSpecId, offered)) return false;
  if (input.opponent?.botId) return false;
  const viewer = normalizedHandle(input.viewerHandle);
  const opponent = normalizedHandle(input.opponent?.handle);
  return !!viewer && !!opponent && viewer.toLowerCase() !== opponent.toLowerCase();
}

export type TargetedChallengeInput = Omit<StartGameInput, 'kind' | 'preferredColor'> & {
  preferredColor: string;
};

/** Never fall back to a public seek or a different variant for an invalid target
 * or selection. Rated follows the same correspondence gate as the dialog. */
export function targetedChallengeRequestBody(
  input: TargetedChallengeInput,
  correspondenceRatedModeEnabled = false,
  offered?: CorrespondenceSpecOffer,
):
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false;
      error:
        | 'handle_required'
        | 'correspondence_unsupported_spec'
        | 'invalid_days_per_move'
        | 'invalid_preferred_color';
    } {
  if (!normalizedHandle(input.handle)) return { ok: false, error: 'handle_required' };
  if (!isCorrespondenceSpecFor(input.gameSpecId, offered)) {
    return { ok: false, error: 'correspondence_unsupported_spec' };
  }
  if (!(DAYS_PER_MOVE_OPTIONS as readonly number[]).includes(input.daysPerMove)) {
    return { ok: false, error: 'invalid_days_per_move' };
  }
  const preferredColor = input.preferredColor;
  if (preferredColor !== 'random' && preferredColor !== 'first' && preferredColor !== 'second') {
    return { ok: false, error: 'invalid_preferred_color' };
  }
  return seekRequestBody({
    ...input,
    kind: 'direct',
    preferredColor,
    rated:
      input.rated === true &&
      correspondenceRatedAvailable(input.gameSpecId, correspondenceRatedModeEnabled),
  });
}

// ---- Play again by correspondence (#606, #531) ------------------------------------

/** What the postgame "Play again by correspondence" control posts: a private
 *  challenge to the same opponent, same variant, sides swapped, casual. */
export type CorrespondenceAgainOffer = {
  gameSpecId: string;
  opponentHandle: string;
  preferredColor: 'first' | 'second';
  daysPerMove: number;
};

export type CorrespondenceAgainInput = PostGameChallengeInput & {
  /** Whether the viewer moved first in the finished game; null when unknown,
   *  which offers nothing rather than guessing a side. */
  viewerMovedFirst: boolean | null;
  /** The finished game's days per move: present for a correspondence game,
   *  null or absent for a live one. */
  daysPerMove: number | null | undefined;
};

/** The days per move the new challenge carries: the finished correspondence
 *  game's own, else one day (a live game has no slow pace to copy). */
export function correspondenceAgainDays(daysPerMove: number | null | undefined): number {
  return typeof daysPerMove === 'number' &&
    (DAYS_PER_MOVE_OPTIONS as readonly number[]).includes(daysPerMove)
    ? daysPerMove
    : 1;
}

/** The offer to show after a finished game, or null when there is none: the
 *  same eligibility as canOfferPostGameChallenge, plus a known side to swap. */
export function correspondenceAgainOffer(
  input: CorrespondenceAgainInput,
  offered?: CorrespondenceSpecOffer,
): CorrespondenceAgainOffer | null {
  const days = input.daysPerMove;
  const correspondence = typeof days === 'number' && days > 0;
  const mode = correspondence ? 'correspondence' : input.mode;
  if (!canOfferPostGameChallenge({ ...input, mode }, offered)) return null;
  if (input.viewerMovedFirst === null || !input.gameSpecId) return null;
  return {
    gameSpecId: input.gameSpecId,
    opponentHandle: normalizedHandle(input.opponent?.handle),
    preferredColor: input.viewerMovedFirst ? 'second' : 'first',
    daysPerMove: correspondenceAgainDays(correspondence ? days : null),
  };
}

/** The POST /api/correspondence/seeks body for an offer: always casual, always
 *  directed. Null when the offer no longer validates (a variant switched off). */
export function correspondenceAgainRequestBody(
  offer: CorrespondenceAgainOffer,
  offered?: CorrespondenceSpecOffer,
): Record<string, unknown> | null {
  const request = targetedChallengeRequestBody(
    {
      handle: offer.opponentHandle,
      gameSpecId: offer.gameSpecId,
      daysPerMove: offer.daysPerMove,
      preferredColor: offer.preferredColor,
      rated: false,
    },
    false,
    offered,
  );
  return request.ok ? request.body : null;
}

/** A finished game's seat as the review envelope lists it (ReviewMetaPlayer). */
export type FinishedGameSeat = {
  color: string;
  handle?: string | null;
  botId?: string | null;
};

/** The review page's view of who the viewer was: their seat's opponent and
 *  whether they moved first, or null when the viewer did not play (a spectator,
 *  a signed-out reader) or the game was not two seats. Move order is red or
 *  white first, unless the page names the first mover (Gomoku's opening). */
export function finishedGameViewerSeat(
  players: readonly FinishedGameSeat[] | undefined,
  viewerHandle: string | null | undefined,
  firstMoverColor?: string,
): { viewer: FinishedGameSeat; opponent: FinishedGameSeat; viewerMovedFirst: boolean } | null {
  if (players?.length !== 2) return null;
  const handle = normalizedHandle(viewerHandle).toLowerCase();
  if (!handle) return null;
  const index = players.findIndex(
    (player) => !player.botId && normalizedHandle(player.handle).toLowerCase() === handle,
  );
  if (index < 0) return null;
  const viewer = players[index]!;
  const opponent = players[1 - index]!;
  const viewerMovedFirst = firstMoverColor
    ? viewer.color === firstMoverColor
    : viewer.color === 'red' || viewer.color === 'white';
  return { viewer, opponent, viewerMovedFirst };
}

/** Days per move off a finished game's time control: the nested
 *  `timeControl.daysPerMove` when the envelope has one, else the persisted
 *  clock read as an official correspondence pace. Null for a live game. */
export function finishedGameDaysPerMove(game: {
  initialMs?: number | null;
  incrementMs?: number | null;
  timeControl?: Record<string, unknown> | null;
}): number | null {
  const nested = game.timeControl?.daysPerMove;
  if (typeof nested === 'number' && nested > 0) return nested;
  const initialMs =
    game.initialMs ??
    (typeof game.timeControl?.initialMs === 'number' ? game.timeControl.initialMs : null);
  const incrementMs =
    game.incrementMs ??
    (typeof game.timeControl?.incrementMs === 'number' ? game.timeControl.incrementMs : null);
  return officialCorrespondenceDays(initialMs, incrementMs);
}
