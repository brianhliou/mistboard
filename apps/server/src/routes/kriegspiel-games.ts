import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type Color,
  KRIEGSPIEL_SPEC_ID,
  type KriegspielGameState,
  type Square,
} from '@mistboard/game';
import { kriegspielEnabled } from './../feature-flags.js';

function opponentOf(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

import { kriegspielRooms } from './../kriegspiel-registration.js';
import type {
  KriegspielEvent,
  KriegspielProjection,
  KriegspielRuntimeRoom,
} from './../kriegspiel-runtime.js';
import {
  getKriegspielClientView,
  type KriegspielWireMove,
  type KriegspielWirePlayerView,
  kriegspielTenant,
} from './../kriegspiel-tenant.js';
import * as persistence from './../persistence.js';
import { buildTenantGameSummary } from './../variant-tenant/events.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './../variant-tenant/runtime.js';
import { type HttpApiContext, postgameGameSummary, requireMethod, writeJson } from './lib.js';

type KriegspielPostgameViewKey = Color | 'truth';

type KriegspielPostgameViews = Partial<Record<KriegspielPostgameViewKey, KriegspielWirePlayerView>>;
type KriegspielPostgameSnapshot = { ply: number; view: KriegspielWirePlayerView };
type KriegspielPostgameHistory = Partial<
  Record<KriegspielPostgameViewKey, KriegspielPostgameSnapshot[]>
>;

type KriegspielPostgameMove = {
  type: 'move-played';
  at: number;
  color: Color;
  move: KriegspielWireMove;
  ply: number;
};

type KriegspielPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: Color; winner: Color }
  | { type: 'seat-resigned'; at: number; color: Color; winner: Color }
  | { type: 'seat-forfeited'; at: number; color: Color; winner: Color }
  | { type: 'game-aborted'; at: number; reason: string };

// The persistence slice the reveal builder needs, injected so the reveal-gate
// and masking are unit-testable without a live database.
export type KriegspielPostgamePersistence = {
  getLiveRoom?(roomId: string): KriegspielRuntimeRoom | null;
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  isPersistenceEnabled?(): boolean;
  loadRoomEvents(roomId: string): Promise<KriegspielEvent[] | null>;
};

const livePersistence: KriegspielPostgamePersistence = {
  getLiveRoom: (roomId) => kriegspielRooms.get(roomId) ?? null,
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  isPersistenceEnabled: () => persistence.isInitialized(),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<KriegspielEvent>(roomId),
};

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  const postgameMatch = pathname.match(/^\/api\/kriegspiel\/games\/([^/]+)$/);
  if (!postgameMatch) return false;

  if (!requireMethod(request, response, 'GET')) return true;
  if (!kriegspielEnabled()) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }

  const roomId = decodeURIComponent(postgameMatch[1]!);
  const payload = await kriegspielPostgameForApi(roomId, livePersistence);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export async function kriegspielPostgameForApi(
  roomId: string,
  deps: KriegspielPostgamePersistence,
) {
  const persistenceEnabled = deps.isPersistenceEnabled?.() ?? true;
  const [game, events] = await Promise.all([
    persistenceEnabled ? deps.getGameSummary(roomId) : null,
    persistenceEnabled ? deps.loadRoomEvents(roomId) : null,
  ]);
  if (game && game.variant !== KRIEGSPIEL_SPEC_ID) return null;
  if (events && !isTenantEventLog(kriegspielTenant, events, roomId)) return null;

  let source: { game: persistence.RecentEveGameRecord; events: readonly KriegspielEvent[] } | null =
    game && events ? { game, events } : null;
  if (!source) {
    const room = deps.getLiveRoom?.(roomId) ?? null;
    await room?.pendingWrites.catch(() => undefined);
    source = kriegspielPostgameFromLiveRoom(roomId, room);
  }
  if (!source) return null;

  const projection = replayTenantEvents(kriegspielTenant, source.events);
  // The reveal gate: only a FINISHED game exposes the truth board and the
  // opponent's hidden history. A live or aborted-mid-play room returns 404.
  if (projection.state.status.type !== 'finished') return null;

  const latestMoveColor = latestKriegspielMoveColor(source.events);
  return {
    game: postgameGameSummary(source.game),
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      clock: projection.clock,
      timeControl: projection.timeControl,
    },
    timeline: kriegspielPostgameTimeline(source.events),
    view: kriegspielTruthView(projection.state),
    views: kriegspielPostgameViews(projection.state, latestMoveColor),
    history: kriegspielPostgameHistory(source.events),
  };
}

