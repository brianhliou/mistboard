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
import { readStoredBanqiTile3d } from './xiangqi-appearance-storage.js';

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
let cachedFlipDurationMs: number | null = null;
let subscribed = false;

function invalidateCache(): void {
  cachedDurationMs = null;
  cachedFlipDurationMs = null;
}

function subscribeToPreferenceChanges(): void {
  if (subscribed || typeof window === 'undefined') return;
  subscribed = true;
  window.addEventListener(DISPLAY_PREFERENCES_CHANGE_EVENT, invalidateCache);
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
  subscribeToPreferenceChanges();
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

/** A face-down tile's turn-over (#709), by the glide pref's speed: long enough
 *  to read as a turn, short enough never to hold up the next move. 'none' (and
 *  reduced motion) turns nothing: the face just appears. */
const PIECE_FLIP_DURATION_BY_SPEED: Record<string, number> = {
  none: 0,
  fast: 180,
  normal: 280,
  slow: 420,
};

/** The turn-over at the default ('normal') speed. */
export const PIECE_FLIP_DURATION_MS = PIECE_FLIP_DURATION_BY_SPEED.normal!;

/** The turn-over duration in ms for the current piece-animation pref, 0 when
 *  piece animation is off (the 'none' pref or `prefers-reduced-motion: reduce`):
 *  the face then just appears. Cached like the glide, cleared by the same
 *  settings event. */
export function pieceFlipDurationMs(): number {
  if (pieceAnimationDurationMs() <= 0) return 0;
  if (cachedFlipDurationMs === null) {
    const preference = readDisplayPreferences().pieceAnimation;
    cachedFlipDurationMs = PIECE_FLIP_DURATION_BY_SPEED[preference] ?? PIECE_FLIP_DURATION_MS;
  }
  return cachedFlipDurationMs;
}

// ── Flip style (#709): follows the Pieces look ─────────────────────────────
// 3D pieces Spin (rise and turn side to side, the wall showing mid-turn); flat
// pieces Flat (a squeeze). No setting of its own (Brian, 2026-10-29: the flip
// is "tied to 3d", as the sheet showed it). `?flip=flat|lift|spin` overrides it
// for testing: read once per page load and kept for the tab (sessionStorage) so
// it survives in-app navigation into a room. Lift (end over end) is reachable
// only that way.

export const PIECE_FLIP_STYLES = ['flat', 'lift', 'spin'] as const;
export type PieceFlipStyle = (typeof PIECE_FLIP_STYLES)[number];

const PIECE_FLIP_STYLE_STORAGE_KEY = 'mistboard.flipStyle';

function isPieceFlipStyle(value: unknown): value is PieceFlipStyle {
  return (PIECE_FLIP_STYLES as readonly unknown[]).includes(value);
}

/** The style a `?flip=` query names, or null when it names none. */
export function pieceFlipStyleFromSearch(search: string): PieceFlipStyle | null {
  try {
    const value = new URLSearchParams(search).get('flip');
    return isPieceFlipStyle(value) ? value : null;
  } catch {
    return null;
  }
}

/** undefined: not parsed yet; null: no override this tab. */
let cachedFlipOverride: PieceFlipStyle | null | undefined;

function pieceFlipOverride(): PieceFlipStyle | null {
  if (cachedFlipOverride !== undefined) return cachedFlipOverride;
  let override: PieceFlipStyle | null = null;
  try {
    const flagged = pieceFlipStyleFromSearch(window.location.search);
    if (flagged) {
      window.sessionStorage.setItem(PIECE_FLIP_STYLE_STORAGE_KEY, flagged);
      override = flagged;
    } else {
      const stored = window.sessionStorage.getItem(PIECE_FLIP_STYLE_STORAGE_KEY);
      override = isPieceFlipStyle(stored) ? stored : null;
    }
  } catch {
    override = null;
  }
  cachedFlipOverride = override;
  return override;
}

/** The turn-over style: the tab's `?flip=` override, else Spin for 3D pieces
 *  and Flat for flat ones. Read on every turn, so a look change applies to the
 *  next one. */
export function pieceFlipStyle(): PieceFlipStyle {
  const override = pieceFlipOverride();
  if (override) return override;
  return readStoredBanqiTile3d() ? 'spin' : 'flat';
}

/** Tests only: forget the parsed flag so the next read re-parses the URL. */
export function resetPieceFlipStyleCache(): void {
  cachedFlipOverride = undefined;
}

// Parse at load, before any in-app navigation can drop the query.
if (typeof window !== 'undefined') pieceFlipOverride();

/** How far a lifted tile grows (it nears the eye) and the shadow it casts. */
const FLIP_LIFT_SCALE = 1.12;
const FLIP_SHADOW_DOWN = 'drop-shadow(0px 0px 0px rgba(0, 0, 0, 0))';
const FLIP_SHADOW_UP = 'drop-shadow(0px 6px 5px rgba(0, 0, 0, 0.32))';

/**
 * The keyframes of one turn-over style. `turn` turns the tile (face swap at
 * offset 0.5, edge-on); `lift`, when present, raises the whole slot: up by
 * 0.2, held while it turns, settled by 1. The lifted turns go to 90 degrees and
 * come back from -90, so the new face arrives unmirrored. Browsers may flatten
 * a 3D turn on SVG content to its 2D squash; the lift still reads.
 */
export function pieceFlipKeyframes(style: PieceFlipStyle): {
  turn: Keyframe[];
  lift: Keyframe[] | null;
} {
  if (style === 'flat') {
    return {
      turn: [
        { transform: 'scaleX(1)', offset: 0, easing: 'ease-in' },
        { transform: 'scaleX(0)', offset: 0.5, easing: 'ease-out' },
        { transform: 'scaleX(1)', offset: 1 },
      ],
      lift: null,
    };
  }
  const axis = style === 'lift' ? 'rotateX' : 'rotateY';
  // No perspective(): Chrome flattens 3D on SVG to an affine guess that widens
  // the tile mid-turn (a 90px disc drew 157px wide); the lift sells the depth.
  const at = (deg: number) => `${axis}(${deg}deg)`;
  return {
    turn: [
      { transform: at(0), offset: 0 },
      { transform: at(0), offset: 0.2, easing: 'ease-in' },
      { transform: at(90), offset: 0.5 },
      { transform: at(-90), offset: 0.5, easing: 'ease-out' },
      { transform: at(0), offset: 0.8 },
      { transform: at(0), offset: 1 },
    ],
    lift: [
      { transform: 'scale(1)', filter: FLIP_SHADOW_DOWN, offset: 0, easing: 'ease-out' },
      { transform: `scale(${FLIP_LIFT_SCALE})`, filter: FLIP_SHADOW_UP, offset: 0.2 },
      {
        transform: `scale(${FLIP_LIFT_SCALE})`,
        filter: FLIP_SHADOW_UP,
        offset: 0.8,
        easing: 'ease-in',
      },
      { transform: 'scale(1)', filter: FLIP_SHADOW_DOWN, offset: 1 },
    ],
  };
}

type Animatable = Element & {
  animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation;
  getAnimations?: () => Animation[];
  style?: CSSStyleDeclaration;
};

/**
 * Turn an already-revealed SVG piece slot over about `center` (viewBox units),
 * showing `backMarkup` for the first half and the slot's own face for the
 * second, in the tab's flip style (`opts.style` overrides it). Call AFTER the
 * innerHTML swap that rendered the face.
 *
 * Hidden information: the face is never drawn before the render that carries
 * it. `backMarkup` must be the identity-free back the board already drew for
 * this tile; the turn only covers the face that just arrived, briefly.
 *
 * `delayMs` holds the turn until a glide on the same slot lands (jieqi: the
 * piece travels face-down, then turns over on its destination); the back covers
 * the face for the whole delay. Without a delay, in-flight animations on the
 * slot are cancelled first. The lifted styles turn an inner wrapper and raise
 * the slot; when the turn ends or is cancelled the back is removed and the
 * wrapper unwrapped, and a re-render replaces the slot anyway, so nothing
 * outlives it. Nothing moves before or after the turn.
 * Returns false (no-op) at duration 0 or without WAAPI (happy-dom/jsdom).
 */
/**
 * A tile's thickness for the turn-over (the ?tile=3d spike): edge-on, a band
 * `2 * halfWidth` long and `depth` thick shows where a flat disc would be a
 * hairline. `fills` stripe the band across its thickness; `stroke` outlines it.
 */
export interface PieceFlipEdge {
  halfWidth: number;
  depth: number;
  fills: readonly string[];
  stroke?: string;
}

/** The edge band, across the turn's axis: lying flat for Lift, upright otherwise. */
export function pieceFlipEdgeMarkup(
  center: { x: number; y: number },
  edge: PieceFlipEdge,
  style: PieceFlipStyle,
): string {
  const across = style === 'lift';
  const n = Math.max(1, edge.fills.length);
  const t = edge.depth / n;
  const stripes = edge.fills.map((fill, i) => {
    const off = -edge.depth / 2 + i * t;
    return across
      ? `<rect x="${center.x - edge.halfWidth}" y="${center.y + off}" width="${2 * edge.halfWidth}" height="${t}" fill="${fill}"/>`
      : `<rect x="${center.x + off}" y="${center.y - edge.halfWidth}" width="${t}" height="${2 * edge.halfWidth}" fill="${fill}"/>`;
  });
  const r = edge.depth / 2;
  const outline = edge.stroke
    ? across
      ? `<rect x="${center.x - edge.halfWidth}" y="${center.y - r}" width="${2 * edge.halfWidth}" height="${edge.depth}" rx="${r}" fill="none" stroke="${edge.stroke}" stroke-width="1"/>`
      : `<rect x="${center.x - r}" y="${center.y - edge.halfWidth}" width="${edge.depth}" height="${2 * edge.halfWidth}" rx="${r}" fill="none" stroke="${edge.stroke}" stroke-width="1"/>`
    : '';
  return stripes.join('') + outline;
}

/** The edge shows as the face goes edge-on and is gone again as it lands. */
export function pieceFlipEdgeKeyframes(style: PieceFlipStyle): Keyframe[] {
  const s = (k: number) => (style === 'lift' ? `scaleY(${k})` : `scaleX(${k})`);
  if (style === 'flat') {
    return [
      { transform: s(0), offset: 0, easing: 'ease-in' },
      { transform: s(1), offset: 0.5, easing: 'ease-out' },
      { transform: s(0), offset: 1 },
    ];
  }
  return [
    { transform: s(0), offset: 0 },
    { transform: s(0), offset: 0.2, easing: 'ease-in' },
    { transform: s(1), offset: 0.5, easing: 'ease-out' },
    { transform: s(0), offset: 0.8 },
    { transform: s(0), offset: 1 },
  ];
}

export function flipSvgPiece(
  slot: Element,
  center: { x: number; y: number },
  backMarkup: string,
  durationMs: number,
  opts: {
    delayMs?: number;
    style?: PieceFlipStyle;
    edge?: PieceFlipEdge;
    /**
     * Turn while the slot glides: the slot's own transform stays the glide's,
     * so the turn and any lift run on wrappers inside it (Brian, 2026-10-28:
     * "Will we be able to flip it while the piece is moving?").
     */
    alongGlide?: boolean;
    /**
     * A mark drawn outside the slot that belongs to the piece (a 3D piece's
     * gold last-move edge): it turns and lifts with the piece, added onto its
     * own glide, so it never hangs off a piece standing edge-on.
     */
    follower?: Element | null;
    /**
     * A mark that belongs to the face being turned up (a flip's ring or cell
     * in the flipper's ink): hidden with the face while the back turns away,
     * then turned in with it, so it never shows before the flip lands (Brian,
     * 2026-10-29: "I'm seeing the ring before the piece flip completes").
     */
    faceMark?: Element | null;
  } = {},
): boolean {
  if (durationMs <= 0) return false;
  const target = slot as Animatable;
  if (typeof target.animate !== 'function') return false;
  const delay = Math.max(0, opts.delayMs ?? 0);
  const alongGlide = opts.alongGlide === true;
  if (delay === 0 && !alongGlide && typeof target.getAnimations === 'function') {
    for (const animation of target.getAnimations()) animation.cancel();
  }
  const style = opts.style ?? pieceFlipStyle();
  const { turn: turnFrames, lift: liftFrames } = pieceFlipKeyframes(style);
  const edge = opts.edge;
  const svgNs = 'http://www.w3.org/2000/svg';
  const faces = Array.from(slot.children);
  const back = slot.ownerDocument.createElementNS(svgNs, 'g');
  back.setAttribute('class', 'piece-flip-back');
  back.setAttribute('aria-hidden', 'true');
  back.innerHTML = backMarkup;
  const origin = `${center.x}px ${center.y}px`;
  // Flat turns the slot itself; a lifted style turns a wrapper inside it, so
  // the slot's own transform is free for the lift (and its shadow follows the
  // turning shape, thinning edge-on as a real tile's would).
  // A tile with an edge turns a wrapper too, so the edge can stay unturned.
  let turner: Animatable = target;
  if (liftFrames || edge || alongGlide) {
    turner = slot.ownerDocument.createElementNS(svgNs, 'g') as Animatable;
    turner.setAttribute('class', 'piece-flip-turn');
    turner.append(...faces, back);
    slot.append(turner);
    if (turner.style) turner.style.transformOrigin = origin;
  } else {
    slot.append(back);
  }
  if (target.style) target.style.transformOrigin = origin;
  // Along a glide the lift goes on a wrapper around the turn and the edge.
  let lifter: Animatable = target;
  if (alongGlide && liftFrames) {
    lifter = slot.ownerDocument.createElementNS(svgNs, 'g') as Animatable;
    lifter.setAttribute('class', 'piece-flip-lift');
    lifter.append(turner);
    slot.append(lifter);
    if (lifter.style) lifter.style.transformOrigin = origin;
  }
  let edgeEl: Animatable | null = null;
  if (edge) {
    edgeEl = slot.ownerDocument.createElementNS(svgNs, 'g') as Animatable;
    edgeEl.setAttribute('class', 'piece-flip-edge');
    edgeEl.setAttribute('aria-hidden', 'true');
    edgeEl.innerHTML = pieceFlipEdgeMarkup(center, edge, style);
    (lifter === target ? slot : lifter).append(edgeEl);
    if (edgeEl.style) edgeEl.style.transformOrigin = origin;
  }
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
    (face as Animatable).animate?.(hideUntilMidpoint, timing);
  }
  back.animate(showUntilMidpoint, { ...timing, fill: 'both' });
  // No backwards fill: during a delay the slot's glide owns its transform.
  const turn = turner.animate?.(turnFrames, { duration: durationMs, delay });
  if (liftFrames) lifter.animate?.(liftFrames, { duration: durationMs, delay });
  edgeEl?.animate?.(pieceFlipEdgeKeyframes(style), { duration: durationMs, delay, fill: 'both' });
  const follower = opts.follower as Animatable | null | undefined;
  if (follower && typeof follower.animate === 'function') {
    if (follower.style) follower.style.transformOrigin = origin;
    const added: KeyframeAnimationOptions = { duration: durationMs, delay, composite: 'add' };
    follower.animate(turnFrames, added);
    if (liftFrames) {
      follower.animate(
        liftFrames.map(({ filter: _shadow, ...frame }) => frame),
        added,
      );
    }
  }
  const faceMark = opts.faceMark as Animatable | null | undefined;
  if (faceMark && typeof faceMark.animate === 'function') {
    if (faceMark.style) faceMark.style.transformOrigin = origin;
    faceMark.animate(hideUntilMidpoint, timing);
    const added: KeyframeAnimationOptions = { duration: durationMs, delay, composite: 'add' };
    faceMark.animate(turnFrames, added);
    if (liftFrames) {
      faceMark.animate(
        liftFrames.map(({ filter: _shadow, ...frame }) => frame),
        added,
      );
    }
  }
  const settle = () => {
    back.remove();
    edgeEl?.remove();
    if (turner !== target && turner.parentNode) {
      turner.replaceWith(...Array.from(turner.childNodes));
    }
    if (lifter !== target && lifter.parentNode === slot) {
      lifter.replaceWith(...Array.from(lifter.childNodes));
    }
  };
  if (turn && typeof turn.addEventListener === 'function') {
    turn.addEventListener('finish', settle);
    turn.addEventListener('cancel', settle);
  } else {
    settle();
  }
  return true;
}
