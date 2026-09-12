import {
  algebraicMoveLabels as buildAlgebraicMoveLabels,
  type Color,
  coordinateMoveLabel,
  type PlayerView,
} from '@mistboard/game';
import {
  getFogViewHistory,
  getReplayIndex,
  handleMoveListClick,
  handleReplayButtonClick,
  isLive,
  replayControlDisabled,
  replayMetaLabel,
  snapshotToPly,
} from './live-replay.js';
import {
  type LiveRefs,
  liveState,
  type MoveListEntry,
  type MovePlayedEvent,
} from './live-state.js';
import { currentView } from './live-view.js';
import { isColor } from './web-utils.js';

type MoveListRefs = Pick<LiveRefs, 'moveList' | 'replayControls' | 'replayMeta'>;

let lastMoveListPlyCount: number | null = null;
let lastMoveListWasLive: boolean | null = null;

export function resetMoveListState(): void {
  lastMoveListPlyCount = null;
  lastMoveListWasLive = null;
}

export function renderReplay(refs: MoveListRefs): void {
  refs.replayMeta.textContent = replayMetaLabel();

  for (const control of refs.replayControls) {
    control.disabled = replayControlDisabled(control.dataset.replay ?? '');
    control.onclick = () => handleReplayButtonClick(control.dataset.replay ?? '');
  }

  refs.moveList.replaceChildren();
  const masked = shouldMaskMoveList();
  const entries = masked ? liveMoveListEntries() : revealedMoveListEntries();
  const entriesByPly = new Map(entries.map((entry) => [entry.ply, entry]));
  const labelsByEventIndex = algebraicMoveLabels();
  const plyCount = moveListPlyCount(masked, entries);
  const visibleColor = moveListVisibleColor(masked);
  const activePly = computeActivePly();
  const rows: HTMLLIElement[] = [];

  for (let row = 0; row < Math.ceil(plyCount / 2); row += 1) {
    const item = document.createElement('li');
    item.className = 'move-row';

    const number = document.createElement('span');
    number.className = 'move-number';
    number.textContent = `${row + 1}.`;
    item.append(number);

    const whitePly = row * 2 + 1;
    const blackPly = row * 2 + 2;
    item.append(
      moveListCell(
        whitePly,
        'white',
        entriesByPly.get(whitePly),
        masked,
        visibleColor,
        plyCount,
        labelsByEventIndex,
        activePly,
      ),
    );
    item.append(
      moveListCell(
        blackPly,
        'black',
        entriesByPly.get(blackPly),
        masked,
        visibleColor,
        plyCount,
        labelsByEventIndex,
        activePly,
      ),
    );
    rows.push(item);
  }
  refs.moveList.append(...rows);
  syncMoveListScroll(refs, plyCount);
}

export function shouldAutoScrollMoveList(input: {
  nextIsLive: boolean;
  nextPlyCount: number;
  previousPlyCount: number | null;
  previousWasLive: boolean | null;
}): boolean {
  if (!input.nextIsLive || input.nextPlyCount === 0) return false;
  if (input.previousPlyCount === null) return true;
  if (input.previousWasLive === false) return true;
  return input.nextPlyCount > input.previousPlyCount;
}

function syncMoveListScroll(refs: MoveListRefs, nextPlyCount: number): void {
  const nextIsLive = isLive();
  if (
    shouldAutoScrollMoveList({
      nextIsLive,
      nextPlyCount,
      previousPlyCount: lastMoveListPlyCount,
      previousWasLive: lastMoveListWasLive,
    })
  ) {
    refs.moveList.scrollTop = refs.moveList.scrollHeight;
  }
  lastMoveListPlyCount = nextPlyCount;
  lastMoveListWasLive = nextIsLive;
}

export function shouldMaskMoveList(): boolean {
  if (liveState.state?.variant !== 'dark-chess' || liveState.roomMode === 'eve') return false;
  // A finished room reveals everything to everyone (the spectator visibility
  // matrix, 2026-09-06): the game-end snapshot carries the whole log, so the
  // list shows both sides' moves beside the opened board.
  if (liveState.state.status.type === 'finished') return false;
  // PvE spectators already receive only the human player's fog view. Engine moves are filtered
  // server-side, so the human's moves are not secret and spectators can follow along.
  if (liveState.roomMode === 'pve' && liveState.seat === 'spectator') return false;
  // Live: each seat lists its own moves and the opponent's plies as blanks.
  return true;
}

