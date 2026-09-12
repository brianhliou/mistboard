import {
  type Color,
  type GameEvent,
  type GameProjection,
  type PlayerView,
  replayGameEvents,
  variantForId,
} from '@mistboard/game';
import { type CaptureTally, computeCaptures } from './captures.js';
import {
  currentReplayIndex,
  getFogSnapshotToEventsLen,
  getFogViewHistory,
  isLive,
} from './live-replay.js';
import { type DevViews, liveState } from './live-state.js';
import { allSquares, oppositeColor } from './web-utils.js';

// Non-chess game specs render their own PlayerView and event stream; the chess
// projection/capture/replay machinery below must not run on their state.
function usesAlternateRenderer(): boolean {
  return liveState.gameSpecId === 'dark-xiangqi';
}

export function currentProjection(): GameProjection | null {
  if (usesAlternateRenderer()) return null;
  const slice = currentEventsSlice();
  return slice ? replayGameEvents(slice) : null;
}

export function currentCaptures(): CaptureTally {
  if (usesAlternateRenderer()) return { white: [], black: [] };
  const slice = currentEventsSlice();
  if (!slice) return { white: [], black: [] };
  return computeCaptures(slice);
}

export function currentView(): PlayerView | null {
  if (usesAlternateRenderer()) return liveState.state;
  const projection = currentProjection();
  const perspective = liveState.seat === 'black' ? 'black' : 'white';
  if (isLive()) return liveState.state;
  // Historical fog position: use the server-provided snapshot captured at that event count.
  // viewForProjection cannot reconstruct accurate historical fog views because events from
  // WebSocket snapshots are fog-filtered and structured differently from replayGameEvents.
  const gameFinished = liveState.state?.status.type === 'finished';
  const idx = getReplayIndexForView();
  const fogHistory = getFogViewHistory();
  if (!isLive() && idx !== null && liveState.state?.variant === 'dark-chess') {
    return fogHistory.get(idx) ?? liveState.state;
  }
  if (!projection) return liveState.state;
  if (projection.state.variant === 'dark-chess' && projection.state.status.type === 'finished') {
    return terminalFogViewForProjection(projection, perspective);
  }
  if (projection.state.variant === 'dark-chess' && gameFinished && idx !== null) {
    const captured = fogHistory.get(idx);
    if (captured) return captured;
  }
  return viewForProjection(projection, perspective);
}

export function currentDevViews(): DevViews | null {
  if (!liveState.devViews) return null;
  if (isLive()) return liveState.devViews;

  const projection = currentProjection();
  if (projection?.state.variant !== 'dark-chess') return liveState.devViews;

  const perspective = liveState.seat === 'black' ? 'black' : 'white';
  const opponent = oppositeColor(perspective);
  const player =
    projection.state.status.type === 'finished'
      ? fullTruthViewForProjection(projection, perspective)
      : viewForProjection(projection, perspective);
  const opponentView =
    projection.state.status.type === 'finished'
      ? fullTruthViewForProjection(projection, opponent)
      : viewForProjection(projection, opponent);
  return {
    opponent,
    opponentView,
    player,
    truth: fullTruthViewForProjection(projection, perspective),
  };
}

function currentEventsSlice(): GameEvent[] | null {
  if (usesAlternateRenderer()) return null;
  const events = liveState.events;
  if (events.length === 0) return null;
  // Fog replay uses fogSnapshotSeq as replayIndex, not an events index. Map through
  // fogSnapshotToEventsLen in fog mode; otherwise use the replay index directly.
  const fogHistory = getFogViewHistory();
  const sliceAt =
    fogHistory.size > 0 && liveState.state?.variant === 'dark-chess'
      ? isLive()
        ? events.length
        : (getFogSnapshotToEventsLen().get(currentReplayIndex()) ?? events.length)
      : currentReplayIndex();
  return events.slice(0, sliceAt);
}

function getReplayIndexForView(): number | null {
  return isLive() ? null : currentReplayIndex();
}

function viewForProjection(projection: GameProjection, perspective: Color): PlayerView {
  const variant = variantForId(projection.state.variant);
  const view = variant.getPlayerView(projection.state, perspective);
  if (!liveState.solo || projection.state.status.type !== 'playing') return view;
  return {
    ...view,
    legalMoves: variant.getLegalMoves(projection.state, projection.state.status.turn),
  };
}

function fullTruthViewForProjection(projection: GameProjection, perspective: Color): PlayerView {
  return {
    id: projection.state.id,
    variant: projection.state.variant,
    board: projection.state.board,
    visibleSquares: allSquares,
    legalMoves: [],
    status: projection.state.status,
    perspective,
    moveNumber: projection.state.moveNumber,
    lastMove: projection.state.lastMove,
    clock: projection.state.clock,
  };
}

function terminalFogViewForProjection(projection: GameProjection, perspective: Color): PlayerView {
  const variant = variantForId(projection.state.variant);
  const reviewState = {
    ...projection.state,
    status: { type: 'playing', turn: perspective } as const,
  };
  const view = variant.getPlayerView(reviewState, perspective);
  // Only show lastMove highlight if the move was made by the viewer. The to-square
  // holds the moving side's piece, so a perspective-colored piece there means it
  // was the viewer's move. Opponent moves stay hidden in the fog room.
  const lastMove = projection.state.lastMove;
  const ownedLastMove =
    lastMove && projection.state.board[lastMove.to]?.color === perspective ? lastMove : undefined;
  return {
    ...view,
    legalMoves: [],
    status: projection.state.status,
    lastMove: ownedLastMove,
    clock: projection.state.clock,
  };
}
