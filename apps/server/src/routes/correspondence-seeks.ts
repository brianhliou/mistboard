import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DARK_CHESS_SPEC_ID,
  DAY_MS,
  isCorrespondenceRatedSpec,
  isOfficialCorrespondenceTimeControl,
  type RoomTimeControl,
} from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import {
  type CorrespondenceStartNotice,
  notifyCorrespondenceStart,
} from './../correspondence-start-email.js';
import { correspondenceEnabled, ratedEnabled } from './../feature-flags.js';
import { logger } from './../obs.js';
import type { SeekColorPreference, SeekVisibility, UserAccount } from './../persistence.js';
import * as persistence from './../persistence.js';
import { correspondenceTenantForSpecId } from './../variant-tenant/registry.js';
import {
  CORRESPONDENCE_ELIGIBLE_SPECS,
  parseCorrespondenceTimeControl,
} from './correspondence-rooms.js';
import {
  type HttpApiContext,
  readJsonBody,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

/**
 * A seek's side preference, in MOVE ORDER rather than colors, so one board serves every
 * eligible variant (migration 106). Deliberately NOT parsePreferredColor: that one parses
 * the chess literals the dark-chess-only room-create route still speaks. Unknown input →
 * undefined → the caller's 'random' default, never a thrown 500.
 */
export function parseSeekColorPreference(value: unknown): SeekColorPreference | undefined {
  if (value === 'first' || value === 'second' || value === 'random') return value;
  return undefined;
}

// Cap on simultaneously-open seeks per account — bounds board spam while still
// leaving room to offer a few time controls / colors at once. Counts directed
// and link challenges too, so it bounds total outstanding invitations.
const MAX_OPEN_SEEKS_PER_USER = 6;

// How long a challenge (private seek: direct or link) stays live before the
// sweep reclaims it. Public board seeks lapse on their own, longer clock
// (persistence.CORRESPONDENCE_SEEK_TTL_MS, read-time from created_at). A week is long enough for
// a shared "play me" link to reach a friend, short enough that dead links do not
// accrete (lichess uses 1 day open / 2 weeks direct; one window is simpler).
const CHALLENGE_TTL_MS = 7 * DAY_MS;

// Parse the optional visibility field of a create request. A seek is 'public'
// (the open board) unless explicitly made 'private' (off-board, link-accepted)
// or given a target (which forces 'private').
export function parseSeekVisibility(value: unknown): SeekVisibility | undefined {
  if (value === undefined || value === null) return undefined;
  return value === 'public' || value === 'private' ? value : undefined;
}

/**
 * Rated correspondence (2026-10-02): why a rated seek on these terms is refused, or null
 * when it may be rated. One gate for both create and accept, so a seek that was legal
 * when posted but whose terms stopped qualifying (the flag turned off, the spec left the
 * rated set) is refused at accept rather than silently seated casual.
 *   - the server-wide rated switch (MISTBOARD_RATED_ENABLED), as the live lobby;
 *   - isCorrespondenceRatedSpec: correspondence-eligible AND an active rating pool;
 *   - an official days-per-move allowance: a compressed dev allowance has no pool
 *     (bucketForGame would never rate it), so calling it rated would be a lie.
 */
export function ratedSeekError(
  gameSpecId: string,
  timeControl: RoomTimeControl,
  enabled: boolean = ratedEnabled(),
): 'rated_disabled' | 'rated_unsupported_spec' | 'rated_unsupported_time_control' | null {
  if (!enabled) return 'rated_disabled';
  if (!isCorrespondenceRatedSpec(gameSpecId)) return 'rated_unsupported_spec';
  if (!isOfficialCorrespondenceTimeControl(timeControl)) return 'rated_unsupported_time_control';
  return null;
}

function ratedSeekErrorStatus(error: NonNullable<ReturnType<typeof ratedSeekError>>): number {
  if (error === 'rated_disabled') return 403;
  if (error === 'rated_unsupported_spec') return 501;
  return 400;
}

// Pure accept gate, shared by the accept route and its tests. Returns the error
// code that blocks this user from accepting this seek, or null when allowed:
//   - a creator can never accept their own seek;
//   - a directed challenge (targetUserId set) admits only that user; a link
//     challenge (target null) admits anyone who holds the id.
export function challengeAcceptError(
  seek: { creatorUserId: string; targetUserId: string | null },
  userId: string,
): 'cannot_accept_own_seek' | 'not_your_challenge' | null {
  if (seek.creatorUserId === userId) return 'cannot_accept_own_seek';
  if (seek.targetUserId !== null && seek.targetUserId !== userId) return 'not_your_challenge';
  return null;
}

// Pure view model for the challenge landing page, shared by the view route and
// its tests. `visible` false → the viewer is a stranger to a directed challenge
// and must be told it does not exist. A directed challenge admits only its
// target; a link challenge (target null) admits anyone who holds the id.
export function challengeViewModel(
  seek: { creatorUserId: string; targetUserId: string | null; expiresAt: Date | null },
  userId: string,
  nowMs: number,
): {
  visible: boolean;
  isMine: boolean;
  expired: boolean;
  canAccept: boolean;
  canDecline: boolean;
} {
  const isCreator = seek.creatorUserId === userId;
  const isTarget = seek.targetUserId === userId;
  const isLink = seek.targetUserId === null;
  const visible = isCreator || isTarget || isLink;
  const expired = seek.expiresAt !== null && seek.expiresAt.getTime() <= nowMs;
  return {
    visible,
    isMine: isCreator,
    expired,
    // Accept: someone else's, not lapsed, and either the named target or a link.
    canAccept: visible && !isCreator && !expired && (isTarget || isLink),
    // Decline: only the named target of a still-live directed challenge.
    canDecline: isTarget && !expired,
  };
}

/** The ONE request these routes serve without an account: reading the public
 *  board. Kept as a named predicate (and pinned by tests) so the anonymous
 *  surface is a single line to audit rather than an implicit branch order —
 *  every other verb, including every write and the per-user challenge lists,
 *  needs a signed-in user. */
export function allowsAnonymousAccess(pathname: string, method: string): boolean {
  return pathname === '/api/correspondence/seeks' && method === 'GET';
}

// The open async-seek board (C3) plus directed + link challenges: standing
// correspondence invitations that form games without both players ever being
// online together (the cold-start lever). Account-only on every verb EXCEPT the
// public board's GET (see allowsAnonymousAccess).
//   GET    /api/correspondence/seeks             list open board seeks (+ isMine), no account needed
//   GET    /api/correspondence/seeks/incoming    directed challenges to me
//   GET    /api/correspondence/seeks/mine         challenges I sent (any visibility)
//   POST   /api/correspondence/seeks             post a seek or a challenge
//   GET    /api/correspondence/seeks/:id         view one seek (challenge landing)
//   POST   /api/correspondence/seeks/:id/accept  accept → create + seat a game
//   POST   /api/correspondence/seeks/:id/decline decline a directed challenge
//   DELETE /api/correspondence/seeks/:id         cancel your own seek
export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (
    pathname !== '/api/correspondence/seeks' &&
    !pathname.startsWith('/api/correspondence/seeks/')
  ) {
    return false;
  }
  if (!correspondenceEnabled()) {
    writeJson(response, 404, { error: 'correspondence_disabled' });
    return true;
  }
  if (!requirePersistence(response)) return true;
  const user = await currentAccountUser(request);

  // The public seek board READS without an account. It is the shop window on the
  // homepage's Correspondence tab, and gating the read left that tab permanently
  // empty for exactly the signed-out visitors it exists to convert. Safe by
  // construction: listOpenCorrespondenceSeeks is already
  // `visibility = 'public' AND target_user_id IS NULL`, so a directed challenge
  // can never surface here, and `isMine` is false for a caller with no id.
  // Everything below still requires a user: posting, accepting, declining,
  // cancelling, the challenge landing, and the "challenges to me" list.
  if (allowsAnonymousAccess(pathname, request.method ?? 'GET')) {
    return listOpenSeeks(user, response);
  }
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }

  if (pathname === '/api/correspondence/seeks') {
    const method = request.method ?? 'GET';
    if (method === 'POST') return createSeek(ctx, user, request, response);
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }

  if (pathname === '/api/correspondence/seeks/incoming') {
    if (!requireMethod(request, response, 'GET')) return true;
    return listIncomingChallenges(user, response);
  }

  if (pathname === '/api/correspondence/seeks/mine') {
    if (!requireMethod(request, response, 'GET')) return true;
    return listOutgoingChallenges(user, response);
  }

  const acceptMatch = pathname.match(/^\/api\/correspondence\/seeks\/([^/]+)\/accept$/);
  if (acceptMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    return acceptSeek(ctx, user, decodeURIComponent(acceptMatch[1]!), response);
  }

  const declineMatch = pathname.match(/^\/api\/correspondence\/seeks\/([^/]+)\/decline$/);
  if (declineMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    return declineChallenge(user, decodeURIComponent(declineMatch[1]!), response);
  }

  const idMatch = pathname.match(/^\/api\/correspondence\/seeks\/([^/]+)$/);
  if (idMatch) {
    const seekId = decodeURIComponent(idMatch[1]!);
    const method = request.method ?? 'GET';
    if (method === 'GET') return viewSeek(user, seekId, response);
    if (method === 'DELETE') return cancelSeek(user, seekId, response);
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }

  writeJson(response, 404, { error: 'not_found' });
  return true;
}

