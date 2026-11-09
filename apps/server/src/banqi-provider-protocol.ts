import {
  applyBanqiMove,
  type BanqiGameState,
  type BanqiMove,
  banqiInkForSeat,
  banqiMoveToEngineUci,
  banqiNoProgressLimitOf,
  banqiSquareToEngineUci,
  banqiStateToEngineFen,
  engineUciToBanqiMove,
  getBanqiLegalMoves,
  parseBanqiFen,
} from '@mistboard/game';

export const BANQI_PROVIDER_PROTOCOL = 'mistboard-banqi/1' as const;
export const BANQI_PROVIDER_MAX_BYTES = 64 * 1024;
export const BANQI_PROVIDER_MAX_BUDGET_MS = 30_000;
const MOVE = /^[a-h][0-3][a-h][0-3]$/;
const SQUARE = /^[a-h][0-3]$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/;
const REPETITION_KEY = /^[.xGAERHCSgaerhcs]{32}\|[01]\|(?:red|black|\?)$/;

export type BanqiProviderRequest = {
  protocol: typeof BANQI_PROVIDER_PROTOCOL;
  requestId: string;
  gameId: string;
  engineId: string;
  ply: number;
  seat: 'first' | 'second';
  ink: 'red' | 'black' | null;
  position: { fen: string; lastMove: string | null; chasedSquare: string | null };
  rules: { noProgressPlies: 40 | 60; chase: 'repetition' | null; repetitionCount: 3 };
  repetition: { fen: string; moves: string[]; positions: Record<string, number> };
  legalMoves: string[];
  clock: { remainingMs: number | null; incrementMs: number };
  limits: { requestedAtUnixMs: number; deadlineUnixMs: number; nodes: number | null };
};

export type BanqiProviderAnalysis = {
  score:
    | { type: 'cp' | 'mate' | 'win-probability'; value: number; pov: 'side-to-move' }
    | { type: 'wdl'; win: number; draw: number; loss: number; pov: 'side-to-move' };
  depth?: number;
  nodes?: number;
  pv?: string[];
};

export type BanqiProviderResponse = {
  protocol: typeof BANQI_PROVIDER_PROTOCOL;
  requestId: string;
  gameId: string;
  ply: number;
  move: string;
  analysis?: BanqiProviderAnalysis;
};

export type BanqiProviderErrorCode =
  | 'invalid-request'
  | 'invalid-response'
  | 'mismatched-response'
  | 'illegal-move'
  | 'deadline'
  | 'cancelled'
  | 'transport'
  | 'oversized';

/** Provider failures never include an endpoint, header, child stderr or response body. */
export class BanqiProviderError extends Error {
  constructor(readonly code: BanqiProviderErrorCode) {
    super(`Banqi provider: ${code}`);
    this.name = 'BanqiProviderError';
  }
}

function requireValue(
  condition: unknown,
  code: BanqiProviderErrorCode = 'invalid-request',
): asserts condition {
  if (!condition) throw new BanqiProviderError(code);
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  const result = value as Record<string, unknown>;
  requireValue(Object.keys(result).every((key) => keys.includes(key)));
  return result;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function publicFen(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 256 || value.trim().split(/\s+/).length !== 5)
    return false;
  const parsed = parseBanqiFen(value, { rng: () => 0 });
  return parsed.ok && banqiStateToEngineFen(parsed.state) === value;
}

/** Reconstruct only an arbitrary public completion. Its sampled covered roles
 * never escape; all legality depends on the same masked position and pool. */
export function providerRequestState(request: BanqiProviderRequest): BanqiGameState {
  const parsed = parseBanqiFen(request.position.fen, { gameId: request.gameId, rng: () => 0 });
  requireValue(parsed.ok);
  const seat = request.seat === 'first' ? 'red' : 'black';
  const state: BanqiGameState = {
    ...parsed.state,
    ply: request.ply,
    status: { type: 'playing', turn: seat },
    firstColor:
      request.ink === null
        ? null
        : seat === 'red'
          ? request.ink
          : request.ink === 'red'
            ? 'black'
            : 'red',
    noProgressLimit: request.rules.noProgressPlies,
    chaseRule: request.rules.chase,
    repCounts: { ...request.repetition.positions },
  };
  if (request.position.lastMove) state.lastMove = engineUciToBanqiMove(request.position.lastMove)!;
  if (request.position.chasedSquare)
    state.chasedSquare = engineUciToBanqiMove(request.position.chasedSquare.repeat(2))!.from;
  return state;
}

