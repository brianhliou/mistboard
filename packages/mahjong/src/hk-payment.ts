/**
 * Hong Kong Old Style: faan to money.
 *
 * Unlike the faan table itself - where sources genuinely disagree and this
 * package records the disagreement rather than picking a winner - the payment
 * arithmetic is settled. Two Cantonese sources (廣東麻雀籌碼計法 and the 分數計算
 * table in 香港麻雀胡牌列表) and one English one agree exactly on it.
 *
 * Two independent axes, and they are independent: the doubling curve decides
 * how much a hand is worth, the payment system decides who hands it over.
 */

/**
 * 半辣上 doubles every second faan above four; 辣辣上 doubles every faan. Half
 * is the traditional and more common table. At ten faan they differ by 8x, so
 * this is not a rounding preference.
 */
export type DoublingCurve = 'half-spicy' | 'full-spicy';

/**
 * 半銃 (half shoot) spreads a discard loss across the table with the discarder
 * paying double; 全銃 (full shoot) puts the whole loss on the discarder. The
 * winner receives the same either way - what changes is who is out of pocket,
 * which changes how dangerous a discard is and therefore how the game is
 * played. It is not an accounting detail.
 */
export type PaymentSystem = 'half-shoot' | 'full-shoot';

export interface HkPaymentRules {
  /** 例牌番數. 10 is the most common table; online play often uses 13. */
  readonly limit: number;
  readonly curve: DoublingCurve;
  readonly system: PaymentSystem;
  /** 二五雞 / 五一 / 一二蚊 are all this one number. */
  readonly stake: number;
}

export const DEFAULT_HK_PAYMENT: HkPaymentRules = {
  limit: 10,
  curve: 'half-spicy',
  system: 'half-shoot',
  stake: 1,
};

/**
 * The base unit for a faan count, before the limit is applied.
 *
 * 半辣上 holds at 16 through four faan, then adds a half-step: 16, 24, 32, 48,
 * 64, 96, 128. The wikidot table prints 196 and 264 at eleven and twelve faan;
 * those are arithmetic slips, and 13 = 384 confirms the 192 / 256 line.
 */
export function unit(faan: number, curve: DoublingCurve = 'half-spicy'): number {
  if (faan < 0) throw new Error(`faan cannot be negative: ${faan}`);
  if (curve === 'full-spicy') return 2 ** faan;
  if (faan <= 4) return 2 ** faan;
  const above = faan - 4;
  return 2 ** (4 + Math.floor(above / 2)) * (above % 2 === 1 ? 1.5 : 1);
}

export interface Settlement {
  /** Faan actually paid on, after the limit is applied. */
  readonly effectiveFaan: number;
  readonly unit: number;
  readonly winnerReceives: number;
  /** Zero on a self-drawn win, which has no discarder. */
  readonly discarderPays: number;
  /** What each non-discarding opponent pays. */
  readonly eachOtherPays: number;
}

/**
 * Settle a won hand.
 *
 * Self-draw is worth exactly 1.5x a discard win at every faan level, in both
 * payment systems: three opponents at two units each against a table total of
 * four. That ratio is flat, which is what distinguishes Hong Kong from MCR,
 * where the self-draw premium shrinks as the hand grows.
 */
export function settle(
  faan: number,
  selfDrawn: boolean,
  rules: HkPaymentRules = DEFAULT_HK_PAYMENT,
): Settlement {
  const effectiveFaan = Math.min(faan, rules.limit);
  const base = unit(effectiveFaan, rules.curve) * rules.stake;

  if (selfDrawn) {
    return {
      effectiveFaan,
      unit: base,
      winnerReceives: base * 6,
      discarderPays: 0,
      eachOtherPays: base * 2,
    };
  }

  if (rules.system === 'full-shoot') {
    return {
      effectiveFaan,
      unit: base,
      winnerReceives: base * 4,
      discarderPays: base * 4,
      eachOtherPays: 0,
    };
  }

  return {
    effectiveFaan,
    unit: base,
    winnerReceives: base * 4,
    discarderPays: base * 2,
    eachOtherPays: base,
  };
}
