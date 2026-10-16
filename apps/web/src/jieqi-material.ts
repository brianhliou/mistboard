// Jieqi's rail material: each side's captured pool. Shared by the live room
// (live-jieqi.ts) and Mistboard TV's rail (watch-jieqi-replay.ts), so it imports
// nothing from the live room.
//
// Lichess convention: a player's captured material sits next to that player.
// The bottom strip is the viewer's side, so it shows the pieces the viewer has
// captured (the opponent's lost pieces); the top strip is the opponent's side,
// so it shows the pieces the opponent has captured (the viewer's lost pieces).
// A null role (a dark piece this view was never told the identity of) renders as
// the board's own face-down disc (the brown / green back), grouped with a count,
// not a "?" token: the pool then reads in the board's vocabulary.
//
// Jieqi does NOT render the "still face-down" pool the other flip variants do
// (hidden-pool-panel.ts): under capturer-only reveal the viewer's own pool cannot
// be computed (the dark pieces the opponent took are unknown to them), and a row
// that lists pieces which may already be gone was read as a bug (2026-09-20). The
// strips carry the same facts; the player does the subtraction. The pool slot is
// cleared so a variant switch never leaves a stale panel behind.
//
// This draws only what the view carries. Whose knowledge that is (a seat's own
// view, the spectator's public view, a finished game's truth) is the server's
// decision; nothing here can add an identity the view lacks.
import type { JieqiColor, JieqiPieceRole } from '@mistboard/game';
import { fillCapturedPoolWith } from './review/captured-pool.js';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import { renderXiangqiPieceGlyphed } from './xiangqi-piece-sets.js';

/** The rail regions the material fills (the shared game table's slots). */
export type JieqiMaterialSlots = {
  capturesTop: HTMLElement;
  capturesBottom: HTMLElement;
  hiddenPool: HTMLElement;
};

/** The view fields the material reads: the live wire view and the watch
 *  payload's per-ply view both carry them. */
export type JieqiMaterialView = {
  board: Partial<Record<string, unknown>>;
  captured: ReadonlyArray<{ owner: JieqiColor; role: JieqiPieceRole | null }>;
};

export function renderJieqiMaterial(
  slots: JieqiMaterialSlots,
  view: JieqiMaterialView | null,
  viewer: JieqiColor,
): void {
  slots.capturesTop.replaceChildren();
  slots.capturesBottom.replaceChildren();
  slots.hiddenPool.replaceChildren();
  // No view yet (or an empty board) must not read as "everything still
  // face-down". A spectator's view is the public one since 2026-09-20: the same
  // masked board, and captures with a role only where the piece was face-up
  // when taken, so the pools below render for a spectator exactly as they do
  // for the victim of each capture.
  if (!view || Object.keys(view.board).length === 0) return;
  const pieceSet = readStoredXiangqiPieceSet();
  const glyph = (entry: { color: JieqiColor; role: JieqiPieceRole }): string =>
    renderXiangqiPieceGlyphed(entry, pieceSet, { ariaLabel: `${entry.color} ${entry.role}` });
  const hidden = (color: JieqiColor): string =>
    renderXiangqiPieceGlyphed({ color, role: 'soldier' }, pieceSet, {
      ariaLabel: `${color} hidden piece`,
      shrouded: true,
      shroudedStyle: 'back',
    });
  const opponent: JieqiColor = viewer === 'red' ? 'black' : 'red';
  fillCapturedPoolWith(slots.capturesTop, view.captured, viewer, glyph, hidden);
  fillCapturedPoolWith(slots.capturesBottom, view.captured, opponent, glyph, hidden);
}
