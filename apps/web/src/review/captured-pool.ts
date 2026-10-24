import './captured-pool.css';

// Generic captured-material pool: ONE renderer for every surface that lists
// pieces a side has lost, whatever the board draws them with. The caller supplies
// the single-piece renderer so the pool always matches its own board (xiangqi
// glyph sets, jungle animal tokens, dark-xiangqi characters). Repeats of a role
// collapse to one glyph + a count badge so a full pool stays inside the board
// width. The caller clears the host (per strip) before filling.
//
// A `role: null` entry is a piece the viewer knows is gone but was never told
// the identity of (jieqi: your own dark piece, taken by the opponent). Those
// group together and draw through `renderHidden`; a caller whose variant has no
// such case leaves it out, and any null it is handed is then skipped rather than
// drawn wrong.

export function fillCapturedPoolWith<Color extends string, Role extends string>(
  host: HTMLElement,
  captured: ReadonlyArray<{ owner: Color; role: Role | null }>,
  owner: Color,
  renderPiece: (entry: { color: Color; role: Role }) => string,
  renderHidden?: (color: Color) => string,
): void {
  const mine = captured.filter(
    (entry) => entry.owner === owner && (entry.role !== null || renderHidden !== undefined),
  );
  host.classList.toggle('has-captures', mine.length > 0);
  if (mine.length === 0) return;
  const order: (Role | null)[] = [];
  const counts = new Map<Role | null, number>();
  for (const entry of mine) {
    if (!counts.has(entry.role)) order.push(entry.role);
    counts.set(entry.role, (counts.get(entry.role) ?? 0) + 1);
  }
  const row = document.createElement('div');
  row.className = 'captures-row review-captures-row';
  for (const role of order) {
    const count = counts.get(role) ?? 1;
    const label = role === null ? `${owner} hidden piece` : `${owner} ${role}`;
    const span = document.createElement('span');
    span.className = count > 1 ? 'review-capture-piece has-count' : 'review-capture-piece';
    span.setAttribute('aria-label', count > 1 ? `${label} x${count}` : label);
    span.innerHTML =
      role === null
        ? (renderHidden as (color: Color) => string)(owner)
        : renderPiece({ color: owner, role });
    if (count > 1) span.append(countBadge(count));
    row.append(span);
  }
  host.append(row);
}

/** The stacked-count sticker shared by capture pools and the face-down pool. */
export function countBadge(count: number): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'captures-count-badge';
  badge.textContent = String(count);
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

/** Pieces removed since this tree's root. Open variants have no capture ledger;
 *  comparing with their seeded root avoids calling absent setup pieces captures.
 *  Only for variants without promotions, drops or changes of identity. */
export function capturedBetweenBoards<Color extends string, Role extends string>(
  root: Partial<Record<string, { color: Color; role: Role }>>,
  board: Partial<Record<string, { color: Color; role: Role }>>,
): { owner: Color; role: Role }[] {
  const remaining = new Map<string, number>();
  for (const piece of Object.values(board)) {
    if (!piece) continue;
    const key = `${piece.color}:${piece.role}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const captured: { owner: Color; role: Role }[] = [];
  for (const piece of Object.values(root)) {
    if (!piece) continue;
    const key = `${piece.color}:${piece.role}`;
    const count = remaining.get(key) ?? 0;
    if (count > 0) remaining.set(key, count - 1);
    else captured.push({ owner: piece.color, role: piece.role });
  }
  return captured;
}
