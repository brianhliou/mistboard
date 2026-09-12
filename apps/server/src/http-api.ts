// HTTP API dispatcher. All route logic lives under apps/server/src/routes/.
// Each route module exports `tryHandle(ctx, request, response, pathname, parsedUrl)`
// returning `true` if it handled the request (response was written) or `false`
// to let the next module try. http-api.ts walks the module list in a documented
// order and falls back to 404 when no module claims the request.
//
// Re-exports the public surface (HttpApiContext, parse helpers, readJsonBody,
// writeJson, requireMethod, requirePersistence) so existing consumers like
// index.ts don't need to know things moved.

import type { IncomingMessage, ServerResponse } from 'node:http';
import * as accountRoute from './routes/account.js';
import * as adminAccountsRoute from './routes/admin-accounts.js';
import * as adminGameArtifactsRoute from './routes/admin-game-artifacts.js';
import * as annotationsRoute from './routes/annotations.js';
import * as authRoute from './routes/auth.js';
import * as banqiGamesRoute from './routes/banqi-games.js';
import * as botsRoute from './routes/bots.js';
import * as chatRoute from './routes/chat.js';
import * as coachesRoute from './routes/coaches.js';
import * as correspondenceGamesRoute from './routes/correspondence-games.js';
import * as correspondenceSeeksRoute from './routes/correspondence-seeks.js';
import * as currentGamesRoute from './routes/current-games.js';
import * as darkXiangqiGamesRoute from './routes/dark-xiangqi-games.js';
import * as duckXiangqiGamesRoute from './routes/duck-xiangqi-games.js';
import * as enginesRoute from './routes/engines.js';
import * as feedbackRoute from './routes/feedback.js';
import * as fortressXiangqiGamesRoute from './routes/fortress-xiangqi-games.js';
import * as forumRoute from './routes/forum.js';
import * as gamesRoute from './routes/games.js';
import * as historicalXiangqiGamesRoute from './routes/historical-xiangqi-games.js';
import * as inboxRoute from './routes/inbox.js';
import * as jieqiGamesRoute from './routes/jieqi-games.js';
import * as jungleFlipGamesRoute from './routes/jungle-flip-games.js';
import * as jungleGamesRoute from './routes/jungle-games.js';
import * as leaderboardRoute from './routes/leaderboard.js';
import type { HttpApiContext } from './routes/lib.js';
import * as lobbyRoute from './routes/lobby.js';
import * as metaRoute from './routes/meta.js';
import * as notificationsRoute from './routes/notifications.js';
import * as oembedRoute from './routes/oembed.js';
import * as openapiRoute from './routes/openapi.js';
import * as patronRoute from './routes/patron.js';
import * as practiceRoute from './routes/practice.js';
import * as puzzlesRoute from './routes/puzzles.js';
import * as readoutsRoute from './routes/readouts.js';
import * as relationsRoute from './routes/relations.js';
import * as roomsRoute from './routes/rooms.js';
import * as studiesRoute from './routes/studies.js';
import * as titlesRoute from './routes/titles.js';
import * as usersRoute from './routes/users.js';
import * as xiangqiBroadcastsRoute from './routes/xiangqi-broadcasts.js';
import * as xiangqiExplorerRoute from './routes/xiangqi-explorer.js';
import * as xiangqiGamesRoute from './routes/xiangqi-games.js';

// Public re-exports: keep import sites in index.ts and elsewhere stable.
export {
  type HttpApiContext,
  isAllowedTimeControl,
  parseHiddenDraft960,
  parseRoomTimeControl,
  parseVariantId,
  readJsonBody,
  requireMethod,
  requirePersistence,
  writeJson,
} from './routes/lib.js';

// Route modules listed in dispatch order. Earlier modules win — order matters
// for path patterns that could overlap (e.g. /api/games vs /api/games/recent).
type RouteModule = {
  tryHandle(
    ctx: HttpApiContext,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    parsedUrl: URL,
  ): Promise<boolean>;
};

// Exported for the games-route registration conformance test
// (games-route-registration.test.ts): a new *-games.ts route file must be added
// here or it silently 404s in production. This array is the hand-maintained
// dispatch mirror with no compile-time enforcement; the test is the backstop.
export const routes: RouteModule[] = [
  annotationsRoute,
  authRoute,
  accountRoute,
  botsRoute,
  chatRoute,
  enginesRoute,
  patronRoute,
  feedbackRoute,
  forumRoute,
  inboxRoute,
  notificationsRoute,
  metaRoute,
  puzzlesRoute,
  readoutsRoute,
  roomsRoute,
  // Ahead of every games route: /api/admin/games/:id/artifacts is variant-agnostic
  // and no other module claims that prefix.
  adminGameArtifactsRoute,
  correspondenceGamesRoute,
  correspondenceSeeksRoute,
  // Ahead of gamesRoute: /api/games/current must not fall into /api/games/:id.
  currentGamesRoute,
  lobbyRoute,
  xiangqiBroadcastsRoute,
  historicalXiangqiGamesRoute,
  xiangqiExplorerRoute,
  xiangqiGamesRoute,
  fortressXiangqiGamesRoute,
  duckXiangqiGamesRoute,
  darkXiangqiGamesRoute,
  jieqiGamesRoute,
  jungleGamesRoute,
  jungleFlipGamesRoute,
  banqiGamesRoute,
  gamesRoute,
  relationsRoute,
  titlesRoute,
  adminAccountsRoute,
  coachesRoute,
  usersRoute,
  leaderboardRoute,
  studiesRoute,
  practiceRoute,
  oembedRoute,
  openapiRoute,
];

export async function handleApiRequest(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = request.url ?? '/';
  const parsedUrl = new URL(url, 'http://localhost');
  const pathname = parsedUrl.pathname;

  for (const route of routes) {
    if (await route.tryHandle(ctx, request, response, pathname, parsedUrl)) return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
}
