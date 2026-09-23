import type { XiangqiBroadcastBoard } from '@mistboard/game';
import type pg from 'pg';
import * as persistence from './persistence.js';
import { withRollbackTransaction } from './persistence-db.js';
import { looksLikeDpxqPage, normalizeDpxqPageToFrameHtml } from './xiangqi-broadcast-dpxq.js';
import type { XiangqiBroadcastSourceFetch } from './xiangqi-broadcast-fetch.js';
import { defaultXiangqiBroadcastFetch } from './xiangqi-broadcast-fetch.js';

export type { XiangqiBroadcastSourceFetch } from './xiangqi-broadcast-fetch.js';

import {
  listXiangqiBroadcastBoards,
  listXiangqiBroadcastRounds,
} from './persistence-xiangqi-broadcasts.js';
import {
  buildDiscoveryManifestSources,
  buildStatedRoundManifestSources,
  type DiscoverySource,
  isXiangqiBroadcastDiscoveryUrl,
  NO_ACTIVE_ROUND_MESSAGE,
  parseXiangqiBroadcastDiscoverySource,
  resolveScheduledRound,
} from './xiangqi-broadcast-discovery.js';
import { registerDefaultXiangqiBroadcastDiscoveryProviders } from './xiangqi-broadcast-discovery-dpxq.js';

import {
  validateXiangqiBroadcastSourceUrl,
  type XiangqiBroadcastSourceUrlPolicy,
  xiangqiBroadcastSourceUrlPolicyFromEnv,
} from './xiangqi-broadcast-source-policy.js';
import {
  convertWxfDhtmlXqPageToSnapshot,
  type WxfDhtmlXqIssue,
} from './xiangqi-broadcast-wxf-dhtmlxq.js';

export type XiangqiBroadcastSourceSnapshot = {
  tour: unknown;
  rounds: unknown[];
  boards: unknown[];
};

export const XIANGQI_BROADCAST_MANIFEST_SCHEMA = 'mistboard.xiangqi.broadcast.manifest.v1';
export const XIANGQI_BROADCAST_MANIFEST_MAX_SOURCES = 32;

export type XiangqiBroadcastManifestSource = {
  url: string;
  tourSlug?: string;
  tourName?: string;
  roundId?: string;
  roundName?: string;
  /** Board number to assign, for sources that serve one game per page. */
  boardNumber?: number;
};

export type XiangqiBroadcastSourceManifest = {
  schema: typeof XIANGQI_BROADCAST_MANIFEST_SCHEMA;
  sources: XiangqiBroadcastManifestSource[];
};

export type XiangqiBroadcastPollErrorKind =
  | 'source_disallowed'
  | 'source_http_error'
  | 'source_fetch_error'
  | 'source_timeout'
  | 'source_malformed';

export type XiangqiBroadcastPollSourceOutcome =
  | {
      ok: true;
      sourceUrl: string;
      tourSlug: string;
      roundsImported: number;
      boardsSeen: number;
      boardsFailed: number;
      updates: persistence.XiangqiBroadcastBoardUpdateResult[];
    }
  | {
      ok: false;
      sourceUrl: string;
      kind: XiangqiBroadcastPollErrorKind;
      message: string;
    };

export type XiangqiBroadcastPollResult =
  | {
      ok: true;
      sourceUrl: string;
      dryRun: boolean;
      tourSlug: string;
      roundsImported: number;
      boardsSeen: number;
      boardsFailed: number;
      sourcesSeen: number;
      sourcesFailed: number;
      updates: persistence.XiangqiBroadcastBoardUpdateResult[];
      sources: XiangqiBroadcastPollSourceOutcome[];
    }
  | {
      ok: false;
      sourceUrl: string;
      dryRun: boolean;
      kind: XiangqiBroadcastPollErrorKind;
      message: string;
    };

export type XiangqiBroadcastPollSchedule = {
  intervalMs: number;
  maxIntervalMs: number;
  backoffMultiplier: number;
};

export type XiangqiBroadcastSourceBody =
  | { kind: 'snapshot'; snapshot: XiangqiBroadcastSourceSnapshot }
  | { kind: 'manifest'; manifest: XiangqiBroadcastSourceManifest }
  | { kind: 'wxf-dhtmlxq'; html: string }
  | { kind: 'malformed'; message: string; parsedJson?: unknown };

