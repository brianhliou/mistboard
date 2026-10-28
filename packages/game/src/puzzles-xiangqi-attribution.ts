// Per-source attribution policy for mined xiangqi puzzles (#712).
//
// Some archives let us mine their games on the condition that every puzzle
// credits them with a link back to the original game. That condition belongs
// to the SOURCE, not to one batch, so it lives here as a policy keyed by the
// historical_xiangqi_sources slug, and every writer that can put a puzzle in
// front of a player checks it: the miner refuses to assemble a puzzle from a
// requiring source without its link, and the publication gate refuses to
// publish one (apps/server/src/xiangqi-puzzle-publication.ts). The "From game"
// card renders the credit wherever the puzzle's source is shown.
//
// DPXQ (东萍象棋网): the operator agreed to credited pages that link back to the
// original game over http (not https), so the link is normalized to http and
// anything else is refused.

import type { XiangqiPuzzle } from './puzzles-xiangqi.js';

export type XiangqiPuzzleSourceAttribution = {
  /** Credit line shown on the puzzle, e.g. "东萍象棋网 (DPXQ)". */
  name: string;
  /** Link back to the original game page. */
  url: string;
};

type XiangqiSourceAttributionPolicy = {
  name: string;
  /** Normalize a stored link; return null when it is not an acceptable link. */
  normalizeUrl: (url: string) => string | null;
  /** Rebuild the game link from the archive's own game id when the row has
   *  no stored link (rows imported before links were kept). */
  urlForSourceGameId?: (sourceGameId: string) => string | null;
};

const DPXQ_NAME = '东萍象棋网 (DPXQ)';
const DPXQ_GAME_URL = /^https?:\/\/(?:www\.)?dpxq\.com\/(\S+)$/i;
const DPXQ_VIEW_ID = /^view_m_(\d+)$/;

const DPXQ_POLICY: XiangqiSourceAttributionPolicy = {
  name: DPXQ_NAME,
  normalizeUrl: (url) => {
    const match = DPXQ_GAME_URL.exec(url.trim());
    return match ? `http://www.dpxq.com/${match[1]}` : null;
  },
  urlForSourceGameId: (sourceGameId) => {
    const match = DPXQ_VIEW_ID.exec(sourceGameId.trim());
    return match ? `http://www.dpxq.com/hldcg/search/view_m_${match[1]}.html` : null;
  },
};

// Keyed by historical_xiangqi_sources.slug. `dpxq-archive-test` is the slug
// the existing 1,000 DPXQ rows already point at (the game upsert never moves a
// row's source), so the clearance flips that source rather than minting a new
// one; `dpxq` covers a fresh import under a clean slug.
const XIANGQI_SOURCE_ATTRIBUTION_POLICIES: Readonly<
  Record<string, XiangqiSourceAttributionPolicy>
> = {
  dpxq: DPXQ_POLICY,
  'dpxq-archive-test': DPXQ_POLICY,
};

export function xiangqiSourceRequiresAttribution(sourceSlug: string | null | undefined): boolean {
  return Boolean(sourceSlug && XIANGQI_SOURCE_ATTRIBUTION_POLICIES[sourceSlug]);
}

export type XiangqiSourceAttributionResult =
  | { ok: true; attribution: XiangqiPuzzleSourceAttribution | null }
  | { ok: false; reason: 'missing-attribution' };

/**
 * The credit a puzzle from this source must carry. `attribution: null` means
 * the source asks for none; `ok: false` means it asks for one and the game has
 * no acceptable link, so the puzzle must not be built or published.
 */
export function xiangqiSourceAttribution(input: {
  sourceSlug?: string | null;
  sourceUrl?: string | null;
  sourceGameId?: string | null;
}): XiangqiSourceAttributionResult {
  const policy = input.sourceSlug ? XIANGQI_SOURCE_ATTRIBUTION_POLICIES[input.sourceSlug] : null;
  if (!policy) return { ok: true, attribution: null };
  const url =
    (input.sourceUrl ? policy.normalizeUrl(input.sourceUrl) : null) ??
    (input.sourceGameId ? (policy.urlForSourceGameId?.(input.sourceGameId) ?? null) : null);
  if (!url) return { ok: false, reason: 'missing-attribution' };
  return { ok: true, attribution: { name: policy.name, url } };
}

/**
 * Null when the puzzle satisfies its source's attribution policy, else why
 * not. Used by the publication gate: a puzzle from a requiring source cannot
 * go live without a credit whose link the policy accepts unchanged.
 */
export function xiangqiPuzzleAttributionIssue(
  puzzle: Pick<XiangqiPuzzle, 'id' | 'sourceGame'>,
  sourceSlug: string | null | undefined,
): string | null {
  const policy = sourceSlug ? XIANGQI_SOURCE_ATTRIBUTION_POLICIES[sourceSlug] : null;
  if (!policy) return null;
  const attribution = puzzle.sourceGame?.attribution;
  if (!attribution?.url || !attribution.name) {
    return `puzzle ${puzzle.id} from ${sourceSlug} lacks the required source credit`;
  }
  if (policy.normalizeUrl(attribution.url) !== attribution.url) {
    return `puzzle ${puzzle.id} from ${sourceSlug} has a credit link the source does not accept: ${attribution.url}`;
  }
  return null;
}
