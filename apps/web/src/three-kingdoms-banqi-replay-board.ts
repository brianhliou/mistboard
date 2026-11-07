// A dealt study mainline on the embed card, drawn with the live masked board.
import {
  applyThreeKingdomsBanqiMove,
  banqiInkForSeat,
  getThreeKingdomsBanqiPlayerView,
  parseThreeKingdomsBanqiFen,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiSquare,
  type ThreeKingdomsBanqiState,
  threeKingdomsBanqiMoveLabel,
} from '@mistboard/game';
import {
  animateThreeKingdomsBanqiBoardMove,
  animateThreeKingdomsBanqiReveal,
  renderThreeKingdomsBanqiLiveBoardSvg,
} from './three-kingdoms-banqi-diagrams.js';

export function replayThreeKingdomsBanqiLine(
  rootFen: string | undefined,
  tokens: readonly string[],
) {
  if (!rootFen) return null;
  const parsed = parseThreeKingdomsBanqiFen(rootFen, { gameId: 'study-embed' });
  if (!parsed.ok || parsed.sampled) return null;
  const states: ThreeKingdomsBanqiState[] = [parsed.state];
  const played: ThreeKingdomsBanqiMove[] = [];
  for (const token of tokens) {
    if (!/^[a-i][1-5][a-i][1-5]$/.test(token)) return null;
    const move = {
      from: token.slice(0, 2) as ThreeKingdomsBanqiSquare,
      to: token.slice(2) as ThreeKingdomsBanqiSquare,
    };
    const before = states.at(-1)!;
    const next = applyThreeKingdomsBanqiMove(before, move);
    if (next === before) return null;
    states.push(next);
    played.push(move);
  }
  return { states, played };
}

export function mountThreeKingdomsBanqiReplayBoard(
  host: HTMLElement,
  line: NonNullable<ReturnType<typeof replayThreeKingdomsBanqiLine>>,
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
) {
  const { states, played } = line;
  const frame = document.createElement('div');
  frame.className = 'tk-banqi-live-board';
  host.replaceChildren(frame);
  let index = 0;
  function render(from?: number) {
    const state = states[index]!;
    const view = getThreeKingdomsBanqiPlayerView(state, 'red');
    frame.innerHTML = renderThreeKingdomsBanqiLiveBoardSvg(view.board, {
      selected: null,
      targets: [],
      draggingFrom: null,
      lastMove: view.lastMove ?? null,
      lastMoveInk: index ? banqiInkForSeat(state, index % 2 ? 'red' : 'black') : null,
    });
    if (from !== undefined && index === from + 1) {
      const move = played[index - 1]!;
      if (move.from === move.to) animateThreeKingdomsBanqiReveal(frame, move.to);
      else animateThreeKingdomsBanqiBoardMove(frame, move);
    }
    hooks.onPlyChange?.(index, played.length);
  }
  render();
  return {
    destroy: () => host.replaceChildren(),
    jumpToPly: (ply: number) => {
      const from = index;
      index = Math.max(0, Math.min(played.length, Math.trunc(ply)));
      render(from);
    },
    plyCount: () => played.length,
    moveEntries: () =>
      played.map((move, i) => ({
        ply: i + 1,
        label: threeKingdomsBanqiMoveLabel(move, states[i]!.board[move.from]),
      })),
    bottomSeat: () => 'first' as const,
  };
}
