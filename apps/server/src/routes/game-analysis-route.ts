// Generic analysis/decisions route section for the per-variant games routes.
//
// Every variant's `/api/<variant>/games/:id/analysis` (and, for the chance
// variants, `/analysis` + `/decisions`) block was a ~90-250 LOC copy of the same
// pipeline: method gate, launch-flag gate, account gate on POST, fail-closed
// engine-binary gate on POST, optional persistence gate, finished-game input
// loading, cache-first resolution, VacuousAnalysisError -> 503 mapping, and the
// 204/200 envelope. The #221 fix had to be hand-applied three times because of
// that duplication. This factory single-sources the pipeline (mirroring the
// variant-tenant/rooms-route.ts factory pattern); each games route supplies a
// small config binding its flag, loader, resolvers, and response extras.
//
// Compute is ASYNC (#208): POST never runs the sweep inside the request. A
// cached game answers 200 immediately (the fast path is unchanged); a miss is
// enqueued on the analysis job queue and answered 202 + {jobId}, and the client
// polls GET .../(analysis|decisions)/jobs/:jobId for pending/done/failed (+ the
// result envelope on done). Enqueueing is bounded: a ply cap, a per-IP rate
// limit, and a per-account in-flight cap.
//
// Fail-closed invariant: each instance binds exactly ONE route id and its own
// loaders/resolvers. There is no catch-all dispatch — an unknown path simply
// does not match and falls through to the next route module.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from './../account-session.js';
import { type AuthRateLimiter, createAuthRateLimiter } from './../auth-rate-limit.js';
import {
  analysisJobStatusBody,
  enqueueAnalysisJob,
  findPendingAnalysisJob,
  getAnalysisJob,
} from './../game-analysis-jobs.js';
import { VacuousAnalysisError } from './../game-analysis-sweep.js';
import { logger } from './../obs.js';
import { clientIpForRateLimit } from './../server-policy.js';
import { requirePersistence, writeJson } from './lib.js';

export type GameAnalysisEndpoint = 'analysis' | 'decisions';

// Enqueue limits. The ply cap bounds the worst-case sweep (an hours-long
// pathological game is rejected explicitly, not queued); the per-IP limiter
// bounds enqueue churn on top of the per-account pending cap in the job queue.
export const ANALYSIS_MAX_PLIES = 300;
const ENQUEUE_IP_LIMIT = 30;
const ENQUEUE_IP_WINDOW_MS = 10 * 60 * 1000;
// One limiter across every variant: the abuse dimension is the client, not the game.
const sharedEnqueueLimiter = createAuthRateLimiter(ENQUEUE_IP_LIMIT, ENQUEUE_IP_WINDOW_MS);

export type GameAnalysisRoutesConfig<Inputs, A extends object, D extends object> = {
  /** URL segment: `/api/<routeId>/games/:id/(analysis|decisions)`. */
  routeId: string;
  /** snake_case prefix for structured log kinds (`${logPrefix}_analysis_engine_vacuous`). */
  logPrefix: string;
  /** Human label for log messages ('Banqi', 'Flip Jungle', ...). */
  variantLabel: string;
  /** Launch flag; false -> 404 (the variant does not exist on this deploy). */
  enabled(): boolean;
  /** Gate on persistence.isInitialized() (503 persistence_disabled) before loading.
   *  The routes with a live-room fallback (xiangqi/fortress) skip this. */
  requiresPersistence: boolean;
  /** Fail-closed engine presence gate, POST only (GET never needs the engine):
   *  a missing binary is a broken deploy -> alertable log + 503, never a weaker eval.
   *  Omit for engines resolved lazily inside the eval itself (xiangqi/fortress). */
  engineBinary?: { available(): boolean; label: string };
  /** Load the finished game's analysis inputs; null -> 404 (missing / wrong-variant /
   *  unfinished game). Shared by the analysis and decisions endpoints. */
  loadInputs(roomId: string): Promise<Inputs | null>;
  /** Number of plies the sweep would evaluate — the enqueue ply-cap dimension. */
  countPlies(inputs: Inputs): number;
  /** Cache-first, coalesced Layer-1 sweep resolution (see game-analysis-kernel). */
  resolveAnalysis(roomId: string, inputs: Inputs, computeIfMissing: boolean): Promise<A | null>;
  /** Extra response fields merged into the 200 analysis envelope (e.g. chancePlies). */
  analysisExtras?(inputs: Inputs): Record<string, unknown>;
  /** Layer-2 decision decomposition; presence enables the `/decisions` endpoint. */
  resolveDecisions?(roomId: string, inputs: Inputs, computeIfMissing: boolean): Promise<D | null>;
  /** Viewer projection, applied on every read, including already-completed jobs.
   *  Shared job/cache results must remain independent of the requesting viewer. */
  decisionsForViewer?(decisions: D, request: IncomingMessage): Promise<object>;
};

