// Move-annotation glyphs, shared by the move list and the board badge.
//
// The move list already renders a suffix after the move ('??', '?', '?!', and the
// user-authored NAGs). The review board pins the SAME symbol to the move's
// destination point (lila does this in ui/lib/src/game/glyphs.ts). One tone
// function feeds both so the two surfaces cannot disagree about a move: a badge
// that said "blunder" next to a list entry that said "inaccuracy" would be worse
// than no badge at all.
//
// Engine judgments arrive with an explicit class (game-analysis.judgmentGlyph);
// user NAGs arrive as a bare symbol with NO class (tree-review's GLYPH_LABEL
// deliberately clears it so an authored '?' is not styled as an engine verdict in
// the list). The symbol fallback below is what lets the badge still colour those.

import { PIECE_GLIDE_EASING } from '../board-anim.js';

/** Badge colour families. The first three mirror MoveJudgment. 'brilliant' (`!!`)
 *  and 'good' (`!`) are shared by the engine's positive verdicts
 *  (game-analysis.praiseGlyph, whose class for `!` is 'great') and by
 *  user-authored NAGs; 'speculative' (`!?`) is authored only. */
export type MoveGlyphTone =
  | 'blunder'
  | 'mistake'
  | 'inaccuracy'
  | 'brilliant'
  | 'good'
  | 'speculative';

const TONE_BY_SYMBOL: Record<string, MoveGlyphTone> = {
  '??': 'blunder',
  '?': 'mistake',
  '?!': 'inaccuracy',
  '!': 'good',
  '!!': 'brilliant',
  '!?': 'speculative',
};

const TONES = new Set<string>([
  'blunder',
  'mistake',
  'inaccuracy',
  'brilliant',
  'good',
  'speculative',
]);
const TONE_BY_CLASS: Record<string, MoveGlyphTone> = { great: 'good' };

/**
 * Tone for a move-list glyph. `suffixClass` (the engine judgment) wins when it is
 * one we know; otherwise fall back to the symbol itself, which is the user-NAG
 * path. Returns null for an absent or unrecognised glyph, which the callers treat
 * as "draw nothing" rather than as a default colour: an unknown symbol with a
 * confident colour would be an invented verdict.
 */
export function moveGlyphTone(
  suffix: string | undefined,
  suffixClass: string | undefined,
): MoveGlyphTone | null {
  if (suffixClass && TONES.has(suffixClass)) return suffixClass as MoveGlyphTone;
  if (suffixClass && TONE_BY_CLASS[suffixClass]) return TONE_BY_CLASS[suffixClass]!;
  if (!suffix) return null;
  return TONE_BY_SYMBOL[suffix] ?? null;
}

type GlyphFade = {
  board: Element | null;
  startedAt: number;
  durationMs: number;
  delayMs: number;
  animations: Animation[];
};
const pendingGlyphs = new WeakMap<HTMLElement, GlyphFade>();

/**
 * Board badges stay hidden until the glide lands, then use the last-move
 * marker's duration and PIECE_GLIDE_EASING. In-place reveals pass delay 0.
 * Backwards fill hides them synchronously, including during the delay. No
 * timers or completion callbacks can write into a later render.
 */
export function animateMoveGlyphs(
  host: HTMLElement,
  durationMs: number,
  delayMs = durationMs,
): void {
  cancelMoveGlyphs(host);
  if (durationMs <= 0) return;
  const fade: GlyphFade = {
    board: host.querySelector('svg'),
    startedAt: performance.now(),
    durationMs,
    delayMs: Math.max(0, delayMs),
    animations: [],
  };
  pendingGlyphs.set(host, fade);
  paintGlyphFade(host, fade, 0);
}

/**
 * Badges for a glided move: a short fade that ENDS as the piece lands, so the
 * badge arrives with the piece rather than a full glide later (it used to wait
 * the whole glide and then fade for another, complete at twice the glide).
 */
export function animateMoveGlyphsOnLanding(host: HTMLElement, glideMs: number): void {
  const fade = Math.min(100, glideMs);
  animateMoveGlyphs(host, fade, glideMs - fade);
}

function cancelMoveGlyphs(host: HTMLElement): void {
  for (const animation of pendingGlyphs.get(host)?.animations ?? []) animation.cancel();
  pendingGlyphs.delete(host);
}

function paintGlyphFade(host: HTMLElement, fade: GlyphFade, elapsedMs: number): void {
  for (const glyph of host.querySelectorAll('.xq-marker--glyph, .luck-mark[data-luck-square]')) {
    if (typeof glyph.animate !== 'function') continue;
    for (const animation of glyph.getAnimations?.() ?? []) animation.cancel();
    const animation = glyph.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: fade.durationMs,
      delay: fade.delayMs,
      easing: PIECE_GLIDE_EASING,
      fill: 'backwards',
    });
    if (elapsedMs > 0) animation.currentTime = elapsedMs;
    fade.animations.push(animation);
  }
}

/** Engine/annotation updates patch badges in place while the board glides.
 * New badges inherit the existing fade's progress. A full board repaint (a
 * jump, first render or superseding move) cancels that context instead. */
export function refreshMoveGlyphs(host: HTMLElement): void {
  const fade = pendingGlyphs.get(host);
  if (!fade) return;
  const elapsedMs = performance.now() - fade.startedAt;
  if (fade.board !== host.querySelector('svg') || elapsedMs >= fade.delayMs + fade.durationMs) {
    cancelMoveGlyphs(host);
    return;
  }
  for (const animation of fade.animations) animation.cancel();
  fade.animations = [];
  paintGlyphFade(host, fade, elapsedMs);
}
