/** Exact deal-in risk under a neutral, uniformly dealt concealed-hand prior. */
import {
  tilePiece,
  XMJ_COPIES,
  XMJ_HAND_SIZE,
  XMJ_TILE_KINDS,
  type XmjMeld,
  type XmjTile,
  xmjWinShape,
} from './xiangqi-mahjong.js';

type Requirement = readonly [XmjTile, number];
const waits = new Map<string, readonly (readonly Requirement[])[]>();

function choose(n: number, k: number): number {
  if (k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - i + 1)) / i;
  return result;
}

/** Enumerate distinct face multisets once, not once per possible winning split. */
function waitingHands(discard: XmjTile, size: number, melds: readonly XmjMeld[]) {
  const key = `${discard}:${size}`;
  const cached = waits.get(key);
  if (cached) return cached;
  const out: Requirement[][] = [];
  const hand: XmjTile[] = [];
  const visit = (start: number) => {
    if (hand.length === size) {
      if (!xmjWinShape([...hand, discard], melds)) return;
      const counts = new Map<XmjTile, number>();
      for (const tile of hand) counts.set(tile, (counts.get(tile) ?? 0) + 1);
      out.push([...counts]);
      return;
    }
    for (let i = start; i < XMJ_TILE_KINDS.length; i += 1) {
      hand.push(XMJ_TILE_KINDS[i] as XmjTile);
      visit(i);
      hand.pop();
    }
  };
  visit(0);
  // With one exposed meld only the concealed pair matters, independent of
  // which legal meld was exposed. Thus discard + concealed size keys the cache.
  waits.set(key, out);
  return out;
}

/**
 * P(opponent can win on discard). `unseen` is xmjUnseen from the discarder:
 * it includes the opponent's concealed tiles and wall, but excludes ALL of our
 * current hand (including the candidate discard), ponds, and exposed melds.
 *
 * For each distinct waiting multiset h, its weight is product C(unseen[t],h[t]);
 * the denominator is C(total unseen, concealedSize), including non-waiting hands.
 * This is exact under the neutral prior, not a posterior on opponent strategy.
 */
export function xmjDealInProbability(
  discard: XmjTile,
  unseen: ReadonlyMap<XmjTile, number>,
  concealedSize: number,
  melds: readonly XmjMeld[],
): number {
  if (concealedSize !== XMJ_HAND_SIZE - 1 - 3 * melds.length || concealedSize < 1) {
    throw new RangeError(
      'XMJ danger requires a waiting hand: four concealed tiles or one with a meld',
    );
  }
  let total = 0;
  for (const tile of XMJ_TILE_KINDS) {
    const n = unseen.get(tile) ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > XMJ_COPIES[tilePiece(tile)]) {
      throw new RangeError(`Invalid unseen count for ${tile}`);
    }
    total += n;
  }
  if (total < concealedSize) throw new RangeError('Not enough unseen tiles for opponent hand');
  let winningSubsets = 0;
  for (const hand of waitingHands(discard, concealedSize, melds)) {
    let weight = 1;
    for (const [tile, count] of hand) weight *= choose(unseen.get(tile) ?? 0, count);
    winningSubsets += weight;
  }
  return winningSubsets / choose(total, concealedSize);
}
