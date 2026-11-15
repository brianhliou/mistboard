import {
  applyBanqiMove,
  applyJungleFlipMove,
  BANQI_STUDY_MOVE_OPTIONS,
  type BanqiSquare,
  type JungleFlipSquare,
  maybeGameSpecForId,
  parseBanqiFen,
  parseJungleFlipFen,
} from '@mistboard/game';
import { flipSeatInk, isFlipSeatVariant } from '../flip-seat-ink.js';
import { CHESS_SEAT_COLORS, type ReviewSeatColors } from '../review/review-seat-colors.js';
import type { StudyChapterPayload } from '../study-chapter-spec.js';

/** Analysis slots are move-order seats, not necessarily the ink on the board. */
export function embedScoreSeatColors(
  variant: string,
  firstColor: 'red' | 'black' | null = null,
): ReviewSeatColors | null {
  const spec = maybeGameSpecForId(variant);
  if (!spec) throw new Error(`unknown score chart variant: ${variant}`);
  const family = spec.family;
  if (isFlipSeatVariant(variant)) {
    if (!firstColor) return null;
    return { red: flipSeatInk('red', firstColor)!, black: flipSeatInk('black', firstColor)! };
  }
  if (family === 'chess') return CHESS_SEAT_COLORS;
  if (family === 'gomoku') return { red: 'black', black: 'white' };
  return { red: 'red', black: 'black' };
}

/** Read only a known binding: the chapter's root, or its legal opening flip.
 *  An unbound root with no legal opening stays neutral; the dealt identities
 *  alone do not say which ink either player chose. */
export function studyScoreSeatColors(
  variant: string,
  root: StudyChapterPayload['root'],
): ReviewSeatColors | null {
  const token = root?.root?.children?.[0]?.uci ?? '';
  if (root?.rootFen && variant === 'banqi') {
    const parsed = parseBanqiFen(root.rootFen);
    if (parsed.ok) {
      const state = parsed.state;
      const after =
        !state.firstColor && !parsed.sampled && /^([a-h][1-4])\1$/.test(token)
          ? applyBanqiMove(
              state,
              {
                from: token.slice(0, 2) as BanqiSquare,
                to: token.slice(2) as BanqiSquare,
              },
              BANQI_STUDY_MOVE_OPTIONS,
            )
          : state;
      return embedScoreSeatColors(variant, after.firstColor);
    }
  }
  if (root?.rootFen && variant === 'jungle-flip') {
    const parsed = parseJungleFlipFen(root.rootFen);
    if (parsed.ok) {
      const state = parsed.state;
      const after =
        !state.firstColor && !parsed.sampled && /^([a-d][1-4])\1$/.test(token)
          ? applyJungleFlipMove(state, {
              from: token.slice(0, 2) as JungleFlipSquare,
              to: token.slice(2) as JungleFlipSquare,
            })
          : state;
      return embedScoreSeatColors(variant, after.firstColor);
    }
  }
  return embedScoreSeatColors(variant);
}
