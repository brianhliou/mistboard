import type { XiangqiBoard, XiangqiColor, XiangqiPieceRole } from '@mistboard/game';

// Captured pieces for an open-information xiangqi room, read off the board:
// standard xiangqi has no promotion and no drops, so a side's captured pieces
// are exactly its starting set minus what it still has on the board. Strongest
// first, the order the flip variants' pools use. Not for variants that add or
// remove pieces some other way (drops, Fortress reserves, Horde).

const XIANGQI_START: Record<XiangqiPieceRole, number> = {
  general: 1,
  advisor: 2,
  elephant: 2,
  horse: 2,
  chariot: 2,
  cannon: 2,
  soldier: 5,
};

const STRONGEST_FIRST: readonly XiangqiPieceRole[] = [
  'chariot',
  'cannon',
  'horse',
  'elephant',
  'advisor',
  'soldier',
  'general',
];

export function xiangqiCapturedFromBoard(
  board: XiangqiBoard,
): { owner: XiangqiColor; role: XiangqiPieceRole }[] {
  const onBoard = new Map<string, number>();
  for (const piece of Object.values(board)) {
    if (!piece) continue;
    const key = `${piece.color}:${piece.role}`;
    onBoard.set(key, (onBoard.get(key) ?? 0) + 1);
  }
  const captured: { owner: XiangqiColor; role: XiangqiPieceRole }[] = [];
  for (const owner of ['red', 'black'] as const) {
    for (const role of STRONGEST_FIRST) {
      const missing = XIANGQI_START[role] - (onBoard.get(`${owner}:${role}`) ?? 0);
      for (let i = 0; i < missing; i += 1) captured.push({ owner, role });
    }
  }
  return captured;
}
