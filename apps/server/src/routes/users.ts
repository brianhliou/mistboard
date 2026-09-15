import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from './../account-session.js';
import * as persistence from './../persistence.js';
import {
  PUBLIC_RATING_TIME_CLASS,
  parseRatingTimeClass,
  parseRatingVariant,
} from './../rating-buckets.js';
import { requireMethod, requirePersistence, writeJson } from './lib.js';

const HANDLE_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
// Upper bound on a single games page; mirrors the server-side clamp in
// getUserGamesPage so a hand-crafted URL can't request an unbounded page.
const GAMES_PAGE_MAX = 50;

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  const profileMatch = pathname.match(/^\/api\/users\/([^/]+)\/profile$/);
  if (profileMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const handle = decodeURIComponent(profileMatch[1] ?? '').trim();
    if (!HANDLE_PATTERN.test(handle)) {
      writeJson(response, 400, { error: 'invalid_handle' });
      return true;
    }
    const viewer = await currentAccountUser(request);
    const profile = await persistence.getUserProfileByHandle(handle, viewer?.id ?? null, {
      // Play-streak days are bucketed on the viewer's calendar (play-streak.ts).
      timeZone: parsedUrl.searchParams.get('tz'),
    });
    if (!profile) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    const isViewer = viewer?.handle.toLowerCase() === profile.user.handle.toLowerCase();
    // The viewer's own edge toward this profile (follow/block buttons). Only
    // for a signed-in non-self viewer; blockedBy stays server-side so the
    // payload can't reveal who blocked the viewer.
    const relation =
      viewer && !isViewer ? await persistence.viewerRelationForHandle(viewer.id, handle) : null;
    writeJson(response, 200, {
      profile: {
        ...profile,
        isViewer,
        relation: relation ? { following: relation.following, blocked: relation.blocked } : null,
      },
    });
    return true;
  }

  const gamesMatch = pathname.match(/^\/api\/users\/([^/]+)\/games$/);
  if (gamesMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const handle = decodeURIComponent(gamesMatch[1] ?? '').trim();
    if (!HANDLE_PATTERN.test(handle)) {
      writeJson(response, 400, { error: 'invalid_handle' });
      return true;
    }
    const offset = clampInt(parsedUrl.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = clampInt(parsedUrl.searchParams.get('limit'), 15, 1, GAMES_PAGE_MAX);
    const viewer = await currentAccountUser(request);
    // Optional pool filter for the profile's Games tab. parseRatingVariant is
    // fail-closed: an unknown value yields null, which serves the unfiltered
    // history rather than erroring or, worse, matching nothing.
    const ratingVariant = parseRatingVariant(parsedUrl.searchParams.get('variant'));
    const page = await persistence.getUserGamesPage(
      handle,
      viewer?.id ?? null,
      offset,
      limit,
      ratingVariant,
    );
    if (!page) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, { games: page.games, total: page.total });
    return true;
  }

  const ratingHistoryMatch = pathname.match(/^\/api\/users\/([^/]+)\/rating-history$/);
  if (ratingHistoryMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const handle = decodeURIComponent(ratingHistoryMatch[1] ?? '').trim();
    if (!HANDLE_PATTERN.test(handle)) {
      writeJson(response, 400, { error: 'invalid_handle' });
      return true;
    }
    const variant = parseRatingVariant(parsedUrl.searchParams.get('variant'));
    if (!variant) {
      writeJson(response, 400, { error: 'invalid_rating_variant' });
      return true;
    }
    // An omitted timeClass keeps the pre-multi-pace default (blitz), so links
    // minted before rated widened still resolve to the same ladder.
    const timeClassParam = parsedUrl.searchParams.get('timeClass');
    const timeClass =
      timeClassParam === null ? PUBLIC_RATING_TIME_CLASS : parseRatingTimeClass(timeClassParam);
    if (!timeClass) {
      writeJson(response, 400, { error: 'invalid_rating_time_class' });
      return true;
    }
    const viewer = await currentAccountUser(request);
    const history = await persistence.getUserRatingHistory(
      handle,
      viewer?.id ?? null,
      variant,
      timeClass,
    );
    if (!history) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, { history });
    return true;
  }

  return false;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}
