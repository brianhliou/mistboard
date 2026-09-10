/**
 * Resolving detected patterns into a faan total.
 *
 * Detection says what a hand contains; this says what that is worth. The two
 * are separate because the interesting failures live here: components counted
 * twice, components not counted at all, a limit hand paid as a number, or a
 * house-rule pattern quietly scoring at an orthodox table.
 */

import { HK_PATTERNS, type HkPatternId, type ScoredPattern } from './hk-patterns.js';

export type PatternSet = 'orthodox' | 'with-custom';

export interface FaanOptions {
  /** 正統牌型 only, or 正統 plus 自訂. Orthodox is what makes this HK. */
  readonly patternSet?: PatternSet;
  /** 例牌番數. Limit hands pay this rather than their nominal faan. */
  readonly limit?: number;
  /** 無限番: limit hands score their nominal faan and nothing is capped. */
  readonly unlimited?: boolean;
  /** Patterns the table has agreed to promote into the 例牌 set. */
  readonly elevatedToLimit?: readonly HkPatternId[];
}

export interface FaanLine {
  readonly id: HkPatternId;
  readonly count: number;
  readonly faan: number;
  readonly chinese: string;
  readonly english: string;
  /** True when this line came from another pattern's `implies`. */
  readonly implied: boolean;
}

export type DropReason = 'not-orthodox' | 'excluded-by-another-pattern' | 'over-max-count';

export interface DroppedLine {
  readonly id: HkPatternId;
  readonly reason: DropReason;
  /** The pattern that excluded it, when that is the reason. */
  readonly by?: HkPatternId;
}

export interface FaanResult {
  readonly faan: number;
  readonly limitHand: boolean;
  readonly lines: readonly FaanLine[];
  readonly dropped: readonly DroppedLine[];
}

const DEFAULTS = { patternSet: 'orthodox' as PatternSet, limit: 10, unlimited: false };

/**
 * Total the faan for a set of detected patterns.
 *
 * Order matters and is: drop house-rule patterns the table does not play, drop
 * anything an surviving pattern excludes, expand what the survivors imply, then
 * sum. Expanding before excluding would resurrect components that a rolled-up
 * pattern is defined to absorb - 坎坎糊 exists precisely so that 對對糊 and
 * 門前清 are NOT also counted.
 */
export function totalFaan(
  detected: readonly ScoredPattern[],
  options: FaanOptions = {},
): FaanResult {
  const patternSet = options.patternSet ?? DEFAULTS.patternSet;
  const limit = options.limit ?? DEFAULTS.limit;
  const unlimited = options.unlimited ?? DEFAULTS.unlimited;
  const elevated = new Set(options.elevatedToLimit ?? []);
  const dropped: DroppedLine[] = [];

  // 1. House rules, if the table does not play them.
  let survivors = detected.filter(({ id }) => {
    if (patternSet === 'with-custom' || HK_PATTERNS[id].orthodox) return true;
    dropped.push({ id, reason: 'not-orthodox' });
    return false;
  });

  // 2. Exclusions, taken from the patterns that survived step 1.
  const excluded = new Map<HkPatternId, HkPatternId>();
  for (const { id } of survivors) {
    for (const victim of HK_PATTERNS[id].excludes) {
      if (!excluded.has(victim)) excluded.set(victim, id);
    }
  }
  survivors = survivors.filter(({ id }) => {
    const by = excluded.get(id);
    if (by === undefined) return true;
    dropped.push({ id, reason: 'excluded-by-another-pattern', by });
    return false;
  });

  // 3. Implications. A component counted explicitly AND implied is one
  //    component, so take the larger count rather than adding them.
  const explicit = new Map<HkPatternId, number>();
  for (const { id, count } of survivors) {
    explicit.set(id, Math.max(explicit.get(id) ?? 0, count));
  }

  const impliedCounts = new Map<HkPatternId, number>();
  for (const { id } of survivors) {
    for (const component of HK_PATTERNS[id].implies) {
      if (excluded.has(component.id)) continue;
      impliedCounts.set(
        component.id,
        Math.max(impliedCounts.get(component.id) ?? 0, component.count),
      );
    }
  }

  const finalCounts = new Map<HkPatternId, { count: number; implied: boolean }>();
  for (const [id, count] of explicit) finalCounts.set(id, { count, implied: false });
  for (const [id, count] of impliedCounts) {
    const existing = finalCounts.get(id);
    if (!existing) {
      finalCounts.set(id, { count, implied: true });
    } else if (count > existing.count) {
      finalCounts.set(id, { count, implied: existing.implied });
    }
  }

  // 4. Sum, clamping any pattern that cannot occur as often as claimed.
  const lines: FaanLine[] = [];
  let limitHand = false;
  let faan = 0;

  for (const [id, { count, implied }] of finalCounts) {
    const spec = HK_PATTERNS[id];
    const capped = Math.min(count, spec.maxCount);
    if (capped < count) dropped.push({ id, reason: 'over-max-count' });
    if (spec.limitHand || elevated.has(id)) limitHand = true;
    lines.push({
      id,
      count: capped,
      faan: spec.faan * capped,
      chinese: spec.chinese,
      english: spec.english,
      implied,
    });
    faan += spec.faan * capped;
  }

  lines.sort((a, b) => b.faan - a.faan || a.id.localeCompare(b.id));

  // A limit hand pays the table's limit, not its nominal faan - unless the
  // table plays 無限番, where the nominal value is all there is.
  if (limitHand && !unlimited) return { faan: limit, limitHand, lines, dropped };
  return { faan, limitHand, lines, dropped };
}
