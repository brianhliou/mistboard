// Follow/block routes (the social kernel, #87).
//   POST/DELETE /api/users/:handle/follow
//   POST/DELETE /api/users/:handle/block
//   GET /api/relations/following
//   GET /api/relations/followers
//   GET /api/relations/blocks
// All signed-in-only. Lists are self-only: there is no public followers or
// following surface, matching the lichess privacy posture. The followers list
// (2026-10-08) takes no handle at all, so it can only ever answer "who follows
// me". Mutations return
// the viewer's fresh relation to the target so the client can render state
// without a profile refetch.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from './../account-session.js';
import { createAuthRateLimiter } from './../auth-rate-limit.js';
import { collectLiveRoomStats } from './../live-room-stats.js';
import * as persistence from './../persistence.js';
import { onlinePresence, refreshPresence } from './../presence.js';
import { PUBLIC_RATING_TIME_CLASS } from './../rating-buckets.js';
import { type HttpApiContext, requireMethod, requirePersistence, writeJson } from './lib.js';

const HANDLE_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
const LIST_PAGE_MAX = 50;

// Defense-in-depth on relation writes: enough for any human clicking buttons,
// low enough to stop scripted follow-spam. Per account id, in-memory.
const relationWriteLimiter = createAuthRateLimiter(30, 60 * 60 * 1000);

export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  const relationMatch = pathname.match(/^\/api\/users\/([^/]+)\/(follow|block)$/);
  if (relationMatch) {
    if (!requirePersistence(response)) return true;
    const method = request.method ?? 'GET';
    if (method !== 'POST' && method !== 'DELETE') {
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    const handle = decodeURIComponent(relationMatch[1] ?? '').trim();
    if (!HANDLE_PATTERN.test(handle)) {
      writeJson(response, 400, { error: 'invalid_handle' });
      return true;
    }
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    if (!relationWriteLimiter.check(user.id)) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }

    const kind = relationMatch[2] as 'follow' | 'block';
    const input = { actorId: user.id, targetHandle: handle };
    const result =
      method === 'POST'
        ? kind === 'follow'
          ? await persistence.followUser(input)
          : await persistence.blockUser(input)
        : kind === 'follow'
          ? await persistence.unfollowUser(input)
          : await persistence.unblockUser(input);

    if (!result.ok) {
      if (result.error === 'unknown_user') {
        writeJson(response, 404, { error: 'not_found' });
      } else if (result.error === 'self_relation') {
        writeJson(response, 400, { error: 'self_relation' });
      } else {
        writeJson(response, 400, { error: result.error });
      }
      return true;
    }

    const relation = await persistence.viewerRelationForHandle(user.id, handle);
    writeJson(response, 200, {
      relation: relation
        ? { following: relation.following, blocked: relation.blocked }
        : { following: false, blocked: false },
    });
    return true;
  }

  // Online-friends (#94): the viewer's follow set intersected with the
  // in-memory presence map. Same visibility gate as /api/players/online:
  // private profiles never appear, even to their followers. Rows carry the
  // same decoration as /api/players/online (best rating + playing flag).
  if (pathname === '/api/relations/online-following') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const now = Date.now();
    const stats = collectLiveRoomStats(ctx);
    // A follower deep in a long game holds an open socket but may not have hit
    // an authed HTTP request within the TTL, so re-touch every connected
    // account (legacy room map + all tenant room maps) before reading presence.
    for (const identity of stats.onlineIdentities) {
      if (identity.startsWith('u:')) refreshPresence(identity.slice(2), now);
    }
    const following = new Set(await persistence.listFollowingIds(user.id));
    const listed = onlinePresence(now)
      .filter((entry) => following.has(entry.userId) && entry.profileVisibility !== 'private')
      .sort((a, b) => a.handle.localeCompare(b.handle));
    // One representative rating per player (their best blitz pool); decoration
    // only, so an empty map (no DB) leaves the field null rather than failing.
    const ratings = persistence.isInitialized()
      ? await persistence.getBestRatings(
          listed.map((entry) => entry.userId),
          PUBLIC_RATING_TIME_CLASS,
        )
      : new Map<string, persistence.BestRatingEntry>();
    const players = listed.map((entry) => ({
      handle: entry.handle,
      displayName: entry.displayName,
      title: entry.title,
      rating: ratings.get(entry.userId) ?? null,
      playing: stats.playingUserIds.has(entry.userId),
    }));
    writeJson(response, 200, { players, count: players.length });
    return true;
  }

  // Followers (2026-10-08): accounts following the signed-in viewer, newest
  // first, minus anyone the viewer blocked. Keyed only by the session, so no
  // request can name another account's followers. Lean rows (no ratings or
  // game totals): the list answers "who", and a private follower's handle is
  // withheld (linkableHandleSql) so the client renders the name unlinked.
  if (pathname === '/api/relations/followers') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const offset = clampInt(parsedUrl.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = clampInt(parsedUrl.searchParams.get('limit'), 30, 1, LIST_PAGE_MAX);
    const page = await persistence.listFollowers(user.id, offset, limit);
    writeJson(response, 200, {
      entries: page.entries.map((entry) => ({
        handle: entry.handle,
        displayName: entry.displayName,
        title: entry.title,
        createdAt: entry.createdAt.toISOString(),
      })),
      total: page.total,
    });
    return true;
  }

  const listMatch = pathname.match(/^\/api\/relations\/(following|blocks)$/);
  if (listMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const offset = clampInt(parsedUrl.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = clampInt(parsedUrl.searchParams.get('limit'), 30, 1, LIST_PAGE_MAX);
    const relation = listMatch[1] === 'following' ? 'follow' : 'block';
    const page = await persistence.listRelations(user.id, relation, offset, limit);

    // The following list is the Friends page (/following): decorate each row
    // with the player's best current rating across every pool/time class, their
    // visible completed-game total, and durable last-activity. Additive fields
    // only, so the pre-enrichment shape (handle/displayName/createdAt/total)
    // stays intact for any older consumer. The blocks list stays lean.
    if (relation === 'follow') {
      const targetIds = page.entries.map((entry) => entry.targetId);
      const [ratings, totals] = await Promise.all([
        persistence.getBestRatingsAnyTimeClass(targetIds),
        persistence.getGamesTotals(targetIds),
      ]);
      writeJson(response, 200, {
        entries: page.entries.map((entry) => ({
          handle: entry.handle,
          displayName: entry.displayName,
          title: entry.title,
          createdAt: entry.createdAt.toISOString(),
          bestRating: ratings.get(entry.targetId) ?? null,
          gamesTotal: totals.get(entry.targetId) ?? 0,
          lastSeenAt: entry.lastSeenAt ? entry.lastSeenAt.toISOString() : null,
        })),
        total: page.total,
      });
      return true;
    }

    writeJson(response, 200, {
      entries: page.entries.map((entry) => ({
        handle: entry.handle,
        displayName: entry.displayName,
        createdAt: entry.createdAt.toISOString(),
      })),
      total: page.total,
    });
    return true;
  }

  return false;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}
