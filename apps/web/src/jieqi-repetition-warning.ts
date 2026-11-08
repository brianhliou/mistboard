// Disposable ?repwarn prototype. Only public boards enter this module. In a
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

export type RepetitionWarningMode = 'heads-up' | 'mark' | 'confirm';
export function repetitionWarningMode(search: string): RepetitionWarningMode | null {
  const value = new URLSearchParams(search).get('repwarn');
  return value === 'heads-up' || value === 'mark' || value === 'confirm' ? value : null;
}

export type RepetitionLoss = { loser: JieqiColor; reason: 'perpetual-check' | 'perpetual-chase' };
export type RepetitionWarning = {
  headsUp: RepetitionLoss | null;
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

function responsibility(log: readonly Entry[], occurrences: number): RepetitionLoss | null {
  const key = log.at(-1)?.key;
  const matches = log.flatMap((item, index) => (item.key === key ? [index] : []));
  if (matches.length !== occurrences) return null;
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
  const empty: RepetitionWarning = { headsUp: null, losingMoves: [] };
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
  const headsUp = responsibility(log, 2);
  if (seat !== view.status.turn) return { headsUp, losingMoves: [] };
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
    const loss = responsibility([...log, next], 3);
    if (loss && loss.loser === seat) losingMoves.push({ ...loss, move });
  }
  return { headsUp, losingMoves };
}
