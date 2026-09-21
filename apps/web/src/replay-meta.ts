import type { GameEvent } from '@mistboard/game';
import { terminationLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { escapeHtml, formatClock } from './web-utils.js';

export type GameMeta = {
  whiteName: string | null;
  blackName: string | null;
  gameUrl?: string | null;
  modeLabel?: string;
  result: string;
  timeControl?: Record<string, unknown> | null;
  termination: string;
  plyCount: number;
};

export type GameMetaPanelHandle = {
  details: HTMLDivElement;
  el: HTMLElement;
  mode: 'full' | 'compact';
  hideGameIdPill: boolean;
};

export type GameHeaderHandle = {
  el: HTMLElement;
  title: HTMLHeadingElement;
  result: HTMLDivElement;
  meta: HTMLDivElement;
  whiteCell: HTMLDivElement;
  blackCell: HTMLDivElement;
  /** Slot for action buttons (Flip, future toggles) on the center column. */
  actions: HTMLDivElement;
};

export function createGameHeaderStrip(): GameHeaderHandle {
  const el = document.createElement('header');
  el.className = 'replay-game-header';
  el.setAttribute('aria-label', 'Game summary');

  const whiteCell = document.createElement('div');
  whiteCell.className = 'replay-game-header-cell replay-game-header-cell-white';

  const center = document.createElement('div');
  center.className = 'replay-game-header-center';
  const title = document.createElement('h1');
  title.className = 'replay-game-header-title';
  const result = document.createElement('div');
  result.className = 'replay-game-header-result';
  const meta = document.createElement('div');
  meta.className = 'replay-game-header-meta';
  const actions = document.createElement('div');
  actions.className = 'replay-game-header-actions';
  center.append(title, result, meta, actions);

  const blackCell = document.createElement('div');
  blackCell.className = 'replay-game-header-cell replay-game-header-cell-black';

  el.append(whiteCell, center, blackCell);
  return { el, title, result, meta, whiteCell, blackCell, actions };
}

export function playerViewLabel(name: string | null | undefined, side: 'white' | 'black'): string {
  const trimmed = name?.trim();
  if (!trimmed) return side === 'white' ? t('replay.whitesView') : t('replay.blacksView');
  // Name kept verbatim so the casing the user chose is preserved. The
  // possessive lives inside the key, not in code: English glues an apostrophe
  // on the end, and no other locale forms it that way.
  return t('replay.playersView', { name: trimmed });
}

export function createShareButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'replay-game-header-action replay-game-header-share';
  btn.innerHTML = `${ICON_SHARE}<span class="replay-game-header-action-label">${escapeHtml(
    t('replay.share'),
  )}</span>`;
  btn.title = t('replay.copyLinkToPosition');
  const labelEl = btn.querySelector<HTMLSpanElement>('.replay-game-header-action-label')!;
  let resetTimer: number | null = null;
  btn.addEventListener('click', async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      labelEl.textContent = t('replay.copied');
      btn.classList.add('replay-game-header-share-copied');
    } catch {
      // Older browsers / clipboard-blocked contexts: fall back to a transient prompt.
      try {
        window.prompt(t('replay.copyThisLink'), url);
      } catch {
        return;
      }
    }
    if (resetTimer !== null) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      labelEl.textContent = t('replay.share');
      btn.classList.remove('replay-game-header-share-copied');
      resetTimer = null;
    }, 1600);
  });
  return btn;
}

