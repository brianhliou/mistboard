/**
 * Small DOM builders shared by the tenant room chrome. Pure element factories,
 * no variant or live-state knowledge.
 */

import { t } from '../i18n/catalog.js';

export function infoItem(label: string, value: string): HTMLDivElement {
  const item = document.createElement('div');
  const key = document.createElement('span');
  const val = document.createElement('strong');
  key.textContent = label;
  val.textContent = value;
  item.append(key, val);
  return item;
}

export function noticeTitle(text: string): HTMLElement {
  const el = document.createElement('strong');
  el.textContent = text;
  return el;
}

export function noticeBody(text: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}

export function presenceDot(connected: boolean): HTMLSpanElement {
  const dot = document.createElement('span');
  dot.className = `presence-dot ${connected ? 'is-online' : 'is-offline'}`;
  const label = connected ? t('live.connConnected') : t('live.connDisconnected');
  dot.setAttribute('aria-label', label);
  dot.title = label;
  return dot;
}

export function roomLink(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = label;
  return link;
}

export function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

// Per-list memory for live auto-follow: the last ply count we rendered and
// whether the list was live. Keyed by the list element so each tenant room
// tracks its own state and nothing needs an explicit reset between games (a new
// game reuses the element with a smaller ply count, which reads as "changed").
const moveListFollowState = new WeakMap<HTMLOListElement, { plyCount: number; wasLive: boolean }>();

// Should the live move list jump to the latest move? Mirrors the chess shell's
// shouldAutoScrollMoveList: follow on the first render, when returning from a
// scrubbed position to live, and when the ply count changes (a move arrived, or
// the game reset). Staying put on an unchanged live render keeps a viewer who
// scrolled up from being yanked on every clock tick.
export function shouldFollowLatestMove(
  next: { live: boolean; plyCount: number },
  prev: { plyCount: number; wasLive: boolean } | undefined,
): boolean {
  if (!next.live || next.plyCount === 0) return false;
  if (!prev) return true;
  if (!prev.wasLive) return true;
  return next.plyCount !== prev.plyCount;
}

// Keep the relevant move visible inside the fixed-height move list. While
// scrubbing, center the highlighted (`.active`) ply. While live, follow the
// latest move to the bottom as new moves arrive (see shouldFollowLatestMove) so
// the move list always shows the move just played. Pass `state` to opt into
// live-follow; omit it for scrub-only centering.
export function syncMoveListScroll(
  list: HTMLOListElement,
  state?: { live: boolean; plyCount: number },
): void {
  if (typeof list.scrollTo !== 'function') return;
  // Decide and record synchronously, against the state at render time; only the
  // DOM read/write is deferred to the next frame.
  const follow = state ? shouldFollowLatestMove(state, moveListFollowState.get(list)) : false;
  if (state) moveListFollowState.set(list, { plyCount: state.plyCount, wasLive: state.live });
  window.requestAnimationFrame(() => {
    const active = list.querySelector<HTMLElement>('.active');
    if (active) {
      const listRect = list.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const centeredDelta =
        activeRect.top - listRect.top - (list.clientHeight - activeRect.height) / 2;
      list.scrollTo({ top: Math.max(0, list.scrollTop + centeredDelta), behavior: 'auto' });
      return;
    }
    if (follow) list.scrollTop = list.scrollHeight;
  });
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
