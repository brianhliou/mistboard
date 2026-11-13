import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createInitialXiangqiState,
  importXiangqiGame,
  parseXiangqiPgn,
  positionRepetitionKey,
  type XiangqiMove,
  type XiangqiMoveFormat,
  type XiangqiPgnGame,
} from '@mistboard/game';
import { createAuthRateLimiter } from '../auth-rate-limit.js';
import {
  findXiangqiBroadcastPushToken,
  touchXiangqiBroadcastPushToken,
} from '../persistence-xiangqi-broadcast-push.js';
import { getXiangqiBroadcastTour } from '../persistence-xiangqi-broadcasts.js';
import { requestBroadcastLiveEvalForBoard } from '../xiangqi-broadcast-live-eval.js';
import {
  applyBroadcastPushGame,
  broadcastPushRoundKey,
  broadcastPushStatus,
  type PushApplied,
  type PushFailure,
  type PushGame,
} from '../xiangqi-broadcast-push-store.js';
import { type HttpApiContext, writeJson } from './lib.js';

export type BroadcastPushDependencies = {
  findToken: typeof findXiangqiBroadcastPushToken;
  touchToken: typeof touchXiangqiBroadcastPushToken;
  getTour(slug: string): Promise<{
    slug: string;
    name: string;
    listed: boolean;
    sourceUrl?: string;
    pollMode: string;
  } | null>;
  apply: typeof applyBroadcastPushGame;
  status(slug: string): Promise<{ rounds: unknown[] }>;
  requestEval: typeof requestBroadcastLiveEvalForBoard;
  now(): number;
  origin(): string;
};
const formats = { iccs: 'uci-0indexed', wxf: 'wxf', chinese: 'chinese' } as const;
const failure = (error: string, message: string): PushFailure => ({ ok: false, error, message });
const codes: Record<string, number> = {
  invalid_body: 400,
  unauthorized: 401,
  token_revoked: 403,
  event_not_pushable: 409,
  too_large: 413,
  illegal_move: 422,
  unknown_notation: 422,
  unsupported_start_position: 422,
  rate_limited: 429,
  internal_error: 500,
};
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const positiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
const notationFor = (format: XiangqiMoveFormat | null) =>
  format === 'uci-0indexed' ? 'iccs' : format;

type Parsed = { game: PushGame; notation: string | null } | PushFailure;
function parseBody(value: unknown, at: number): Parsed {
  if (!isRecord(value)) return failure('invalid_body', 'body must be an object.');
  if (
    !positiveInt(value.round) &&
    !(typeof value.round === 'string' && value.round.trim().length > 0)
  )
    return failure('invalid_body', 'round must be a positive integer or existing round id.');
  if (!positiveInt(value.board))
    return failure('invalid_body', 'board must be a positive integer.');
  if (value.status !== 'live' && value.status !== 'finished')
    return failure('invalid_body', 'status must be live or finished.');
  const result = value.result === undefined ? '*' : value.result;
  if (
    typeof result !== 'string' ||
    !['*', '1-0', '0-1', '1/2-1/2'].includes(result) ||
    (value.status === 'finished' && result === '*')
  )
    return failure('invalid_body', 'result must be 1-0, 0-1 or 1/2-1/2 when finished.');
  if (value.status === 'live' && result !== '*')
    return failure('invalid_body', 'result must be * while status is live.');
  if (
    value.notation !== undefined &&
    !(typeof value.notation === 'string' && Object.hasOwn(formats, value.notation))
  )
    return failure('invalid_body', 'notation must be iccs, wxf or chinese.');
  if (value.seq !== undefined && (typeof value.seq !== 'number' || !Number.isFinite(value.seq)))
    return failure('invalid_body', 'seq must be a finite number.');
  if (value.timeControl !== undefined && typeof value.timeControl !== 'string')
    return failure('invalid_body', 'timeControl must be a string.');
  for (const seat of ['red', 'black']) {
    const p = value[seat];
    if (p === undefined) continue;
    if (!isRecord(p) || typeof p.name !== 'string' || !p.name.trim())
      return failure('invalid_body', `${seat}.name is required.`);
    if (p.title !== undefined && typeof p.title !== 'string')
      return failure('invalid_body', `${seat}.title must be a string.`);
    if (
      p.federation !== undefined &&
      (typeof p.federation !== 'string' || !/^[A-Z]{3}$/.test(p.federation))
    )
      return failure('invalid_body', `${seat}.federation must be a three-letter code.`);
  }
  let clock: PushGame['clock'];
  if (value.clock !== undefined) {
    const c = value.clock;
    if (
      !isRecord(c) ||
      ![c.red, c.black].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
    )
      return failure(
        'invalid_body',
        'clock.red and clock.black must be non-negative milliseconds.',
      );
    clock = { redMs: c.red as number, blackMs: c.black as number, at };
  }
  if (
    !(
      typeof value.moves === 'string' ||
      (Array.isArray(value.moves) && value.moves.every((m) => typeof m === 'string'))
    )
  )
    return failure('invalid_body', 'moves must be a string or an array of move strings.');
  const text = Array.isArray(value.moves) ? value.moves.join(' ') : value.moves;
  if ((Array.isArray(value.moves) ? value.moves.length : text.trim().split(/\s+/).length) > 1000)
    return failure('too_large', 'game exceeds 1,000 plies.');
  const format = formats[value.notation as keyof typeof formats];
  const imported = text.trim()
    ? importXiangqiGame(text, { format })
    : { moves: [], format: format ?? null };
  if (imported.failure)
    return {
      ...failure(imported.failure.code, 'moves could not be read.'),
      ...(imported.failure.code === 'illegal_move'
        ? { ply: imported.failure.ply, move: imported.failure.move }
        : {}),
    };
  if (
    imported.initialState &&
    positionRepetitionKey(imported.initialState) !==
      positionRepetitionKey(createInitialXiangqiState('push-start'))
  )
    return failure('unsupported_start_position', 'Moves must start from the standard opening.');
  if (imported.moves.length > 1000) return failure('too_large', 'game exceeds 1,000 plies.');
  const player = (seat: 'red' | 'black') => {
    const p = value[seat] as Record<string, string> | undefined;
    return p
      ? {
          name: p.name,
          ...(p.federation !== undefined ? { federation: p.federation } : {}),
          ...(p.title !== undefined ? { title: p.title } : {}),
        }
      : undefined;
  };
  return {
    notation: (value.notation as string | undefined) ?? notationFor(imported.format),
    game: {
      round: value.round as number | string,
      board: value.board,
      red: player('red'),
      black: player('black'),
      moves: imported.moves,
      status: value.status,
      result: result as PushGame['result'],
      seq: value.seq as number | undefined,
      clock,
      timeControl: value.timeControl as string | undefined,
    },
  };
}