export function renderGameHeader(
  handle: GameHeaderHandle | null,
  meta: GameMeta | undefined,
): void {
  if (!handle) return;
  if (!meta) {
    handle.title.textContent = '';
    handle.result.replaceChildren();
    handle.meta.replaceChildren();
    return;
  }
  handle.title.textContent = meta.modeLabel ?? 'Game';

  const resultSide = winningSideFromResult(meta.result);
  const resultText = resultLabel(meta.result);
  const terminationText = terminationDetailLabel(meta.termination);
  handle.result.replaceChildren();
  const chip = document.createElement('span');
  chip.className = `replay-game-header-result-chip replay-game-header-result-${resultSide}`;
  chip.textContent = resultText;
  handle.result.append(chip);
  if (terminationText) {
    const detail = document.createElement('span');
    detail.className = 'replay-game-header-result-detail';
    detail.textContent = terminationText;
    handle.result.append(detail);
  }

  const timeControl = timeControlLabelFromMeta(meta.timeControl);
  const bits: string[] = [
    ...(timeControl ? [timeControl] : []),
    meta.plyCount === 1 ? t('replay.onePly') : t('watch.plyCount', { count: meta.plyCount }),
  ];
  handle.meta.replaceChildren();
  bits.forEach((bit, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'replay-game-header-sep';
      sep.textContent = '·';
      handle.meta.append(sep);
    }
    const span = document.createElement('span');
    span.textContent = bit;
    handle.meta.append(span);
  });
  if (meta.gameUrl) {
    const sep = document.createElement('span');
    sep.className = 'replay-game-header-sep';
    sep.textContent = '·';
    const link = document.createElement('a');
    link.className = 'replay-game-header-link';
    link.href = meta.gameUrl;
    link.textContent = t('replay.viewGame');
    handle.meta.append(sep, link);
  }
}

export function createGameMetaPanel(
  mode: 'full' | 'compact' = 'full',
  opts: { hideGameIdPill?: boolean } = {},
): GameMetaPanelHandle {
  const el = document.createElement('aside');
  el.className = `replay-game-meta-card replay-game-meta-card-${mode} side-panel meta-panel`;
  el.setAttribute('aria-label', t('replay.gameMetadata'));
  const section = document.createElement('section');
  section.className = 'panel-section';
  const title = document.createElement('h2');
  title.textContent = mode === 'compact' ? t('replay.featuredGame') : t('replay.game');
  const details = document.createElement('div');
  details.className = 'game-info replay-game-meta-details';
  if (mode === 'compact') {
    section.append(details);
  } else {
    section.append(title, details);
  }
  el.append(section);
  return { details, el, mode, hideGameIdPill: opts.hideGameIdPill === true };
}

export function renderGameMetaPanel(
  panel: GameMetaPanelHandle | null,
  meta: GameMeta | undefined,
  activeSample: string,
): void {
  if (!panel) return;
  if (!meta) {
    panel.el.hidden = true;
    panel.details.replaceChildren();
    return;
  }

  panel.el.hidden = false;
  const timeControl = timeControlLabelFromMeta(meta.timeControl);
  const items: Array<{ label: string; value: string }> =
    panel.mode === 'compact'
      ? []
      : [
          { label: t('replay.modeLabel'), value: meta.modeLabel ?? t('replay.replayMode') },
          { label: t('replay.resultLabel'), value: resultLabel(meta.result) },
          { label: t('replay.endLabel'), value: terminationLabel(meta.termination) },
          ...(timeControl ? [{ label: t('replay.timeLabel'), value: timeControl }] : []),
          { label: t('replay.pliesLabel'), value: String(meta.plyCount) },
          { label: t('replay.game'), value: activeSample },
        ];

  panel.details.replaceChildren();
  for (const item of items) {
    panel.details.append(infoItem(item.label, item.value));
  }
  if (panel.mode === 'compact') {
    if (!panel.hideGameIdPill) {
      const gameId = document.createElement(meta.gameUrl ? 'a' : 'span');
      gameId.className = 'replay-game-id';
      gameId.textContent = activeSample;
      if (gameId instanceof HTMLAnchorElement && meta.gameUrl) gameId.href = meta.gameUrl;
      panel.details.append(gameId);
    }
  } else if (meta.gameUrl) {
    const link = document.createElement('a');
    link.className = 'replay-game-link';
    link.href = meta.gameUrl;
    link.textContent = t('replay.viewGame');
    panel.details.append(link);
  }
}

