import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
  type XmjPlayerView,
  type XmjSeat,
  xmjReviewViewFor,
} from '@mistboard/game';
import { xiangqiMahjongEnabled } from './../feature-flags.js';
import * as persistence from './../persistence.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './../variant-tenant/runtime.js';
import { type XmjEvent, xiangqiMahjongTenant } from './../xiangqi-mahjong-tenant.js';
import {
  type HttpApiContext,
  postgameGameSummary,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

// Xiangqi Mahjong postgame review: a finished match, every hand, move by move,
// with every tile face up (both concealed hands and each tile as it is drawn).
//
// HIDDEN INFORMATION. The review views hold exactly what the live table keeps
// from the other seat and from spectators, so this route answers ONLY for a
// match whose event log replays to 'finished' (roomViewPolicy: a finished room
// reveals everything). A live match, including the pause between two hands of
// a six-hand match, and an aborted one get the same 404 as a room that does not
// exist, so the route cannot even confirm a live match is there. The walls (the
// server-secret setup in room-created) never go out: each wall is a count, and
// the timeline carries only moves and endings. Regression:
// routes/xiangqi-mahjong-games.test.ts.
//
// No analysis tier: there is no engine review for this game, and no discard
// advice. Pure replay.

/** Each seat's clock after a ply: time left as recorded at that moment (the
 *  increment credited, nothing projected) and the seat then on the clock. Clocks
 *  are public, so a snapshot's clock reveals nothing the live table hid. */
export type XmjPostgameClock = { remainingMs: Record<XmjSeat, number>; active: XmjSeat | null };

export type XmjPostgameSnapshot = { ply: number; view: XmjPlayerView; clock?: XmjPostgameClock };

type XmjPostgameMove = {
  type: 'move-played';
  at: number;
  color: XmjSeat;
  move: XmjMove;
  ply: number;
};

type XmjPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: XmjSeat }
  | { type: 'seat-resigned'; at: number; color: XmjSeat }
  | { type: 'seat-forfeited'; at: number; color: XmjSeat };

export type XmjPostgamePersistence = {
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  loadRoomEvents(roomId: string): Promise<XmjEvent[] | null>;
};

const defaultPersistence: XmjPostgamePersistence = {
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<XmjEvent>(roomId),
};

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  const postgameMatch = pathname.match(/^\/api\/xiangqi-mahjong\/games\/([^/]+)$/);
  if (!postgameMatch) return false;

  if (!requireMethod(request, response, 'GET')) return true;
  if (!xiangqiMahjongEnabled()) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  if (!requirePersistence(response)) return true;

  const roomId = decodeURIComponent(postgameMatch[1]!);
  const payload = await xiangqiMahjongPostgameForApi(roomId);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export async function xiangqiMahjongPostgameForApi(
  roomId: string,
  deps: XmjPostgamePersistence = defaultPersistence,
) {
  const [game, events] = await Promise.all([
    deps.getGameSummary(roomId),
    deps.loadRoomEvents(roomId),
  ]);
  if (!game || game.variant !== XIANGQI_MAHJONG_SPEC_ID) return null;
  if (!events || !isTenantEventLog(xiangqiMahjongTenant, events, roomId)) return null;

  // The game record is written at game end, but the log is the truth: a record
  // with a log that does not replay to 'finished' reveals nothing.
  const projection = replayTenantEvents(xiangqiMahjongTenant, events);
  if (projection.state.status.type !== 'finished') return null;

  return {
    game: postgameGameSummary(game),
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline: xmjPostgameTimeline(events),
    view: xmjReviewViewFor(projection.state),
    history: xmjPostgameHistory(events),
  };
}

// One review view per ply, ply 0 being the first deal. A 'next-hand' move is a
// ply too, so the step after a hand's result is the next deal. A timed match
// carries each seat's clock per ply; the last ply takes the clock the log ends
// on, so a match lost on time shows the flag.
function xmjPostgameHistory(events: readonly XmjEvent[]): XmjPostgameSnapshot[] {
  const created = events[0];
  if (created?.type !== 'room-created') return [];
  let projection = replayTenantEvents(xiangqiMahjongTenant, [created]);
  type Projection = typeof projection;
  const snapshot = (ply: number, at: Projection): XmjPostgameSnapshot => {
    const clock = at.clock;
    return {
      ply,
      view: xmjReviewViewFor(at.state),
      ...(clock
        ? {
            clock: {
              remainingMs: { east: clock.remainingMs.east, west: clock.remainingMs.west },
              active: clock.activeColor,
            },
          }
        : {}),
    };
  };
  let ply = 0;
  // Ply 0 is the table just before the first move, so the clock-started event
  // that follows room-created is in it.
  const history: XmjPostgameSnapshot[] = [];
  for (const event of events.slice(1)) {
    if (event.type === 'move-played' && history.length === 0) {
      history.push(snapshot(ply, projection));
    }
    projection = applyTenantEvent(xiangqiMahjongTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    history.push(snapshot(ply, projection));
  }
  if (history.length === 0) history.push(snapshot(ply, projection));
  const last = history[history.length - 1];
  if (last && projection.clock) history[history.length - 1] = snapshot(last.ply, projection);
  return history;
}

function xmjPostgameTimeline(
  events: readonly XmjEvent[],
): Array<XmjPostgameMove | XmjPostgameTerminal> {
  const timeline: Array<XmjPostgameMove | XmjPostgameTerminal> = [];
  let ply = 0;
  for (const event of events) {
    if (event.type === 'move-played') {
      ply += 1;
      timeline.push({ type: event.type, at: event.at, color: event.color, move: event.move, ply });
      continue;
    }
    if (
      event.type === 'clock-expired' ||
      event.type === 'seat-resigned' ||
      event.type === 'seat-forfeited'
    ) {
      timeline.push({ type: event.type, at: event.at, color: event.color });
    }
  }
  return timeline;
}
