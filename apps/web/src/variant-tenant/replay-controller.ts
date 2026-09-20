/**
 * Generic fog-safe replay controller for tenant live rooms: an index-based
 * scrubber over per-recipient view snapshots. The CAPTURE policy (when a new
 * snapshot exists, how plies are derived under fog) stays tenant-owned — the
 * tenant pushes {ply, view} snapshots; this owns the index state, the
 * shell/keyboard controls, and the meta label.
 *
 * Extracted from the Dark Mini Xiangqi room; the label and control-disabling
 * semantics are pinned by its vitest suite.
 */

import type { LiveRefs } from '../live-state.js';
import { isEditableKeyboardTarget } from './chrome-dom.js';

export type TenantReplaySnapshot<View> = { ply: number; view: View };

export type TenantReplayController<View> = {
  reset(): void;
  push(snapshot: TenantReplaySnapshot<View>): void;
  /**
   * Replace the whole snapshot history (a tenant rebuilt per-ply views from
   * the event log after mount/reconnect). A live client stays live; a
   * scrubbed client re-anchors to the same ply in the new history (back to
   * live when the ply no longer exists).
   */
  replaceHistory(snapshots: readonly TenantReplaySnapshot<View>[]): void;
  /**
   * Scrub straight to a ply (clickable move-list jump). Jumping to the latest
   * ply, or past it, returns to live. Records the transition for the one-shot
   * animation channel like every other control.
   */
  jumpToPly(ply: number): void;
  historyLength(): number;
  latestPly(): number;
  isLive(): boolean;
  /** The view to display: the scrubbed snapshot, or the live view when live. */
  currentView(liveView: View | null): View | null;
  /** Visible ply ceiling for move lists (scrubbed ply, or the latest). */
  visiblePlyCount(): number;
  /** The scrubbed ply for active-move highlighting, or null when live. */
  activePly(): number | null;
  metaLabel(): string;
  controlDisabled(action: string): boolean;
  handleControl(action: string): void;
  /**
   * One-shot: the ply transition of the most recent scrub control (buttons or
   * keyboard), consumed by the render that follows it. Null when nothing was
   * scrubbed since the last take. Adjacent single-ply transitions are what the
   * animation channel turns into a forward/back glide.
   */
  takeLastStep(): { fromPly: number; toPly: number } | null;
  /** Wire the shared replay buttons + meta line; onChange re-renders the room. */
  renderShell(refs: LiveRefs, onChange: () => void): void;
  handleKeyboard(event: KeyboardEvent, onChange: () => void): void;
};