/** Strict structural and kernel validation also makes every UCI command token safe. */
export function parseBanqiProviderRequest(value: unknown): BanqiProviderRequest {
  const r = record(value, [
    'protocol',
    'requestId',
    'gameId',
    'engineId',
    'ply',
    'seat',
    'ink',
    'position',
    'rules',
    'repetition',
    'legalMoves',
    'clock',
    'limits',
  ]);
  requireValue(r.protocol === BANQI_PROVIDER_PROTOCOL);
  for (const key of ['requestId', 'gameId', 'engineId'])
    requireValue(typeof r[key] === 'string' && ID.test(r[key] as string));
  requireValue(integer(r.ply, 0, 1_000_000));
  requireValue(r.seat === (r.ply % 2 === 0 ? 'first' : 'second'));
  requireValue(r.ink === 'red' || r.ink === 'black' || (r.ink === null && r.ply === 0));
  const position = record(r.position, ['fen', 'lastMove', 'chasedSquare']);
  requireValue(publicFen(position.fen));
  requireValue(
    position.lastMove === null ||
      (typeof position.lastMove === 'string' && MOVE.test(position.lastMove)),
  );
  requireValue(
    position.chasedSquare === null ||
      (typeof position.chasedSquare === 'string' && SQUARE.test(position.chasedSquare)),
  );
  const rules = record(r.rules, ['noProgressPlies', 'chase', 'repetitionCount']);
  requireValue(
    (rules.noProgressPlies === 40 || rules.noProgressPlies === 60) &&
      (rules.chase === null || rules.chase === 'repetition') &&
      rules.repetitionCount === 3,
  );
  const repetition = record(r.repetition, ['fen', 'moves', 'positions']);
  requireValue(publicFen(repetition.fen));
  requireValue(
    Array.isArray(repetition.moves) &&
      repetition.moves.length <= 60 &&
      repetition.moves.every(
        (move) => typeof move === 'string' && MOVE.test(move) && move.slice(0, 2) !== move.slice(2),
      ),
  );
  const positions = record(
    repetition.positions,
    Object.keys((repetition.positions ?? {}) as object),
  );
  requireValue(
    Object.keys(positions).length <= 128 &&
      Object.entries(positions).every(
        ([key, count]) => REPETITION_KEY.test(key) && integer(count, 1, 61),
      ),
  );
  requireValue(
    Array.isArray(r.legalMoves) &&
      r.legalMoves.length > 0 &&
      r.legalMoves.length <= 128 &&
      r.legalMoves.every((move) => typeof move === 'string' && MOVE.test(move)) &&
      new Set(r.legalMoves).size === r.legalMoves.length,
  );
  const clock = record(r.clock, ['remainingMs', 'incrementMs']);
  requireValue(
    (clock.remainingMs === null || integer(clock.remainingMs, 1)) && integer(clock.incrementMs),
  );
  const limits = record(r.limits, ['requestedAtUnixMs', 'deadlineUnixMs', 'nodes']);
  requireValue(
    integer(limits.requestedAtUnixMs) &&
      integer(limits.deadlineUnixMs) &&
      limits.deadlineUnixMs > limits.requestedAtUnixMs &&
      limits.deadlineUnixMs - limits.requestedAtUnixMs <= BANQI_PROVIDER_MAX_BUDGET_MS &&
      (limits.nodes === null || integer(limits.nodes, 1, 1_000_000_000)),
  );
  const request = value as BanqiProviderRequest;
  const state = providerRequestState(request);
  requireValue(
    banqiStateToEngineFen(state) === request.position.fen &&
      state.moveNumber === Math.floor(request.ply / 2) + 1 &&
      state.noProgressClock < request.rules.noProgressPlies,
  );
  const window = parseBanqiFen(request.repetition.fen, { gameId: request.gameId, rng: () => 0 });
  requireValue(window.ok && request.ply >= request.repetition.moves.length);
  const basePly = request.ply - request.repetition.moves.length;
  let replay: BanqiGameState = {
    ...window.state,
    ply: basePly,
    status: { type: 'playing', turn: basePly % 2 === 0 ? 'red' : 'black' },
    chaseRule: null,
    noProgressLimit: request.rules.noProgressPlies,
  };
  if (basePly % 2 === 1 && replay.firstColor)
    replay.firstColor = replay.firstColor === 'red' ? 'black' : 'red';
  for (const uci of request.repetition.moves) {
    const move = engineUciToBanqiMove(uci)!;
    requireValue(!replay.board[move.to]);
    const next = applyBanqiMove(replay, move, {
      noProgressClockLimit: Number.POSITIVE_INFINITY,
      repetitionDrawCount: Number.MAX_SAFE_INTEGER,
    });
    requireValue(next.ply === replay.ply + 1);
    replay = next;
  }
  requireValue(banqiStateToEngineFen(replay) === request.position.fen);
  const legal = getBanqiLegalMoves(state).map(banqiMoveToEngineUci);
  requireValue(
    legal.length === request.legalMoves.length &&
      legal.every((move) => request.legalMoves.includes(move)),
  );
  return request;
}

