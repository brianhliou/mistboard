/**
 * GET /api/admin/games/:roomId/artifacts?type=live-engine-decision
 *
 * One variant-agnostic reader for per-move engine telemetry. Every tenant PvE
 * loop queues its decisions into the same `game_debug_artifacts` rows keyed by
 * room id, and nothing about reading them back is variant-specific — the
 * per-variant routes that came first (routes/xiangqi-games.ts,
 * routes/dark-xiangqi-games.ts) differ only in which spec id they check. Five
 * more copies of that for banqi, jungle, flip jungle, jieqi and fortress would
 * have been five more places for the same bug. Those two stay where they are:
 * the admin UI and existing links point at them, and this route is additive.
 *
 * The 404 is the load-bearing part. An unknown room id, or an id that names no
 * finished game, is NOT `200 {"artifacts": []}`. An empty 200 for any string
 * you can type turns "wrong route", "wrong id", and "this game predates the
 * instrumentation" into the single indistinguishable answer "this engine
 * recorded nothing" — which is how a missing-instrumentation problem was
 * investigated as an engine bug for most of a session. An empty list here means
 * the game exists and genuinely has no decisions.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from '../account-session.js';
import * as persistence from './../persistence.js';
import { LIVE_ENGINE_DECISION_ARTIFACT_TYPE } from './../persistence-game-lifecycle.js';
import { isProductionLikeRuntime } from '../server-policy.js';
import { type HttpApiContext, requireMethod, writeJson } from './lib.js';

/** Artifact types this route will serve. Fail-closed: an unlisted type is a 400,
 *  never a silent empty list, so a typo cannot read as "nothing recorded". */
const READABLE_ARTIFACT_TYPES: readonly string[] = [LIVE_ENGINE_DECISION_ARTIFACT_TYPE];

export type AdminGameArtifactsPersistence = {
  isPersistenceEnabled?(): boolean;
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  listArtifacts(
    roomId: string,
    artifactType: string,
  ): ReturnType<typeof persistence.listGameDebugArtifactPayloads>;
};

const livePersistence: AdminGameArtifactsPersistence = {
  isPersistenceEnabled: () => persistence.isInitialized(),
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  listArtifacts: (roomId, artifactType) =>
    persistence.listGameDebugArtifactPayloads(roomId, { artifactType }),
};

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  const match = pathname.match(/^\/api\/admin\/games\/([^/]+)\/artifacts$/);
  if (!match) return false;
  if (!requireMethod(request, response, 'GET')) return true;

  // Authenticate before validation so anonymous requests consistently get 401.
  if (isProductionLikeRuntime()) {
    const user = await currentAccountUser(request);
    if (user?.accountRole !== 'admin') {
      writeJson(response, user ? 403 : 401, { error: 'admin_required' });
      return true;
    }
  }

  const artifactType = parsedUrl.searchParams.get('type');
  if (artifactType === null || !READABLE_ARTIFACT_TYPES.includes(artifactType)) {
    writeJson(response, 400, { error: 'invalid_artifact_type' });
    return true;
  }
  const payload = await adminGameArtifactsForApi(decodeURIComponent(match[1]!), artifactType);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

/**
 * Null means 404 — no such finished game, or persistence is off so the question
 * cannot be answered at all. Only a real game returns a (possibly empty) list.
 * `deps` is injectable so those cases are testable without req/res plumbing,
 * matching the *ForApi convention in the per-variant games routes.
 */
export async function adminGameArtifactsForApi(
  roomId: string,
  artifactType: string = LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
  deps: AdminGameArtifactsPersistence = livePersistence,
) {
  if (!READABLE_ARTIFACT_TYPES.includes(artifactType)) return null;
  // Persistence off means "unknown", not "empty": there is no store to have
  // recorded anything in, and reporting an empty list would assert the opposite.
  if (!(deps.isPersistenceEnabled?.() ?? true)) return null;
  const game = await deps.getGameSummary(roomId);
  // Deliberately variant-agnostic: any finished game qualifies. The rows are
  // keyed by room id and a room id belongs to exactly one variant, so there is
  // nothing for a variant check to protect here — and a check would reintroduce
  // the per-variant copies this route exists to avoid.
  if (!game) return null;
  const artifacts = await deps.listArtifacts(roomId, artifactType);
  return {
    roomId,
    variant: game.variant,
    artifactType,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      gameId: artifact.gameId,
      ply: artifact.ply,
      engineColor: artifact.engineColor,
      artifactType: artifact.artifactType,
      payload: artifact.payload,
      createdAt: artifact.createdAt.toISOString(),
    })),
  };
}
