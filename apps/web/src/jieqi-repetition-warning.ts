// Only public boards enter this module. In a
// reversible window every mover is already face up; captures and reveals reset
// the window, so neither a deal nor a captured identity is needed to predict it.
import {
  createJieqiChasePosition,
  type JieqiColor,
  type JieqiMove,
  type JieqiPlayerView,
  jieqiChaseResponsibility,
  jieqiCheckedGeneral,
} from '@mistboard/game';

/** Public position identity only; mask even accidentally truth-bearing boards. */
export function repetitionConfirmationPosition(view: JieqiPlayerView): string {
  return JSON.stringify([view.id, view.moveNumber, view.status, view.lastMove, entry(view)?.key]);
}

type LabelBox = { left: number; top: number; width: number; height: number };

/** All boxes use rendered board coordinates, so orientation and layout need no
 * special cases. Prefer clear legal points, then the side away from the piece.
 * Clamping is applied before scoring, including at corners. */
export function placeRepetitionLabel(
  point: LabelBox,
  board: LabelBox,
  label: { width: number; height: number },
  selected: LabelBox,
  siblings: readonly LabelBox[],
): { left: number; top: number } {
  const x = point.left + point.width / 2;
  const y = point.top + point.height / 2;
  const awayX = x - (selected.left + selected.width / 2);
  const awayY = y - (selected.top + selected.height / 2);
  const awayLength = Math.hypot(awayX, awayY) || 1;
  const pad = 4;
  const gap = 4;
  const width = Math.min(label.width, Math.max(0, board.width - pad * 2));
  const height = Math.min(label.height, Math.max(0, board.height - pad * 2));
  const overlap = (a: LabelBox, b: LabelBox) =>
    Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const candidates = (
    [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const
  ).map(([dx, dy]) => {
    const left = Math.max(
      board.left + pad,
      Math.min(
        x + dx * (point.width / 2 + gap + width / 2) - width / 2,
        board.left + board.width - pad - width,
      ),
    );
    const top = Math.max(
      board.top + pad,
      Math.min(
        y + dy * (point.height / 2 + gap + height / 2) - height / 2,
        board.top + board.height - pad - height,
      ),
    );
    const box = { left, top, width, height };
    const vx = left + width / 2 - x;
    const vy = top + height / 2 - y;
    const direction = (vx * awayX + vy * awayY) / ((Math.hypot(vx, vy) || 1) * awayLength);
    // Any covered legal point outweighs directional preference. Also avoid
    // covering the selected piece or the warning ring after edge clamping.
    const covered = [...siblings, selected, point].reduce((sum, b) => sum + overlap(box, b), 0);
    return { left, top, score: covered * 100 + (1 - direction) };
  });
  const best = candidates.reduce((a, b) => (a.score <= b.score ? a : b));
  return { left: best.left, top: best.top };
}

export type RepetitionLoss = { loser: JieqiColor; reason: 'perpetual-check' | 'perpetual-chase' };
export type RepetitionWarning = {
  losingMoves: Array<RepetitionLoss & { move: JieqiMove }>;
};
export type PublicRepetitionPosition = Pick<JieqiPlayerView, 'board' | 'status' | 'lastMove'>;
type Entry = {
  key: string;
  mover?: JieqiColor;
  gaveCheck?: boolean;
  chase: ReturnType<typeof createJieqiChasePosition>;
};

const opposite = (color: JieqiColor): JieqiColor => (color === 'red' ? 'black' : 'red');
function entry(position: PublicRepetitionPosition, prior?: Entry): Entry | null {
  if (position.status.type !== 'playing') return null;
  const chase = createJieqiChasePosition(position.board, prior?.chase, position.lastMove);
  const key = JSON.stringify([
    position.status.turn,
    Object.entries(chase.board).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return {
    key,
    chase,
    ...(prior
      ? {
          mover: opposite(position.status.turn),
          gaveCheck: jieqiCheckedGeneral(chase.board, position.status) !== null,
        }
      : {}),
  };
}

function responsibility(log: readonly Entry[]): RepetitionLoss | null {
  const key = log.at(-1)?.key;
  const matches = log.flatMap((item, index) => (item.key === key ? [index] : []));
  if (matches.length !== 3) return null;
  const interval = log.slice(matches[0]);
  const cycle = interval.slice(1);
  const perpetual = (color: JieqiColor): boolean => {
    const own = cycle.filter((item) => item.mover === color);
    return own.length > 0 && own.every((item) => item.gaveCheck);
  };
  const red = perpetual('red');
  const black = perpetual('black');
  if (red !== black) return { loser: red ? 'red' : 'black', reason: 'perpetual-check' };
  if (cycle.some((item) => item.gaveCheck)) return null;
  const loser = jieqiChaseResponsibility(interval);
  return loser ? { loser, reason: 'perpetual-chase' } : null;
}

/** History must be consecutive public plies ending at view. Missing history
 * fails closed. The caller uses the existing masked live replay, also on reload. */
export function jieqiRepetitionWarning(
  rule: unknown,
  history: readonly PublicRepetitionPosition[],
  view: JieqiPlayerView,
  seat: unknown,
): RepetitionWarning {
  const empty: RepetitionWarning = { losingMoves: [] };
  if (rule !== 'jqe-v1' || view.status.type !== 'playing' || history.length === 0) return empty;
  let log: Entry[] = [];
  for (const position of history) {
    const prior = log.at(-1);
    const move = position.lastMove;
    if (prior && (!move || !prior.chase.board[move.from])) return empty;
    const item = entry(position, prior);
    if (!item) return empty;
    const irreversible =
      prior && move && (prior.chase.board[move.to] || prior.chase.board[move.from]?.faceDown);
    log = irreversible ? [item] : [...log, item];
  }
  const current = log.at(-1)!;
  if (entry(view)?.key !== current.key) return empty;
  if (seat !== view.status.turn) return empty;
  const losingMoves: RepetitionWarning['losingMoves'] = [];
  for (const move of view.legalMoves) {
    const piece = current.chase.board[move.from];
    // An irreversible move cannot repeat. Never guess a concealed role.
    if (!piece || piece.faceDown || current.chase.board[move.to]) continue;
    const board = { ...current.chase.board, [move.to]: piece };
    delete board[move.from];
    const next = entry(
      { board, status: { type: 'playing', turn: opposite(view.status.turn) }, lastMove: move },
      current,
    )!;
    const loss = responsibility([...log, next]);
    if (loss && loss.loser === seat) losingMoves.push({ ...loss, move });
  }
  return { losingMoves };
}