/** One public-board row as the client sees it. `viewerUserId` is null for an
 *  anonymous reader: nobody owns a row without an account, so isMine is false
 *  rather than unknown — a signed-out visitor must never be handed a Cancel
 *  control for somebody else's seek. */
export function openSeekPayload(
  seek: {
    id: string;
    gameSpecId: string;
    daysPerMove: number;
    preferredColor: string;
    creatorName: string | null;
    createdAt: Date;
    creatorUserId: string;
    rated?: boolean;
  },
  viewerUserId: string | null,
): Record<string, unknown> {
  return {
    id: seek.id,
    gameSpecId: seek.gameSpecId,
    daysPerMove: seek.daysPerMove,
    preferredColor: seek.preferredColor,
    rated: seek.rated === true,
    creatorName: seek.creatorName,
    createdAt: seek.createdAt.toISOString(),
    isMine: viewerUserId !== null && seek.creatorUserId === viewerUserId,
  };
}

async function listOpenSeeks(user: UserAccount | null, response: ServerResponse): Promise<boolean> {
  const seeks = await persistence.listOpenCorrespondenceSeeks();
  writeJson(response, 200, {
    seeks: seeks.map((seek) => openSeekPayload(seek, user?.id ?? null)),
  });
  return true;
}

async function listIncomingChallenges(
  user: UserAccount,
  response: ServerResponse,
): Promise<boolean> {
  const challenges = await persistence.listChallengesForUser(user.id);
  writeJson(response, 200, {
    challenges: challenges.map((seek) => ({
      id: seek.id,
      gameSpecId: seek.gameSpecId,
      daysPerMove: seek.daysPerMove,
      preferredColor: seek.preferredColor,
      rated: seek.rated === true,
      challengerName: seek.creatorName,
      createdAt: seek.createdAt.toISOString(),
    })),
  });
  return true;
}

