// Shared runner for the variant PvE smokes (Fortress / DXQ).
//
// The flow is identical for every variant: create a PvE room as the black
// human (which puts the engine on red), connect over WebSocket, wait for the
// engine's opening move, then clean up with a pregame abort. Before this
// runner the three smokes were ~90% identical clones and drifted (the DXQ
// engine-id fix in bfb02b95 touched one clone only); a variant is now one
// config entry in variant-smoke-configs.mjs.
//
// Output contract (consumed by release-prod.mjs): exactly one JSON line on
// stdout on success, either the full result or the `skipped` shape when the
// variant's feature flag is off; failures throw and exit nonzero.

import WebSocket from 'ws';

import { resolveBaseUrl } from './base-url.mjs';
import { fetchWithTimeout, parseJsonResponse } from './http.mjs';
import { parseSmokeArgs } from './smoke-args.mjs';
import { reportResult } from './smoke-report.mjs';
import { matchesEngineSeat } from './variant-smoke-configs.mjs';

export async function runVariantSmoke(config, argv = process.argv.slice(2)) {
  const options = parseSmokeArgs(argv, argSpec(config));
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? config.defaultTimeoutMs;

  const created = await createRoom(config, baseUrl, timeoutMs);
  if (created.skipped) {
    reportResult({ ok: true, skipped: true, reason: created.reason, baseUrl: baseUrl.href });
    return;
  }
  reportResult(await smokeRoom(config, baseUrl, created, timeoutMs));
}

function argSpec(config) {
  return {
    usage: config.usage,
    flags: {
      '--base': {
        key: 'baseUrl',
        placeholder: '<url>',
        help: 'Base URL to smoke, default https://mistboard.com',
      },
      '--timeout-ms': {
        key: 'timeoutMs',
        placeholder: '<ms>',
        kind: 'positive-int',
        help: `Timeout per network step, default ${config.defaultTimeoutMs}`,
      },
    },
  };
}

async function createRoom(config, baseUrl, timeoutMs) {
  const response = await fetchWithTimeout(new URL('/api/rooms', baseUrl), timeoutMs, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameSpecId: config.gameSpecId,
      mode: 'pve',
      // Human black makes the engine red, so the smoke proves the opening
      // engine move and can still clean up with a pregame abort.
      preferredColor: 'black',
      // No pace named on purpose. The smoke cares that the engine moves, not
      // about the clock, and the server owns which pace an engine may play:
      // pinned variants resolve to their pin (the fog engines cannot honor the
      // house 3+2, #283) and the rest take the room factory default. Naming a
      // pace here is what red-ed this smoke the moment the first pin landed.
    }),
  });
  const body = await parseJsonResponse(response);
  // The variant is feature-flagged per environment. When the flag is off, the
  // request gate answers 404 `<spec>_disabled` — a clean, deterministic signal,
  // not a deploy regression. Skip (exit 0) so the release smoke doesn't red on a
  // deliberately-disabled variant; the check turns real the moment the flag flips.
  if (response.status === 404 && /_disabled$/.test(body?.error ?? '')) {
    return { skipped: true, reason: body.error };
  }
  if (response.status !== 201 || typeof body?.roomId !== 'string') {
    throw new Error(`room creation failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

// Pure per-message decision logic, exported for tests. Given the config, the
// current context ({ roomId, sentAbort }) and one parsed socket message,
// returns the ordered effects the socket loop must apply:
//   { kind: 'failure', message }            fail the smoke
//   { kind: 'seat-token', seatToken }       remember the hello seat token
//   { kind: 'abort', engineReplyState }     engine moved: record + send abort
//   { kind: 'success', finalStatus }        abort confirmed: finish ok
export function evaluateSmokeMessage(config, context, message) {
  const effects = [];

  if (message.type === 'hello') {
    if (message.seat !== 'black') {
      return [
        { kind: 'failure', message: `expected black seat, got ${message.seat ?? 'missing'}` },
      ];
    }
    if (typeof message.seatToken === 'string') {
      effects.push({ kind: 'seat-token', seatToken: message.seatToken });
    }
  }

  const state = message.state;
  if (!state) return effects;

  if (
    !context.sentAbort &&
    state.status?.type === 'playing' &&
    state.status.turn === 'black' &&
    state.moveNumber === 1 &&
    matchesEngineSeat(config.engineSeat, message.seats?.red)
  ) {
    effects.push({
      kind: 'abort',
      engineReplyState: {
        moveNumber: state.moveNumber,
        turn: state.status.turn,
        lastMove: state.lastMove ?? null,
      },
    });
    return effects;
  }

  if (context.sentAbort && state.status?.type === 'aborted') {
    effects.push({ kind: 'success', finalStatus: state.status });
  }

  if (state.status?.type === 'finished') {
    effects.push({
      kind: 'failure',
      message: `${config.label} game ${context.roomId} finished before smoke completed: ${JSON.stringify(
        state.status,
      )}`,
    });
  }

  return effects;
}

async function smokeRoom(config, baseUrl, created, timeoutMs) {
  const startedAt = Date.now();
  const wsUrl = new URL(baseUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  wsUrl.searchParams.set('room', created.roomId);
  wsUrl.searchParams.set('client', `prod-${config.name}-smoke-${Date.now()}`);

  const socket = new WebSocket(wsUrl, {
    headers: { origin: baseUrl.origin },
  });

  const context = { roomId: created.roomId, sentAbort: false };
  let capturedSeatToken = null;
  let engineReplyState = null;
  let settled = false;

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      fail(new Error(`timed out waiting for ${config.label} engine opening move`));
    }, timeoutMs);

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    }

    function fail(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(err);
    }

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (err) {
        fail(err);
        return;
      }

      for (const effect of evaluateSmokeMessage(config, context, message)) {
        if (effect.kind === 'failure') {
          fail(new Error(effect.message));
          return;
        }
        if (effect.kind === 'seat-token') {
          capturedSeatToken = effect.seatToken;
        } else if (effect.kind === 'abort') {
          engineReplyState = effect.engineReplyState;
          context.sentAbort = true;
          socket.send(JSON.stringify({ type: 'abort' }));
        } else if (effect.kind === 'success') {
          finish({
            ok: true,
            baseUrl: baseUrl.href,
            roomId: created.roomId,
            mode: created.mode,
            gameSpecId: created.gameSpecId,
            elapsedMs: Date.now() - startedAt,
            seat: 'black',
            hadSeatToken: typeof capturedSeatToken === 'string',
            engineReplyState,
            finalStatus: effect.finalStatus,
          });
        }
      }
    });

    socket.on('error', fail);
    socket.on('close', (code, reason) => {
      if (!settled) {
        fail(
          new Error(
            `socket closed before ${config.label} smoke finished: ${code} ${reason.toString()}`,
          ),
        );
      }
    });
  });
}
