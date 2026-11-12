// FFQ uses banqi's board art and record notation, with fixed ink seats and a
// public covered-capture identity. None of these builders exports the deal.
import {
  banqiPieceLetter,
  type FFQBanqiMove,
  type FFQBanqiState,
  ffqBanqiStateToFen,
  getFFQBanqiPlayerView,
  type HiddenPieceReveal,
  hiddenPiecePgnToken,
} from '@mistboard/game';

export function ffqBanqiRecordSquare(index: number): string {
  return `${'abcdefgh'[Math.floor(index / 4)]}${(index % 4) + 1}`;
}

export function ffqBanqiPlyReveal(state: FFQBanqiState, move: FFQBanqiMove): HiddenPieceReveal {
  const flipped = move.from === move.to ? state.board[move.to] : null;
  const captured = move.from !== move.to ? state.board[move.to] : null;
  return {
    revealed: flipped ? { color: flipped.color, role: flipped.role } : null,
    capturedHidden: captured?.faceDown ? { color: captured.color, role: captured.role } : null,
  };
}

// Rotate the PUBLIC snapshot into the standard banqi card renderer's 8x4
// geometry. This is a rendering format only; FFQ's own snapshot retains HP.
export function ffqBanqiCardFen(state: FFQBanqiState): string {
  const snapshot = ffqBanqiStateToFen(state).split(' ');
  const view = getFFQBanqiPlayerView(state, 'observer');
  const rows: string[] = [];
  for (let x = 3; x >= 0; x -= 1) {
    let row = '';
    let empty = 0;
    for (let y = 0; y < 8; y += 1) {
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
  return [rows.join('/'), snapshot[1], snapshot[8], snapshot[4], snapshot[7]].join(' ');
}

// ICGA banqi movetext with FFQ's public start snapshot. Covered captures,
// HP and damage live in PGN comments; no standard-banqi rules are implied.
export function writeFFQBanqiPgn(
  tags: Record<string, string>,
  result: string,
  game: import('./variant-tenant/registry.js').TenantExportGame,
  frames: ReturnType<typeof import('./ffq-banqi-replay.js').ffqBanqiPostgameHistory>['truth'],
): string {
  const escapeTag = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = Object.entries({ ...tags, Result: result, SetUp: '1', FEN: frames[0]!.fen }).map(
    ([name, value]) => `[${name} "${escapeTag(value)}"]`,
  );
  const body = game.plies.map((ply, index) => {
    if (!ply.uci) throw new Error('Missing replay move');
    const frame = frames[index + 1]!;
    const token = hiddenPiecePgnToken('banqi', { uci: ply.uci, revealed: ply.revealed ?? null });
    const capture = ply.capturedHidden
      ? ` [%captured ${banqiPieceLetter(ply.capturedHidden as Parameters<typeof banqiPieceLetter>[0])}]`
      : '';
    const comment = `{[%hp ${frame.view.hp.red},${frame.view.hp.black}] [%damage ${frame.damage.red},${frame.damage.black}]${capture}}`;
    return `${index % 2 === 0 ? `${index / 2 + 1}. ` : ''}${token} ${comment}`;
  });
  return `${lines.join('\n')}\n\n${body.join(' ')} ${result}\n`;
}
