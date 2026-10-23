// Play a cached best move in a game embed using the same public deal and board
// renderer as the review. The watch replay remains the source of the mainline,
// clocks and overlays. Never request analysis or invent a multi-ply continuation.
import {
  applyJieqiMove,
  createInitialJieqiState,
  type JieqiGameState,
  pikafishUciToJieqiMove,
} from '@mistboard/game';
import { type JieqiReplayLine, mountJieqiReplayBoard } from '../jieqi-replay-board.js';
import { type JieqiPostgameResponse, postgameViewAtPly } from '../live-jieqi-postgame.js';
import { recoverJieqiDeal } from '../review/jieqi-tree-adapter.js';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import type { EmbedBoardHandle } from './embed-card.js';

export function publicJieqiReplay(postgame: JieqiPostgameResponse): JieqiReplayLine | null {
  const root = postgameViewAtPly(postgame, 'truth', 0);
  if (!root) return null;
  const deal = recoverJieqiDeal(root, () => 0);
  const states: JieqiGameState[] = [createInitialJieqiState('game-embed', deal)];
  const played = postgame.timeline.flatMap((e) =>
    e.type === 'move-played' && e.move ? [e.move] : [],
  );
  for (const move of played) {
    const before = states[states.length - 1]!;
    const after = applyJieqiMove(before, move, { noCaptureClockLimit: Number.POSITIVE_INFINITY });
    if (before === after) return null;
    states.push(after);
  }
  return { states, played };
}

export async function installJieqiEmbedLines(
  host: HTMLElement,
  handle: EmbedBoardHandle,
  roomId: string,
  bestMoves: ReadonlyMap<number, string>,
  perspective: 'red' | 'black',
): Promise<Set<number>> {
  const unknownReveals = new Set<number>();
  if (!bestMoves.size || !handle.jumpToPly) return unknownReveals;
  const response = await fetch(`/api/jieqi/games/${encodeURIComponent(roomId)}`);
  if (!response.ok) return unknownReveals;
  const line = publicJieqiReplay(await response.json());
  if (!line) return unknownReveals;
  const main = document.createElement('div');
  main.append(...host.childNodes);
  const branch = document.createElement('div');
  host.append(main, branch);
  const replay = mountJieqiReplayBoard(branch, line, {
    perspective,
    lines: Object.fromEntries(
      [...bestMoves].flatMap(([ply, uci]) => {
        const move = pikafishUciToJieqiMove(uci);
        // No sampled identity is presented as an actual alternative reveal.
        if (!move) return [];
        if (line.states[ply - 1]?.board[move.from]?.unknown) {
          unknownReveals.add(ply);
          return [];
        }
        return [[ply, { moves: [`${move.from}${move.to}`] }]];
      }),
    ),
  });
  branch.hidden = true;
  const entries = handle.moveEntries?.() ?? [];
  const branches = new Map(replay.moveEntries().map((e) => [e.ply, e.line]));
  const jump = handle.jumpToPly.bind(handle);
  const destroy = handle.destroy.bind(handle);
  let selected: { atPly: number; cursor: number } | null = null;
  const repaint = () => {
    if (selected) replay.jumpToLine(selected.atPly, selected.cursor);
  };
  window.addEventListener(xiangqiAppearanceChangedEvent, repaint);
  handle.moveEntries = () =>
    entries.map((entry) => ({
      ...entry,
      ...(branches.get(entry.ply) ? { line: branches.get(entry.ply) } : {}),
    }));
  handle.jumpToLine = (atPly, cursor) => {
    if (!branches.get(atPly)) return;
    // Anchor the watch replay's clocks and mainline cursor at the position
    // this alternative starts from, even when selected from a distant ply.
    if (selected?.atPly !== atPly) jump(atPly - 1);
    selected = { atPly, cursor };
    main.hidden = true;
    branch.hidden = false;
    replay.jumpToLine(atPly, cursor);
  };
  handle.jumpToPly = (ply) => {
    selected = null;
    branch.hidden = true;
    main.hidden = false;
    jump?.(ply);
  };
  handle.destroy = () => {
    window.removeEventListener(xiangqiAppearanceChangedEvent, repaint);
    replay.destroy();
    destroy();
  };
  return unknownReveals;
}