function kriegspielPostgameFromLiveRoom(
  roomId: string,
  room: KriegspielRuntimeRoom | null,
): { game: persistence.RecentEveGameRecord; events: readonly KriegspielEvent[] } | null {
  if (!room || room.id !== roomId) return null;
  if (room.projection.state.status.type !== 'finished') return null;
  if (!isTenantEventLog(kriegspielTenant, room.events, roomId)) return null;
  const summary = buildTenantGameSummary(kriegspielTenant, room);
  return {
    game: recentGameRecordFromSummary(room.id, summary),
    events: room.events,
  };
}

function recentGameRecordFromSummary(
  roomId: string,
  summary: persistence.GameSummary,
): persistence.RecentEveGameRecord {
  return {
    roomId,
    variant: summary.variant,
    mode: summary.mode ?? (summary.corpusId ? 'imported' : 'pvp'),
    result: summary.result,
    termination: summary.termination,
    plyCount: summary.plyCount,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    whiteName: summary.whiteName,
    blackName: summary.blackName,
    corpusId: summary.corpusId,
    rated: summary.rated ?? false,
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: summary.initialMs ?? null,
    incrementMs: summary.incrementMs ?? null,
    visibility: summary.visibility ?? 'public',
    participants: summary.participants ?? [],
  };
}

function kriegspielPostgameViews(
  state: KriegspielGameState,
  latestMoveColor?: Color,
): KriegspielPostgameViews {
  return {
    black: getKriegspielClientView(
      state,
      { id: 'postgame-black', seat: 'black', solo: false },
      latestMoveColor,
    ),
    truth: kriegspielTruthView(state),
    white: getKriegspielClientView(
      state,
      { id: 'postgame-white', seat: 'white', solo: false },
      latestMoveColor,
    ),
  };
}

function kriegspielPostgameHistory(events: readonly KriegspielEvent[]): KriegspielPostgameHistory {
  const created = events[0];
  if (created?.type !== 'room-created') return {};
  let projection = replayTenantEvents(kriegspielTenant, [created]);
  let ply = 0;
  let latestMoveColor: Color | undefined;
  const history = postgameHistoryViews(projection, ply, latestMoveColor);

  for (const event of events.slice(1)) {
    projection = applyTenantEvent(kriegspielTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    latestMoveColor = event.color;
    appendPostgameHistoryViews(history, projection, ply, latestMoveColor);
  }
  return history;
}

function postgameHistoryViews(
  projection: KriegspielProjection,
  ply: number,
  latestMoveColor?: Color,
): KriegspielPostgameHistory {
  const history: KriegspielPostgameHistory = {};
  appendPostgameHistoryViews(history, projection, ply, latestMoveColor);
  return history;
}

function appendPostgameHistoryViews(
  history: KriegspielPostgameHistory,
  projection: KriegspielProjection,
  ply: number,
  latestMoveColor?: Color,
): void {
  history.truth = [...(history.truth ?? []), { ply, view: kriegspielTruthView(projection.state) }];
  for (const color of ['black', 'white'] as const) {
    const view = getKriegspielClientView(
      projection.state,
      { id: `postgame-history-${color}-${ply}`, seat: color, solo: false },
      latestMoveColor,
    );
    history[color] = [...(history[color] ?? []), { ply, view }];
  }
}

function kriegspielPostgameTimeline(
  events: readonly KriegspielEvent[],
): Array<KriegspielPostgameMove | KriegspielPostgameTerminal> {
  const timeline: Array<KriegspielPostgameMove | KriegspielPostgameTerminal> = [];
  let ply = 0;
  for (const event of events) {
    if (event.type === 'move-played') {
      ply += 1;
      timeline.push({ type: event.type, at: event.at, color: event.color, move: event.move, ply });
      continue;
    }
    if (event.type === 'clock-expired') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: opponentOf(event.color),
      });
      continue;
    }
    if (event.type === 'seat-resigned' || event.type === 'seat-forfeited') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: opponentOf(event.color),
      });
      continue;
    }
    if (event.type === 'game-aborted') {
      timeline.push({ type: event.type, at: event.at, reason: event.reason });
    }
  }
  return timeline;
}

function latestKriegspielMoveColor(events: readonly KriegspielEvent[]): Color | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === 'move-played') return event.color;
  }
  return undefined;
}

// The truth board: every piece revealed, every square visible. Only ever built
// for a finished game (the reveal gate above). Kriegspiel has no reserves, so
// pawnTries is 0 (postgame has no side to move).
function kriegspielTruthView(state: KriegspielGameState): KriegspielWirePlayerView {
  return {
    id: state.id,
    perspective: 'white',
    board: { ...state.board },
    visibleSquares: allKriegspielSquares(),
    legalMoves: [],
    pawnTries: 0,
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}

function allKriegspielSquares(): Square[] {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const squares: Square[] = [];
  for (let rank = 1; rank <= 8; rank += 1) {
    for (const file of files) {
      squares.push(`${file}${rank}` as Square);
    }
  }
  return squares;
}
