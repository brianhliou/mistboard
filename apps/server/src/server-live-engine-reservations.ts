import type { EngineTurnRequest, EngineTurnResponse, GameProjection } from '@mistboard/game';
import { isKnownEngineClientId, loadEngine } from './engine-registry.js';
import {
  InternalEngineClientError,
  releaseInternalEngineReservation,
  requestInternalEngineReservation,
  requestInternalEngineTurn,
} from './internal-engine-client.js';
import { engineCounters, logger } from './obs.js';

export function canonicalLiveEngineVersionId(clientId: string): string {
  if (clientId === 'random-engine') return 'builtin-random-legal';
  return clientId;
}

export function pveEngineSeatForProjection(
  projection: GameProjection,
): { clientId: string; color: 'white' | 'black' } | null {
  const whiteClient = projection.seats.white;
  const blackClient = projection.seats.black;
  // Identify the engine seat by "is this an engine at all", not "is it currently
  // offered in the picker" — a hydrated/recovered game may use legacy or random,
  // which are no longer playable but are still valid engine seats to serve.
  const whiteIsEngine = isKnownEngineClientId(whiteClient);
  const blackIsEngine = isKnownEngineClientId(blackClient);
  if (whiteIsEngine && !blackIsEngine && whiteClient) {
    return { clientId: whiteClient, color: 'white' };
  }
  if (blackIsEngine && !whiteIsEngine && blackClient) {
    return { clientId: blackClient, color: 'black' };
  }
  return null;
}

export async function reserveLiveEngineSeat(
  engineId: string,
  color: 'white' | 'black',
): Promise<string | null> {
  if (loadEngine(engineId).config.kind !== 'python-subprocess') return null;
  const reservation = await requestInternalEngineReservation({ engineId, color });
  logger.info(
    {
      kind: 'live_engine_reservation_created',
      engine_id: engineId,
      color,
      reservation_id: reservation.reservationId,
      active_seats: reservation.capacity.activeSeats,
      max_seats: reservation.capacity.maxSeats,
      expires_at: reservation.expiresAt,
    },
    'live engine reservation created',
  );
  return reservation.reservationId;
}

export async function reserveHydratedLiveEngineSeat({
  color,
  engineId,
  roomId,
}: {
  color: 'white' | 'black';
  engineId: string;
  roomId: string;
}): Promise<string | null> {
  try {
    return await reserveLiveEngineSeat(engineId, color);
  } catch (err) {
    logger.warn(
      {
        kind: 'live_engine_reservation_hydrate_failed',
        room_id: roomId,
        engine_id: engineId,
        color,
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof InternalEngineClientError ? { engine_error_reason: err.reason } : {}),
      },
      'live engine reservation hydrate failed',
    );
    return null;
  }
}

export function releaseLiveEngineReservation(reservationId: string, reason: string): void {
  void releaseInternalEngineReservation(reservationId, reason).catch((err) => {
    engineCounters.recordReservationReleaseFailure();
    logger.warn(
      {
        kind: 'live_engine_reservation_release_failed',
        reservation_id: reservationId,
        reason,
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof InternalEngineClientError ? { engine_error_reason: err.reason } : {}),
      },
      'live engine reservation release failed',
    );
  });
}

/**
 * Anything that holds a live engine-service seat for one game: a dark-chess
 * `Room` or a tenant room (Dark Xiangqi). The renewal path writes a fresh id
 * back here, so the next turn presents a seat the worker knows.
 */
export type LiveEngineReservationHolder = {
  readonly id: string;
  engineReservationId: string | null;
};

export type LiveEngineTurnBudget = { computeBudgetMs: number; watchdogTimeoutMs: number };

