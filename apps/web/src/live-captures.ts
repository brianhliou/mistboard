import type { Color, PieceRole, PlayerView } from '@mistboard/game';
import { captureRow } from './capture-render.js';
import { flippedBottom } from './live-board-flip.js';
import { type LiveRefs, liveState } from './live-state.js';
import { currentCaptures } from './live-view.js';
import { isColor, oppositeColor } from './web-utils.js';

type CaptureRefs = Pick<LiveRefs, 'capturesBottom' | 'capturesTop'>;

// Renders each known capture tally on the visual side owned by the capturer.
// The tally is derived from the current event stream, so fog-filtered live rooms
// only show captures the server has already revealed to this client.
export function renderCaptures(refs: CaptureRefs, view: PlayerView | null): void {
  clearCaptureStrip(refs.capturesTop);
  clearCaptureStrip(refs.capturesBottom);
  if (!view) return;

  const tally = currentCaptures();
  const seat = isColor(liveState.seat) ? liveState.seat : null;
  // The strips follow the board, so the viewer's flip moves them with it.
  const bottomCapturer = flippedBottom(seat ?? view.perspective);
  const topCapturer = oppositeColor(bottomCapturer);
  const knownLosses = seat ? knownLostRoles(view, seat) : null;
  // The opponent's haul is the seat's known losses (fog hides the captures
  // themselves), whichever strip it is drawn in.
  const haul = (capturer: Color) =>
    knownLosses && seat && capturer === oppositeColor(seat) ? knownLosses : tally[capturer];

  renderCaptureStrip(refs.capturesTop, haul(topCapturer), oppositeColor(topCapturer));
  renderCaptureStrip(refs.capturesBottom, haul(bottomCapturer), oppositeColor(bottomCapturer));
}

function clearCaptureStrip(strip: HTMLDivElement): void {
  strip.replaceChildren();
  strip.classList.toggle('has-captures', false);
}

function renderCaptureStrip(
  strip: HTMLDivElement,
  capturedRoles: PieceRole[],
  capturedColor: Color,
): void {
  const row = captureRow(capturedRoles, capturedColor);
  strip.classList.toggle('has-captures', row !== null);
  if (row) strip.append(row);
}

const STARTING_MATERIAL: Record<PieceRole, number> = {
  bishop: 2,
  king: 1,
  knight: 2,
  pawn: 8,
  queen: 1,
  rook: 2,
};

function knownLostRoles(view: PlayerView, color: Color): PieceRole[] {
  const current: Record<PieceRole, number> = {
    bishop: 0,
    king: 0,
    knight: 0,
    pawn: 0,
    queen: 0,
    rook: 0,
  };
  for (const piece of Object.values(view.board)) {
    if (piece?.color === color) current[piece.role] += 1;
  }

  const promotedPawnsStillOnBoard = (['queen', 'rook', 'bishop', 'knight'] as PieceRole[]).reduce(
    (total, role) => total + Math.max(0, current[role] - STARTING_MATERIAL[role]),
    0,
  );
  const missing: PieceRole[] = [];
  for (const role of ['queen', 'rook', 'bishop', 'knight', 'pawn', 'king'] as PieceRole[]) {
    const deficit = STARTING_MATERIAL[role] - current[role];
    const count =
      role === 'pawn' ? Math.max(0, deficit - promotedPawnsStillOnBoard) : Math.max(0, deficit);
    for (let i = 0; i < count; i += 1) missing.push(role);
  }
  return missing;
}

export { captureRow };
