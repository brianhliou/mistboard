// The things an Atomic Xiangqi board draws that a xiangqi board does not,
// shared by the live room, the postgame and the study review so they cannot
// disagree:
//
//   - the AFTERMATH: a soft amber disc on every point the last move's
//     explosion cleared, the general's point included (the capturer's origin
//     is already the last-move shadow), so pieces do not simply vanish;
//   - the EXPLOSION, the first time a ply is on screen, the way lichess does
//     atomic: the discs and a shockwave appear at once, the capturer glides in
//     from its origin and fades as it arrives, and the pieces the blast removed
//     fade out where they stood, all within one piece glide. Later repaints of
//     the same position (a selection, a hover, a flip) draw the discs still,
//     without replaying the detonation;
//   - the CHECK notice copy, which has to say what "check" means here.
//
// One style for every cleared point: a game that ended by explosion shows the
// general's point as one more disc, and the status line says what happened.
// Under a blast the board's own last-move ring is hidden (`xq-has-blast` on
// the host), so the capture point carries one mark, not two.
//
// The board itself is xiangqi-board.ts: same array, same geometry, same piece
// set. An AtomicXiangqiPlayerView is a StandardXiangqiPlayerView with two more
// fields, so it renders through the same function. Motion is CSS on the marker
// classes (atomic-xiangqi.css) plus the shared piece glide, and both honour
// the piece-animation preference and prefers-reduced-motion.

