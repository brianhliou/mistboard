// Public FFQ snapshot, never a dealt FEN or canonical save format.
// Rules as implemented by Huorongrong (mistboard#800).
//
// <board> <turn r|b> <redHP> <blackHP> <clock> <redChases> <blackChases>
// <fullmove> <public-pool> <redUnknownCaptured> <blackUnknownCaptured>
//
// Eight ranks, y=7 first, four files left-to-right. X hides BOTH ink and role;
// G/A/E/R/H/C/S are revealed pieces (UPPER red, lower black), digits are empties.
// Pool: <letter><count> in rank order, red then black, or '-'. It includes the
// identities of covered captures not shown to an observer; the last two fields
// count those captures by ink. Computed only from the masked observer view.
// Permuting identities underneath backs cannot change any field.
//
// No parser/dealt field: importing a public snapshot cannot reconstruct the
// secret deal or either player's private capture knowledge. Replay must use the
// server-secret initial deal and actions, as in the Three Kingdoms boundary.
import { banqiPieceLetter } from './banqi-fen.js';
import {
  FFQ_BANQI_ROLE_ORDER,
  type FFQBanqiState,
  ffqBanqiSeatToMove,
  getFFQBanqiPlayerView,
} from './variants-ffq-banqi.js';

export function ffqBanqiStateToFen(state: FFQBanqiState): string {
  const view = getFFQBanqiPlayerView(state, 'observer');
  const rows: string[] = [];
  for (let y = 7; y >= 0; y -= 1) {
    let row = '';
    let empty = 0;
    for (let x = 0; x < 4; x += 1) {
      const piece = view.board[y * 4 + x];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      row += piece.faceDown ? 'X' : banqiPieceLetter(piece);
    }
    if (empty) row += empty;
    rows.push(row);
  }
  let pool = '';
  for (const color of ['red', 'black'] as const) {
    for (const role of FFQ_BANQI_ROLE_ORDER) {
      const count = view.pool[color][role];
      if (count > 0) pool += `${banqiPieceLetter({ color, role })}${count}`;
    }
  }
  return [
    rows.join('/'),
    ffqBanqiSeatToMove(state)[0],
    view.hp.red,
    view.hp.black,
    view.noProgressClock,
    view.chaseCounts.red,
    view.chaseCounts.black,
    view.moveNumber,
    pool || '-',
    view.unknownCaptured.red,
    view.unknownCaptured.black,
  ].join(' ');
}