function pgnBody(pgn: XiangqiPgnGame, at: number): Parsed {
  if (pgn.failure)
    return {
      ...failure(pgn.failure.code, 'PGN could not be read.'),
      ...(pgn.failure.code === 'illegal_move'
        ? { ply: pgn.failure.ply, move: pgn.failure.move }
        : {}),
    };
  if (pgn.error) return failure('unknown_notation', 'PGN could not be read.');
  if (pgn.plyCount > 1000) return failure('too_large', 'game exceeds 1,000 plies.');
  const tags = pgn.tags;
  if (tags.Result !== undefined && !['*', '1-0', '0-1', '1/2-1/2'].includes(tags.Result))
    return failure('invalid_body', 'Result must be *, 1-0, 0-1 or 1/2-1/2.');
  const compound = /^(\d+)\.(\d+)$/.exec(tags.Round ?? '');
  const rawRound = compound?.[1] ?? tags.Round;
  const round = rawRound && /^\d+$/.test(rawRound) ? Number(rawRound) : rawRound;
  // Validate metadata without re-importing a game in a potentially ambiguous
  // notation. The PGN reader already validated its complete mainline.
  const parsed = parseBody(
    {
      round,
      board: Number(tags.Board ?? compound?.[2]),
      red:
        tags.Red !== undefined || tags.White !== undefined
          ? { name: tags.Red ?? tags.White }
          : undefined,
      black: tags.Black ? { name: tags.Black } : undefined,
      moves: [],
      status: pgn.result === '*' ? 'live' : 'finished',
      result: pgn.result,
      timeControl: tags.TimeControl,
    },
    at,
  );
  if ('ok' in parsed) return parsed;
  const moves: XiangqiMove[] = [];
  let node = pgn.children[0];
  while (node) {
    moves.push(node.move);
    node = node.children[0];
  }
  return { game: { ...parsed.game, moves }, notation: notationFor(pgn.format) };
}

class BodyTooLarge extends Error {}
async function readBody(request: IncomingMessage): Promise<string> {
  if (Number(request.headers['content-length']) > 65_536) {
    request.resume();
    throw new BodyTooLarge();
  }
  let size = 0;
  const chunks: Buffer[] = [];
  // Do not destroy the socket on overflow: it still needs the 413 response.
  return await new Promise((resolve, reject) => {
    request.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 65_536) {
        chunks.length = 0;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(bytes);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => reject(new Error('body_read_failed')));
    request.on('aborted', () => reject(new Error('body_read_failed')));
  });
}