type SnapshotValidationResult =
  | { ok: true; snapshot: XiangqiBroadcastSourceSnapshot }
  | { ok: false; message: string };

type ManifestValidationResult =
  | { ok: true; manifest: XiangqiBroadcastSourceManifest }
  | { ok: false; message: string };

type SourceUnit = {
  sourceUrl: string;
  snapshot: XiangqiBroadcastSourceSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSourceSnapshot(value: unknown): SnapshotValidationResult {
  if (!isRecord(value)) return { ok: false, message: 'source snapshot must be an object' };
  if (!Array.isArray(value.rounds)) return { ok: false, message: 'source.rounds must be an array' };
  if (!Array.isArray(value.boards)) return { ok: false, message: 'source.boards must be an array' };
  return {
    ok: true,
    snapshot: {
      tour: value.tour,
      rounds: value.rounds,
      boards: value.boards,
    },
  };
}

registerDefaultXiangqiBroadcastDiscoveryProviders();

const MANIFEST_SOURCE_STRING_OPTIONS = ['tourSlug', 'tourName', 'roundId', 'roundName'] as const;

function validateSourceManifest(value: Record<string, unknown>): ManifestValidationResult {
  if (!Array.isArray(value.sources)) {
    return { ok: false, message: 'manifest.sources must be an array' };
  }
  if (value.sources.length === 0) {
    return { ok: false, message: 'manifest.sources must not be empty' };
  }
  if (value.sources.length > XIANGQI_BROADCAST_MANIFEST_MAX_SOURCES) {
    return {
      ok: false,
      message: `manifest.sources must list at most ${XIANGQI_BROADCAST_MANIFEST_MAX_SOURCES} sources`,
    };
  }
  const sources: XiangqiBroadcastManifestSource[] = [];
  for (const [index, rawSource] of value.sources.entries()) {
    if (!isRecord(rawSource) || typeof rawSource.url !== 'string' || rawSource.url.length === 0) {
      return { ok: false, message: `manifest source ${index + 1} must have a url` };
    }
    const source: XiangqiBroadcastManifestSource = { url: rawSource.url };
    if (rawSource.boardNumber !== undefined) {
      const boardNumber = rawSource.boardNumber;
      if (typeof boardNumber !== 'number' || !Number.isInteger(boardNumber) || boardNumber < 1) {
        return {
          ok: false,
          message: `manifest source ${index + 1} boardNumber must be a positive integer`,
        };
      }
      source.boardNumber = boardNumber;
    }
    for (const key of MANIFEST_SOURCE_STRING_OPTIONS) {
      const optionValue = rawSource[key];
      if (optionValue === undefined) continue;
      if (typeof optionValue !== 'string') {
        return { ok: false, message: `manifest source ${index + 1} ${key} must be a string` };
      }
      source[key] = optionValue;
    }
    sources.push(source);
  }
  return { ok: true, manifest: { schema: XIANGQI_BROADCAST_MANIFEST_SCHEMA, sources } };
}

// Classify a fetched source body without trusting any of it: canonical JSON
// snapshot, source manifest, or a WXF-style page carrying DhtmlXQ frames.
// Everything else is malformed. All three shapes still validate through the
// rules engine before any board becomes persisted state.
export function interpretXiangqiBroadcastSourceBody(text: string): XiangqiBroadcastSourceBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (text.includes('[DhtmlXQiFrame]')) return { kind: 'wxf-dhtmlxq', html: text };
    // Raw dpxq.com pages carry DhtmlXQ move data without the frame wrapper;
    // normalize them into the same shape before the converter sees them.
    if (looksLikeDpxqPage(text)) {
      const normalized = normalizeDpxqPageToFrameHtml(text);
      if (normalized.ok) return { kind: 'wxf-dhtmlxq', html: normalized.html };
      return {
        kind: 'malformed',
        message: `dpxq page could not be normalized: ${normalized.reason}`,
      };
    }
    return {
      kind: 'malformed',
      message: 'source body is neither JSON nor a DhtmlXQ page',
    };
  }
  if (isRecord(parsed) && parsed.schema === XIANGQI_BROADCAST_MANIFEST_SCHEMA) {
    const manifest = validateSourceManifest(parsed);
    if (!manifest.ok) return { kind: 'malformed', message: manifest.message, parsedJson: parsed };
    return { kind: 'manifest', manifest: manifest.manifest };
  }
  const snapshot = validateSourceSnapshot(parsed);
  if (!snapshot.ok) return { kind: 'malformed', message: snapshot.message, parsedJson: parsed };
  return { kind: 'snapshot', snapshot: snapshot.snapshot };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function sourcePayloadSummary(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (!isRecord(value)) return { type: value === null ? 'null' : typeof value };
  const keys = Object.keys(value).sort();
  return {
    type: 'object',
    keys: keys.slice(0, 12),
    keyCount: keys.length,
  };
}

