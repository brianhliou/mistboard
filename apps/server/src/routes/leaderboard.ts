import type { IncomingMessage, ServerResponse } from 'node:http';
import * as persistence from './../persistence.js';
import {
  DEFAULT_RATING_BUCKET,
  PUBLIC_RATING_TIME_CLASS,
  parseRatingVariant,
  parseVisibleRatingTimeClass,
  visibleRatingTimeClasses,
} from './../rating-buckets.js';
import { requireMethod, requirePersistence, writeJson } from './lib.js';

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (pathname === '/api/leaderboard/summary') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const timeClass = requestedTimeClass(parsedUrl);
    if (!timeClass) {
      writeJson(response, 400, { error: 'invalid_rating_time_class' });
      return true;
    }
    const limitParam = parseInt(parsedUrl.searchParams.get('limit') ?? '10', 10);
    const limitPerVariant = Number.isNaN(limitParam) ? 10 : Math.max(1, Math.min(limitParam, 50));
    const [ladders, activePlayers] = await Promise.all([
      persistence.getLeaderboardSummary({ timeClass, limitPerVariant }),
      persistence.getMostActivePlayers(limitPerVariant),
    ]);
    writeJson(response, 200, {
      timeClass,
      timeClasses: visibleRatingTimeClasses(),
      ladders,
      activePlayers,
    });
    return true;
  }

  if (pathname !== '/api/leaderboard') return false;
  if (!requireMethod(request, response, 'GET')) return true;
  if (!requirePersistence(response)) return true;
  const variant =
    parseRatingVariant(parsedUrl.searchParams.get('variant')) ?? DEFAULT_RATING_BUCKET.variant;
  const timeClass = requestedTimeClass(parsedUrl);
  if (!timeClass) {
    writeJson(response, 400, { error: 'invalid_rating_time_class' });
    return true;
  }
  const limitParam = parseInt(parsedUrl.searchParams.get('limit') ?? '100', 10);
  const limit = Number.isNaN(limitParam) ? 100 : Math.max(1, Math.min(limitParam, 500));
  const entries = await persistence.getLeaderboard({ variant, timeClass, limit });
  writeJson(response, 200, {
    leaderboard: entries,
    bucket: { variant, timeClass },
    timeClasses: visibleRatingTimeClasses(),
  });
  return true;
}

// Each rated pace has its own ladder. An omitted timeClass keeps the
// pre-multi-pace default (blitz) so existing links and clients are unaffected;
// an unrecognized one is a 400 rather than a silent fallback to a ladder the
// caller did not ask for.
function requestedTimeClass(parsedUrl: URL) {
  const raw = parsedUrl.searchParams.get('timeClass');
  return raw === null ? PUBLIC_RATING_TIME_CLASS : parseVisibleRatingTimeClass(raw);
}
