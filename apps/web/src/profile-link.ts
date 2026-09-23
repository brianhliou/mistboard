/**
 * Profile links for player names (profile-link).
 *
 * One place that answers "does this seat have a page, and what is its URL", so
 * every surface that renders a player name links it the same way. Before this,
 * the `/@/<handle>` href was inlined at ~23 call sites and every game-derived
 * surface (watch, review, the live rooms, the profile game rows) rendered plain
 * text, because the name resolvers in game-display.ts return a bare string with
 * no identity attached.
 *
 * Two rules hold everywhere:
 *
 * - **Fail-closed.** A target is produced only from an id the server explicitly
 *   marked linkable. Guests, imported/manual corpus seats, redacted 'Anonymous'
 *   seats and raw engine versions have no page, so they render as plain text.
 *   Never synthesize a handle from a display name: the display name is not the
 *   handle, and a name-derived href would 404 or, worse, land on someone else.
 * - **A user's participant `subjectId` is NOT a handle.** It is the internal
 *   user id, which `/@/:handle` cannot address; only `handle` may build a user
 *   href. A bot's `subjectId` IS its `/bot/:id` slug, which is why bots link
 *   from data the client has always had.
 */

import type { GameParticipant } from './game-display.js';

/** A player-name destination: a member profile, or a bot profile. */
export type ProfileTarget =
  | { readonly kind: 'user'; readonly handle: string }
  | { readonly kind: 'bot'; readonly botId: string }
  /** A professional's page built from the broadcast archive (/players/<slug>). */
  | { readonly kind: 'player'; readonly slug: string };

/** Seat identity as the server emits it on postgame rows and the live TV feed.
 *  Both fields absent/null means "no page" — the common case (guests, corpus
 *  seats, engine versions with no bot in front of them). */
export type ProfileIdentity = {
  handle?: string | null;
  botId?: string | null;
};

// The two profile routes, as main.ts parses them: /@/<handle> for a member and
// /bot/<id> for a bot. Encoded because a handle can legally hold characters that
// need escaping in a path segment.
function profileHref(target: ProfileTarget): string {
  if (target.kind === 'user') return `/@/${encodeURIComponent(target.handle)}`;
  if (target.kind === 'bot') return `/bot/${encodeURIComponent(target.botId)}`;
  return `/players/${encodeURIComponent(target.slug)}`;
}

/** The target for a seat carrying explicit `handle`/`botId` identity (postgame
 *  player rows, live TV players). `handle` wins if both are somehow present, but
 *  the server never sets both. */
export function profileTargetFor(
  identity: ProfileIdentity | null | undefined,
): ProfileTarget | null {
  if (!identity) return null;
  if (identity.handle) return { kind: 'user', handle: identity.handle };
  if (identity.botId) return { kind: 'bot', botId: identity.botId };
  return null;
}

/** The target for a persisted game participant. Bots link off `subjectId` (it is
 *  the bot slug); users need the separately-carried `handle`, since `subjectId`
 *  is an internal user id. Every other subject type has no public page. */
export function participantProfileTarget(
  participant: GameParticipant | null | undefined,
): ProfileTarget | null {
  if (!participant) return null;
  if (participant.subjectType === 'bot') {
    return participant.subjectId ? { kind: 'bot', botId: participant.subjectId } : null;
  }
  if (participant.subjectType === 'user') {
    return participant.handle ? { kind: 'user', handle: participant.handle } : null;
  }
  return null;
}

/** The target for one seat of a postgame roster, by the seat's own colour. Takes
 *  the colour rather than an index because rosters are seat-keyed, not ordered,
 *  and the surfaces that call this (the board seat strips) name their slots by
 *  move order, so the caller has to do the mapping explicitly. */
function seatProfileTarget(
  players: readonly (ProfileIdentity & { color: string })[] | undefined,
  color: string,
): ProfileTarget | null {
  return profileTargetFor(players?.find((player) => player.color === color));
}

/**
 * Seat-strip link targets for a review board, keyed the way tree-review keys its
 * `players`: `red` is the FIRST-MOVER slot, `black` the second. The chess-family
 * boards seat White first, so they pass `firstSeat: 'white'` — the same mapping
 * their existing name builders already make, kept here so the names and the
 * links cannot drift onto different seats.
 */
export function reviewSeatProfiles(
  players: readonly (ProfileIdentity & { color: string })[] | undefined,
  firstSeat: string = 'red',
  secondSeat: string = 'black',
): { red: ProfileTarget | null; black: ProfileTarget | null } {
  return {
    red: seatProfileTarget(players, firstSeat),
    black: seatProfileTarget(players, secondSeat),
  };
}

/**
 * Render a player name as a link when it has a page, and as a plain span when it
 * does not — so a caller stays one expression either way and cannot accidentally
 * ship a linkless surface.
 *
 * The element keeps the caller's own class, so every surface's existing
 * typography and grid placement survive untouched; the link affordance rides on
 * the extra `player-name-link` class (see app-base.css), which inherits colour
 * and only underlines on hover/focus.
 */
export function playerNameEl(
  name: string,
  target: ProfileTarget | null,
  className: string,
): HTMLElement {
  if (!target) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = name;
    span.title = name;
    return span;
  }
  const link = document.createElement('a');
  link.className = `${className} player-name-link`;
  link.href = profileHref(target);
  link.textContent = name;
  link.title = name;
  return link;
}
