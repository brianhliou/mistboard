// Reveal luck from the finished game's PUBLIC deal. Unknown captured pieces
// stay unknown; only a mover's actual, public reveal receives a luck mark.
import type { JieqiPieceRole } from '@mistboard/game';
import type { JieqiReplayLine } from '../jieqi-replay-board.js';
import type { AnalysisMark } from '../review/analysis-marks.js';
import { jieqiRevealOdds } from '../review/jieqi-luck-mark.js';
import type { LuckCardDetail } from '../review/luck-mark-card.js';
import { publicJieqiReplay } from './embed-jieqi-lines.js';

export function jieqiEmbedLuck(
  line: JieqiReplayLine,
  marks: ReadonlyMap<number, AnalysisMark>,
): Map<number, LuckCardDetail<JieqiPieceRole>> {
  const luck = new Map<number, LuckCardDetail<JieqiPieceRole>>();
  for (const [ply, mark] of marks) {
    const move = line.played[ply - 1];
    const before = line.states[ply - 1];
    const source = move && before?.board[move.from];
    if (mark.luck === undefined || !move || !before || !source?.faceDown || source.unknown)
      continue;
    luck.set(ply, {
      square: move.to,
      color: source.color,
      luck: mark.luck,
      kind: 'reveal',
      odds: jieqiRevealOdds(before, move),
      capture: null,
    });
  }
  return luck;
}

export async function loadJieqiEmbedLuck(roomId: string, marks: ReadonlyMap<number, AnalysisMark>) {
  if (![...marks.values()].some((mark) => mark.luck !== undefined)) return null;
  const response = await fetch(`/api/jieqi/games/${encodeURIComponent(roomId)}`);
  if (!response.ok || response.status === 204) return null;
  const line = publicJieqiReplay(await response.json());
  return line ? { line, luck: jieqiEmbedLuck(line, marks) } : null;
}
