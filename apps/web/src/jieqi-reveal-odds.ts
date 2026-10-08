// Live jieqi reveal odds: what each side's face-down pieces could still be, as
// a pure function of ONE masked view (a seat's PlayerView, or the spectator's
// public view). Nothing else goes in, so it cannot know more than the viewer:
// it is bookkeeping the player could do in their head from what the rules
// already show them (CLAUDE.md "In-game aids bar"), never an evaluation.
//
// The count, per ink: the 15-piece start set minus that ink's face-up pieces on
// the board minus its captured pieces whose identity this view holds
// (jieqiHiddenPool). What is left is the multiset of identities this viewer has
// not seen. Under capturer-only reveal the two inks differ:
//   - the opponent's pool is exact: the viewer captured every opponent piece
//     that left the board face-down, and was told what each one was;
//   - the viewer's own pool also holds the face-down pieces the opponent took
//     (`takenUnseen`), because nobody told the viewer which they were.
// A spectator gets the public view, where no face-down capture has a role, so
// both inks are in the second case.
//
// The odds: every unseen identity is equally likely to be on any one of the
// side's face-down squares or among its taken-unseen captures. The deal is a
// uniform shuffle of each ink's 15 roles over its home squares (createJieqiDeal);
// a face-down piece moves by its home square's role whatever it is, so legal
// moves, checks and every choice of which face-down piece to move or take are
// blind to the hidden identities. Seeing an identity (a reveal, or a capture you
// made) removes it from the unseen multiset and says nothing about which of the
// remaining slots holds what. So for ANY one face-down piece of an ink,
// P(role) = unseen count of role / unseen total, with the taken-unseen pieces in
// the denominator (they are slots too). Every face-down piece of an ink has the
// same odds, which is why the display is a per-ink pool, not a per-piece badge.
// Caveat, by design: an opponent who took your face-down piece knows what it
// was, and their later play could hint at it; reading that is inference about a
// person, not bookkeeping, and stays out.

import {
  type HiddenPoolSide,
  type JieqiCapturedView,
  type JieqiColor,
  type JieqiPieceRole,
  type JieqiPlayerBoard,
  jieqiHiddenPool,
} from '@mistboard/game';

export type RevealOddsEntry = {
  role: JieqiPieceRole;
  /** Unseen pieces of this role (on the board face-down or taken unseen). */
  count: number;
  /** count / unseen: the chance one face-down piece of this ink is this role. */
  probability: number;
};

export type RevealOddsSide = {
  color: JieqiColor;
  /** Canonical order (chariot first), count > 0 only. */
  entries: RevealOddsEntry[];
  /** Identities of this ink the view has not seen: the odds' denominator. */
  unseen: number;
  /** This ink's pieces captured face-down whose identity the view never got. */
  takenUnseen: number;
  /** This ink's face-down pieces still on the board. */
  faceDown: number;
};

export type RevealOdds = Record<JieqiColor, RevealOddsSide>;

export type RevealOddsView = {
  board: JieqiPlayerBoard;
  captured: readonly JieqiCapturedView[];
};

export function jieqiRevealOdds(view: RevealOddsView): RevealOdds {
  const pool = jieqiHiddenPool(view);
  const faceDown: Record<JieqiColor, number> = { red: 0, black: 0 };
  for (const entry of Object.values(view.board)) {
    if (entry?.faceDown) faceDown[entry.color] += 1;
  }
  const side = (color: JieqiColor, poolSide: HiddenPoolSide<JieqiPieceRole>): RevealOddsSide => ({
    color,
    entries: poolSide.entries.map(({ role, count }) => ({
      role,
      count,
      probability: poolSide.total > 0 ? count / poolSide.total : 0,
    })),
    unseen: poolSide.total,
    takenUnseen: poolSide.unknownCaptured,
    faceDown: faceDown[color],
  });
  return { red: side('red', pool.red), black: side('black', pool.black) };
}

/** Whole percent, as the page prints it ("15%"). */
export function formatRevealPercent(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

export type RevealOddsVariant = 'a' | 'b' | 'c';

/**
 * The UI variant from `?revealOdds=a|b|c` (a pick-one trial for Brian). Anything
 * else, including no flag, is the planned default, a.
 */
export function revealOddsVariantFrom(search: string): RevealOddsVariant {
  const value = new URLSearchParams(search).get('revealOdds');
  return value === 'b' || value === 'c' ? value : 'a';
}
