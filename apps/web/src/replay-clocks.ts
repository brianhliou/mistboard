import {
  type ClockState,
  type Color,
  clockRemainingMs,
  type GameEvent,
  type GameState,
} from '@mistboard/game';
import {
  type GameMeta,
  thinkingBudgetMsFromMeta,
  timeControlLabelFromMeta,
} from './replay-meta.js';
import { formatClock } from './web-utils.js';

export type ClockPanelHandle = {
  blackLabel: HTMLSpanElement;
  blackRow: HTMLDivElement;
  blackTime: HTMLSpanElement;
  blackToMove: HTMLSpanElement;
  el: HTMLDivElement;
  label: HTMLSpanElement;
  whiteLabel: HTMLSpanElement;
  whiteRow: HTMLDivElement;
  whiteTime: HTMLSpanElement;
  whiteToMove: HTMLSpanElement;
};

export type ReplayThinkingBudgetState = {
  activeColor: Color;
  budgetMs: number;
  elapsedMs: number;
};

export function createClockPanel(): ClockPanelHandle {
  const el = document.createElement('div');
  el.className = 'replay-clock-panel';
  el.hidden = true;

  const label = document.createElement('span');
  label.className = 'replay-clock-control';

  const whiteRow = createClockRow('White');
  const blackRow = createClockRow('Black');
  // Move-order seat, the same tag the tenant seat rows carry, so one host rule
  // finds either kind of row.
  whiteRow.row.dataset.seat = 'first';
  blackRow.row.dataset.seat = 'second';
  el.append(label);

  return {
    blackLabel: blackRow.label,
    blackRow: blackRow.row,
    blackTime: blackRow.time,
    blackToMove: blackRow.toMove,
    el,
    label,
    whiteLabel: whiteRow.label,
    whiteRow: whiteRow.row,
    whiteTime: whiteRow.time,
    whiteToMove: whiteRow.toMove,
  };
}

function createClockRow(colorLabel: string): {
  label: HTMLSpanElement;
  row: HTMLDivElement;
  time: HTMLSpanElement;
  toMove: HTMLSpanElement;
} {
  const row = document.createElement('div');
  row.className = 'replay-clock-row';
  row.hidden = true;
  const label = document.createElement('span');
  label.className = 'replay-clock-side';
  label.textContent = colorLabel;
  const toMove = document.createElement('span');
  toMove.className = 'replay-clock-to-move';
  toMove.textContent = 'to move';
  toMove.setAttribute('aria-hidden', 'true');
  const time = document.createElement('span');
  time.className = 'replay-clock-time';
  row.append(label, toMove, time);
  return { label, row, time, toMove };
}

export function createCompactClockSpacer(): HTMLDivElement {
  const spacer = document.createElement('div');
  spacer.className = 'replay-clock-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  return spacer;
}

export function setClockPanelNames(panel: ClockPanelHandle, meta: GameMeta | undefined): void {
  panel.whiteLabel.textContent = meta?.whiteName ?? 'White';
  panel.blackLabel.textContent = meta?.blackName ?? 'Black';
}

