/**
 * The four replay scrub arrows, in one place because there are three toolbars:
 * the standalone replay/review moves panel (replay-moves-panel.ts), the live
 * room's boxed game table (game-table.ts), and Mistboard TV, which mounts the
 * same table. The room's toolbar rendered ASCII text (`|<`, `<`, `>`, `>|`)
 * until 2026-09-10 while the other two already drew these glyphs.
 *
 * Deliberately NOT in ui-icon.ts: that set is Lucide line glyphs, and these are
 * filled transport marks. Mixing the two weights in one 30px control row is
 * what makes a toolbar look assembled rather than drawn.
 */
export type ReplayStepAction = 'first' | 'prev' | 'next' | 'latest';

export const REPLAY_ICON_FIRST =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 3h1.5v10H4zM6.5 8l5-4v8z" fill="currentColor"/></svg>';
export const REPLAY_ICON_PREV =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M11 3.5v9L5 8z" fill="currentColor"/></svg>';
export const REPLAY_ICON_NEXT =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 3.5v9L11 8z" fill="currentColor"/></svg>';
export const REPLAY_ICON_LAST =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.5 3H12v10h-1.5zM4.5 12V4l5 4z" fill="currentColor"/></svg>';

export const REPLAY_STEPS: ReadonlyArray<{
  action: ReplayStepAction;
  icon: string;
  label: string;
  title: string;
}> = [
  { action: 'first', icon: REPLAY_ICON_FIRST, label: 'First move', title: 'First position' },
  { action: 'prev', icon: REPLAY_ICON_PREV, label: 'Previous move', title: 'Previous event' },
  { action: 'next', icon: REPLAY_ICON_NEXT, label: 'Next move', title: 'Next event' },
  { action: 'latest', icon: REPLAY_ICON_LAST, label: 'Last move', title: 'Latest position' },
];
