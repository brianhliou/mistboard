// Display aspect ratio (width / height) of each watchable variant's board, used
// ONLY to size the renderer-swap skeleton so the board slot reserves the right
// box before the real board mounts. Without it every skeleton is square and a
// channel switch shifts layout twice: once when the square placeholder replaces
// the outgoing board, once when the new board's true height lands. Measured CLS
// on a /watch channel switch was 0.137 (six shifts) before this existed.
//
// The numbers deliberately DUPLICATE each renderer's own FILES/RANKS constants
// rather than importing them: this module is reachable from the entry chunk (the
// same bundle-discipline rule showcase-dispatch.ts documents), and pulling in a
// renderer would drag chessground and every board module into module-init.
// watch-board-aspect.test.ts asserts every watchable channel spec has an entry,
// so a new variant can't silently fall back.
//
// The fallback is a NEUTRAL square, not another variant's geometry: this is
// cosmetic placeholder sizing, so it is not a variant-dispatch surface and an
// unknown id must not throw here (a channel whose board we can't pre-size still
// has to render).

// Nominal drawn board, in cells across x cells down. Xiangqi-family boards vary
// a few percent with the user's intersection-vs-cell layout preference; the
// nominal point grid is close enough for a placeholder.
import { hasOwnKey } from '@mistboard/game';

const BOARD_ASPECT_BY_SPEC_ID: Readonly<Record<string, number>> = {
  // Xiangqi family: 9 files x 10 ranks.
  xiangqi: 9 / 10,
  jieqi: 9 / 10,
  'dark-xiangqi': 9 / 10,
  'duck-xiangqi': 9 / 10,
  // Fortress xiangqi: 7 x 8 (fortress-xiangqi-render.ts).
  'fortress-xiangqi': 7 / 8,
  'mini-open-xiangqi': 1,
  // Banqi: 8 x 4, the one wide board on the rail (live-banqi-render.ts).
  banqi: 8 / 4,
  // Chess-geometry boards: 8 x 8 (dark-chess-render.ts).
  'dark-chess': 1,
  'dark-draft960': 1,
  kriegspiel: 1,
  'dark-crazyhouse': 1,
  // Jungle: 7 x 9 (jungle-render.ts). Flip jungle: 4 x 4 (jungle-flip-render.ts).
  jungle: 7 / 9,
  'jungle-flip': 1,
  // Luzhanqi rides its own renderer (5x12).
  luzhanqi: 5 / 12,
};

// A neutral square, used when a spec has no entry. Never another variant's ratio.
export const DEFAULT_BOARD_ASPECT = 1;

export function boardAspectForSpec(specId: string | null | undefined): number {
  if (!specId) return DEFAULT_BOARD_ASPECT;
  return BOARD_ASPECT_BY_SPEC_ID[specId] ?? DEFAULT_BOARD_ASPECT;
}

// The value for a CSS `aspect-ratio` declaration.
export function boardAspectRatioCss(specId: string | null | undefined): string {
  return `${boardAspectForSpec(specId)}`;
}

export function hasBoardAspect(specId: string): boolean {
  return hasOwnKey(BOARD_ASPECT_BY_SPEC_ID, specId);
}
