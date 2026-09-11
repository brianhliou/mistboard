import './game-shell.css';
import {
  algebraicMoveLabels as buildAlgebraicMoveLabels,
  type Color,
  coordinateMoveLabel,
  type GameEvent,
} from '@mistboard/game';
import { t } from './i18n/catalog.js';
import {
  REPLAY_ICON_FIRST,
  REPLAY_ICON_LAST,
  REPLAY_ICON_NEXT,
  REPLAY_ICON_PREV,
} from './replay-icons.js';

type MovePlayedEvent = Extract<GameEvent, { type: 'move-played' }>;

export type ReplayMovesPanelHandle = {
  controls: {
    first: HTMLButtonElement;
    last: HTMLButtonElement;
    next: HTMLButtonElement;
    prev: HTMLButtonElement;
  };
  el: HTMLElement;
  meta: HTMLParagraphElement;
  moveList: HTMLOListElement;
};

type ReplayMoveEntry = {
  event: MovePlayedEvent;
  eventIndex: number;
  label: string;
  ply: number;
};

export function createReplayMovesPanel(): ReplayMovesPanelHandle {
  const el = document.createElement('aside');
  el.className = 'side-panel moves-panel replay-moves-panel';
  el.setAttribute('aria-label', t('replay.movesPanelAria'));

  const section = document.createElement('section');
  section.className = 'panel-section';
  const title = document.createElement('h2');
  title.textContent = t('replay.moves');

  const controls = document.createElement('div');
  controls.className = 'replay-controls';
  const first = iconButton(REPLAY_ICON_FIRST, 'First position');
  const prev = iconButton(REPLAY_ICON_PREV, 'Previous move');
  const next = iconButton(REPLAY_ICON_NEXT, 'Next move');
  const last = iconButton(REPLAY_ICON_LAST, 'Latest position');
  controls.append(first, prev, next, last);

  const meta = document.createElement('p');
  meta.className = 'replay-meta';
  meta.textContent = t('replay.replayMode');

  const moveList = document.createElement('ol');
  moveList.className = 'move-list';

  section.append(title, controls, meta, moveList);
  el.append(section);
  return {
    controls: { first, last, next, prev },
    el,
    meta,
    moveList,
  };
}

export function renderReplayMovesPanel(
  panel: ReplayMovesPanelHandle,
  state: {
    activePly: number;
    eventIndex: number;
    events: GameEvent[];
    moveCount: number;
    onJump: (ply: number) => void;
  },
): void {
  panel.meta.textContent =
    state.events.length === 0
      ? 'No moves'
      : `Move ${Math.ceil(state.activePly / 2)} · ply ${state.activePly} of ${state.moveCount}`;
  panel.controls.first.disabled = state.activePly === 0;
  panel.controls.prev.disabled = state.activePly === 0;
  panel.controls.next.disabled = state.activePly >= state.moveCount;
  panel.controls.last.disabled = state.activePly >= state.moveCount;
  panel.controls.first.onclick = () => state.onJump(0);
  panel.controls.prev.onclick = () => state.onJump(state.activePly - 1);
  panel.controls.next.onclick = () => state.onJump(state.activePly + 1);
  panel.controls.last.onclick = () => state.onJump(state.moveCount);
  renderReplayMoveList(panel.moveList, state.events, state.activePly, state.onJump);
}

function renderReplayMoveList(
  list: HTMLOListElement,
  events: GameEvent[],
  activePly: number,
  onJump: (ply: number) => void,
): void {
  const entries = replayMoveEntries(events);
  list.replaceChildren();
  if (entries.length === 0) return;
  const fullMoves = Math.ceil(entries.length / 2);
  const rows: HTMLLIElement[] = [];
  for (let moveNumber = 1; moveNumber <= fullMoves; moveNumber += 1) {
    const whitePly = moveNumber * 2 - 1;
    const blackPly = moveNumber * 2;
    const row = document.createElement('li');
    row.className = 'move-row';
    const label = document.createElement('span');
    label.className = 'move-number';
    label.textContent = String(moveNumber);
    row.append(label);
    row.append(replayMoveCell(entries[whitePly - 1], 'white', activePly, onJump));
    row.append(replayMoveCell(entries[blackPly - 1], 'black', activePly, onJump));
    rows.push(row);
  }
  list.append(...rows);
  scrollActiveMoveIntoView(list);
}

function scrollActiveMoveIntoView(list: HTMLOListElement): void {
  window.requestAnimationFrame(() => {
    const active = list.querySelector<HTMLButtonElement>('button.active');
    if (!active) return;
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const centeredDelta =
      activeRect.top - listRect.top - (list.clientHeight - activeRect.height) / 2;
    list.scrollTo({ top: Math.max(0, list.scrollTop + centeredDelta), behavior: 'auto' });
  });
}

function replayMoveCell(
  entry: ReplayMoveEntry | undefined,
  color: Color,
  activePly: number,
  onJump: (ply: number) => void,
): HTMLElement {
  if (!entry) {
    const empty = document.createElement('span');
    empty.className = `${color}-ply move-empty`;
    return empty;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = [
    color === 'white' ? 'white-ply' : 'black-ply',
    activePly === entry.ply ? 'active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  button.textContent = entry.label;
  button.title = `Event ${entry.eventIndex}`;
  button.addEventListener('click', () => onJump(entry.ply));
  return button;
}

function replayMoveEntries(events: GameEvent[]): ReplayMoveEntry[] {
  const entries: ReplayMoveEntry[] = [];
  const labelsByEventIndex = buildAlgebraicMoveLabels(events, events[0]?.roomId ?? 'replay');
  for (const [index, event] of events.entries()) {
    if (event.type === 'move-played') {
      entries.push({
        event,
        eventIndex: index + 1,
        label: labelsByEventIndex.get(index + 1) ?? coordinateMoveLabel(event.move),
        ply: entries.length + 1,
      });
    }
  }
  return entries;
}

function iconButton(svgMarkup: string, titleText: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'replay-button replay-icon-button';
  btn.innerHTML = svgMarkup;
  btn.title = titleText;
  btn.setAttribute('aria-label', titleText);
  return btn;
}
