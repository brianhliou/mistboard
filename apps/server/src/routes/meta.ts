import type { IncomingMessage, ServerResponse } from 'node:http';
import { getBuildInfo } from '../build-info.js';
import { darkXiangqiEnabled, ratedEnabled } from '../feature-flags.js';
import { collectLiveRoomStats } from '../live-room-stats.js';
import * as persistence from '../persistence.js';
import { onlinePresence, refreshPresence } from '../presence.js';
import { PUBLIC_RATING_TIME_CLASS } from '../rating-buckets.js';
import { readEventLoopLagMs } from '../server-event-loop-lag.js';
import { getProxyTrustWarning } from '../server-policy.js';
import { aggregateEnginePoolStats } from '../uci-engine-harness.js';
import {
  type HttpApiContext,
  isHttpAdminAuthorized,
  isHttpAdminSession,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (pathname === '/api/server-status') {
    if (!requireMethod(request, response, 'GET')) return true;
    writeJson(response, 200, {
      restartAt: ctx.drainDeadlineMs(),
      restartPhase: ctx.restartPhase?.() ?? null,
      activeGames: ctx.activeGameCount(),
      // Why the gate reads what it reads: `gating` is activeGames restated, and
      // the rest are the rooms a deploy is free to restart under (paused,
      // correspondence, long-idle, already finished). A release that stalls is
      // then a readable number rather than a mystery. Aggregate only.
      deployGate: ctx.deployGateCensus?.() ?? null,
      build: getBuildInfo(),
      darkXiangqiEnabled: darkXiangqiEnabled(),
      ratedEnabled: ratedEnabled(),
      proxyTrust: getProxyTrustWarning(),
      // Web-side in-process UCI engine-pool saturation (#203): the leading signal for
      // the non-fog engine-service split, visible before it sheds load as timeouts.
      enginePools: aggregateEnginePoolStats(),
    });
    return true;
  }

  if (pathname === '/api/ping') {
    if (!requireMethod(request, response, 'GET')) return true;
    // Round-trip probe for the account dropdown's connection footer. The client
    // times the request for PING; `lagMs` is the server's event-loop lag for the
    // SERVER readout. Kept trivially cheap (no DB, no allocations) and no-store
    // so it measures live latency rather than a cached response.
    writeJson(
      response,
      200,
      { now: Date.now(), lagMs: readEventLoopLagMs() },
      { 'cache-control': 'no-store' },
    );
    return true;
  }

  if (pathname === '/api/admin/lifecycle') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!isHttpAdminAuthorized(request)) {
      writeJson(response, 401, { error: 'unauthorized' });
      return true;
    }
    if (!requirePersistence(response)) return true;

    const limit = parseLimit(parsedUrl.searchParams.get('limit'));
    const roomId = parsedUrl.searchParams.get('roomId')?.trim() || null;
    if (roomId) {
      writeJson(response, 200, {
        timeline: await persistence.getRoomLifecycleTimeline(roomId, { auditLimit: limit }),
      });
      return true;
    }

    writeJson(response, 200, {
      audit: await persistence.listRoomLifecycleAudit({ limit }),
    });
    return true;
  }

  if (pathname === '/api/live-stats') {
    if (!requireMethod(request, response, 'GET')) return true;
    const stats = collectLiveRoomStats(ctx);
    // Fold in active correspondence games (durable, may have nobody connected)
    // on top of the live in-memory count, skipping any whose room is already
    // counted live so a viewed correspondence game isn't double-counted.
    let playing = stats.playing;
    if (persistence.isInitialized()) {
      try {
        const correspondenceRoomIds = await persistence.listActiveCorrespondenceRoomIds();
        for (const roomId of correspondenceRoomIds) {
          if (!stats.playingRoomIds.has(roomId)) playing += 1;
        }
      } catch {
        // Durable count is best-effort; fall back to the live-only count.
      }
    }
    writeJson(response, 200, { playing, online: stats.onlineIdentities.size });
    return true;
  }

  if (pathname === '/api/players/online') {
    if (!requireMethod(request, response, 'GET')) return true;
    const now = Date.now();
    const stats = collectLiveRoomStats(ctx);
    // Presence is fed by session resolution (see account-session.ts), which a
    // player deep in a long game may not have hit for longer than the TTL. An
    // open room socket is live presence by definition, so re-touch every
    // connected account across the legacy room map and all tenant room maps.
    for (const identity of stats.onlineIdentities) {
      if (identity.startsWith('u:')) refreshPresence(identity.slice(2), now);
    }
    // Same visibility gate as the leaderboard query: private profiles never
    // appear on public surfaces.
    const visible = onlinePresence(now)
      .filter((entry) => entry.profileVisibility !== 'private')
      .sort((a, b) => a.handle.localeCompare(b.handle));
    const listed = visible.slice(0, ONLINE_PLAYERS_LIMIT);
    // One representative rating per player (their best blitz pool). Ratings
    // are decoration here, so the endpoint stays available without a database.
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
    writeJson(
      response,
      200,
      { players, count: visible.length, anonymousOnline: stats.anonymousOnline },
      { 'cache-control': 'no-store' },
    );
    return true;
  }

  if (pathname === '/api/stats/public') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    writeJson(response, 200, await persistence.getPublicSiteStats());
    return true;
  }

  if (pathname === '/api/stats') {
    if (!requireMethod(request, response, 'GET')) return true;
    // Canonical durable totals (accounts/games), unlike the in-memory
    // /api/live-stats. Admin-gated two ways: the debug token for script
    // callers, and an admin session for the /metrics page, which fetches this
    // with a cookie. Token-only was a silent hole: in prod the admin page got
    // a 401 here, fell back to the public view, and dropped the account count,
    // the online count, the result breakdown and the bot-vs-bot row with no
    // error anywhere.
    if (!isHttpAdminAuthorized(request) && !(await isHttpAdminSession(request))) {
      writeJson(response, 401, { error: 'unauthorized' });
      return true;
    }
    if (!requirePersistence(response)) return true;
    writeJson(response, 200, await persistence.getSiteStats());
    return true;
  }

  if (pathname === '/api/stats/admin') {
    if (!requireMethod(request, response, 'GET')) return true;
    // Same gate as /api/stats. The /metrics page's weekly series: human-only
    // players and games, the engagement surfaces, and the engine/corpus modes
    // kept in their own block (docs-private/metrics-roadmap.md).
    if (!isHttpAdminAuthorized(request) && !(await isHttpAdminSession(request))) {
      writeJson(response, 401, { error: 'unauthorized' });
      return true;
    }
    if (!requirePersistence(response)) return true;
    writeJson(response, 200, await persistence.getAdminMetrics(), { 'cache-control': 'no-store' });
    return true;
  }

  return false;
}

// Cap on the online-players listing; `count` still reports the full total.
const ONLINE_PLAYERS_LIMIT = 50;

function parseLimit(value: string | null): number {
  if (!value) return 100;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), 500);
}