export function timeControlLabelFromMeta(
  raw: Record<string, unknown> | null | undefined,
): string | null {
  if (!raw) return null;
  if (typeof raw.label === 'string' && raw.label.trim()) return raw.label.trim();
  if (raw.kind === 'none') return t('watch.untimed');

  const initialSeconds = numericValue(raw.initial_seconds);
  const incrementSeconds = numericValue(raw.increment_seconds);
  if (initialSeconds !== null) {
    const base = formatClock(initialSeconds * 1000);
    return incrementSeconds && incrementSeconds > 0
      ? `${base}+${Math.round(incrementSeconds)}`
      : base;
  }

  const initialMs = numericValue(raw.initialMs) ?? numericValue(raw.initial_ms);
  const incrementMs = numericValue(raw.incrementMs) ?? numericValue(raw.increment_ms);
  if (initialMs !== null) {
    const base = formatClock(initialMs);
    const increment = incrementMs ? Math.round(incrementMs / 1000) : 0;
    return increment > 0 ? `${base}+${increment}` : base;
  }

  const perMoveMs = numericValue(raw.milliseconds) ?? numericValue(raw.per_move_ms);
  if (raw.kind === 'per-move' && perMoveMs !== null) return `${formatClock(perMoveMs)} / move`;

  return typeof raw.kind === 'string' ? raw.kind : null;
}

export function thinkingBudgetMsFromMeta(
  raw: Record<string, unknown> | null | undefined,
): number | null {
  if (!raw) return null;
  const explicit =
    numericValue(raw.budgetMs) ??
    numericValue(raw.budget_ms) ??
    numericValue(raw.perMoveMs) ??
    numericValue(raw.per_move_ms) ??
    numericValue(raw.milliseconds);
  if (explicit !== null && explicit > 0) return explicit;

  const seconds =
    numericValue(raw.budgetSeconds) ??
    numericValue(raw.budget_seconds) ??
    numericValue(raw.per_move_seconds);
  if (seconds !== null && seconds > 0) return seconds * 1000;

  return null;
}

// Engine self-play games carry no clock; their per-move compute budget lives on
// the move events as `compute_ms`/`thinkTimeMs`. Recover it so the replay can
// render the per-move count-up (e.g. "3.2s / 5s") for clockless games whose
// stored metadata has no time control. The budget varies by run (5s, 13s, ...),
// so derive it from the data rather than assuming a constant: take the median of
// the moves that actually consumed time (ignoring instant/forced 0ms moves) and
// round to the nearest second. That lands on the run's true cap because the
// engine spends ~all of its allowance on most moves, while the median shrugs off
// both the fast moves and the occasional overshoot.
export function deriveThinkingBudgetMsFromEvents(events: readonly GameEvent[]): number | null {
  const spent: number[] = [];
  for (const event of events) {
    if (event.type !== 'move-played') continue;
    const ext = event as { compute_ms?: unknown; thinkTimeMs?: unknown };
    const ms = numericValue(ext.compute_ms) ?? numericValue(ext.thinkTimeMs);
    if (ms !== null && ms > 0) spent.push(ms);
  }
  if (spent.length === 0) return null;
  spent.sort((a, b) => a - b);
  const median = spent[Math.floor(spent.length / 2)]!;
  return Math.max(1000, Math.round(median / 1000) * 1000);
}

function winningSideFromResult(result: string): 'white' | 'black' | 'draw' {
  if (result === 'white-wins' || result === '1-0') return 'white';
  if (result === 'black-wins' || result === '0-1') return 'black';
  return 'draw';
}

function terminationDetailLabel(termination: string): string | null {
  const label = terminationLabel(termination).toLowerCase();
  if (!label || label === 'unknown') return null;
  return t('replay.byTermination', { termination: label });
}

function resultLabel(result: string): string {
  if (result === 'white-wins') return t('watch.whiteWins');
  if (result === 'black-wins') return t('watch.blackWins');
  return t('watch.draw');
}

function numericValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function infoItem(labelText: string, valueText: string): HTMLDivElement {
  const item = document.createElement('div');
  const label = document.createElement('span');
  label.textContent = labelText;
  const value = document.createElement('strong');
  value.textContent = valueText;
  item.append(label, value);
  return item;
}

// Lucide share-2 (ISC): three-node share graph (the shape the old hand-rolled
// icon approximated), unified to the 24-grid / 2px round spec shared with the
// flip icon and landing CTAs.
const ICON_SHARE =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>';