// Everything this player has standing, so a private link is visible to whoever
// made it and can be cancelled. Carries the cap so the client can say WHY a
// create was refused instead of only reporting a number back (#353).
async function listOutgoingChallenges(
  user: UserAccount,
  response: ServerResponse,
): Promise<boolean> {
  const seeks = await persistence.listOutgoingSeeksForUser(user.id);
  writeJson(response, 200, {
    limit: MAX_OPEN_SEEKS_PER_USER,
    seeks: seeks.map((seek) => ({
      id: seek.id,
      gameSpecId: seek.gameSpecId,
      daysPerMove: seek.daysPerMove,
      preferredColor: seek.preferredColor,
      rated: seek.rated === true,
      visibility: seek.visibility,
      // Present only for a directed challenge; a link challenge has no target.
      targetName: seek.targetName,
      // The share URL for a link challenge, so a creator can re-copy a link they
      // already sent. Public board posts have no private URL.
      challengeUrl:
        seek.visibility === 'private' ? `/challenge/${encodeURIComponent(seek.id)}` : null,
      expiresAt: seek.expiresAt?.toISOString() ?? null,
      createdAt: seek.createdAt.toISOString(),
    })),
  });
  return true;
}

async function createSeek(
  ctx: HttpApiContext,
  user: UserAccount,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  // Per-account play lock (126). Correspondence never reaches seat assignment
  // through a socket the way a live room does, so posting a seek and accepting
  // one are their own enforcement points. Declining and cancelling stay open: a
  // locked account must still be able to clear challenges aimed at it.
  if (persistence.isPlayDisabled(user)) {
    writeJson(response, 403, { error: 'play_disabled' });
    return true;
  }
  const body = await readJsonBody(request);
  const gameSpecId = typeof body.gameSpecId === 'string' ? body.gameSpecId : DARK_CHESS_SPEC_ID;
  // Fork-6 fail-closed allowlist — the same set the create route enforces.
  if (!CORRESPONDENCE_ELIGIBLE_SPECS.has(gameSpecId)) {
    writeJson(response, 501, { error: 'correspondence_unsupported_spec' });
    return true;
  }
  // A variant whose server flag is off cannot back a game: refuse the seek now,
  // not at accept time after the row is gone.
  if (correspondenceTenantForSpecId(gameSpecId)?.enabled() === false) {
    writeJson(response, 404, { error: 'variant_disabled' });
    return true;
  }
  const timeControl = parseCorrespondenceTimeControl(body.daysPerMove);
  const daysPerMove = timeControl?.daysPerMove;
  if (!timeControl || daysPerMove === undefined) {
    writeJson(response, 400, { error: 'invalid_days_per_move' });
    return true;
  }
  const preferredColor = parseSeekColorPreference(body.preferredColor) ?? 'random';
  // Casual unless the body says exactly `rated: true`; a rated request that cannot be
  // honoured is refused, never quietly downgraded to casual.
  const rated = body.rated === true;
  if (rated) {
    const ratedError = ratedSeekError(gameSpecId, timeControl);
    if (ratedError) {
      writeJson(response, ratedSeekErrorStatus(ratedError), { error: ratedError });
      return true;
    }
  }

  // Challenge dimensions. A target forces a private, directed seek; otherwise
  // visibility defaults to the public board.
  let targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : null;
  // Directed challenges from the social surfaces (profile / user-card) address the
  // target by handle — the rest of the user API is handle-based and we don't expose
  // ids to the client. Resolve it into the id the directed-seek path expects.
  if (!targetUserId) {
    const targetHandle = typeof body.targetHandle === 'string' ? body.targetHandle.trim() : '';
    if (targetHandle) {
      targetUserId = await persistence.userIdForHandle(targetHandle);
      if (!targetUserId) {
        writeJson(response, 404, { error: 'target_not_found' });
        return true;
      }
    }
  }
  const requestedVisibility = parseSeekVisibility(body.visibility);
  const visibility: SeekVisibility = targetUserId ? 'private' : (requestedVisibility ?? 'public');

  if (targetUserId) {
    if (targetUserId === user.id) {
      writeJson(response, 400, { error: 'cannot_challenge_self' });
      return true;
    }
    if (!(await persistence.userExists(targetUserId))) {
      writeJson(response, 404, { error: 'target_not_found' });
      return true;
    }
    // The target blocking the challenger hides the challenge entirely, mirroring
    // the inbox send gate — the challenger cannot reach someone who blocked them.
    if (await persistence.hasBlock(targetUserId, user.id)) {
      writeJson(response, 403, { error: 'challenge_blocked' });
      return true;
    }
  }

  if (ctx.isDraining()) {
    writeJson(response, 503, { error: 'server_draining', restartAt: ctx.drainDeadlineMs() });
    return true;
  }
  // The same board offer posted twice returns the live one instead of stacking a
  // duplicate row. Checked before the cap so a player at the limit re-posting an
  // offer they already have gets it back rather than a refusal. Best-effort under
  // concurrency like the cap: two simultaneous posts can still both insert.
  if (visibility === 'public' && !targetUserId) {
    const existing = await persistence.findOpenDuplicatePublicSeek({
      creatorUserId: user.id,
      gameSpecId,
      daysPerMove,
      preferredColor,
      rated,
    });
    if (existing) {
      writeJson(response, 200, {
        seek: {
          id: existing.id,
          gameSpecId: existing.gameSpecId,
          daysPerMove: existing.daysPerMove,
          preferredColor: existing.preferredColor,
          rated: existing.rated === true,
          targetUserId: null,
          visibility: existing.visibility,
          expiresAt: existing.expiresAt ? existing.expiresAt.toISOString() : null,
        },
        challengeUrl: null,
        existing: true,
      });
      return true;
    }
  }
  // Cap is best-effort under concurrency (no unique constraint); a racing pair of
  // creates could both pass at exactly the limit. Acceptable for a spam bound.
  const open = await persistence.countOpenSeeksForUser(user.id);
  if (open >= MAX_OPEN_SEEKS_PER_USER) {
    writeJson(response, 409, { error: 'seek_limit_reached', limit: MAX_OPEN_SEEKS_PER_USER });
    return true;
  }
  // Private challenges store their expiry; a public board seek stores none and
  // lapses CORRESPONDENCE_SEEK_TTL_MS after posting, computed at read time.
  const now = Date.now();
  const expiresAt = visibility === 'private' ? new Date(now + CHALLENGE_TTL_MS) : null;
  const effectiveExpiresAt = expiresAt ?? new Date(now + persistence.CORRESPONDENCE_SEEK_TTL_MS);
  const id = `seek_${randomUUID()}`;
  await persistence.createCorrespondenceSeek({
    id,
    creatorUserId: user.id,
    gameSpecId,
    daysPerMove,
    preferredColor,
    targetUserId,
    visibility,
    expiresAt,
    rated,
  });
  writeJson(response, 201, {
    seek: {
      id,
      gameSpecId,
      daysPerMove,
      preferredColor,
      rated,
      targetUserId,
      visibility,
      expiresAt: effectiveExpiresAt.toISOString(),
    },
    // The shareable "play me" URL: the accept page keyed by the unguessable id.
    // Present for off-board seeks (link + directed challenges); the public board
    // surfaces its own seeks without a private link.
    challengeUrl: visibility === 'private' ? `/challenge/${encodeURIComponent(id)}` : null,
  });
  return true;
}

