// Piece-move animation core (Phase 1): the single reader of the `pieceAnimation`
// display preference, plus the shared WAAPI glide used by the SVG board family.
//
// Contract for every consumer:
//   - Animation is ALWAYS driven by a move payload the client already received
//     (a move event, a lastMove on a view, a timeline entry). NEVER derive an
//     animation by diffing two board states on a fog surface — a diff-based
//     glide could imply a hidden origin the server deliberately redacted.
//   - The glide is applied AFTER the innerHTML swap: the piece is already at its
//     destination; we translate it back to the origin and release, so the DOM
//     (hit layers, rings, arrows) is final-state throughout the animation.
//   - Animate a `<g>` wrapper (the keyed piece slot), never the nested
//     `<svg x= y=>` piece element — transforms on inner <svg> elements are
//     inconsistent across browsers. Deltas are in viewBox user units, so CSS
//     board sizing costs nothing.

import { maybeGameSpecForId } from '@mistboard/game';
import { readDisplayPreferences } from './display-preferences.js';

const DISPLAY_PREFERENCES_CHANGE_EVENT = 'mistboard:display-preferences-change';

/** lichess-like feel: fast/normal/slow map to short glides; none disables. */
const PIECE_ANIMATION_DURATION_MS: Record<string, number> = {
  none: 0,
  fast: 120,
  normal: 250,
  slow: 500,
};

export const PIECE_GLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

let cachedDurationMs: number | null = null;
let subscribed = false;

function invalidateCache(): void {
  cachedDurationMs = null;
}

function prefersReducedMotion(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

function computeDurationMs(): number {
  if (prefersReducedMotion()) return 0;
  const preference = readDisplayPreferences().pieceAnimation;
  return PIECE_ANIMATION_DURATION_MS[preference] ?? PIECE_ANIMATION_DURATION_MS.normal!;
}

/**
 * Current piece-glide duration in ms. Reads the preference once and caches;
 * the cache invalidates on the settings change event so a pref flip applies to
 * the next render without a reload. Returns 0 (disable) for the 'none' pref
 * and whenever the OS asks for reduced motion (re-checked on each cache miss).
 */
export function pieceAnimationDurationMs(opts?: { fog?: boolean }): number {
  // Fog/dark surfaces never animate (interim blanket-off pending the fog-aware
  // animation work in #158): a glide implies an origin->destination path, and
  // under fog that path can imply a square the server deliberately redacted, so
  // the current origin/destination inference is unsafe there.
  if (opts?.fog) return 0;
  if (!subscribed && typeof window !== 'undefined') {
    subscribed = true;
    window.addEventListener(DISPLAY_PREFERENCES_CHANGE_EVENT, invalidateCache);
  }
  if (cachedDurationMs === null) cachedDurationMs = computeDurationMs();
  return cachedDurationMs;
}

/**
 * May a step-through diagram of this variant glide its pieces? Decided by the
 * variant's visibility, failing closed: only perfect information ('open') and
 * public positions with hidden identities ('hidden-identity': banqi, jieqi)
 * glide. Fog ('dark'), concealed hands, an unknown id and no id at all repaint
 * only, so a diagram can never animate a path its variant would hide.
 */
export function variantDiagramGlides(gameSpecId: string | null | undefined): boolean {
  const visibility = maybeGameSpecForId(gameSpecId)?.visibility;
  return visibility === 'open' || visibility === 'hidden-identity';
}

/** Chessground animation config derived from the same preference. */
export function chessgroundAnimation(opts?: { fog?: boolean }): {
  enabled: boolean;
  duration: number;
} {
  const duration = pieceAnimationDurationMs(opts);
  return { enabled: duration > 0, duration };
}

/**
 * Glide an already-final-positioned SVG piece slot from an offset back to rest:
 * translate(dx, dy) -> none over `durationMs`. dx/dy are in the board's viewBox
 * user units (CSS transforms on SVG elements resolve px as user units).
 *
 * In-flight animations on the element are cancelled first, so rapid stepping or
 * autoplay never stacks glides. Feature-checked: environments without WAAPI
 * (happy-dom/jsdom tests) no-op instead of throwing.
 */
export function glideSvgPiece(
  el: Element,
  dxUser: number,
  dyUser: number,
  durationMs: number,
): void {
  if (durationMs <= 0) return;
  if (dxUser === 0 && dyUser === 0) return;
  const target = el as Element & {
    animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation;
    getAnimations?: () => Animation[];
  };
  if (typeof target.animate !== 'function') return;
  if (typeof target.getAnimations === 'function') {
    for (const animation of target.getAnimations()) animation.cancel();
  }
  target.animate([{ transform: `translate(${dxUser}px, ${dyUser}px)` }, { transform: 'none' }], {
    duration: durationMs,
    easing: PIECE_GLIDE_EASING,
  });
}

/**
 * "Draw on arrival": fade a last-move destination marker in so it lands with the
 * gliding piece instead of sitting there for the whole travel. The marker stays
 * invisible for the first half of the glide, then fades to full as the piece
 * nears its square. Applied synchronously after the innerHTML swap (same task as
 * the glide), so the first paint already carries opacity 0 — no flash. Reverts to
 * the element's own opacity (1) when the animation ends or is cancelled. No-ops
 * without WAAPI (jsdom/happy-dom) or when animation is disabled.
 */
export function drawMarkerOnArrival(el: Element | null, durationMs: number): void {
  if (!el || durationMs <= 0) return;
  const target = el as Element & {
    animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation;
    getAnimations?: () => Animation[];
  };
  if (typeof target.animate !== 'function') return;
  if (typeof target.getAnimations === 'function') {
    for (const animation of target.getAnimations()) animation.cancel();
  }
  target.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: 0.5 },
      { opacity: 1, offset: 1 },
    ],
    { duration: durationMs, easing: PIECE_GLIDE_EASING },
  );
}

