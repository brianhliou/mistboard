// The perspective turn-over for a tile with thickness (the banqi ?tile=3d
// spike). Chrome flattens 3D transforms on SVG content to a 2D guess (b01ef9495),
// so a tile drawn in the board's SVG cannot turn with true perspective. For the
// length of the turn this lays an HTML coin over the tile instead: two faces
// and a ring of wall strips in a preserve-3d stage under a CSS perspective, the
// board's own markup on each face, and the SVG tile hidden underneath. When the
// turn ends (or anything interrupts it) the coin is removed and the SVG tile,
// already showing its new face, is shown again.
//
// The rest poses are pixel-exact. The up face sits at z = 0, where perspective
// scales nothing, and the flat band the board draws under the disc rides on
// each face as a 2D layer that fades out once the turn starts and back in
// before it ends. The camera looks from a little above: an oblique shear
// (z into y) puts the wall below the disc, where the flat band sits, so the
// moving wall and the resting band agree.
//
// Hidden information: the coin is built only from markup the caller already
// rendered. `front` is the face the board shows after the render that carried
// the reveal, `back` the identity-free back it drew before. Nothing is drawn
// ahead of that render, and the coin is gone when the turn is.

import { pieceFlipKeyframes } from './board-anim.js';

export interface TileFlipLayers {
  /** The flat band (and shadow) drawn under the disc, in board units. */
  band: string;
  /** The disc itself. */
  face: string;
}

export interface TileFlipOverlaySpec {
  /** The board slot that holds the tile, inside an <svg> with a viewBox. */
  slot: Element;
  /** The disc's centre, board units. */
  center: { x: number; y: number };
  /** The disc's outer radius, board units. */
  radius: number;
  /** The band the flat tile shows under its disc, board units. */
  depth: number;
  /** Half the side of the square each face layer draws (disc, band, shadow). */
  reach: number;
  /** The tile face up, as the board shows it after the reveal. */
  front: TileFlipLayers;
  /** The tile face down, as the board drew it before (identity-free). */
  back: TileFlipLayers;
  /** The body's colour toward each face: the wall shows both, edge-on. */
  wall: { front: string; back: string };
  durationMs: number;
  style: 'lift' | 'spin';
}

/** How much of the true thickness the flat band shows: the camera's tilt. */
const TILT = 0.5;
/** Strips in the wall ring; enough that the ring reads round at 4x slow-mo. */
const WALL_STRIPS = 40;
/** The eye's distance, in disc diameters: near enough that the near edge reads
 *  wider than the far one mid-turn. */
const PERSPECTIVE_DIAMETERS = 3.2;
/** A face sits this far proud of the band it carries, so they never z-fight. */
const FACE_PROUD = 0.02;
/** Easing of the turn itself, between the lift and the settle. */
const TURN_EASING = 'cubic-bezier(0.45, 0, 0.55, 1)';

const SVG_NS = 'http://www.w3.org/2000/svg';

const active = new Set<() => void>();

/** Remove every coin in flight, showing the tiles under them. */
export function cancelTileFlipOverlays(): void {
  for (const stop of Array.from(active)) stop();
}

/** How many coins are up now (tests). */
export function activeTileFlipOverlays(): number {
  return active.size;
}

function px(n: number): string {
  return `${Math.round(n * 1000) / 1000}px`;
}

function layer(
  doc: Document,
  markup: string,
  viewBox: string,
  side: number,
  transform: string,
): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('width', String(side));
  svg.setAttribute('height', String(side));
  svg.setAttribute('overflow', 'visible');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  const s = svg.style;
  s.position = 'absolute';
  s.left = '0';
  s.top = '0';
  s.overflow = 'visible';
  s.transform = transform;
  s.transformOrigin = '50% 50%';
  s.backfaceVisibility = 'hidden';
  s.setProperty('-webkit-backface-visibility', 'hidden');
  return svg;
}

