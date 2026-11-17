// A Flip Jungle study chapter on the shared embed card: the chapter's dealt
// root (rootFen, jungleFlipStateToDealtFen: the sixth field is the deal)
// replayed through the kernel, drawn by the live flip-jungle renderer. The
// card owns the seat rows, the score sheet and the stepper; this owns the
// board and the ply cursor, like mountBanqiReplayBoard.
//
// The board is the as-played view, as in the rules article's replay: a tile
// nobody has turned over is face down, and shows its dealt animal from the
// ply it is flipped. Tokens are the tree's own (`a1a1` flips a1, `a1b1` moves).
import {
  applyJungleFlipMove,
  getJungleFlipPlayerView,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipSquare,
  jungleFlipLastMoverInk,
  jungleFlipMoveLabelOnBoard,
  parseJungleFlipFen,
} from '@mistboard/game';
import {
  animateJungleFlipStep,
  type JungleFlipBoardMarker,
  type JungleFlipRenderBoard,
  renderJungleFlipBoardSvg,
} from './jungle-flip-render.js';
import { analysisMarks, type DecisionOverlay } from './review/analysis-marks.js';
import { jungleFlipLuckDetail, jungleFlipLuckPieceSvg } from './review/flip-luck.js';
import { attachLuckBadgeCard, attachLuckMarkCard } from './review/luck-mark-card.js';
import { formatFlipVariantBestMove } from './review/move-advice-text.js';
import { GLYPH_SUFFIX_CLASS } from './study-chapter-annotations.js';

export type JungleFlipReplayLine = { states: JungleFlipGameState[]; played: JungleFlipMove[] };

const TOKEN = /^([a-d][1-4])([a-d][1-4])$/;

function tokenToMove(token: string): JungleFlipMove | null {
  const m = TOKEN.exec(token);
  return m ? { from: m[1] as JungleFlipSquare, to: m[2] as JungleFlipSquare } : null;
}

/**
 * Replay a chapter's mainline from its dealt root as far as the kernel accepts
 * it; a token it refuses ends the line there. Null when the root is missing,
 * does not parse, or carries no deal (a sampled deal flips up animals that
 * were never there).
 */
export function replayJungleFlipLine(
  rootFen: string | undefined,
  tokens: readonly string[],
): JungleFlipReplayLine | null {
  if (!rootFen) return null;
  const parsed = parseJungleFlipFen(rootFen, { gameId: 'study-embed' });
  if (!parsed.ok || parsed.sampled) return null;
  const states: JungleFlipGameState[] = [parsed.state];
  const played: JungleFlipMove[] = [];
  for (const token of tokens) {
    const move = tokenToMove(token);
    if (!move) break;
    const before = states[states.length - 1]!;
    const next = applyJungleFlipMove(before, move);
    if (next === before) break;
    states.push(next);
    played.push(move);
  }
  return { states, played };
}

export function mountJungleFlipReplayBoard(
  host: HTMLElement,
  line: JungleFlipReplayLine,
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
  annotations: {
    glyphs?: Readonly<Record<number, string>>;
    notes?: Readonly<Record<number, string>>;
    decisions?: DecisionOverlay | null;
  } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{ ply: number; label: string }>;
  bottomSeat: () => 'first' | 'second';
} {
  const { states, played } = line;
  const total = played.length;
  const marks = analysisMarks({
    analysis: { moves: [], evals: [] },
    decisions: annotations.decisions,
    quoteEvalBestMove: false,
    formatBestMove: formatFlipVariantBestMove,
  });
  const luckDetail = (ply: number) => {
    const luck = annotations.decisions?.byPly.get(ply)?.luck;
    const move = played[ply - 1];
    const before = states[ply - 1];
    return luck !== undefined && move && before
      ? jungleFlipLuckDetail(move, { luck, before })
      : null;
  };

  const frame = document.createElement('div');
  frame.className = 'jungle-flip-embed-board';
  host.replaceChildren(frame);

  let index = 0;
  const detachMark = annotations.decisions?.byPly.size
    ? attachLuckMarkCard(frame, () => luckDetail(index), jungleFlipLuckPieceSvg)
    : undefined;
  const detachBadge = annotations.decisions?.byPly.size
    ? attachLuckBadgeCard(
        host.closest<HTMLElement>('.embed-card') ?? host,
        (badge) => luckDetail(Number(badge.dataset.luckPath)),
        jungleFlipLuckPieceSvg,
      )
    : undefined;
  const render = (animateFrom?: number): void => {
    // The renderer draws one fixed orientation (the deal has no sides), so
    // the seat the view is projected for only decides legal-move hints, which
    // a replay does not draw.
    const view = getJungleFlipPlayerView(states[index]!, 'red');
    const luck = luckDetail(index);
    const markers: JungleFlipBoardMarker[] = luck
      ? [{ square: luck.square as JungleFlipSquare, kind: 'luck', luck: { luck: luck.luck } }]
      : [];
    frame.innerHTML = renderJungleFlipBoardSvg(view.board as JungleFlipRenderBoard, {
      markers,
      lastMove: view.lastMove ?? null,
      lastMoveInk: jungleFlipLastMoverInk(view),
    });
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = forward ? played[index - 1] : played[animateFrom - 1];
      if (move) animateJungleFlipStep(frame, move, { reverse: !forward });
    }
    hooks.onPlyChange?.(index, total);
  };
  render();

  return {
    destroy: () => {
      detachMark?.();
      detachBadge?.();
      host.replaceChildren();
    },
    jumpToPly: (ply: number) => {
      const from = index;
      index = Math.max(0, Math.min(total, Math.trunc(ply)));
      render(from);
    },
    plyCount: () => total,
    moveEntries: () =>
      played.map((move, i) => {
        const mark = marks.get(i + 1);
        const glyph = annotations.glyphs?.[i + 1] ?? mark?.suffix;
        const note = [annotations.notes?.[i + 1], mark?.comment].filter(Boolean).join(' ');
        const luck = luckDetail(i + 1);
        return {
          ply: i + 1,
          label: jungleFlipMoveLabelOnBoard(move, states[i + 1]?.board),
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
          ...(luck ? { luck: Math.round(luck.luck) } : {}),
        };
      }),
    // One fixed orientation, first mover's seat row under it.
    bottomSeat: () => 'first',
  };
}