/** A face-down tile's turn-over (#709): long enough to read as a turn, short
 *  enough never to hold up the next move. Fixed rather than scaled by the glide
 *  pref, which only switches it on or off ('none', reduced motion). */
export const PIECE_FLIP_DURATION_MS = 280;

/** The turn-over duration in ms, 0 when piece animation is off (the 'none'
 *  pref or `prefers-reduced-motion: reduce`): the face then just appears. */
export function pieceFlipDurationMs(): number {
  return pieceAnimationDurationMs() > 0 ? PIECE_FLIP_DURATION_MS : 0;
}

/**
 * Turn an already-revealed SVG piece slot over: a scaleX turn about `center`
 * (viewBox units) that shows `backMarkup` for the first half and the slot's own
 * face for the second. Call AFTER the innerHTML swap that rendered the face.
 *
 * Hidden information: the face is never drawn before the render that carries
 * it. `backMarkup` must be the identity-free back the board already drew for
 * this tile; the turn only covers the face that just arrived, briefly.
 *
 * `delayMs` holds the turn until a glide on the same slot lands (jieqi: the
 * piece travels face-down, then turns over on its destination); the back covers
 * the face for the whole delay. Without a delay, in-flight animations on the
 * slot are cancelled first. The back is removed when the turn ends or is
 * cancelled, and a re-render replaces the slot anyway, so nothing outlives it.
 * Returns false (no-op) at duration 0 or without WAAPI (happy-dom/jsdom).
 */
export function flipSvgPiece(
  slot: Element,
  center: { x: number; y: number },
  backMarkup: string,
  durationMs: number,
  opts: { delayMs?: number } = {},
): boolean {
  if (durationMs <= 0) return false;
  const target = slot as Element & {
    animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation;
    getAnimations?: () => Animation[];
    style?: CSSStyleDeclaration;
  };
  if (typeof target.animate !== 'function') return false;
  const delay = Math.max(0, opts.delayMs ?? 0);
  if (delay === 0 && typeof target.getAnimations === 'function') {
    for (const animation of target.getAnimations()) animation.cancel();
  }
  const faces = Array.from(slot.children);
  const back = slot.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
  back.setAttribute('class', 'piece-flip-back');
  back.setAttribute('aria-hidden', 'true');
  back.innerHTML = backMarkup;
  slot.append(back);
  if (target.style) target.style.transformOrigin = `${center.x}px ${center.y}px`;
  const timing: KeyframeAnimationOptions = { duration: durationMs, delay, fill: 'backwards' };
  // The face swaps in at the midpoint, edge-on, where neither side shows.
  const hideUntilMidpoint: Keyframe[] = [
    { opacity: 0, offset: 0 },
    { opacity: 0, offset: 0.5 },
    { opacity: 1, offset: 0.5 },
    { opacity: 1, offset: 1 },
  ];
  const showUntilMidpoint: Keyframe[] = [
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: 0.5 },
    { opacity: 0, offset: 0.5 },
    { opacity: 0, offset: 1 },
  ];
  for (const face of faces) {
    (face as Element & { animate?: typeof target.animate }).animate?.(hideUntilMidpoint, timing);
  }
  back.animate(showUntilMidpoint, { ...timing, fill: 'both' });
  const turn = target.animate(
    [
      { transform: 'scaleX(1)', offset: 0, easing: 'ease-in' },
      { transform: 'scaleX(0)', offset: 0.5, easing: 'ease-out' },
      { transform: 'scaleX(1)', offset: 1 },
    ],
    // No backwards fill: during a delay the slot's glide owns its transform.
    { duration: durationMs, delay },
  );
  const removeBack = () => back.remove();
  if (turn && typeof turn.addEventListener === 'function') {
    turn.addEventListener('finish', removeBack);
    turn.addEventListener('cancel', removeBack);
  } else {
    removeBack();
  }
  return true;
}
