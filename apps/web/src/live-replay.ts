// Replay-of-live navigation — extracted from live-render.ts.
// Owns the replay state (replayIndex + fogViewHistory tracking) and the
// navigation surface (keyboard + button + move-list-click). live-render
// reads state via accessors and calls handleReplayButtonClick /
// handleMoveListClick when wiring DOM events. State mutators notify the
// caller via the `onStateChange` callback injected at initReplay() time —
// this keeps the dependency one-way (live-render → live-replay) and avoids
// a value-circular import.

import type { GameEvent, PlayerView } from '@mistboard/game';
import { ownPieceCount, playSound, soundForMove, soundForOwnMove } from './live-sound.js';
import { liveState } from './live-state.js';
import { isColor } from './web-utils.js';

let onStateChange: () => void = () => {};

export function initReplay(callbacks: { onStateChange: () => void }): void {
  onStateChange = callbacks.onStateChange;
}

let replayIndex: number | null = null;

// Fog-of-war replay needs to remember the player-view at every snapshot the
// server delivered so we can step backwards through fog-filtered events.
// Opponent moves are absent from liveState.events (fog-filtered), so eventsLen
// is not a monotonic key for fog snapshots — instead, we capture on every state
// change (liveState.state reference change) and key by a monotonic counter so
// both own and opponent moves get distinct entries.
let fogViewHistory: Map<number, PlayerView> = new Map();
let fogSnapshotToEventsLen: Map<number, number> = new Map();
let fogSnapshotSeq = 0;
let lastCapturedFogState: PlayerView | null = null;
let lastCapturedFogPositionKey: string | null = null;
let fogFirstMoveSnapshotIndex: number | null = null;

export function resetReplayState(): void {
  replayIndex = null;
  fogViewHistory = new Map();
  fogSnapshotToEventsLen = new Map();
  fogSnapshotSeq = 0;
  lastCapturedFogState = null;
  lastCapturedFogPositionKey = null;
  fogFirstMoveSnapshotIndex = null;
}

export function getReplayIndex(): number | null {
  return replayIndex;
}

export function getFogViewHistory(): Map<number, PlayerView> {
  return fogViewHistory;
}

export function getFogSnapshotToEventsLen(): Map<number, number> {
  return fogSnapshotToEventsLen;
}

export function captureFogView(): void {
  if (liveState.state?.variant !== 'dark-chess') return;
  // Consider every server state change, not just eventsLen increases. Opponent moves don't
  // appear in liveState.events (fog-filtered), so eventsLen stays constant after them — using it
  // as the key would collapse own-move and opponent-move positions into one entry. Terminal
  // non-move frames, such as forfeits and timeouts, are skipped below when the fogged position
  // itself did not change.
  if (liveState.state === lastCapturedFogState) return;
  const positionKey = fogReplayPositionKey(liveState.state);
  if (positionKey === lastCapturedFogPositionKey) {
    lastCapturedFogState = liveState.state;
    return;
  }
  if (fogFirstMoveSnapshotIndex === null && liveState.state.lastMove !== undefined) {
    fogFirstMoveSnapshotIndex = fogSnapshotSeq;
  }
  fogViewHistory.set(fogSnapshotSeq, liveState.state);
  fogSnapshotToEventsLen.set(fogSnapshotSeq, liveState.events.length);
  fogSnapshotSeq++;
  lastCapturedFogState = liveState.state;
  lastCapturedFogPositionKey = positionKey;
}

function fogReplayPositionKey(view: PlayerView): string {
  const board = Object.entries(view.board)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([square, piece]) => [square, piece.color, piece.role]);
  return JSON.stringify({
    board,
    lastMove: view.lastMove ?? null,
    moveNumber: view.moveNumber,
    perspective: view.perspective,
    variant: view.variant,
    visibleSquares: [...view.visibleSquares].sort(),
  });
}

export function isLive(): boolean {
  return replayIndex === null || replayIndex >= fogLivePos();
}

export function currentReplayIndex(): number {
  return replayIndex ?? fogLivePos();
}

export function fogLivePos(): number {
  // For fog games, the live position IS the last captured snapshot (fogSnapshotSeq - 1), not
  // one past it. This eliminates the redundant extra right-press from "last snapshot" to "live"
  // since both show the same board.
  return liveState.state?.variant === 'dark-chess' && fogViewHistory.size > 0
    ? fogSnapshotSeq - 1
    : liveState.events.length;
}

export function snapshotToPly(snapshot: number): number {
  if (fogFirstMoveSnapshotIndex === null) return 0;
  return Math.max(0, snapshot - fogFirstMoveSnapshotIndex + 1);
}

function totalPlies(): number {
  return snapshotToPly(fogLivePos());
}