export type LiveEngineTurnWithRenewalOptions = {
  holder: LiveEngineReservationHolder;
  /** The redacted turn. Sent byte-identical on every attempt, renewal included. */
  request: EngineTurnRequest;
  /** The first attempt's budget. Its watchdog fixes the turn's deadline. */
  budget: LiveEngineTurnBudget;
  /**
   * The budget a retry would be granted now, from the live clock. A retry gets
   * the smaller of this and what is left before the deadline. Omitted: the
   * first budget, cut to the time left.
   */
  rebudget?: () => LiveEngineTurnBudget;
  /**
   * False once the game no longer needs the seat (it ended while the renewal
   * was in flight): the fresh seat is released instead of written to a holder
   * nothing will release it from.
   */
  stillNeeded?: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** Backoff between transient-failure retries; the last step repeats. */
const LIVE_ENGINE_RETRY_BACKOFF_MS = [250, 500, 1_000, 2_000] as const;
/** Below this much time before the deadline, a retry cannot finish a move. */
const LIVE_ENGINE_RETRY_MIN_WINDOW_MS = 500;

/**
 * One live engine turn, surviving an engine-worker restart (#477).
 *
 * The worker keeps seat reservations in memory, so a redeploy or crash forgets
 * every seat: the next turn answers `409 invalid_engine_reservation`, and while
 * the new container comes up turns fail with a network error or a 502/503.
 * Every live turn is cold (the full redacted observation transcript rides in
 * the request), so a fresh worker can play the same bytes; only the seat needs
 * replacing.
 *
 * - 409 invalid_engine_reservation: reserve a fresh seat, write it to the
 *   holder, retry once. A second 409 for the same turn throws (no loop).
 * - network error / 502 / 503 / 504: back off and retry until the turn's
 *   watchdog deadline, re-deriving the compute budget each time.
 * - anything else (timeout, invalid response, 4xx, 429 on reserve): throws as
 *   before, so the caller forfeits exactly as it did.
 *
 * The request body is never rebuilt; only the reservation header changes.
 */
export async function requestLiveEngineTurnWithRenewal(
  options: LiveEngineTurnWithRenewalOptions,
): Promise<EngineTurnResponse> {
  const { holder, request } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = now();
  const deadline = startedAt + options.budget.watchdogTimeoutMs;
  const engineId = request.engineId;
  const color = request.color;

  let budget = options.budget;
  let renewed = false;
  let needsRenewal = false;
  let retries = 0;
  let lastError: InternalEngineClientError | null = null;

  for (;;) {
    if (retries > 0) {
      const remainingMs = deadline - now();
      if (remainingMs < LIVE_ENGINE_RETRY_MIN_WINDOW_MS) {
        throw retryExhaustedError(lastError, {
          holder,
          engineId,
          retries,
          elapsedMs: now() - startedAt,
        });
      }
      const fresh = options.rebudget ? options.rebudget() : options.budget;
      const watchdogTimeoutMs = Math.max(1, Math.min(fresh.watchdogTimeoutMs, remainingMs));
      budget = {
        watchdogTimeoutMs,
        computeBudgetMs: Math.max(1, Math.min(fresh.computeBudgetMs, watchdogTimeoutMs)),
      };
    }

    if (needsRenewal) {
      try {
        await renewLiveEngineReservation(holder, engineId, color, lastError, options.stillNeeded);
        needsRenewal = false;
      } catch (err) {
        if (!isTransientEngineError(err)) throw err;
        lastError = err;
        await backoff(err, 'reserve');
        continue;
      }
    }

    try {
      return await requestInternalEngineTurn(
        request,
        budget.watchdogTimeoutMs,
        holder.engineReservationId ?? undefined,
        { computeBudgetMs: budget.computeBudgetMs },
      );
    } catch (err) {
      if (isInvalidReservationError(err)) {
        if (renewed) {
          throw new InternalEngineClientError(
            'http_error',
            `engine reservation rejected again after renewal (${invalidReservationReason(err) ?? 'no reason'}); not retrying`,
            {
              status: err.status,
              diagnostics: { ...(err.diagnostics ?? {}), renewal: 'rejected_after_renewal' },
            },
          );
        }
        renewed = true;
        needsRenewal = true;
        lastError = err;
        retries += 1;
        continue;
      }
      if (!isTransientEngineError(err)) throw err;
      lastError = err;
      await backoff(err, 'turn');
    }
  }

  async function backoff(err: InternalEngineClientError, step: 'reserve' | 'turn'): Promise<void> {
    const waitMs =
      LIVE_ENGINE_RETRY_BACKOFF_MS[Math.min(retries, LIVE_ENGINE_RETRY_BACKOFF_MS.length - 1)]!;
    retries += 1;
    logger.warn(
      {
        kind: 'live_engine_turn_retry',
        room_id: holder.id,
        engine_id: engineId,
        color,
        step,
        attempt: retries,
        reason: err.reason,
        status: err.status ?? null,
        wait_ms: waitMs,
        remaining_ms: deadline - now(),
        error: err.message,
      },
      'live engine turn retry',
    );
    // Never sleep past the deadline: the check at the top of the loop ends it.
    await sleep(Math.max(0, Math.min(waitMs, deadline - now())));
  }
}

async function renewLiveEngineReservation(
  holder: LiveEngineReservationHolder,
  engineId: string,
  color: 'white' | 'black',
  rejection: InternalEngineClientError | null,
  stillNeeded: (() => boolean) | undefined,
): Promise<void> {
  const oldId = holder.engineReservationId;
  const workerReason = rejection ? invalidReservationReason(rejection) : null;
  if (workerReason === 'mismatch') {
    // The worker knows the seat but under another engine or colour: the room's
    // engine identity drifted from what it reserved. Renewal fixes the seat;
    // this line is the page for the drift itself.
    logger.error(
      {
        kind: 'live_engine_reservation_mismatch',
        room_id: holder.id,
        engine_id: engineId,
        color,
        reservation_id: oldId,
        worker_detail: invalidReservationDetail(rejection),
      },
      'live engine reservation engine/colour mismatch',
    );
  }
  const reservation = await requestInternalEngineReservation({ engineId, color });
  if (stillNeeded && !stillNeeded()) {
    releaseLiveEngineReservation(reservation.reservationId, 'renewed_after_game_end');
    throw new InternalEngineClientError(
      'http_error',
      'engine reservation renewed after the game stopped needing it; released',
    );
  }
  holder.engineReservationId = reservation.reservationId;
  logger.warn(
    {
      kind: 'live_engine_reservation_renewed',
      room_id: holder.id,
      engine_id: engineId,
      color,
      old_reservation_id: oldId,
      new_reservation_id: reservation.reservationId,
      worker_reason: workerReason,
      active_seats: reservation.capacity.activeSeats,
      max_seats: reservation.capacity.maxSeats,
    },
    'live engine reservation renewed',
  );
  // A restarted worker never heard of the old id (release is a no-op there);
  // after a mismatch the old seat is still held and this frees it.
  if (oldId) releaseLiveEngineReservation(oldId, 'renewed');
}

function isInvalidReservationError(err: unknown): err is InternalEngineClientError {
  return (
    err instanceof InternalEngineClientError &&
    err.reason === 'http_error' &&
    err.status === 409 &&
    workerErrorBody(err)?.error === 'invalid_engine_reservation'
  );
}

function isTransientEngineError(err: unknown): err is InternalEngineClientError {
  if (!(err instanceof InternalEngineClientError)) return false;
  if (err.reason === 'network_error') return true;
  return (
    err.reason === 'http_error' && (err.status === 502 || err.status === 503 || err.status === 504)
  );
}

function workerErrorBody(err: InternalEngineClientError): Record<string, unknown> | null {
  const tail = err.diagnostics?.bodyTail;
  if (typeof tail !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(tail);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function invalidReservationReason(err: InternalEngineClientError): string | null {
  const reason = workerErrorBody(err)?.reason;
  return typeof reason === 'string' ? reason : null;
}

function invalidReservationDetail(err: InternalEngineClientError | null): unknown {
  return err ? (workerErrorBody(err)?.reservation ?? null) : null;
}

function retryExhaustedError(
  lastError: InternalEngineClientError | null,
  context: {
    holder: LiveEngineReservationHolder;
    engineId: string;
    retries: number;
    elapsedMs: number;
  },
): InternalEngineClientError {
  logger.error(
    {
      kind: 'live_engine_turn_retry_exhausted',
      room_id: context.holder.id,
      engine_id: context.engineId,
      retries: context.retries,
      elapsed_ms: context.elapsedMs,
      reason: lastError?.reason ?? null,
      status: lastError?.status ?? null,
      error: lastError?.message ?? null,
    },
    'live engine turn retries exhausted at the turn deadline',
  );
  return new InternalEngineClientError(
    lastError?.reason ?? 'network_error',
    `engine unreachable until the turn deadline (${context.retries} retries over ${context.elapsedMs}ms): ${lastError?.message ?? 'no response'}`,
    {
      ...(lastError?.status !== undefined ? { status: lastError.status } : {}),
      diagnostics: {
        ...(lastError?.diagnostics ?? {}),
        retries: context.retries,
        elapsedMs: context.elapsedMs,
      },
    },
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