import type {
  AtomicXiangqiColor,
  AtomicXiangqiPlayerView,
  XiangqiPieceRole,
} from '@mistboard/game';
import { glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';
import { LIVE_BOARD_GEO, XIANGQI_PIECE_SIZE, type XiangqiBoardMarker } from './xiangqi-board.js';
import { xiangqiBoardPoint } from './xiangqi-board-geometry.js';
import { renderXiangqiPiece } from './xiangqi-pieces.js';

/** Identity of the position a view shows, for "is this ply new on screen". */
export function atomicXiangqiBlastKey(view: AtomicXiangqiPlayerView): string {
  const move = view.lastMove ? `${view.lastMove.from}${view.lastMove.to}` : 'start';
  return `${view.id}:${view.moveNumber}:${move}:${view.status.type}`;
}

/**
 * The aftermath discs, and on a fresh ply the shockwave too. `fresh` is the
 * caller's "this position just arrived on screen".
 */
export function atomicXiangqiBlastMarkers(
  view: AtomicXiangqiPlayerView,
  options: { fresh?: boolean } = {},
): XiangqiBoardMarker[] {
  const fresh = options.fresh === true && view.lastBlast.length > 0;
  const markers: XiangqiBoardMarker[] = view.lastBlast.map((victim) => ({
    square: victim.square,
    kind: 'circle',
    className: fresh ? 'xq-marker--blast xq-marker--blast-fresh' : 'xq-marker--blast',
  }));
  // The shockwave rides the capture point, which the aftermath already lists
  // (the captured piece stood there), so it is a second marker on that point.
  if (fresh && view.lastMove) {
    markers.push({ square: view.lastMove.to, kind: 'circle', className: 'xq-marker--shock' });
  }
  return markers;
}

/** Flag the board host so the last-move ring yields to the aftermath disc. */
export function markAtomicXiangqiBlastHost(
  host: HTMLElement,
  view: AtomicXiangqiPlayerView | null,
): void {
  host.classList.toggle('xq-has-blast', (view?.lastBlast.length ?? 0) > 0);
}

/**
 * Whether a fresh capture on this view can be shown as a glide-then-blast.
 * False when animation is off (preference or reduced motion), when the ply is
 * not a capture, or when the view does not carry the capturer (a snapshot from
 * before that field existed).
 */
export function atomicXiangqiCaptureAnimates(view: AtomicXiangqiPlayerView): boolean {
  return (
    pieceAnimationDurationMs() > 0 &&
    view.lastBlast.length > 0 &&
    view.lastMove !== undefined &&
    view.lastCapturer !== undefined
  );
}

/**
 * The explosion's motion, lichess-style: nothing waits for anything else. Call
 * AFTER the board was rendered with the fresh aftermath (the post-explosion
 * position, discs and shockwave already in the marker band). This adds ghosts
 * on top for the length of one piece glide: the capturer glides in from its
 * origin, and it and the pieces the blast removed fade out together before it
 * would have arrived, so the burst and the disappearance are one event. The returned function cancels it (a newer position arrived
 * before the glide ended).
 */
export function animateAtomicXiangqiCapture(
  host: HTMLElement,
  view: AtomicXiangqiPlayerView,
  perspective: AtomicXiangqiColor,
): () => void {
  const duration = pieceAnimationDurationMs();
  const move = view.lastMove;
  const piece = view.lastCapturer;
  const layerHost = host.querySelector('.xq-live-pieces');
  const svg = host.querySelector('.xq-live-svg');
  if (duration <= 0 || !move || !piece || !layerHost || !svg) return () => {};
  const layoutAttr = svg.getAttribute('data-xiangqi-layout');
  const layout = layoutAttr === 'cell' ? 'cell' : 'intersection';
  const point = (square: string) => {
    const file = 'abcdefghi'.indexOf(square[0] ?? '');
    const rank = Number(square.slice(1));
    return xiangqiBoardPoint(file, rank, perspective, layout, LIVE_BOARD_GEO);
  };
  const from = point(move.from);
  const to = point(move.to);
  const ghostSlot = (
    subject: { color: AtomicXiangqiColor; role: XiangqiPieceRole },
    square: string,
    className: string,
  ): SVGGElement => {
    const at = point(square);
    const rank = Number(square.slice(1));
    const crossed = subject.role === 'soldier' && (subject.color === 'red' ? rank >= 6 : rank <= 5);
    const slot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    slot.setAttribute('class', `xq-piece-slot ${className}`);
    slot.innerHTML = renderXiangqiPiece(subject, {
      x: at.x - XIANGQI_PIECE_SIZE / 2,
      y: at.y - XIANGQI_PIECE_SIZE / 2,
      size: XIANGQI_PIECE_SIZE,
      className: 'xq-piece',
      crossed,
    });
    return slot;
  };
  const victims = view.lastBlast.map((victim) =>
    ghostSlot(victim.piece, victim.square, 'xq-piece-slot--victim'),
  );
  // The capturer gets its fade class AFTER the glide starts: glideSvgPiece
  // cancels every animation already running on the element, and a CSS fade
  // applied at insertion counts, which left the capturer un-faded and removed
  // late, visibly after the victims had gone.
  const capturer = ghostSlot(piece, move.to, 'xq-piece-slot--ghost');
  const ghosts = [...victims, capturer];
  for (const ghost of ghosts) layerHost.append(ghost);
  // Everything the blast takes is gone by the time the capturer would have
  // arrived: the victims and the capturer fade together over the first 60% of
  // the glide, so the capturer is seen to blow up on the way in rather than
  // to land and then vanish after the others.
  const goneMs = Math.round(duration * 0.6);
  for (const ghost of ghosts) ghost.style.setProperty('--xq-ghost-ms', `${goneMs}ms`);
  glideSvgPiece(capturer, from.x - to.x, from.y - to.y, duration);
  capturer.classList.add('xq-piece-slot--capturer');
  const clear = () => {
    for (const ghost of ghosts) ghost.remove();
  };
  const settle = setTimeout(clear, duration);
  return () => {
    clearTimeout(settle);
    clear();
  };
}

/** The reason phrase for the room chrome's end-of-game line. */
export function atomicXiangqiReasonPhrase(reason: string): string {
  switch (reason) {
    case 'checkmate':
      return 'checkmate';
    case 'stalemate':
      return 'stalemate';
    case 'general-captured':
      return 'the general was blown up';
    case 'timeout':
      return 'timeout';
    case 'resignation':
      return 'resignation';
    case 'abandonment':
      return 'abandonment';
    case 'repetition':
      return 'threefold repetition';
    case 'chasing':
      return 'perpetual check';
    case 'progress-clock':
      return 'sixty plies without a capture';
    default:
      return 'the game rules';
  }
}

/** Check notice body: whose general, and what the threat is. */
export function atomicXiangqiCheckBody(perspective: AtomicXiangqiColor, ownSeat: boolean): string {
  const whose = ownSeat ? 'Your' : perspective === 'red' ? 'Red’s' : 'Black’s';
  return `${whose} general can be taken or blown up next move. A repeated check like this loses.`;
}