function isReplayHistoryEvent(event: GameEvent): boolean {
  // clock-expired is excluded: it ends the game but doesn't move pieces, so navigating to it
  // always shows the same board as the last move-played. Stepping backward would burn a key press
  // with no visible board change.
  return event.type === 'room-created' || event.type === 'move-played';
}

function firstMoveHistoryIndex(): number | null {
  if (liveState.state?.variant === 'dark-chess' && fogViewHistory.size > 0) {
    return fogFirstMoveSnapshotIndex;
  }
  for (const [index, event] of liveState.events.entries()) {
    if (event.type === 'move-played') return index + 1;
  }
  return null;
}

function replayHistoryIndexes(): number[] {
  // For fog-of-war games, navigate through fogViewHistory keys rather than the events list.
  // Events are fog-filtered: opponent moves are excluded from liveState.events, so events-based
  // history only has the current player's moves — each step would span 2 chess ply. fogViewHistory
  // is captured on every snapshot render (including after hidden opponent moves), giving 1-ply
  // granularity.
  //
  // Skip transient pregame snapshots so the chess-viewer convention holds: |< lands on a single
  // "starting position" (ply 0), not on whichever seat-assigned/clock-started snapshot happened
  // to fire first. Keep the snapshot immediately before the first move as the ply-0 anchor;
  // every snapshot from the first move onward is a real ply position.
  if (liveState.state?.variant === 'dark-chess' && fogViewHistory.size > 0) {
    const allKeys = Array.from(fogViewHistory.keys()).sort((a, b) => a - b);
    if (fogFirstMoveSnapshotIndex === null) {
      // No moves played yet — expose only the latest pregame snapshot so |< / > don't walk
      // through redundant setup states.
      return allKeys.length > 0 ? [allKeys[allKeys.length - 1]!] : [];
    }
    const firstMove = fogFirstMoveSnapshotIndex;
    const startAnchor = firstMove - 1;
    return allKeys.filter((k) => k === startAnchor || k >= firstMove);
  }
  const indexes: number[] = [];
  for (const [index, event] of liveState.events.entries()) {
    if (isReplayHistoryEvent(event)) indexes.push(index + 1);
  }
  return indexes;
}

function previousReplayHistoryIndex(currentIndex: number, history: number[]): number {
  const currentHistoryIndex = latestReplayHistoryIndexAtOrBefore(currentIndex, history);
  // If currentIndex is not itself a history entry (e.g. the live position is one past the last
  // snapshot), the nearest earlier history entry IS the previous position — don't step back again.
  if (currentHistoryIndex !== currentIndex) return currentHistoryIndex;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const historyIndex = history[index]!;
    if (historyIndex < currentHistoryIndex) return historyIndex;
  }
  return currentHistoryIndex;
}

function nextReplayHistoryIndex(currentIndex: number, history: number[]): number | null {
  for (const historyIndex of history) {
    if (historyIndex > currentIndex) return historyIndex;
  }
  const livePos = fogLivePos();
  return currentIndex < livePos ? livePos : null;
}

function latestReplayHistoryIndexAtOrBefore(currentIndex: number, history: number[]): number {
  let latest = history[0] ?? currentIndex;
  for (const historyIndex of history) {
    if (historyIndex > currentIndex) break;
    latest = historyIndex;
  }
  return latest;
}

function fogSnapshotForEventIndex(eventIndex: number): number | null {
  // Find the earliest fog snapshot whose eventsLen covers this eventIndex.
  let best: number | null = null;
  for (const [snap, evLen] of fogSnapshotToEventsLen) {
    if (evLen >= eventIndex && (best === null || snap < best)) best = snap;
  }
  return best;
}

function applyReplayControl(action: string): void {
  const history = replayHistoryIndexes();
  if (action === 'latest') {
    replayIndex = null;
    return;
  }
  if (history.length === 0) {
    replayIndex = null;
    return;
  }

  const currentIndex = currentReplayIndex();
  if (action === 'first') replayIndex = history[0] ?? null;
  if (action === 'prev') replayIndex = previousReplayHistoryIndex(currentIndex, history);
  if (action === 'next') {
    const next = nextReplayHistoryIndex(currentIndex, history);
    const livePos = fogLivePos();
    replayIndex = next === null || next >= livePos ? null : next;
  }
}

