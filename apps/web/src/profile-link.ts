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

import { buildChampionCrowns, type Championship } from './champion-crowns.js';
import { buildFlairIconIfSet, type FlairKey } from './flair.js';
import type { GameParticipant } from './game-display.js';
import { buildTitleBadge, type PlayerTitle } from './player-titles.js';

/** A player-name destination: a member profile, or a bot profile. */
export type ProfileTarget =
  | {
      readonly kind: 'user';
      readonly handle: string;
      readonly champions?: readonly Championship[];
      // The account's verified title and chosen flair (#1083). The server sends
      // both only beside a linkable handle, so they never reach a bot or guest.
      readonly title?: PlayerTitle;
      readonly flair?: FlairKey;
    }
  | { readonly kind: 'bot'; readonly botId: string }
  /** A professional's page built from the broadcast archive (/players/<slug>). */
  | { readonly kind: 'player'; readonly slug: string };

/** Seat identity as the server emits it on postgame rows and the live TV feed.
 *  Both fields absent/null means "no page" — the common case (guests, corpus
 *  seats, engine versions with no bot in front of them). */
export type ProfileIdentity = {
  champions?: readonly Championship[];
  handle?: string | null;
  botId?: string | null;
  title?: PlayerTitle | null;
  flair?: FlairKey | null;
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
  if (identity.handle)
    return {
      kind: 'user',
      handle: identity.handle,
      ...(identity.champions != null ? { champions: identity.champions } : {}),
      ...(identity.title ? { title: identity.title } : {}),
      ...(identity.flair ? { flair: identity.flair } : {}),
    };
  if (identity.botId) return { kind: 'bot', botId: identity.botId };
  return null;
}

/** The target for a persisted game participant. Bots link off `subjectId` (it is
 *  the bot slug); users need the separately-carried `handle`, since `subjectId`
 *  is an internal user id. A Misty engine version links Misty; every other
 *  subject type has no public page. */
export function participantProfileTarget(
  participant: GameParticipant | null | undefined,
): ProfileTarget | null {
  if (!participant) return null;
  if (participant.subjectType === 'bot') {
    return participant.subjectId ? { kind: 'bot', botId: participant.subjectId } : null;
  }
  if (participant.subjectType === 'user') {
    return participant.handle
      ? profileTargetFor({
          handle: participant.handle,
          champions: participant.champions,
          title: participant.title,
          flair: participant.flair,
        })
      : null;
  }
  // Misty's own engines with no bot row (Three Kingdoms Banqi, FFQ banqi) are
  // recorded as engine versions; the seat is still Misty and links her page.
  if (participant.subjectType === 'engine-version' && /^misty-/.test(participant.subjectId ?? '')) {
    return { kind: 'bot', botId: 'misty' };
  }
  return null;
}

/** Only the title and flair of a member seat, for a name drawn without its link
 *  (the homepage TV board). Crowns are left off: that board never showed them.
 *  Null for a bot, a guest, or a member with neither, so the name stays bare. */
export function nameDecorationTarget(
  identity: Pick<ProfileIdentity, 'handle' | 'title' | 'flair'> | null | undefined,
): ProfileTarget | null {
  if (!identity?.handle || !(identity.title || identity.flair)) return null;
  return profileTargetFor({
    handle: identity.handle,
    title: identity.title,
    flair: identity.flair,
  });
}

/** nameDecorationTarget for a persisted participant: member seats only. */
export function participantNameDecoration(
  participant: GameParticipant | null | undefined,
): ProfileTarget | null {
  return participant?.subjectType === 'user' ? nameDecorationTarget(participant) : null;
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
 *
 * A member's title badge goes before the name and their flair after it, inside
 * the link, with the name in its own span so a surface that cuts the name with
 * an ellipsis still shows both whole. Flair honours the viewer's playerFlairs
 * setting; the title always shows. A name with none of these keeps the plain
 * link it always had.
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
  return decoratePlayerName(link, name, target);
}

/**
 * A compact board's seat name (the homepage TV and the boards it shares code
 * with). The plain span these seats always had, carrying the same badge and
 * flair as playerNameEl when the seat has them, but never a link: the homepage
 * board sits inside a link to /watch, and an anchor may not hold another.
 */
export function seatNameEl(
  name: string,
  decoration: ProfileTarget | null | undefined,
  className: string,
): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = name;
  return decoration ? decoratePlayerName(span, name, decoration) : span;
}

// The badge, the name in its own span, the flair and the crowns, in that order;
// an element with none of them is returned untouched.
function decoratePlayerName(host: HTMLElement, name: string, target: ProfileTarget): HTMLElement {
  const user = target.kind === 'user' ? target : null;
  const crowns = buildChampionCrowns(user?.champions);
  const badge = user ? buildTitleBadge(user.title) : null;
  const flair = user ? buildFlairIconIfSet(user.flair) : null;
  if (!crowns && !badge && !flair) return host;
  if (crowns) host.classList.add('player-name--champion');
  if (badge || flair) host.classList.add('player-name--decorated');
  const text = document.createElement('span');
  text.className = 'player-name-text';
  text.textContent = name;
  host.replaceChildren(
    ...[badge, text, flair, crowns].filter((node): node is HTMLElement => node !== null),
  );
  return host;
}

// A sentinel no display name can contain, used to find where a translated
// template puts its name placeholder.
const NAME_SLOT = '\u0000';

/**
 * Render a translated one-placeholder template with a real ELEMENT in the
 * placeholder's position, so the name can be a link while the words around it
 * stay localized and in the locale's own order ('vs {opponent}' in English,
 * '对 {opponent}' in Chinese).
 *
 * `render` is the t() call with the placeholder left as the caller's token, so
 * this helper never has to reach into the catalog. If the template drops the
 * placeholder entirely, the node is appended bare rather than lost.
 */
export function appendWithNameNode(
  host: HTMLElement,
  render: (token: string) => string,
  node: HTMLElement,
): void {
  const template = render(NAME_SLOT);
  const at = template.indexOf(NAME_SLOT);
  if (at < 0) {
    host.append(node);
    return;
  }
  const before = template.slice(0, at);
  const after = template.slice(at + NAME_SLOT.length);
  if (before) host.append(document.createTextNode(before));
  host.append(node);
  if (after) host.append(document.createTextNode(after));
}