function revealedMoveListEntries(): MoveListEntry[] {
  const entries: MoveListEntry[] = [];
  for (const [index, event] of liveState.events.entries()) {
    if (event.type !== 'move-played') continue;
    entries.push({
      event: event as MovePlayedEvent,
      eventIndex: index + 1,
      ply: entries.length + 1,
    });
  }
  return entries;
}

function liveMoveListEntries(): MoveListEntry[] {
  const entries: MoveListEntry[] = [];
  const counts: Record<Color, number> = { black: 0, white: 0 };
  for (const [index, event] of liveState.events.entries()) {
    if (event.type !== 'move-played') continue;
    counts[event.color] += 1;
    const ply = event.color === 'white' ? counts.white * 2 - 1 : counts.black * 2;
    entries.push({ event: event as MovePlayedEvent, eventIndex: index + 1, ply });
  }
  return entries;
}

function liveMoveListPlyCount(view: PlayerView | null): number {
  if (!view) return 0;
  if (view.status.type !== 'playing') return 0;
  const completedFullMoves = Math.max(0, view.moveNumber - 1);
  return completedFullMoves * 2 + (view.status.turn === 'black' ? 1 : 0);
}

function moveListPlyCount(masked: boolean, entries: MoveListEntry[]): number {
  if (!masked) return entries.length;
  if (liveState.state?.status.type === 'playing') return liveMoveListPlyCount(liveState.state);
  return Math.max(0, ...entries.map((entry) => entry.ply));
}

function moveListVisibleColor(masked: boolean): Color | null {
  if (!masked) return null;
  if (isColor(liveState.seat)) return liveState.seat;
  return currentView()?.status.type === 'finished' ? (currentView()?.perspective ?? 'white') : null;
}

function computeActivePly(): number | null {
  const idx = getReplayIndex();
  if (idx === null) return null;
  // Fog replay indexes snapshots; snapshotToPly maps them to chess plies.
  if (liveState.state?.variant === 'dark-chess' && getFogViewHistory().size > 0) {
    return snapshotToPly(idx);
  }
  // Non-fog replay indexes events; count moves up to the selected event index.
  let plies = 0;
  for (let i = 0; i < idx && i < liveState.events.length; i += 1) {
    if (liveState.events[i]?.type === 'move-played') plies += 1;
  }
  return plies;
}

function moveListCell(
  ply: number,
  color: Color,
  entry: MoveListEntry | undefined,
  masked: boolean,
  visibleColor: Color | null,
  plyCount: number,
  labelsByEventIndex: Map<number, string>,
  activePly: number | null = null,
): HTMLElement {
  if (ply > plyCount) {
    const empty = document.createElement('span');
    empty.className = `${color}-ply move-empty`;
    return empty;
  }

  const isActive = activePly === ply;
  const hidden = masked && color !== visibleColor;
  if (!entry || hidden) {
    const placeholder = document.createElement('span');
    placeholder.className = [`${color}-ply`, 'move-placeholder', isActive ? 'active' : '']
      .filter(Boolean)
      .join(' ');
    placeholder.textContent = '..';
    return placeholder;
  }

  if (masked) {
    const label = document.createElement('span');
    label.className = [`${color}-ply`, 'move-visible', isActive ? 'active' : '']
      .filter(Boolean)
      .join(' ');
    label.textContent = moveLabel(entry, labelsByEventIndex);
    return label;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = moveLabel(entry, labelsByEventIndex);
  button.className = [color === 'white' ? 'white-ply' : 'black-ply', isActive ? 'active' : '']
    .filter(Boolean)
    .join(' ');
  button.addEventListener('click', () => handleMoveListClick(entry.eventIndex));
  return button;
}

function algebraicMoveLabels(): Map<number, string> {
  return buildAlgebraicMoveLabels(liveState.events, liveState.events[0]?.roomId ?? liveState.room);
}

function moveLabel(entry: MoveListEntry, labelsByEventIndex: Map<number, string>): string {
  return labelsByEventIndex.get(entry.eventIndex) ?? coordinateMoveLabel(entry.event.move);
}