export function buildBanqiProviderRequest(input: {
  state: BanqiGameState;
  requestId: string;
  engineId: string;
  nowMs: number;
  budgetMs: number;
  remainingMs: number | null;
  incrementMs: number;
  nodes?: number;
  repetitionWindow?: { fen: string; moves: readonly string[] };
}): BanqiProviderRequest {
  const { state } = input;
  requireValue(state.status.type === 'playing');
  const fen = banqiStateToEngineFen(state);
  const seat = state.status.turn;
  const request: BanqiProviderRequest = {
    protocol: BANQI_PROVIDER_PROTOCOL,
    requestId: input.requestId,
    gameId: state.id,
    engineId: input.engineId,
    ply: state.ply,
    seat: seat === 'red' ? 'first' : 'second',
    ink: banqiInkForSeat(state, seat),
    position: {
      fen,
      lastMove: state.lastMove ? banqiMoveToEngineUci(state.lastMove) : null,
      chasedSquare: state.chasedSquare ? banqiSquareToEngineUci(state.chasedSquare) : null,
    },
    rules: {
      noProgressPlies: banqiNoProgressLimitOf(state) as 40 | 60,
      chase: state.chaseRule === undefined ? 'repetition' : state.chaseRule,
      repetitionCount: 3,
    },
    repetition: {
      fen: input.repetitionWindow?.fen ?? fen,
      moves: [...(input.repetitionWindow?.moves ?? [])],
      positions: Object.fromEntries(
        Object.entries(state.repCounts).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    legalMoves: getBanqiLegalMoves(state).map(banqiMoveToEngineUci),
    clock: { remainingMs: input.remainingMs, incrementMs: input.incrementMs },
    limits: {
      requestedAtUnixMs: input.nowMs,
      deadlineUnixMs: input.nowMs + Math.min(input.budgetMs, BANQI_PROVIDER_MAX_BUDGET_MS),
      nodes: input.nodes ?? null,
    },
  };
  return snapshotBanqiProviderRequest(request);
}

/** The exact snapshot used for dispatch is also used for reply validation. */
export function snapshotBanqiProviderRequest(input: BanqiProviderRequest): BanqiProviderRequest {
  const json = JSON.stringify(input);
  if (Buffer.byteLength(json) > BANQI_PROVIDER_MAX_BYTES) throw new BanqiProviderError('oversized');
  const request = parseBanqiProviderRequest(JSON.parse(json));
  const freeze = (value: object): void => {
    for (const child of Object.values(value))
      if (child !== null && typeof child === 'object') freeze(child);
    Object.freeze(value);
  };
  freeze(request);
  return request;
}

export function parseBanqiProviderResponse(
  value: unknown,
  request: BanqiProviderRequest,
): BanqiProviderResponse {
  try {
    const r = record(value, ['protocol', 'requestId', 'gameId', 'ply', 'move', 'analysis']);
    requireValue(
      r.protocol === BANQI_PROVIDER_PROTOCOL &&
        r.requestId === request.requestId &&
        r.gameId === request.gameId &&
        r.ply === request.ply,
      'mismatched-response',
    );
    requireValue(typeof r.move === 'string' && request.legalMoves.includes(r.move), 'illegal-move');
    if (r.analysis !== undefined) {
      const analysis = record(r.analysis, ['score', 'depth', 'nodes', 'pv']);
      const score = record(analysis.score, ['type', 'value', 'win', 'draw', 'loss', 'pov']);
      requireValue(score.pov === 'side-to-move');
      if (score.type === 'wdl') {
        record(score, ['type', 'win', 'draw', 'loss', 'pov']);
        requireValue(
          [score.win, score.draw, score.loss].every(
            (value) =>
              typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
          ),
        );
        requireValue(
          Math.abs((score.win as number) + (score.draw as number) + (score.loss as number) - 1) <=
            0.000001,
        );
      } else {
        record(score, ['type', 'value', 'pov']);
        requireValue(typeof score.value === 'number' && Number.isFinite(score.value));
        requireValue(
          score.type === 'win-probability'
            ? score.value >= 0 && score.value <= 1
            : (score.type === 'cp' || score.type === 'mate') && Math.abs(score.value) <= 10_000_000,
        );
      }
      requireValue(analysis.depth === undefined || integer(analysis.depth, 0, 1_000_000));
      requireValue(analysis.nodes === undefined || integer(analysis.nodes));
      requireValue(
        analysis.pv === undefined ||
          (Array.isArray(analysis.pv) &&
            analysis.pv.length <= 128 &&
            analysis.pv.every((move) => typeof move === 'string' && MOVE.test(move))),
      );
    }
    return value as BanqiProviderResponse;
  } catch (error) {
    if (error instanceof BanqiProviderError && error.code !== 'invalid-request') throw error;
    throw new BanqiProviderError('invalid-response');
  }
}

export function providerResponse(
  request: BanqiProviderRequest,
  move: string,
  analysis?: BanqiProviderAnalysis,
): BanqiProviderResponse {
  return parseBanqiProviderResponse(
    {
      protocol: BANQI_PROVIDER_PROTOCOL,
      requestId: request.requestId,
      gameId: request.gameId,
      ply: request.ply,
      move,
      ...(analysis ? { analysis } : {}),
    },
    request,
  );
}

export function providerMove(
  request: BanqiProviderRequest,
  response: BanqiProviderResponse,
): BanqiMove {
  parseBanqiProviderResponse(response, request);
  return engineUciToBanqiMove(response.move)!;
}
