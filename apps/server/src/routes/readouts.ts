import type { IncomingMessage, ServerResponse } from 'node:http';
import { getBuildInfo } from '../build-info.js';
import {
  type MistboardReadoutTrigger,
  renderMistboardReadoutMarkdown,
  scheduledReadoutTrigger,
} from '../mistboard-readout.js';
import {
  authorizeGithubReadoutBearer,
  type MistboardReadoutTokenVerifier,
  verifyGithubReadoutToken,
} from '../mistboard-readout-oidc.js';
import * as persistence from '../persistence.js';
import {
  generateMistboardReadout,
  latestMistboardReadout,
  listMistboardReadoutSummaries,
} from '../persistence-mistboard-readout.js';
import { sendReadoutEmail } from '../readout-email.js';
import { type HttpApiContext, isHttpAdminSession, readJsonBody, writeJson } from './lib.js';

type ReadoutRouteDependencies = {
  verifyToken: MistboardReadoutTokenVerifier;
  generate: typeof generateMistboardReadout;
  latest: typeof latestMistboardReadout;
  list: typeof listMistboardReadoutSummaries;
  email: typeof sendReadoutEmail;
  now: () => Date;
};

const defaultDependencies: ReadoutRouteDependencies = {
  verifyToken: verifyGithubReadoutToken,
  generate: generateMistboardReadout,
  latest: latestMistboardReadout,
  list: listMistboardReadoutSummaries,
  email: sendReadoutEmail,
  now: () => new Date(),
};

const READOUT_PATHS = [
  '/api/admin/readouts/generate',
  '/api/admin/readouts/latest',
  '/api/admin/readouts/history',
] as const;

// The field is optional on the report: a context without the census (tests,
// older snapshots) leaves it out rather than reporting a peak of zero.
function broadcastViewersRuntime(ctx: HttpApiContext): { broadcastViewersPeak?: number } {
  const stats = ctx.broadcastViewers?.();
  return stats ? { broadcastViewersPeak: stats.peakToday } : {};
}

export async function readoutGenerateForApi(
  ctx: HttpApiContext,
  body: Record<string, unknown>,
  deps: ReadoutRouteDependencies = defaultDependencies,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const now = deps.now();
  const trigger = parseTrigger(body.trigger, now);
  if (!trigger) return { status: 400, payload: { error: 'invalid_trigger' } };
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return { status: 400, payload: { error: 'invalid_dry_run' } };
  }
  const result = await deps.generate({
    trigger,
    now,
    dryRun: body.dryRun === true,
    runtime: {
      revision: getBuildInfo().revision,
      activeGames: ctx.activeGameCount?.() ?? 0,
      databaseRequired: ctx.databaseRequired,
      persistence: persistence.isInitialized() ? 'enabled' : 'disabled',
      persistenceErrors: ctx.persistenceHealth?.() ?? { count1m: 0, lastAt: null },
      ...broadcastViewersRuntime(ctx),
    },
  });
  // Fire and forget, like the engine alerts: a mail provider having a bad day
  // must not fail the readout that is already stored.
  const emailed = await deps
    .email({
      report: result.report,
      reused: result.reused,
      previousAlertKey: result.previousAlertKey,
      dryRun: body.dryRun === true,
    })
    .catch(() => ({ send: false, reason: 'disabled' as const }));
  return {
    status: 200,
    payload: {
      report: result.report,
      markdown: renderMistboardReadoutMarkdown(result.report),
      reused: result.reused,
      emailed: emailed.send,
    },
  };
}

export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (!(READOUT_PATHS as readonly string[]).includes(pathname)) return false;

  const method = pathname.endsWith('/generate') ? 'POST' : 'GET';
  if ((request.method ?? 'GET') !== method) {
    writeJson(
      response,
      405,
      { error: 'method_not_allowed' },
      { allow: method, 'cache-control': 'no-store' },
    );
    return true;
  }
  // Generation stays workflow-only: it writes a snapshot and can send mail, so
  // the OIDC identity of the scheduled run is the only thing that may ask for
  // one. Reads also accept an admin session, which is what the /readouts page
  // authenticates with.
  const authorized =
    (await authorizeGithubReadoutBearer(
      request.headers.authorization,
      defaultDependencies.verifyToken,
    )) ||
    (method === 'GET' && (await isHttpAdminSession(request)));
  if (!authorized) {
    writeJson(response, 401, { error: 'unauthorized' }, { 'cache-control': 'no-store' });
    return true;
  }
  if (!persistence.isInitialized()) {
    writeJson(response, 503, { error: 'persistence_disabled' }, { 'cache-control': 'no-store' });
    return true;
  }

  if (pathname.endsWith('/history')) {
    const limit = Number.parseInt(parsedUrl.searchParams.get('limit') ?? '', 10);
    const summaries = await defaultDependencies.list(undefined, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    writeJson(response, 200, { readouts: summaries }, { 'cache-control': 'no-store' });
    return true;
  }

  if (pathname.endsWith('/latest')) {
    const report = await defaultDependencies.latest();
    writeJson(
      response,
      report ? 200 : 404,
      report
        ? { report, markdown: renderMistboardReadoutMarkdown(report) }
        : { error: 'not_found' },
      { 'cache-control': 'no-store' },
    );
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch {
    writeJson(response, 400, { error: 'invalid_request_body' }, { 'cache-control': 'no-store' });
    return true;
  }
  try {
    const result = await readoutGenerateForApi(ctx, body);
    writeJson(response, result.status, result.payload, { 'cache-control': 'no-store' });
  } catch {
    writeJson(
      response,
      500,
      { error: 'readout_generation_failed' },
      { 'cache-control': 'no-store' },
    );
  }
  return true;
}

function parseTrigger(value: unknown, now: Date): MistboardReadoutTrigger | null {
  if (value === undefined || value === 'auto') return scheduledReadoutTrigger(now);
  if (value === 'daily' || value === 'weekly' || value === 'manual') return value;
  return null;
}
