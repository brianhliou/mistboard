// Banqi's rail material: each side's captured pool and the face-down pool under
// them. Shared by the live room (live-banqi.ts) and Mistboard TV's rail
// (watch-banqi-replay.ts), so it imports nothing from the live room.
//
// Lichess convention: a player's captured material sits next to that player.
// The bottom strip is the viewer's side, so it shows the pieces the viewer has
// captured (the opponent's lost pieces); the top strip is the opponent's side,
// so it shows the pieces the opponent has captured (the viewer's lost pieces).
// Captures are always REVEALED in banqi (adjacency and cannon both require a
// revealed target), so every captured piece has a known identity and there is
// no "?" case. Under the strips, the face-down pool lists what each ink still
// has unrevealed: public arithmetic (start minus revealed minus captured) that
// the player would otherwise do by hand.
//
// Three Kingdoms banqi (live-three-kingdoms-banqi.ts) renders the same material:
// the same 32 pieces, revealed captures and face-down tiles that never move,
// only on a 9x5 grid, so the view is generic over the square type.
import type { BanqiCapturedView, BanqiColor, BanqiPieceRole, BanqiSquare } from '@mistboard/game';
import { type BanqiFamilyBoard, banqiFaceDownAtEnd, banqiRevealOdds } from './banqi-reveal-odds.js';
import { renderHiddenPoolPanel } from './hidden-pool-panel.js';
import { t } from './i18n/catalog.js';
import { fillCapturedPoolWith } from './review/captured-pool.js';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import { renderXiangqiPieceGlyphed } from './xiangqi-piece-sets.js';

/** The rail regions the material fills (the shared game table's slots). */
export type BanqiMaterialSlots = {
  capturesTop: HTMLElement;
  capturesBottom: HTMLElement;
  hiddenPool: HTMLElement;
};

/** The masked view fields the material reads: the live wire view and the
 *  postgame per-ply view both carry them. */
export type BanqiMaterialView<S extends string = BanqiSquare> = {
  board: BanqiFamilyBoard<S>;
  captured: readonly BanqiCapturedView[];
  status: { type: string };
  ply: number;
};

// `viewerInk` is the bottom side's ink, null before the opening flip binds it:
// nothing can have been captured yet, and the pool rows fall back to
// red-then-black since no seat owns an ink.
//
// `moves` is the game's move log. A finished room's truth view has every tile
// face up, which would empty the tally (#544); the log recovers which tiles were
// still face-down when play ended, and the tally keeps showing those.
export function renderBanqiMaterial<S extends string, V extends BanqiMaterialView<S>>(
  slots: BanqiMaterialSlots,
  view: V | null,
  viewerInk: BanqiColor | null,
  moves: readonly { from: S; to: S }[] = [],
): void {
  slots.capturesTop.replaceChildren();
  slots.capturesBottom.replaceChildren();
  slots.hiddenPool.replaceChildren();
  // No view yet (or an empty board) must not read as "everything still
  // face-down". A spectator's view is the shared masked board since 2026-09-20
  // (banqi is symmetric), so the pools below render for a spectator too.
  if (!view || Object.keys(view.board).length === 0) return;
  const pieceSet = readStoredXiangqiPieceSet();
  const glyph = (entry: { color: BanqiColor; role: BanqiPieceRole }): string =>
    renderXiangqiPieceGlyphed(entry, pieceSet, { ariaLabel: `${entry.color} ${entry.role}` });
  if (viewerInk !== null) {
    const opponentInk: BanqiColor = viewerInk === 'red' ? 'black' : 'red';
    fillCapturedPoolWith(slots.capturesTop, view.captured, viewerInk, glyph);
    fillCapturedPoolWith(slots.capturesBottom, view.captured, opponentInk, glyph);
  }
  // Rows follow the board: the opponent's ink on top, the viewer's below.
  const top: BanqiColor = viewerInk === 'black' ? 'red' : viewerInk === 'red' ? 'black' : 'red';
  const bottom: BanqiColor = top === 'red' ? 'black' : 'red';
  const finished = view.status.type === 'finished';
  const poolView = finished ? banqiFaceDownAtEnd<S, V>(view, moves) : view;
  if (!poolView) return;
  const odds = banqiRevealOdds(poolView);
  renderHiddenPoolPanel(
    slots.hiddenPool,
    [
      { color: top, label: banqiInkLabel(top), side: odds.pool[top] },
      { color: bottom, label: banqiInkLabel(bottom), side: odds.pool[bottom] },
    ],
    glyph,
    // While the game is on, each disc carries its reveal odds (#542); a finished
    // game's tally is a record of what stayed hidden, so it carries none.
    finished
      ? { caption: t('live.faceDownAtEnd') }
      : view.status.type === 'playing' && odds.total > 0
        ? { caption: t('live.revealOdds.couldBe', { count: odds.total }), odds }
        : {},
  );
}

function banqiInkLabel(ink: BanqiColor): string {
  return t(ink === 'red' ? 'setup.red' : 'setup.black');
}
