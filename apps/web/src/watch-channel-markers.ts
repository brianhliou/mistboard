import type { VariantMiniId } from './variant-mini-boards.js';

// The shared variant marker for each watch channel, so the TV rail (/watch) and
// the current-games grid (/games) read in the same icon language as the
// picker, rules rail, leaderboard, and profile. Channel ids match VariantMiniId
// ids; the dark-chess channel shows the dark-chess marker. An unmapped channel
// keeps its (empty) marker slot so the rows stay grid-aligned.
//
// A leaf module so /games does not pull the 2,000-line watch module into its
// chunk. It was two hand-kept copies for that reason, and the /games copy
// missed duck-xiangqi until the launch audit (aa91538e).
// variant-registry-sync.test.ts fails for a server watch channel with no entry.
export const WATCH_CHANNEL_MINI_IDS: Readonly<Record<string, VariantMiniId>> = {
  'dark-chess': 'dark-chess',
  xiangqi: 'xiangqi',
  'dark-xiangqi': 'dark-xiangqi',
  'fortress-xiangqi': 'fortress-xiangqi',
  'duck-xiangqi': 'duck-xiangqi',
  'atomic-xiangqi': 'atomic-xiangqi',
  'crazyhouse-xiangqi': 'crazyhouse-xiangqi',
  jieqi: 'jieqi',
  banqi: 'banqi',
  jungle: 'jungle',
  'jungle-flip': 'jungle-flip',
};