function maybeSoundForReplayStep(prevIndex: number | null, nextIndex: number | null): void {
  // Both prevIndex and nextIndex use `null` to mean "live position". Map both to the concrete
  // live snapshot index so a forward step into live (the final ply reveal) still plays a sound —
  // the WS-driven sound system only fires on new server messages, not on keyboard navigation.
  const livePos = fogLivePos();
  const effectiveNext = nextIndex ?? livePos;
  const effectivePrev = prevIndex ?? livePos;
  if (effectiveNext <= effectivePrev) return; // backward step or no change — no sound

  if (liveState.state?.variant === 'dark-chess' && fogViewHistory.size > 0) {
    // replayIndex is a fog snapshot number, not an events index. Use fog view comparison to
    // determine the sound — the same logic playSanitizedOpponentSound uses for live moves.
    const prevView = fogViewHistory.get(effectivePrev);
    const nextView = fogViewHistory.get(effectiveNext);
    if (!prevView || !nextView) return;
    const seat = isColor(liveState.seat) ? liveState.seat : 'white';
    const moveEvent = fogReplayStepMoveEvent(effectivePrev, effectiveNext);
    if (moveEvent && (liveState.solo || moveEvent.color === seat)) {
      playSound(soundForOwnReplayMove(prevView, moveEvent));
      return;
    }
    playSound(ownPieceCount(nextView, seat) < ownPieceCount(prevView, seat) ? 'captured' : 'move');
    return;
  }

  const eventIndex = effectiveNext - 1;
  const event = liveState.events[eventIndex];
  if (event?.type !== 'move-played') return;
  playSound(soundForMove(liveState.events.slice(0, eventIndex), event));
}

function fogReplayStepMoveEvent(
  prevSnapshot: number,
  nextSnapshot: number,
): Extract<GameEvent, { type: 'move-played' }> | null {
  const prevEventsLen = fogSnapshotToEventsLen.get(prevSnapshot);
  const nextEventsLen = fogSnapshotToEventsLen.get(nextSnapshot);
  if (prevEventsLen === undefined || nextEventsLen === undefined || nextEventsLen <= prevEventsLen)
    return null;

  for (let index = nextEventsLen - 1; index >= prevEventsLen; index -= 1) {
    const event = liveState.events[index];
    if (event?.type === 'move-played') return event;
  }
  return null;
}

function soundForOwnReplayMove(
  prevView: PlayerView,
  event: Extract<GameEvent, { type: 'move-played' }>,
) {
  const viewSound = soundForOwnMove(prevView, event.move);
  if (viewSound !== 'move' || !event.capturedRole) return viewSound;
  return event.capturedRole === 'king' ? 'king-capture' : 'capture';
}

function replayActionForKey(key: string): string | null {
  if (key === 'ArrowLeft') return 'prev';
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowUp') return 'first';
  if (key === 'ArrowDown') return 'latest';
  return null;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function replayControlDisabled(action: string): boolean {
  const history = replayHistoryIndexes();
  if (history.length === 0) return action !== 'latest';
  const currentIndex = currentReplayIndex();
  if (action === 'latest') return isLive();
  if (action === 'next') return isLive() || nextReplayHistoryIndex(currentIndex, history) === null;
  if (action === 'first') return previousReplayHistoryIndex(currentIndex, history) === currentIndex;
  if (action === 'prev') {
    // Disable prev one step before the first move so the user can still step back to the initial
    // board but not further. < (not <=) so the first-move position itself allows one more step.
    const firstMove = firstMoveHistoryIndex();
    if (firstMove !== null && currentIndex < firstMove) return true;
    return previousReplayHistoryIndex(currentIndex, history) === currentIndex;
  }
  return false;
}

export function replayMetaLabel(): string {
  if (liveState.events.length === 0) return 'No events';
  const isFog = liveState.state?.variant === 'dark-chess' && fogViewHistory.size > 0;
  if (isFog) {
    const total = totalPlies();
    if (isLive()) return `Live · ply ${total} of ${total}`;
    return `Replay · ply ${snapshotToPly(currentReplayIndex())} of ${total}`;
  }
  if (isLive()) return `Live · ${liveState.events.length} events`;
  return `Replay · event ${currentReplayIndex()} of ${fogLivePos()}`;
}

// ── Navigation entry points ───────────────────────────────────────────────────

export function handleReplayButtonClick(action: string): void {
  const prev = replayIndex;
  applyReplayControl(action);
  maybeSoundForReplayStep(prev, replayIndex);
  onStateChange();
}

export function handleReplayKeyboard(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
    return;
  if (isEditableKeyboardTarget(event.target)) return;

  const action = replayActionForKey(event.key);
  if (!action || replayControlDisabled(action)) return;

  event.preventDefault();
  const prev = replayIndex;
  applyReplayControl(action);
  maybeSoundForReplayStep(prev, replayIndex);
  onStateChange();
}

export function handleMoveListClick(eventIndex: number): void {
  if (liveState.state?.variant === 'dark-chess' && fogViewHistory.size > 0) {
    replayIndex = fogSnapshotForEventIndex(eventIndex);
  } else {
    replayIndex = eventIndex;
  }
  onStateChange();
}