/** Test seams: the account-session lookup and the per-IP enqueue limiter,
 *  injectable so the factory can be unit tested without minting a session
 *  cookie or sharing the process-wide limiter bucket. Default to the real ones. */
export type GameAnalysisRouteDeps = {
  currentUser?(request: IncomingMessage): Promise<{ id: string } | null>;
  enqueueLimiter?: AuthRateLimiter;
};

export type GameAnalysisRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
) => Promise<boolean>;

/**
 * Build the analysis(/decisions) section handler for one variant's games route.
 * Returns true when the request was handled (matched the section's paths).
 *
 * Semantics (identical across variants, previously copy-pasted):
 * - GET returns only the cached result: 204 on a miss, so the client can
 *   auto-load on page open without ever triggering an engine pass.
 * - POST is account-gated (the whole-game sweep is the expensive path). A
 *   cached game answers 200 immediately; a miss enqueues a background job and
 *   answers 202 + {jobId} (never computes in-request, #208), bounded by the ply
 *   cap, the per-IP limiter, and the per-account pending cap.
 * - GET .../(analysis|decisions)/jobs/:jobId polls a job: pending/failed/done,
 *   with the result envelope inlined on done.
 * - The decisions endpoint resolves the basic analysis first as its readiness
 *   gate: a basic-analysis miss on GET means analysis has not been requested
 *   yet, so 204.
 * - A VacuousAnalysisError (scoreless sweep/decomposition) maps to 503
 *   analysis_engine_unavailable with an alertable log; nothing is cached.
 */
