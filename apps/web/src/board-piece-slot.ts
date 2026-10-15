// A keyed piece slot for the article diagrams, the same on every board family.
//
// The slot is the `<g>` a glide animates (board-anim.ts contract): it names the
// square its piece stands on and carries the piece's centre in the board's
// viewBox units, written by the renderer that already knows the geometry. A
// step-through card then glides a move from the DOM alone, with no per-variant
// cell maths, and a flipped board or another layout costs it nothing.

export type PieceSlotCentre = { x: number; y: number };

/** Wrap a drawn piece in its keyed slot. `className` keeps a family's own
 *  selector (`xq-diagram-piece-slot`) for the code that already reads it. */
export function pieceSlot(
  square: string,
  centre: PieceSlotCentre,
  pieceSvg: string,
  className = 'diagram-piece-slot',
): string {
  return `<g class="${className}" data-piece-square="${square}" data-piece-cx="${centre.x}" data-piece-cy="${centre.y}">${pieceSvg}</g>`;
}

/** The slot standing on `square`, or null when the square is empty. */
export function findPieceSlot(root: ParentNode, square: string): Element | null {
  return root.querySelector(`[data-piece-square="${square}"]`);
}

/** The centre a slot was drawn at, or null for a slot without one. */
export function pieceSlotCentre(slot: Element | null): PieceSlotCentre | null {
  const cx = slot?.getAttribute('data-piece-cx');
  const cy = slot?.getAttribute('data-piece-cy');
  if (!cx || !cy) return null;
  const x = Number(cx);
  const y = Number(cy);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
