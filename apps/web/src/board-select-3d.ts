// Selection marks on 3D pieces (xiangqi and jieqi boards). A flat piece is
// selected with a green wash under it and a capture target with a green ring
// round it; on a 3D piece both rings take in the rim and read as a halo around
// a cylinder (Brian, 2026-10-31: the rings "look weird" on 3D pieces). So a 3D
// piece is marked on the piece itself, as its last-move mark is (its edge in
// gold, board-lastmove.ts):
// - the selected piece: its side painted green (Brian, 2026-10-31, picked over
//   a green face, which muddied red art);
// - a capture target: its face tinted in the move-hint green;
// - a capture target under the mouse (hovered, or dragged over): the face tint
//   plus its side in green. Touch has no hover, so a tap just moves.
// Marks drawn over the pieces and over the gold edge, so green wins over gold.
// They take only the selected piece's legal targets, which the flat board
// already rings, so a face-down jieqi target reveals nothing new.
import {
  type BoardPoint,
  type RaisedPieceOutline,
  raisedPieceEdgeD,
  raisedPieceFaceSvg,
} from './board-lastmove.js';
import './board-select-3d.css';

/** Attributes for the group the 3D selection marks draw in: after the pieces
 *  and the gold edge, never a hit target. */
export const SELECT_3D_GROUP_ATTRS =
  'class="board-select3d" aria-hidden="true" pointer-events="none"';

/** The selected 3D piece: its side in green. */
export function select3dSelectedSvg(at: BoardPoint, outline: RaisedPieceOutline): string {
  return `<path class="board-select3d-edge" d="${raisedPieceEdgeD(at, outline)}"/>`;
}

/** A capture target's face, tinted in the move-hint green. */
export function select3dCaptureFaceSvg(at: BoardPoint, outline: RaisedPieceOutline): string {
  return raisedPieceFaceSvg(at, outline, 'class="board-select3d-face"');
}

/** The green side a capture target shows while the pointer is over it: drawn
 *  inside the target's hit group, shown by the group's :hover (CSS). */
export function select3dHoverEdgeSvg(at: BoardPoint, outline: RaisedPieceOutline): string {
  return `<path class="board-select3d-edge board-select3d-edge--hover" d="${raisedPieceEdgeD(at, outline)}"/>`;
}