export function xiangqiBroadcastPollSchedule(input: {
  intervalMs: number;
  maxIntervalMs?: number;
  backoffMultiplier?: number;
}): XiangqiBroadcastPollSchedule {
  const intervalMs = boundedInteger(input.intervalMs, 250, 60_000, 1_000);
  const maxIntervalMs = Math.max(
    intervalMs,
    boundedInteger(input.maxIntervalMs ?? 30_000, intervalMs, 300_000, 30_000),
  );
  const backoffMultiplier =
    typeof input.backoffMultiplier === 'number' && Number.isFinite(input.backoffMultiplier)
      ? Math.min(Math.max(input.backoffMultiplier, 1), 10)
      : 2;
  return { intervalMs, maxIntervalMs, backoffMultiplier };
}

export function nextXiangqiBroadcastPollDelayMs(input: {
  result: XiangqiBroadcastPollResult;
  previousDelayMs: number;
  schedule: XiangqiBroadcastPollSchedule;
}): number {
  if (input.result.ok) return input.schedule.intervalMs;
  const previous = Math.max(input.previousDelayMs, input.schedule.intervalMs);
  return Math.min(
    input.schedule.maxIntervalMs,
    Math.max(input.schedule.intervalMs, Math.ceil(previous * input.schedule.backoffMultiplier)),
  );
}

function boundedInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

type PollContext = {
  timeoutMs: number;
  allowCorrection: boolean;
  dryRun: boolean;
  fetchImpl: XiangqiBroadcastSourceFetch;
  sourcePolicy: XiangqiBroadcastSourceUrlPolicy;
  /**
   * The tour this poll is for, when the caller knows it (the scheduler always
   * does; a discovery URL pins it). Every sync log the poll writes carries it,
   * because the tour endpoint reads its health as "the newest log with my
   * slug": an error written without one is invisible there, and that is how
   * the Shanghai Cup tour reported no sync log at all through five days of
   * source_malformed on every poll.
   */
  tourSlug?: string;
  /** Pause between a manifest's page fetches; see LEAF_FETCH_SPACING_MS. */
  leafSpacingMs: number;
};

// dpxq answers 503 to a burst: 33 requests in two seconds (one game list and a
// manifest's 32 pages) failed from a laptop on 2026-09-23, and prod logged
// source_fetch_error the day before. A pause between pages keeps a full poll
// near fifteen seconds. Only the real network gets it; an injected fetch (the
// tests, the fake source server) has no one to be polite to.
export const LEAF_FETCH_SPACING_MS = 400;