export function createTenantReplayController<View>(): TenantReplayController<View> {
  let replayIndex: number | null = null;
  let history: TenantReplaySnapshot<View>[] = [];
  let lastStep: { fromPly: number; toPly: number } | null = null;

  function reset(): void {
    replayIndex = null;
    history = [];
    lastStep = null;
  }

  function currentPly(): number {
    if (replayIndex === null) return latestPly();
    return history[replayIndex]?.ply ?? latestPly();
  }

  function push(snapshot: TenantReplaySnapshot<View>): void {
    history.push(snapshot);
  }

  function replaceHistory(snapshots: readonly TenantReplaySnapshot<View>[]): void {
    const scrubbedPly = replayIndex === null ? null : (history[replayIndex]?.ply ?? null);
    history = [...snapshots];
    if (scrubbedPly === null) {
      replayIndex = null;
      return;
    }
    // Snapshots are ply-ascending: re-anchor to the first snapshot at or past
    // the old scrub position; a position at (or beyond) the new tip is live.
    const index = history.findIndex((snapshot) => snapshot.ply >= scrubbedPly);
    replayIndex = index === -1 || index >= history.length - 1 ? null : index;
  }

  function jumpToPly(ply: number): void {
    const fromPly = currentPly();
    applyJump(ply);
    const toPly = currentPly();
    lastStep = fromPly === toPly ? lastStep : { fromPly, toPly };
  }

  function applyJump(ply: number): void {
    if (history.length === 0) {
      replayIndex = null;
      return;
    }
    let index = history.findIndex((snapshot) => snapshot.ply >= ply);
    if (index === -1) index = history.length - 1;
    replayIndex = index >= history.length - 1 ? null : index;
  }

  function historyLength(): number {
    return history.length;
  }

  function latestPly(): number {
    return history.at(-1)?.ply ?? 0;
  }

  function isLive(): boolean {
    return replayIndex === null || replayIndex >= history.length - 1;
  }

  function currentView(liveView: View | null): View | null {
    if (replayIndex === null) return liveView;
    return history[replayIndex]?.view ?? liveView;
  }

  function visiblePlyCount(): number {
    if (replayIndex !== null) return history[replayIndex]?.ply ?? 0;
    return latestPly();
  }

  function activePly(): number | null {
    if (replayIndex === null) return null;
    return history[replayIndex]?.ply ?? null;
  }

  function metaLabel(): string {
    const total = latestPly();
    if (total === 0) return 'Live · ply 0 of 0';
    if (isLive()) return `Live · ply ${total} of ${total}`;
    return `Replay · ply ${visiblePlyCount()} of ${total}`;
  }

  function controlDisabled(action: string): boolean {
    if (history.length <= 1) return action !== 'latest';
    const current = replayIndex ?? history.length - 1;
    if (action === 'latest') return isLive();
    if (action === 'next') return isLive();
    if (action === 'first') return current <= 0;
    if (action === 'prev') return current <= 0;
    return true;
  }

  function handleControl(action: string): void {
    const fromPly = currentPly();
    applyControl(action);
    const toPly = currentPly();
    // Record every scrub transition (including no-ops, which the consumer
    // filters out as non-adjacent); one-shot, drained by takeLastStep().
    lastStep = fromPly === toPly ? lastStep : { fromPly, toPly };
  }

  function applyControl(action: string): void {
    if (action === 'latest') {
      replayIndex = null;
      return;
    }
    if (history.length === 0) {
      replayIndex = null;
      return;
    }
    const current = replayIndex ?? history.length - 1;
    if (action === 'first') replayIndex = 0;
    if (action === 'prev') replayIndex = Math.max(0, current - 1);
    if (action === 'next') {
      const next = current + 1;
      replayIndex = next >= history.length - 1 ? null : next;
    }
  }

  function takeLastStep(): { fromPly: number; toPly: number } | null {
    const step = lastStep;
    lastStep = null;
    return step;
  }

  function renderShell(refs: LiveRefs, onChange: () => void): void {
    refs.replayMeta.textContent = metaLabel();
    for (const button of refs.replayControls) {
      const action = button.dataset.replay ?? '';
      button.disabled = controlDisabled(action);
      // The scrubbed state lives on the controls (the "Last move" button lights
      // up via CSS) rather than in a notice row, so stepping back never changes
      // the rail's height. A seated player's board click also returns to live
      // (live-client). Set on the button itself: the controls root is not on
      // every LiveRefs shape that reaches this shell.
      button.classList.toggle('replay-controls__return', action === 'latest' && !isLive());
      button.onclick = () => {
        handleControl(action);
        onChange();
      };
    }
  }

  function handleKeyboard(event: KeyboardEvent, onChange: () => void): void {
    if (event.defaultPrevented || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey)
      return;
    if (isEditableKeyboardTarget(event.target)) return;

    const action = replayActionForKey(event.key);
    if (!action || controlDisabled(action)) return;

    event.preventDefault();
    handleControl(action);
    onChange();
  }

  return {
    reset,
    push,
    replaceHistory,
    jumpToPly,
    historyLength,
    latestPly,
    isLive,
    currentView,
    visiblePlyCount,
    activePly,
    metaLabel,
    controlDisabled,
    handleControl,
    takeLastStep,
    renderShell,
    handleKeyboard,
  };
}

function replayActionForKey(key: string): string | null {
  if (key === 'ArrowLeft') return 'prev';
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowUp') return 'first';
  if (key === 'ArrowDown') return 'latest';
  return null;
}
