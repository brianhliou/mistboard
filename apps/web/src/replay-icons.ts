/**
 * The move-navigation icon set, in one place: the shared move-nav bar
 * (move-nav-bar.ts) draws these on every surface that steps through moves, and
 * the standalone replay panel (replay-moves-panel.ts) draws the same marks.
 *
 * Deliberately NOT in ui-icon.ts: that set is Lucide line glyphs, and these are
 * filled transport marks. Mixing the two weights in one control row is what
 * makes a toolbar look assembled rather than drawn.
 */
export type ReplayStepAction = 'first' | 'prev' | 'next' | 'latest';

// Solid, rounded transport marks on a 24px grid (lichess weight): first/last
// pair a bar with a double triangle so the jump ends read apart from one step.
export const REPLAY_ICON_FIRST =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3.5" y="5.5" width="2.2" height="13" rx="0.6"/><path d="M13 6v12l-6.2-6z"/><path d="M20 6v12l-6.2-6z"/></g></svg>';
export const REPLAY_ICON_PREV =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M16 5.5v13L7.5 12z"/></svg>';
export const REPLAY_ICON_NEXT =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M8 5.5v13l8.5-6.5z"/></svg>';
export const REPLAY_ICON_LAST =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 6v12l6.2-6z"/><path d="M11 6v12l6.2-6z"/><rect x="18.3" y="5.5" width="2.2" height="13" rx="0.6"/></g></svg>';

// The bar's fifth column, the page menu: stroked at the magnifier's weight so
// it sits with the solid marks.
export const REPLAY_ICON_MENU =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15"/></svg>';

// Open the finished game's review at the move on screen (lichess's microscope).
// A plain magnifier, stroked heavy enough to sit with the solid marks.
export const REPLAY_ICON_ANALYSIS =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6" stroke-width="2.6"/><path d="M15 15l5 5" stroke-width="3.2"/></svg>';

// Flip board: two solid arrows, one up and one down.
export const REPLAY_ICON_FLIP =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M7.5 3.5 3 9h3.2v11.5h2.6V9H12z"/><path d="M16.5 20.5 21 15h-3.2V3.5h-2.6V15H12z"/></g></svg>';

/** The four steps in bar order. Labels are catalog keys, read through t() when
 *  the bar is built, so a zh page gets zh tooltips and aria-labels. */
export const REPLAY_STEPS: ReadonlyArray<{
  action: ReplayStepAction;
  icon: string;
  labelKey: 'review.navFirst' | 'review.navPrevious' | 'review.navNext' | 'review.navLast';
}> = [
  { action: 'first', icon: REPLAY_ICON_FIRST, labelKey: 'review.navFirst' },
  { action: 'prev', icon: REPLAY_ICON_PREV, labelKey: 'review.navPrevious' },
  { action: 'next', icon: REPLAY_ICON_NEXT, labelKey: 'review.navNext' },
  { action: 'latest', icon: REPLAY_ICON_LAST, labelKey: 'review.navLast' },
];