/**
 * Who the "your seek was accepted" email goes to, and what it says. Split out
 * of acceptSeek so the mapping is testable without a socket, a database, or a
 * mail provider: the failure that matters here is a silent one — swapping the
 * two players, or inverting who owes the first move, still sends a
 * plausible-looking email to the wrong person.
 *
 * `creatorSide` is move order, already resolved (a 'random' seek has had its
 * coin flipped by this point), so the creator owes move 1 exactly when they
 * took the first side.
 */
export function correspondenceStartNoticeFor(
  roomId: string,
  seek: { creatorUserId: string; daysPerMove: number },
  accepter: { displayName: string; handle: string },
  creatorSide: 'first' | 'second',
): CorrespondenceStartNotice {
  return {
    roomId,
    creatorUserId: seek.creatorUserId,
    accepterName: accepter.displayName || accepter.handle,
    creatorOnMove: creatorSide === 'first',
    daysPerMove: seek.daysPerMove,
  };
}

async function acceptSeek(
  ctx: HttpApiContext,
  user: UserAccount,
  seekId: string,
  response: ServerResponse,
): Promise<boolean> {
  if (persistence.isPlayDisabled(user)) {
    writeJson(response, 403, { error: 'play_disabled' });
    return true;
  }
  if (ctx.isDraining()) {
    writeJson(response, 503, { error: 'server_draining', restartAt: ctx.drainDeadlineMs() });
    return true;
  }
  const seek = await persistence.getCorrespondenceSeek(seekId);
  if (!seek) {
    writeJson(response, 404, { error: 'seek_not_found' });
    return true;
  }
  const gateError = challengeAcceptError(seek, user.id);
  if (gateError) {
    writeJson(response, gateError === 'cannot_accept_own_seek' ? 409 : 403, { error: gateError });
    return true;
  }
  // A lapsed challenge or board seek is gone: refuse it even before the sweep
  // reclaims the row. expiresAt is the effective expiry, board TTL included.
  if (seek.expiresAt && seek.expiresAt.getTime() <= Date.now()) {
    writeJson(response, 410, { error: 'challenge_expired' });
    return true;
  }
  if (!CORRESPONDENCE_ELIGIBLE_SPECS.has(seek.gameSpecId)) {
    writeJson(response, 501, { error: 'correspondence_unsupported_spec' });
    return true;
  }
  const timeControl = parseCorrespondenceTimeControl(seek.daysPerMove);
  if (!timeControl) {
    writeJson(response, 500, { error: 'invalid_seek' });
    return true;
  }
  // Variant switched off since the seek was posted: keep the row (it accepts
  // again once the flag is back) instead of consuming it for a 404.
  if (correspondenceTenantForSpecId(seek.gameSpecId)?.enabled() === false) {
    writeJson(response, 404, { error: 'variant_disabled' });
    return true;
  }
  // A rated seek re-passes the rated gate at accept (the terms may have stopped
  // qualifying since it was posted), and both players must be free to play: the
  // accepter's lock is checked above, the creator's here, because accepting seats them.
  if (seek.rated) {
    const ratedError = ratedSeekError(seek.gameSpecId, timeControl);
    if (ratedError) {
      writeJson(response, ratedSeekErrorStatus(ratedError), { error: ratedError });
      return true;
    }
    if (await persistence.isUserIdPlayDisabled(seek.creatorUserId)) {
      writeJson(response, 409, { error: 'opponent_play_disabled' });
      return true;
    }
  }
  // The DB decides the race: deleteCorrespondenceSeek removes the row once, so
  // exactly one of two simultaneous accepters proceeds to create the game; the
  // loser gets 409 and the row is already gone.
  const won = await persistence.deleteCorrespondenceSeek(seekId);
  if (!won) {
    writeJson(response, 409, { error: 'seek_taken' });
    return true;
  }
  // Which tenant backs this spec's correspondence rooms. Fail-closed twice over: the spec
  // already passed CORRESPONDENCE_ELIGIBLE_SPECS above, and a spec whose tenant offers no
  // seek factory is refused here rather than silently seated by another variant's.
  const tenant = correspondenceTenantForSpecId(seek.gameSpecId);
  const createGame = tenant?.createCorrespondenceGameForSeek ?? null;
  if (!createGame) {
    writeJson(response, 501, { error: 'correspondence_unsupported_spec' });
    return true;
  }
  // Creator's side is honored; the accepter takes the other (random → coin flip). Move
  // order, not color: the tenant maps first/second onto its own colors, so this path stays
  // variant-neutral.
  const creatorSide =
    seek.preferredColor === 'random'
      ? randomBytes(1)[0]! < 128
        ? 'first'
        : 'second'
      : seek.preferredColor;
  const accepterSide = creatorSide === 'first' ? 'second' : 'first';
  const created = await createGame({
    timeControl,
    first: { userId: creatorSide === 'first' ? seek.creatorUserId : user.id },
    second: { userId: creatorSide === 'second' ? seek.creatorUserId : user.id },
    rated: seek.rated === true,
  });
  if (!created.ok) {
    // The seek row is already deleted, so a failure here is a rare persistence
    // error rather than a lost race — surface it; the creator can re-post.
    const status = created.error === 'disabled' ? 404 : 503;
    writeJson(response, status, { error: created.error });
    return true;
  }
  // The creator posted this seek and left; nothing else will tell them it was
  // taken. Fire-and-forget on purpose: the seated game is the durable outcome,
  // so a mail provider outage must never turn a successful accept into an error
  // for the accepter, who is right here watching this response.
  notifyCorrespondenceStart(correspondenceStartNoticeFor(created.room.id, seek, user, creatorSide));
  const roomRated = created.room.rated === true;
  if ((seek.rated === true) !== roomRated) {
    // Unreachable while the conformance test holds (every isCorrespondenceRatedSpec
    // factory honours `rated`); logged loudly because the game already exists.
    logger.error(
      { roomId: created.room.id, gameSpecId: seek.gameSpecId, seekRated: seek.rated, roomRated },
      'correspondence accept: room rated flag does not match the seek',
    );
  }
  writeJson(response, 201, {
    roomId: created.room.id,
    url: `/room/${encodeURIComponent(created.room.id)}`,
    // The tenant's own color for the side the accepter took (white/black, red/black, ...).
    seat: created.seats[accepterSide],
    gameSpecId: created.room.gameSpecId,
    rated: roomRated,
  });
  return true;
}

