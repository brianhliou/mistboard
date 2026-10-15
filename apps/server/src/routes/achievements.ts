// Achievements (persistence-achievements.ts, definitions in @mistboard/game):
//
//   GET /api/achievements                  the catalog, each with its holder
//                                          count (stats-excluded accounts left
//                                          out) and the account total.
//   GET /api/users/:handle/achievements    one account's awards, id and date.
//                                          Same gate as the profile: a private
//                                          profile is a 404 to everyone else.
//
// The award's source (which game, puzzle or post) never leaves the server: it
// can name a private game or a hidden post.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from './../account-session.js';
import * as persistence from './../persistence.js';
import { requireMethod, requirePersistence, writeJson } from './lib.js';

const HANDLE_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  if (pathname === '/api/achievements') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    writeJson(response, 200, await persistence.getAchievementCatalog());
    return true;
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)\/achievements$/);
  if (userMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const handle = decodeURIComponent(userMatch[1] ?? '').trim();
    if (!HANDLE_PATTERN.test(handle)) {
      writeJson(response, 400, { error: 'invalid_handle' });
      return true;
    }
    const viewer = await currentAccountUser(request);
    const achievements = await persistence.getUserAchievementsByHandle(handle, viewer?.id ?? null);
    if (!achievements) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, { achievements });
    return true;
  }

  return false;
}