export function createBroadcastPushHandler(deps: BroadcastPushDependencies) {
  const tokenLimiter = createAuthRateLimiter(50, 1000);
  const boardLimiter = createAuthRateLimiter(2, 1000);
  return async (
    _ctx: HttpApiContext,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    _parsedUrl: URL,
  ): Promise<boolean> => {
    const statusRead = pathname === '/api/xiangqi/broadcast-push/status';
    if (pathname !== '/api/xiangqi/broadcast-push' && !statusRead) return false;
    const answerError = (err: PushFailure) =>
      writeJson(
        response,
        codes[err.error] ?? 500,
        err,
        err.error === 'rate_limited' ? { 'Retry-After': '1' } : {},
      );
    // Do not let a driver/parser exception reach the global API error logger,
    // which logs arbitrary error.message. Never log headers or raw bodies here.
    try {
      response.setHeader?.('Cache-Control', 'no-store');
      if (request.method !== (statusRead ? 'GET' : 'POST')) {
        answerError(
          failure('invalid_body', `Use ${statusRead ? 'GET' : 'POST'} for this endpoint.`),
        );
        return true;
      }
      const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
      const token = match ? await deps.findToken(match[1]!) : null;
      if (!token) {
        answerError(failure('unauthorized', 'The token is missing or unknown.'));
        return true;
      }
      if (token.revokedAt) {
        answerError(failure('token_revoked', 'The token was revoked.'));
        return true;
      }
      const tour = await deps.getTour(token.tourSlug);
      if (!tour) {
        answerError(failure('unauthorized', 'The token event no longer exists.'));
        return true;
      }
      if (statusRead) {
        writeJson(response, 200, {
          ok: true,
          event: { slug: tour.slug, name: tour.name },
          test: !tour.listed,
          ...(await deps.status(tour.slug)),
        });
        return true;
      }
      if (!tokenLimiter.check(token.id, deps.now())) {
        answerError(failure('rate_limited', 'Token rate limit exceeded.'));
        return true;
      }
      if (tour.sourceUrl && tour.pollMode !== 'off') {
        answerError(failure('event_not_pushable', 'The event is filled from another source.'));
        return true;
      }
      let text: string;
      try {
        text = await readBody(request);
      } catch (err) {
        answerError(
          err instanceof BodyTooLarge
            ? failure('too_large', 'body exceeds 64 KB.')
            : failure('invalid_body', 'body could not be read.'),
        );
        return true;
      }
      const contentType = (request.headers['content-type'] ?? '')
        .split(';')[0]!
        .trim()
        .toLowerCase();
      const multi = contentType === 'application/x-chess-pgn' || contentType === 'text/plain';
      let games: Parsed[];
      if (contentType === 'application/json') {
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          answerError(failure('invalid_body', 'body must be valid JSON.'));
          return true;
        }
        games = [parseBody(value, deps.now())];
      } else if (multi) {
        games = parseXiangqiPgn(text, { requireStandardStart: true, maxPlies: 1000 }).map((game) =>
          pgnBody(game, deps.now()),
        );
        if (!games.length) {
          answerError(failure('invalid_body', 'body must contain a PGN game.'));
          return true;
        }
      } else {
        answerError(
          failure(
            'invalid_body',
            'Content-Type must be application/json, application/x-chess-pgn or text/plain.',
          ),
        );
        return true;
      }
      const results: unknown[] = [];
      let limited = false;
      for (const parsed of games) {
        if ('ok' in parsed) {
          results.push(parsed);
          continue;
        }
        const { game, notation } = parsed;
        // Numeric rounds and their externally supplied stored id share one budget.
        const roundKey = broadcastPushRoundKey(tour.slug, game.round);
        if (!boardLimiter.check(JSON.stringify([token.id, roundKey, game.board]), deps.now())) {
          limited = true;
          results.push(failure('rate_limited', 'Board rate limit exceeded.'));
          continue;
        }
        try {
          const applied = await deps.apply(tour.slug, game);
          if (!applied.ok) {
            results.push(applied);
            continue;
          }
          const { board, ...flags } = applied;
          const result = {
            ...flags,
            game: {
              round: board.round,
              board: board.board,
              plies: board.plies,
              status: board.status,
              result: board.result,
              url: new URL(
                `/broadcast/xiangqi/board/${encodeURIComponent(board.id)}`,
                deps.origin(),
              ).href,
            },
            notation,
          };
          if (applied.changed) void deps.requestEval(board.id).catch(() => {});
          await deps.touchToken(token.id);
          results.push(result);
        } catch {
          results.push(
            failure('internal_error', 'The game could not be saved. Retry the latest game.'),
          );
        }
      }
      const onlyResult = results[0] as PushFailure | PushApplied;
      if (results.length === 1 && !onlyResult.ok) answerError(onlyResult);
      else if (multi)
        writeJson(
          response,
          200,
          { ok: true, games: results },
          limited ? { 'Retry-After': '1' } : {},
        );
      else {
        const result = results[0] as PushFailure | PushApplied;
        if (!result.ok) answerError(result);
        else writeJson(response, 200, result);
      }
    } catch {
      answerError(
        failure('internal_error', 'The request could not be completed. Retry the latest game.'),
      );
    }
    return true;
  };
}

export const tryHandle = createBroadcastPushHandler({
  findToken: findXiangqiBroadcastPushToken,
  touchToken: touchXiangqiBroadcastPushToken,
  getTour: getXiangqiBroadcastTour,
  apply: applyBroadcastPushGame,
  status: broadcastPushStatus,
  requestEval: requestBroadcastLiveEvalForBoard,
  now: Date.now,
  origin: () => process.env.MISTBOARD_HOST ?? 'https://mistboard.com',
});