// The challenge landing page's read: enough to render "X challenged you to Y"
// with the right action buttons. A stranger to a directed challenge is told it
// does not exist (privacy), not that they are forbidden.
async function viewSeek(
  user: UserAccount,
  seekId: string,
  response: ServerResponse,
): Promise<boolean> {
  const seek = await persistence.getCorrespondenceSeekListing(seekId);
  if (!seek) {
    writeJson(response, 404, { error: 'seek_not_found' });
    return true;
  }
  const view = challengeViewModel(seek, user.id, Date.now());
  if (!view.visible) {
    writeJson(response, 404, { error: 'seek_not_found' });
    return true;
  }
  writeJson(response, 200, {
    id: seek.id,
    gameSpecId: seek.gameSpecId,
    daysPerMove: seek.daysPerMove,
    preferredColor: seek.preferredColor,
    rated: seek.rated === true,
    visibility: seek.visibility,
    challengerName: seek.creatorName,
    isMine: view.isMine,
    canAccept: view.canAccept,
    canDecline: view.canDecline,
    expired: view.expired,
    expiresAt: seek.expiresAt ? seek.expiresAt.toISOString() : null,
  });
  return true;
}

// The named target rejecting a directed challenge: deletes the seek. A link
// challenge (no target) has no one to decline it — only its creator can cancel.
async function declineChallenge(
  user: UserAccount,
  seekId: string,
  response: ServerResponse,
): Promise<boolean> {
  const seek = await persistence.getCorrespondenceSeek(seekId);
  if (!seek) {
    writeJson(response, 404, { error: 'seek_not_found' });
    return true;
  }
  if (seek.targetUserId !== user.id) {
    writeJson(response, 403, { error: 'not_your_challenge' });
    return true;
  }
  await persistence.deleteCorrespondenceSeek(seekId);
  writeJson(response, 200, { ok: true });
  return true;
}

async function cancelSeek(
  user: UserAccount,
  seekId: string,
  response: ServerResponse,
): Promise<boolean> {
  // Owner-scoped: deletes only when the seek belongs to this account.
  const deleted = await persistence.deleteCorrespondenceSeek(seekId, user.id);
  if (!deleted) {
    writeJson(response, 404, { error: 'seek_not_found' });
    return true;
  }
  writeJson(response, 200, { ok: true });
  return true;
}
