/**
 * The in-game action row's marks (variant-tenant/room-chrome.ts, #530): a
 * flag for resign, an X for abort and decline, a check for confirm and accept.
 * Offer draw is the text glyph ½, as on lichess.
 *
 * Filled and heavy-stroked on the 24px grid, the weight of the move-nav marks
 * (replay-icons.ts) the row sits beside, not the Lucide line set (ui-icon.ts).
 */

export const GAME_ACTION_ICON_FLAG =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-linejoin="round"><rect x="4.6" y="3" width="2.2" height="18.5" rx="1" stroke-width="0.6"/><path d="M7.5 4.5c3.6-1.6 6.4 1.6 11.5 0v8.5c-5.1 1.6-7.9-1.6-11.5 0z" stroke-width="1.4"/></g></svg>';

export const GAME_ACTION_ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>';

export const GAME_ACTION_ICON_CROSS =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