export function renderClockPanel(
  panel: ClockPanelHandle,
  clock: ClockState | undefined,
  state: GameState,
  meta: GameMeta | undefined,
  displayAtOverride?: number,
  thinking?: ReplayThinkingBudgetState | null,
): void {
  const timeControl = clock
    ? timeControlLabelFromClock(clock)
    : timeControlLabelFromMeta(meta?.timeControl);
  const thinkingBudgetMs = thinkingBudgetMsFromMeta(meta?.timeControl);
  const hasPlayerLabels = Boolean(meta?.whiteName || meta?.blackName);
  if (!clock && !timeControl && !hasPlayerLabels) {
    panel.el.hidden = true;
    panel.whiteRow.hidden = true;
    panel.blackRow.hidden = true;
    renderClockRowThinking(panel, null);
    return;
  }

  panel.el.hidden = !timeControl;
  panel.whiteRow.hidden = false;
  panel.blackRow.hidden = false;
  panel.label.textContent = timeControl ? `Time ${timeControl}` : 'Clock';
  panel.label.hidden = true;

  if (!clock) {
    const activeColor = state.status.type === 'playing' ? state.status.turn : null;
    const activeThinking =
      thinking &&
      activeColor === thinking.activeColor &&
      thinkingBudgetMs !== null &&
      thinking.budgetMs === thinkingBudgetMs
        ? thinking
        : activeColor && thinkingBudgetMs !== null
          ? { activeColor, budgetMs: thinkingBudgetMs, elapsedMs: 0 }
          : null;
    const showIdleThinkingBudget = state.status.type === 'playing';
    panel.whiteTime.textContent = clocklessReplayTimeLabel(
      'white',
      activeThinking,
      timeControl,
      thinkingBudgetMs,
      showIdleThinkingBudget,
    );
    panel.blackTime.textContent = clocklessReplayTimeLabel(
      'black',
      activeThinking,
      timeControl,
      thinkingBudgetMs,
      showIdleThinkingBudget,
    );
    renderClockRowTurn(panel, activeColor);
    renderClockRowThinking(panel, activeThinking);
    return;
  }

  const displayAt = displayAtOverride ?? clock.runningSince ?? 0;
  panel.whiteTime.textContent = formatClock(clockRemainingMs(clock, 'white', displayAt), true);
  panel.blackTime.textContent = formatClock(clockRemainingMs(clock, 'black', displayAt), true);
  panel.whiteRow.classList.toggle(
    'active',
    state.status.type === 'playing' && clock.activeColor === 'white',
  );
  panel.blackRow.classList.toggle(
    'active',
    state.status.type === 'playing' && clock.activeColor === 'black',
  );
  renderClockRowTurn(panel, state.status.type === 'playing' ? clock.activeColor : null);
  renderClockRowThinking(panel, null);
}

function renderClockRowTurn(panel: ClockPanelHandle, activeColor: Color | null): void {
  const whiteActive = activeColor === 'white';
  const blackActive = activeColor === 'black';
  panel.whiteRow.classList.toggle('active', whiteActive);
  panel.blackRow.classList.toggle('active', blackActive);
  panel.whiteToMove.classList.toggle('is-visible', whiteActive);
  panel.blackToMove.classList.toggle('is-visible', blackActive);
  panel.whiteToMove.setAttribute('aria-hidden', whiteActive ? 'false' : 'true');
  panel.blackToMove.setAttribute('aria-hidden', blackActive ? 'false' : 'true');
  panel.whiteRow.setAttribute('aria-current', whiteActive ? 'true' : 'false');
  panel.blackRow.setAttribute('aria-current', blackActive ? 'true' : 'false');
}

function renderClockRowThinking(
  panel: ClockPanelHandle,
  thinking: ReplayThinkingBudgetState | null,
): void {
  for (const row of [panel.whiteRow, panel.blackRow]) {
    row.classList.remove('is-thinking');
    row.style.removeProperty('--replay-thinking-progress');
  }
  if (!thinking) return;
  const row = thinking.activeColor === 'white' ? panel.whiteRow : panel.blackRow;
  const progress = Math.min(Math.max(thinking.elapsedMs / thinking.budgetMs, 0), 1);
  row.classList.add('is-thinking');
  row.style.setProperty('--replay-thinking-progress', String(progress));
}

function clocklessReplayTimeLabel(
  color: Color,
  thinking: ReplayThinkingBudgetState | null,
  timeControl: string | null,
  thinkingBudgetMs: number | null,
  showIdleThinkingBudget: boolean,
): string {
  if (timeControl === 'Untimed') return 'Untimed';
  if (!thinking) {
    return showIdleThinkingBudget && thinkingBudgetMs !== null
      ? formatThinkingBudget(thinkingBudgetMs)
      : '';
  }
  // The idle seat shows its full per-move allowance; the seat to move counts that allowance
  // DOWN. The two rows then read as a clock ("2.9s" against "1.4s and falling") instead of
  // as a statistic, which is how the old elapsed-over-budget form ("1.5s / 2.9s") read.
  if (color !== thinking.activeColor) return formatThinkingBudget(thinking.budgetMs);
  return formatThinkingRemaining(thinking.budgetMs - thinking.elapsedMs);
}

function formatThinkingRemaining(ms: number): string {
  if (ms < 100) return '0.0s';
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function formatThinkingBudget(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

export function replayClockDisplayAt(events: GameEvent[], state: GameState): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const at = events[index]?.at;
    if (typeof at === 'number' && Number.isFinite(at)) return at;
  }
  return state.clock?.runningSince ?? null;
}

function timeControlLabelFromClock(clock: ClockState): string {
  const base = formatClock(clock.initialMs);
  const incrementSeconds = Math.round(clock.incrementMs / 1000);
  return incrementSeconds > 0 ? `${base}+${incrementSeconds}` : base;
}