/**
 * Turn the tile in `spec.slot` over with true perspective. Returns false, and
 * changes nothing, when it cannot (duration 0, no WAAPI, no screen mapping for
 * the board); the caller then falls back to the SVG turn.
 */
export function flipTileOverlay(spec: TileFlipOverlaySpec): boolean {
  if (spec.durationMs <= 0) return false;
  const slot = spec.slot as SVGGraphicsElement;
  const doc = slot.ownerDocument;
  const view = doc?.defaultView;
  const board = slot.closest?.('svg') as SVGSVGElement | null;
  if (!doc?.body || !view || !board || typeof board.getScreenCTM !== 'function') return false;
  const probe = doc.createElement('div') as HTMLElement & { animate?: unknown };
  if (typeof probe.animate !== 'function') return false;
  const ctm = board.getScreenCTM();
  if (!ctm || !(ctm.a > 0)) return false;

  cancelTileFlipOverlays();

  const k = ctm.a;
  const { center, radius, depth, reach } = spec;
  const side = 2 * reach * k;
  const viewBox = `${center.x - reach} ${center.y - reach} ${2 * reach} ${2 * reach}`;
  // The true thickness; the shear shows TILT of it as the resting band.
  const thick = (depth / TILT) * k;
  const half = thick / 2;
  const r = radius * k;
  const axis = spec.style === 'lift' ? 'rotateX' : 'rotateY';

  const root = doc.createElement('div');
  root.className = 'tile-flip-3d';
  root.setAttribute('aria-hidden', 'true');
  const place = () => {
    const m = board.getScreenCTM();
    if (!m) return;
    root.style.left = px(m.e + m.a * (center.x - reach));
    root.style.top = px(m.f + m.d * (center.y - reach));
  };
  Object.assign(root.style, {
    position: 'fixed',
    width: px(side),
    height: px(side),
    margin: '0',
    pointerEvents: 'none',
    zIndex: '2147483000',
    transformOrigin: '50% 50%',
  });
  place();

  const eye = doc.createElement('div');
  Object.assign(eye.style, {
    position: 'absolute',
    inset: '0',
    perspective: px(PERSPECTIVE_DIAMETERS * 2 * r),
    perspectiveOrigin: '50% 50%',
  });
  const camera = doc.createElement('div');
  Object.assign(camera.style, {
    position: 'absolute',
    inset: '0',
    transformStyle: 'preserve-3d',
    // y += TILT * (-z): the far side of the tile shows lower, as from above.
    transform: `matrix3d(1,0,0,0, 0,1,0,0, 0,${-TILT},1,0, 0,0,0,1)`,
  });
  const coin = doc.createElement('div');
  Object.assign(coin.style, {
    position: 'absolute',
    inset: '0',
    transformStyle: 'preserve-3d',
  });

  // The wall: strips around the rim, each the face's colour on its face half
  // and the back's on the other, shaded by the way it faces.
  const stripWidth = 2 * r * Math.tan(Math.PI / WALL_STRIPS) + 0.6;
  for (let i = 0; i < WALL_STRIPS; i += 1) {
    const turn = (i / WALL_STRIPS) * 360;
    const shade = 0.04 + 0.16 * ((1 - Math.cos(((turn - 135) * Math.PI) / 180)) / 2);
    const strip = doc.createElement('div');
    strip.className = 'tile-flip-3d-wall';
    Object.assign(strip.style, {
      position: 'absolute',
      left: px(side / 2 - stripWidth / 2),
      top: px(side / 2 - half),
      width: px(stripWidth),
      height: px(thick),
      background: `linear-gradient(rgba(0,0,0,${shade.toFixed(3)}), rgba(0,0,0,${shade.toFixed(3)})), linear-gradient(${spec.wall.front} 0 50%, ${spec.wall.back} 50% 100%)`,
      transform: `rotateZ(${turn}deg) translateY(${px(r)}) rotateX(-90deg)`,
      backfaceVisibility: 'hidden',
    });
    strip.style.setProperty('-webkit-backface-visibility', 'hidden');
    coin.append(strip);
  }

  const flipBack = spec.style === 'lift' ? 'rotateX(180deg)' : 'rotateY(180deg)';
  const backBand = layer(doc, spec.back.band, viewBox, side, `${flipBack} translateZ(${px(half)})`);
  const backFace = layer(
    doc,
    spec.back.face,
    viewBox,
    side,
    `${flipBack} translateZ(${px(half + FACE_PROUD * k)})`,
  );
  const frontBand = layer(doc, spec.front.band, viewBox, side, `translateZ(${px(half)})`);
  const frontFace = layer(
    doc,
    spec.front.face,
    viewBox,
    side,
    `translateZ(${px(half + FACE_PROUD * k)})`,
  );
  backBand.setAttribute('class', 'tile-flip-3d-back');
  backFace.setAttribute('class', 'tile-flip-3d-back');
  frontBand.setAttribute('class', 'tile-flip-3d-front');
  frontFace.setAttribute('class', 'tile-flip-3d-front');
  coin.append(backBand, backFace, frontBand, frontFace);
  camera.append(coin);
  eye.append(camera);
  root.append(eye);

  const duration = spec.durationMs;
  const at = (deg: number) => `translateZ(${px(-half)}) ${axis}(${deg}deg)`;
  // Hold face down while it rises, turn, settle face up: the lift's offsets.
  const turnFrames: Keyframe[] = [
    { transform: at(180), offset: 0 },
    { transform: at(180), offset: 0.2, easing: TURN_EASING },
    { transform: at(0), offset: 0.8 },
    { transform: at(0), offset: 1 },
  ];
  const bandOut: Keyframe[] = [
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: 0.2 },
    { opacity: 0, offset: 0.3 },
    { opacity: 0, offset: 1 },
  ];
  const bandIn: Keyframe[] = [
    { opacity: 0, offset: 0 },
    { opacity: 0, offset: 0.7 },
    { opacity: 1, offset: 0.8 },
    { opacity: 1, offset: 1 },
  ];

  doc.body.append(root);
  const target = slot as SVGGraphicsElement & { style?: CSSStyleDeclaration };
  target.style?.setProperty('visibility', 'hidden');

  const animations: Animation[] = [];
  const run = (el: Element, frames: Keyframe[]) => {
    const animation = (el as HTMLElement).animate(frames, { duration, fill: 'both' });
    animations.push(animation);
    return animation;
  };
  const turn = run(coin, turnFrames);
  run(backBand, bandOut);
  run(frontBand, bandIn);
  const lift = pieceFlipKeyframes(spec.style).lift;
  if (lift) run(root, lift);

  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    active.delete(stop);
    if (frame) view.cancelAnimationFrame?.(frame);
    if (timer) clearTimeout(timer);
    view.removeEventListener('resize', stop);
    view.removeEventListener('pagehide', stop);
    doc.removeEventListener('visibilitychange', onVisibility);
    for (const animation of animations) animation.cancel?.();
    root.remove();
    target.style?.removeProperty('visibility');
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') stop();
  };
  // Each frame: gone with the slot (a re-render or a page change), else keep
  // the coin over the tile through a scroll.
  const track = () => {
    frame = 0;
    if (done) return;
    if (!slot.isConnected || !board.isConnected) {
      stop();
      return;
    }
    place();
    frame = view.requestAnimationFrame?.(track) ?? 0;
  };
  active.add(stop);
  view.addEventListener('resize', stop);
  view.addEventListener('pagehide', stop);
  doc.addEventListener('visibilitychange', onVisibility);
  turn.addEventListener?.('finish', stop);
  turn.addEventListener?.('cancel', stop);
  // A backstop if the finish never comes (a throttled tab).
  timer = setTimeout(stop, duration + 500);
  frame = view.requestAnimationFrame?.(track) ?? 0;
  return true;
}