export function createGameAnalysisRoutes<Inputs, A extends object, D extends object>(
  config: GameAnalysisRoutesConfig<Inputs, A, D>,
  deps: GameAnalysisRouteDeps = {},
): GameAnalysisRouteHandler {
  const currentUser = deps.currentUser ?? currentAccountUser;
  const enqueueLimiter = deps.enqueueLimiter ?? sharedEnqueueLimiter;
  const pathPrefix = `/api/${config.routeId}/games/`;

  const analysisEnvelope = (analysis: A, inputs: Inputs): Record<string, unknown> | A => {
    const extras = config.analysisExtras?.(inputs);
    return extras ? { ...analysis, ...extras } : analysis;
  };

  return async function handleAnalysisRoutes(request, response, pathname): Promise<boolean> {
    if (!pathname.startsWith(pathPrefix)) return false;
    const segments = pathname.slice(pathPrefix.length).split('/');
    if (segments.length !== 2 && segments.length !== 4) return false;
    const [roomIdRaw, endpoint] = segments;
    if (!roomIdRaw) return false;
    if (endpoint !== 'analysis' && endpoint !== 'decisions') return false;
    if (endpoint === 'decisions' && !config.resolveDecisions) return false;
    const isJobPoll = segments.length === 4;
    if (isJobPoll && segments[2] !== 'jobs') return false;
    if (isJobPoll && !segments[3]) return false;
    const roomId = decodeURIComponent(roomIdRaw);

    const method = request.method ?? 'GET';

    // ── Job poll: GET .../(analysis|decisions)/jobs/:jobId ────────────────────
    if (isJobPoll) {
      if (method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' });
        return true;
      }
      if (!config.enabled()) {
        writeJson(response, 404, { error: 'not_found' });
        return true;
      }
      const job = getAnalysisJob(decodeURIComponent(segments[3]!));
      if (
        !job ||
        job.variant !== config.routeId ||
        job.roomId !== roomId ||
        job.kind !== endpoint
      ) {
        writeJson(response, 404, { error: 'not_found' });
        return true;
      }
      const body = analysisJobStatusBody(job);
      if (endpoint === 'decisions' && job.status === 'done' && config.decisionsForViewer) {
        body.result = await config.decisionsForViewer(job.result as D, request);
      }
      writeJson(response, 200, body);
      return true;
    }

    if (method !== 'GET' && method !== 'POST') {
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!config.enabled()) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    let accountId: string | null = null;
    if (method === 'POST') {
      const user = await currentUser(request);
      if (!user) {
        writeJson(response, 401, { error: 'not_signed_in' });
        return true;
      }
      accountId = user.id;
      if (config.engineBinary && !config.engineBinary.available()) {
        logger.error(
          { kind: `${config.logPrefix}_${endpoint}_engine_unavailable` },
          `${config.variantLabel} ${endpoint} requested but the ${config.engineBinary.label} is not present; failing closed`,
        );
        writeJson(response, 503, { error: 'analysis_engine_unavailable' });
        return true;
      }
    }
    if (config.requiresPersistence && !requirePersistence(response)) return true;

    const inputs = await config.loadInputs(roomId);
    if (!inputs) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }

    // Enqueue a compute job and answer 202 + {jobId}; coalesces onto an already-
    // pending job for the same (variant, room, kind) before burning any limit.
    const enqueue = (kind: GameAnalysisEndpoint, run: () => Promise<unknown>): void => {
      if (config.countPlies(inputs) > ANALYSIS_MAX_PLIES) {
        writeJson(response, 422, { error: 'rejected_too_long' });
        return;
      }
      const existing = findPendingAnalysisJob(config.routeId, roomId, kind);
      if (existing) {
        writeJson(response, 202, { jobId: existing.id, status: 'pending' });
        return;
      }
      if (!enqueueLimiter.check(clientIpForRateLimit(request))) {
        writeJson(response, 429, { error: 'rate_limited' });
        return;
      }
      const enqueued = enqueueAnalysisJob({
        variant: config.routeId,
        roomId,
        kind,
        // POST is account-gated above, so accountId is always set here.
        accountId: accountId ?? 'unknown',
        run,
      });
      if (!enqueued.ok) {
        writeJson(response, enqueued.error === 'too_many_pending_analyses' ? 429 : 503, {
          error: enqueued.error,
        });
        return;
      }
      writeJson(response, 202, { jobId: enqueued.job.id, status: 'pending' });
    };

    try {
      // Cache reads only on the request path — compute happens on the job queue.
      const cachedAnalysis = await config.resolveAnalysis(roomId, inputs, false);

      if (endpoint === 'analysis') {
        if (cachedAnalysis) {
          writeJson(response, 200, analysisEnvelope(cachedAnalysis, inputs));
          return true;
        }
        if (method === 'GET') {
          response.writeHead(204).end();
          return true;
        }
        enqueue('analysis', async () => {
          const analysis = await config.resolveAnalysis(roomId, inputs, true);
          if (!analysis) throw new Error('analysis_unavailable');
          return analysisEnvelope(analysis, inputs);
        });
        return true;
      }

      // Decisions: the basic analysis cache is the readiness gate on GET; a POST
      // job computes the basic sweep first (usually a cache hit), then the
      // decomposition — exactly what the synchronous path did.
      const cachedDecisions = cachedAnalysis
        ? await config.resolveDecisions?.(roomId, inputs, false)
        : null;
      if (cachedAnalysis && cachedDecisions) {
        writeJson(
          response,
          200,
          config.decisionsForViewer
            ? await config.decisionsForViewer(cachedDecisions, request)
            : cachedDecisions,
        );
        return true;
      }
      if (method === 'GET') {
        response.writeHead(204).end();
        return true;
      }
      enqueue('decisions', async () => {
        const analysis = await config.resolveAnalysis(roomId, inputs, true);
        if (!analysis) throw new Error('analysis_unavailable');
        const decisions = await config.resolveDecisions?.(roomId, inputs, true);
        if (!decisions) throw new Error('decisions_unavailable');
        return decisions;
      });
    } catch (err) {
      // A scoreless sweep/decomposition (engine emitted moves but no evals) fails
      // closed like a missing binary: 503, nothing cached, rather than a bogus
      // flawless-game result. (Job-queue failures map to the same code via the
      // job's failed status; this catch covers resolver reads.)
      if (err instanceof VacuousAnalysisError) {
        logger.error(
          { kind: `${config.logPrefix}_${endpoint}_engine_vacuous`, room_id: roomId },
          `${config.variantLabel} ${endpoint} produced no evals (engine emitted no score); failing closed`,
        );
        writeJson(response, 503, { error: 'analysis_engine_unavailable' });
        return true;
      }
      throw err;
    }
    return true;
  };
}
