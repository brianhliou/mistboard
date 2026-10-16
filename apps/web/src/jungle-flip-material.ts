// Flip Jungle's rail material: each side's captured animals and the face-down
// pool under them. Shared by the live room (live-jungle-flip.ts) and Mistboard
// TV's rail (watch-jungle-flip-replay.ts), so it imports nothing from the live room.
import {
  type JungleFlipCapture,
  type JungleFlipColor,
  type JungleFlipPieceRole,
  type JungleFlipPlayerBoard,
  jungleFlipHiddenPool,
} from '@mistboard/game';
import { renderHiddenPoolPanel } from './hidden-pool-panel.js';
import { t } from './i18n/catalog.js';
import { jungleFlipPieceGhostSvg } from './jungle-flip-render.js';
import { fillCapturedPoolWith } from './review/captured-pool.js';

/** The rail regions the material fills (the shared game table's slots). */
export type JungleFlipMaterialSlots = {
  capturesTop: HTMLElement;
  capturesBottom: HTMLElement;
  hiddenPool: HTMLElement;
};

/** The masked view fields the material reads: the live wire view and the
 *  postgame per-ply view both carry them. */
export type JungleFlipMaterialView = {
  board: JungleFlipPlayerBoard;
  captured: readonly JungleFlipCapture[];
};

// `viewerInk` is the bottom side's ink, null before the opening flip binds it:
// nothing can have been captured yet, and the pool rows fall back to
// red-then-blue since no seat owns an ink.
export function renderJungleFlipMaterial(
  slots: JungleFlipMaterialSlots,
  view: JungleFlipMaterialView | null,
  viewerInk: JungleFlipColor | null,
): void {
  slots.capturesTop.replaceChildren();
  slots.capturesBottom.replaceChildren();
  slots.hiddenPool.replaceChildren();
  // No view yet (or an empty board) must not read as "everything still
  // face-down". A spectator's view is the shared masked board since 2026-09-20
  // (Flip Jungle is symmetric), so the pools below render for a spectator too.
  if (!view || Object.keys(view.board).length === 0) return;
  const glyph = (entry: { color: JungleFlipColor; role: JungleFlipPieceRole }): string =>
    jungleFlipPieceGhostSvg(entry);
  if (viewerInk !== null) {
    const opponentInk: JungleFlipColor = viewerInk === 'red' ? 'black' : 'red';
    fillCapturedPoolWith(slots.capturesTop, view.captured, viewerInk, glyph);
    fillCapturedPoolWith(slots.capturesBottom, view.captured, opponentInk, glyph);
  }
  // Rows follow the board: the opponent's ink on top, the viewer's below.
  const top: JungleFlipColor =
    viewerInk === 'black' ? 'red' : viewerInk === 'red' ? 'black' : 'red';
  const bottom: JungleFlipColor = top === 'red' ? 'black' : 'red';
  const pool = jungleFlipHiddenPool(view);
  renderHiddenPoolPanel(
    slots.hiddenPool,
    [
      { color: top, label: jungleFlipInkLabel(top), side: pool[top] },
      { color: bottom, label: jungleFlipInkLabel(bottom), side: pool[bottom] },
    ],
    glyph,
  );
}

// The Jungle family brands its navy ink "Blue" (internal ink id stays 'black').
function jungleFlipInkLabel(ink: JungleFlipColor): string {
  return t(ink === 'red' ? 'setup.red' : 'setup.blue');
}