async function recordSourceError(
  context: Pick<PollContext, 'dryRun' | 'tourSlug'>,
  input: {
    sourceUrl: string;
    kind: XiangqiBroadcastPollErrorKind;
    message: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  if (context.dryRun) return;
  await persistence.recordXiangqiBroadcastSyncLog({
    ...(context.tourSlug ? { tourSlug: context.tourSlug } : {}),
    severity: 'error',
    kind: input.kind,
    message: input.message,
    payload: {
      sourceUrl: input.sourceUrl,
      ...input.payload,
    },
  });
}

async function recordSkippedFrames(
  context: Pick<PollContext, 'dryRun' | 'tourSlug'>,
  sourceUrl: string,
  issues: WxfDhtmlXqIssue[],
): Promise<void> {
  if (context.dryRun || issues.length === 0) return;
  await persistence.recordXiangqiBroadcastSyncLog({
    severity: 'warning',
    kind: 'source_frames_skipped',
    message: `skipped ${issues.length} unusable DhtmlXQ frame(s) from source page`,
    payload: {
      sourceUrl,
      issues: issues.map((issue) => ({
        kind: issue.kind,
        message: issue.message,
        ...(issue.sourceBoardId ? { sourceBoardId: issue.sourceBoardId } : {}),
      })),
    },
  });
}

async function fetchSourceText(input: {
  sourceUrl: string;
  timeoutMs: number;
  fetchImpl: XiangqiBroadcastSourceFetch;
}): Promise<
  { ok: true; value: string } | { ok: false; kind: XiangqiBroadcastPollErrorKind; message: string }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  timeout.unref?.();

  try {
    const response = await input.fetchImpl(input.sourceUrl, { signal: controller.signal });
    if (!response.ok) {
      return {
        ok: false,
        kind: 'source_http_error',
        message: `source answered HTTP ${response.status}`,
      };
    }
    return { ok: true, value: await response.text() };
  } catch (error) {
    return {
      ok: false,
      kind: isAbortError(error) ? 'source_timeout' : 'source_fetch_error',
      message: isAbortError(error)
        ? `source timed out after ${input.timeoutMs}ms`
        : errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

type SourceResolution =
  | { ok: true; unit: SourceUnit }
  | { ok: false; kind: XiangqiBroadcastPollErrorKind; message: string };

async function resolveLeafSource(
  context: PollContext,
  sourceUrl: string,
  options: Omit<XiangqiBroadcastManifestSource, 'url'>,
  errorPayload: Record<string, unknown>,
): Promise<SourceResolution> {
  const decision = validateXiangqiBroadcastSourceUrl(sourceUrl, context.sourcePolicy);
  if (!decision.ok) {
    await recordSourceError(context, {
      sourceUrl,
      kind: 'source_disallowed',
      message: decision.message,
      payload: { reason: decision.reason, ...errorPayload },
    });
    return { ok: false, kind: 'source_disallowed', message: decision.message };
  }

  const fetched = await fetchSourceText({
    sourceUrl,
    timeoutMs: context.timeoutMs,
    fetchImpl: context.fetchImpl,
  });
  if (!fetched.ok) {
    await recordSourceError(context, {
      sourceUrl,
      kind: fetched.kind,
      message: fetched.message,
      payload: { timeoutMs: context.timeoutMs, ...errorPayload },
    });
    return { ok: false, kind: fetched.kind, message: fetched.message };
  }

  const body = interpretXiangqiBroadcastSourceBody(fetched.value);
  if (body.kind === 'malformed') {
    await recordSourceError(context, {
      sourceUrl,
      kind: 'source_malformed',
      message: body.message,
      payload: {
        bodySummary:
          body.parsedJson !== undefined
            ? sourcePayloadSummary(body.parsedJson)
            : { type: 'text', length: fetched.value.length },
        ...errorPayload,
      },
    });
    return { ok: false, kind: 'source_malformed', message: body.message };
  }
  if (body.kind === 'manifest') {
    const message = 'nested source manifests are not allowed';
    await recordSourceError(context, {
      sourceUrl,
      kind: 'source_malformed',
      message,
      payload: errorPayload,
    });
    return { ok: false, kind: 'source_malformed', message };
  }
  if (body.kind === 'wxf-dhtmlxq') {
    return await convertWxfSourceUnit(context, sourceUrl, body.html, options, errorPayload);
  }
  return { ok: true, unit: { sourceUrl, snapshot: body.snapshot } };
}

async function convertWxfSourceUnit(
  context: PollContext,
  sourceUrl: string,
  html: string,
  options: Omit<XiangqiBroadcastManifestSource, 'url'>,
  errorPayload: Record<string, unknown>,
): Promise<SourceResolution> {
  const converted = convertWxfDhtmlXqPageToSnapshot(html, {
    ...options,
    sourceUrl,
  });
  if (!converted.ok) {
    const message =
      converted.issues[0]?.message ?? 'DhtmlXQ page produced no usable broadcast boards';
    await recordSourceError(context, {
      sourceUrl,
      kind: 'source_malformed',
      message,
      payload: {
        issues: converted.issues.map((issue) => issue.kind),
        ...errorPayload,
      },
    });
    return { ok: false, kind: 'source_malformed', message };
  }
  await recordSkippedFrames(context, sourceUrl, converted.issues);
  return {
    ok: true,
    unit: {
      sourceUrl,
      snapshot: {
        tour: converted.snapshot.tour,
        rounds: converted.snapshot.rounds,
        boards: converted.snapshot.boards,
      },
    },
  };
}

async function applySourceUnit(
  context: PollContext,
  unit: SourceUnit,
  client: pg.PoolClient | null,
): Promise<XiangqiBroadcastPollSourceOutcome> {
  let imported: persistence.XiangqiBroadcastImportResult;
  const pack = { tour: unit.snapshot.tour, rounds: unit.snapshot.rounds, boards: [] };
  try {
    imported = client
      ? await persistence.importXiangqiBroadcastPackOn(client, pack)
      : await persistence.importXiangqiBroadcastPack(pack);
  } catch (error) {
    const message = errorMessage(error);
    await recordSourceError(context, {
      sourceUrl: unit.sourceUrl,
      kind: 'source_malformed',
      message,
      payload: { phase: 'tour_round_import' },
    });
    return { ok: false, sourceUrl: unit.sourceUrl, kind: 'source_malformed', message };
  }

  const updates: persistence.XiangqiBroadcastBoardUpdateResult[] = [];
  for (const board of unit.snapshot.boards as XiangqiBroadcastBoard[]) {
    const updateOptions = {
      allowCorrection: context.allowCorrection,
      source: unit.sourceUrl,
    };
    updates.push(
      client
        ? await persistence.applyXiangqiBroadcastBoardUpdateOn(client, board, updateOptions)
        : await persistence.applyXiangqiBroadcastBoardUpdate(board, updateOptions),
    );
  }

  return {
    ok: true,
    sourceUrl: unit.sourceUrl,
    tourSlug: imported.tourSlug,
    roundsImported: imported.roundsImported,
    boardsSeen: unit.snapshot.boards.length,
    boardsFailed: updates.filter((update) => !update.ok).length,
    updates,
  };
}

type BodyResolution =
  | { ok: true; body: Exclude<XiangqiBroadcastSourceBody, { kind: 'malformed' }> }
  | { ok: false; kind: XiangqiBroadcastPollErrorKind; message: string };

// Discovery: run the provider, work out which round the poll belongs to, and
// return a manifest built in memory rather than parsed from a response.
//
// The discovery URL is never fetched, so it never meets the host allowlist.
// That is safe because every board URL a provider yields goes through
// resolveLeafSource below, which re-runs validateXiangqiBroadcastSourceUrl per
// entry; the fail-closed property lives at the leaves, which is where it has to.
async function discoverManifest(
  context: PollContext,
  sourceUrl: string,
): Promise<
  | { ok: true; manifest: XiangqiBroadcastSourceManifest }
  | { ok: false; kind: XiangqiBroadcastPollErrorKind; message: string; quiet?: true }
> {
  const parsed = parseXiangqiBroadcastDiscoverySource(
    sourceUrl,
    XIANGQI_BROADCAST_MANIFEST_MAX_SOURCES,
  );
  if (!parsed.ok) return { ok: false, kind: 'source_malformed', message: parsed.message };
  context.tourSlug ??= parsed.source.tourSlug;

  const rounds = await listXiangqiBroadcastRounds(parsed.source.tourSlug);
  if (parsed.source.provider.statesRounds) {
    return discoverStatedRounds(context, parsed.source, rounds);
  }

  const round = resolveScheduledRound(
    rounds.flatMap((row) =>
      row.startsAt ? [{ id: row.id, name: row.name, startsAt: new Date(row.startsAt) }] : [],
    ),
    new Date(),
  );
  // Between sessions there is no active round, and importing nothing is the
  // correct outcome: guessing the most recent round would file the next
  // round's games under the previous one.
  //
  // That state holds for most of a multi-day event, so it is marked quiet. A
  // sync log per tick would be tens of thousands of rows across an eleven-day
  // tournament and would leave the ops console's source health red exactly
  // when it most needs to mean something.
  if (!round.ok) {
    return {
      ok: false,
      kind: 'source_malformed',
      message: round.message,
      ...(round.message === NO_ACTIVE_ROUND_MESSAGE ? { quiet: true as const } : {}),
    };
  }

  const discovered = await parsed.source.provider.discover({
    config: parsed.source.config,
    fetchImpl: context.fetchImpl,
    timeoutMs: context.timeoutMs,
  });
  if (!discovered.ok) {
    return { ok: false, kind: 'source_fetch_error', message: discovered.message };
  }

  const built = buildDiscoveryManifestSources({
    source: parsed.source,
    boards: discovered.boards,
    round: { roundId: round.roundId, ...(round.roundName ? { roundName: round.roundName } : {}) },
  });
  if (!built.ok) return { ok: false, kind: 'source_malformed', message: built.message };
  if (built.droppedForCap > 0) {
    // A silent cap reads as full coverage.
    console.warn(
      `[xiangqi-broadcast] discovery kept ${built.sources.length} board(s) and dropped ${built.droppedForCap} over the manifest cap`,
    );
  }

  return {
    ok: true,
    manifest: { schema: XIANGQI_BROADCAST_MANIFEST_SCHEMA, sources: built.sources },
  };
}

// A provider that states each board's round is filed by those rounds and is
// never time-gated: see buildStatedRoundManifestSources for why. Boards the
// store already holds complete are left out of the manifest, so an idle tour
// costs one list fetch per poll and a finished league costs nothing more.
async function discoverStatedRounds(
  context: PollContext,
  source: DiscoverySource,
  rounds: Awaited<ReturnType<typeof listXiangqiBroadcastRounds>>,
): Promise<
  | { ok: true; manifest: XiangqiBroadcastSourceManifest }
  | { ok: false; kind: XiangqiBroadcastPollErrorKind; message: string; quiet?: true }
> {
  const discovered = await source.provider.discover({
    config: source.config,
    fetchImpl: context.fetchImpl,
    timeoutMs: context.timeoutMs,
  });
  if (!discovered.ok) {
    return { ok: false, kind: 'source_fetch_error', message: discovered.message };
  }

  const completeUrls = new Set<string>();
  for (const round of rounds) {
    for (const board of await listXiangqiBroadcastBoards(round.id)) {
      // A complete board stored before game details existed is read once more
      // so its match, table and date arrive; after that it is final.
      if (board.status === 'complete' && board.sourceUrl && board.details) {
        completeUrls.add(board.sourceUrl);
      }
    }
  }

  const built = buildStatedRoundManifestSources({
    source,
    boards: discovered.boards,
    rounds: rounds.map((row) => ({ id: row.id, ...(row.name ? { name: row.name } : {}) })),
    completeUrls,
  });
  if (!built.ok) {
    return {
      ok: false,
      kind: 'source_malformed',
      message: built.message,
      ...(built.quiet ? { quiet: true as const } : {}),
    };
  }
  if (built.droppedForCap > 0 || built.roundsAdded.length > 0) {
    // The cap is not a loss (the rest come on the next poll, since the
    // imported ones drop out); a new round is worth a line because it has no
    // start time until someone seeds one.
    console.warn(
      `[xiangqi-broadcast] ${source.provider.name} kept ${built.sources.length} board(s), ` +
        `deferred ${built.droppedForCap} over the manifest cap, ` +
        `added round(s) ${built.roundsAdded.join(', ') || 'none'} the schedule had not seeded`,
    );
  }
  return {
    ok: true,
    manifest: { schema: XIANGQI_BROADCAST_MANIFEST_SCHEMA, sources: built.sources },
  };
}

async function resolveSourceBody(context: PollContext, sourceUrl: string): Promise<BodyResolution> {
  if (isXiangqiBroadcastDiscoveryUrl(sourceUrl)) {
    const discovered = await discoverManifest(context, sourceUrl);
    if (!discovered.ok) {
      if (!discovered.quiet) {
        await recordSourceError(context, {
          sourceUrl,
          kind: discovered.kind,
          message: discovered.message,
          payload: { discovery: true },
        });
      }
      return { ok: false, kind: discovered.kind, message: discovered.message };
    }
    return { ok: true, body: { kind: 'manifest', manifest: discovered.manifest } };
  }

  const decision = validateXiangqiBroadcastSourceUrl(sourceUrl, context.sourcePolicy);
  if (!decision.ok) {
    await recordSourceError(context, {
      sourceUrl,
      kind: 'source_disallowed',
      message: decision.message,
      payload: { reason: decision.reason },
    });
    return { ok: false, kind: 'source_disallowed', message: decision.message };
  }

  const fetched = await fetchSourceText({
    sourceUrl,
    timeoutMs: context.timeoutMs,
    fetchImpl: context.fetchImpl,
  });
  if (!fetched.ok) {
    await recordSourceError(context, {
      sourceUrl,
      kind: fetched.kind,
      message: fetched.message,
      payload: { timeoutMs: context.timeoutMs },
    });
    return { ok: false, kind: fetched.kind, message: fetched.message };
  }

  const body = interpretXiangqiBroadcastSourceBody(fetched.value);
  if (body.kind === 'malformed') {
    await recordSourceError(context, {
      sourceUrl,
      kind: 'source_malformed',
      message: body.message,
      payload: {
        bodySummary:
          body.parsedJson !== undefined
            ? sourcePayloadSummary(body.parsedJson)
            : { type: 'text', length: fetched.value.length },
      },
    });
    return { ok: false, kind: 'source_malformed', message: body.message };
  }
  return { ok: true, body };
}

async function pollSourceOutcomes(
  context: PollContext,
  sourceUrl: string,
): Promise<
  | { ok: true; outcomes: XiangqiBroadcastPollSourceOutcome[] }
  | { ok: false; kind: XiangqiBroadcastPollErrorKind; message: string }
> {
  const resolvedBody = await resolveSourceBody(context, sourceUrl);
  if (!resolvedBody.ok) {
    return { ok: false, kind: resolvedBody.kind, message: resolvedBody.message };
  }
  const body = resolvedBody.body;

  // Resolve every leaf source first, then apply. Dry runs wrap the whole
  // apply phase in one always-rollback transaction so the preview exercises
  // the exact production write path without committing any of it.
  const resolutions: Array<
    { sourceUrl: string } & (
      | { ok: true; unit: SourceUnit }
      | { ok: false; kind: XiangqiBroadcastPollErrorKind; message: string }
    )
  > = [];
  if (body.kind === 'manifest') {
    for (const [index, entry] of body.manifest.sources.entries()) {
      const { url, ...entryOptions } = entry;
      if (index > 0 && context.leafSpacingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, context.leafSpacingMs));
      }
      resolutions.push({
        sourceUrl: url,
        ...(await resolveLeafSource(context, url, entryOptions, { manifestUrl: sourceUrl })),
      });
    }
  } else if (body.kind === 'wxf-dhtmlxq') {
    const converted = await convertWxfSourceUnit(context, sourceUrl, body.html, {}, {});
    if (!converted.ok) return converted;
    resolutions.push({ sourceUrl, ...converted });
  } else {
    resolutions.push({ sourceUrl, ok: true, unit: { sourceUrl, snapshot: body.snapshot } });
  }

  // The tour's source is the URL the operator polls, not whatever a page or
  // payload claims. Without this a manifest poll would stamp the last page
  // URL onto the tour and the ops re-poll loop would only refresh that page.
  for (const resolution of resolutions) {
    if (!resolution.ok) continue;
    const tour = resolution.unit.snapshot.tour;
    if (isRecord(tour)) {
      resolution.unit.snapshot.tour = { ...tour, sourceUrl };
    }
  }

  const applyAll = async (client: pg.PoolClient | null) => {
    const outcomes: XiangqiBroadcastPollSourceOutcome[] = [];
    for (const resolution of resolutions) {
      outcomes.push(
        resolution.ok
          ? await applySourceUnit(context, resolution.unit, client)
          : {
              ok: false,
              sourceUrl: resolution.sourceUrl,
              kind: resolution.kind,
              message: resolution.message,
            },
      );
    }
    return outcomes;
  };

  const outcomes = context.dryRun
    ? await withRollbackTransaction((client) => applyAll(client))
    : await applyAll(null);
  return { ok: true, outcomes };
}

export async function pollXiangqiBroadcastSourceOnce(input: {
  sourceUrl: string;
  /** Tour the poll belongs to, stamped on every sync log it writes. */
  tourSlug?: string;
  allowCorrection?: boolean;
  dryRun?: boolean;
  timeoutMs?: number;
  fetchImpl?: XiangqiBroadcastSourceFetch;
  sourcePolicy?: XiangqiBroadcastSourceUrlPolicy;
  leafSpacingMs?: number;
}): Promise<XiangqiBroadcastPollResult> {
  const context: PollContext = {
    timeoutMs: input.timeoutMs ?? 5_000,
    allowCorrection: input.allowCorrection ?? false,
    dryRun: input.dryRun ?? false,
    fetchImpl: input.fetchImpl ?? defaultXiangqiBroadcastFetch,
    sourcePolicy: input.sourcePolicy ?? xiangqiBroadcastSourceUrlPolicyFromEnv(),
    ...(input.tourSlug ? { tourSlug: input.tourSlug } : {}),
    leafSpacingMs: input.leafSpacingMs ?? (input.fetchImpl ? 0 : LEAF_FETCH_SPACING_MS),
  };

  const polled = await pollSourceOutcomes(context, input.sourceUrl);
  if (!polled.ok) {
    return {
      ok: false,
      sourceUrl: input.sourceUrl,
      dryRun: context.dryRun,
      kind: polled.kind,
      message: polled.message,
    };
  }

  const succeeded = polled.outcomes.filter((outcome) => outcome.ok);
  const failed = polled.outcomes.filter((outcome) => !outcome.ok);
  if (succeeded.length === 0) {
    const firstFailure = failed[0];
    return {
      ok: false,
      sourceUrl: input.sourceUrl,
      dryRun: context.dryRun,
      kind: firstFailure?.kind ?? 'source_malformed',
      message:
        failed.length > 1
          ? `all ${failed.length} manifest sources failed: ${firstFailure?.message ?? 'unknown failure'}`
          : (firstFailure?.message ?? 'source produced no importable boards'),
    };
  }

  return {
    ok: true,
    sourceUrl: input.sourceUrl,
    dryRun: context.dryRun,
    tourSlug: succeeded[0]!.tourSlug,
    roundsImported: succeeded.reduce((sum, outcome) => sum + outcome.roundsImported, 0),
    boardsSeen: succeeded.reduce((sum, outcome) => sum + outcome.boardsSeen, 0),
    boardsFailed: succeeded.reduce((sum, outcome) => sum + outcome.boardsFailed, 0),
    sourcesSeen: polled.outcomes.length,
    sourcesFailed: failed.length,
    updates: succeeded.flatMap((outcome) => outcome.updates),
    sources: polled.outcomes,
  };
}

export async function pollXiangqiBroadcastSourceLoop(input: {
  sourceUrl: string;
  intervalMs: number;
  maxIntervalMs?: number;
  backoffMultiplier?: number;
  timeoutMs?: number;
  allowCorrection?: boolean;
  sourcePolicy?: XiangqiBroadcastSourceUrlPolicy;
  signal?: AbortSignal;
  wait?: (ms: number) => Promise<void>;
  onResult?: (result: XiangqiBroadcastPollResult) => void;
}): Promise<void> {
  const wait = input.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const schedule = xiangqiBroadcastPollSchedule({
    intervalMs: input.intervalMs,
    maxIntervalMs: input.maxIntervalMs,
    backoffMultiplier: input.backoffMultiplier,
  });
  let nextDelayMs = schedule.intervalMs;
  while (!input.signal?.aborted) {
    const result = await pollXiangqiBroadcastSourceOnce({
      sourceUrl: input.sourceUrl,
      timeoutMs: input.timeoutMs,
      allowCorrection: input.allowCorrection,
      sourcePolicy: input.sourcePolicy,
    });
    input.onResult?.(result);
    nextDelayMs = nextXiangqiBroadcastPollDelayMs({
      result,
      previousDelayMs: nextDelayMs,
      schedule,
    });
    if (input.signal?.aborted) break;
    await wait(nextDelayMs);
  }
}
