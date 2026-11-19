// Decided 2026-11-15: study embeds consume only observed Fanfanqi outcomes.
import {
  applyFFQBanqiReplayMove,
  type BanqiMove,
  banqiHiddenPool,
  banqiMoveLabelOnBoard,
  type FFQBanqiReplayState,
  getFFQBanqiPlayerView,
  parseFFQBanqiReplayMove,
  validateFFQBanqiReplayTree,
} from '@mistboard/game';
import { boardCoordinatesEnabled } from './display-preferences.js';
import type { EmbedBoardHandle } from './embed/embed-card.js';
import { ffqBanqiBoardView, ffqBanqiSquare } from './ffq-banqi-board.js';
import { createFFQBanqiHpRow } from './ffq-banqi-hp.js';
import {
  animateBanqiBoardMove,
  animateBanqiReveal,
  type BanqiBoardMarker,
  installBanqiBoardStyles,
  renderBanqiBoardSvg,
} from './live-banqi-render.js';
import { analysisMarks, type DecisionOverlay } from './review/analysis-marks.js';
import { formatFFQBanqiBestMove } from './review/ffq-banqi-decisions.js';
import { type FlipLuckDetail, flipLuckPieceSvg, publicFlipLuckDetail } from './review/flip-luck.js';
import { attachLuckBadgeCard } from './review/luck-mark-card.js';
import { chapterAnnotations, GLYPH_SUFFIX_CLASS } from './study-chapter-annotations.js';
import type { StudyChapterPayload } from './study-chapter-spec.js';

function replayFrom(root: FFQBanqiReplayState, tokens: readonly string[], sideline = false) {
  const states = [root];
  const played: BanqiMove[] = [];
  const labels: string[] = [];
  for (const token of tokens) {
    const move = parseFFQBanqiReplayMove(token);
    if (!move) throw new Error('Invalid Fanfanqi study move.');
    const before = states.at(-1)!;
    // Even an annotated outcome cannot predict a different chance event.
    if (sideline && (move.from === move.to || before.board[move.to]?.faceDown)) break;
    const after = applyFFQBanqiReplayMove(before, move);
    const boardMove = { from: ffqBanqiSquare(move.from), to: ffqBanqiSquare(move.to) };
    labels.push(
      banqiMoveLabelOnBoard(
        boardMove,
        ffqBanqiBoardView(getFFQBanqiPlayerView(after, 'observer')).board,
      ),
    );
    played.push(boardMove);
    states.push(after);
  }
  return { states, played, labels };
}

export function ffqBanqiStudyLine(chapter: StudyChapterPayload) {
  const root = validateFFQBanqiReplayTree({ ...chapter.root, version: 1 });
  const annotations = chapterAnnotations(chapter);
  const mainline = replayFrom(root, annotations.moves);
  const lines = new Map<number, ReturnType<typeof replayFrom>>();
  for (const [ply, line] of Object.entries(annotations.lines)) {
    const before = mainline.states[Number(ply) - 1];
    if (!before) continue;
    const branch = replayFrom(before, line.moves, true);
    if (branch.played.length) {
      lines.set(Number(ply), branch);
      annotations.lines[Number(ply)] = {
        ...line,
        moves: line.moves.slice(0, branch.played.length),
      };
      if (branch.played.length < line.moves.length) delete annotations.lines[Number(ply)]!.verdict;
      delete annotations.lines[Number(ply)]!.replies;
    } else delete annotations.lines[Number(ply)];
  }
  delete annotations.branches;
  const project = (line: ReturnType<typeof replayFrom>) => ({
    played: line.played,
    labels: line.labels,
    views: line.states.map((state) => ffqBanqiBoardView(getFFQBanqiPlayerView(state, 'observer'))),
    hp: line.states.map((state) => ({ ...state.hp })),
  });
  return {
    ...project(mainline),
    annotations,
    lines: new Map([...lines].map(([ply, line]) => [ply, project(line)])),
  };
}

export function mountFFQBanqiStudyReplay(
  host: HTMLElement,
  line: ReturnType<typeof ffqBanqiStudyLine>,
  decisions: DecisionOverlay | null | undefined,
  hooks: { onPlyChange: (ply: number, maxPly: number) => void },
  perspective: 'red' | 'black',
): EmbedBoardHandle {
  installBanqiBoardStyles();
  const frame = document.createElement('div');
  frame.className = 'ffq-banqi-study-board';
  const topHp = document.createElement('div');
  const bottomHp = document.createElement('div');
  topHp.className = bottomHp.className = 'ffq-banqi-study-hp';
  host.replaceChildren(topHp, frame, bottomHp);
  const marks = analysisMarks({
    analysis: { moves: [], evals: [] },
    decisions,
    quoteEvalBestMove: false,
    formatBestMove: formatFFQBanqiBestMove,
  });
  const luckDetail = (ply: number): FlipLuckDetail | null => {
    const luck = decisions?.byPly.get(ply)?.luck;
    const move = line.played[ply - 1];
    const before = line.views[ply - 1];
    const after = line.views[ply];
    if (luck === undefined || !move || !before || !after) return null;
    if (move.from === move.to) {
      const drawn = after.board[move.to];
      return drawn && !drawn.faceDown
        ? publicFlipLuckDetail('banqi', move, luck, before, drawn)
        : null;
    }
    // FFQ publicly discloses a covered victim off the board. Its identity
    // comes only from this capture, never from the pre-move covered tile.
    const victim = after.captured[before.captured.length];
    if (!before.board[move.to]?.faceDown || !victim?.role || before.status.type !== 'playing')
      return null;
    const pool = banqiHiddenPool(before);
    const entries = (['red', 'black'] as const).flatMap((color) =>
      pool[color].entries.filter((p) => p.count > 0).map((p) => ({ ...p, color })),
    );
    const count =
      entries.find((p) => p.color === victim.owner && p.role === victim.role)?.count ?? 0;
    const total = pool.red.total + pool.black.total;
    if (!count || !total) return null;
    return {
      square: move.to,
      color: before.status.turn,
      luck,
      kind: 'capture',
      odds: null,
      capture: { role: victim.role, color: victim.owner, count, total, pool: entries },
    };
  };
  const detachLuck = attachLuckBadgeCard(
    host.closest<HTMLElement>('.embed-card') ?? host,
    (badge) => luckDetail(Number(badge.dataset.luckPath)),
    (role, color) => flipLuckPieceSvg('banqi', role, color),
  );
  let ply = 0;
  let inLine = false;
  const render = (view = line.views[ply]!, hp = line.hp[ply]!, mainline = true) => {
    const glyph = mainline ? (line.annotations.glyphs[ply] ?? marks.get(ply)?.suffix) : undefined;
    const lastMove = view.lastMove;
    const markers: BanqiBoardMarker[] =
      glyph && lastMove
        ? [
            {
              square: lastMove.to,
              kind: 'glyph',
              text: glyph,
              className: `xq-marker--${GLYPH_SUFFIX_CLASS[glyph] ?? ''}`,
            },
          ]
        : [];
    const bottom = perspective;
    topHp.replaceChildren(createFFQBanqiHpRow({ hp }, bottom === 'red' ? 'black' : 'red'));
    bottomHp.replaceChildren(createFFQBanqiHpRow({ hp }, bottom));
    frame.innerHTML = renderBanqiBoardSvg(view, perspective, {
      coordinates: boardCoordinatesEnabled(),
      markers,
    });
  };
  render();
  hooks.onPlyChange(ply, line.played.length);
  return {
    destroy: () => {
      detachLuck();
      host.replaceChildren();
    },
    jumpToPly: (next) => {
      if (!Number.isFinite(next)) return;
      const nextPly = Math.max(0, Math.min(line.played.length, Math.trunc(next)));
      const move = !inLine && nextPly === ply + 1 ? line.played[ply] : undefined;
      const before = line.views[ply];
      ply = nextPly;
      inLine = false;
      render();
      // Only a forward step along the mainline animates, as the review page
      // does it: a step or capture glides, a flip turns over the face this
      // frame's public view already shows. Back steps and jumps repaint.
      if (move) {
        if (move.from !== move.to) animateBanqiBoardMove(frame, move);
        else {
          const drawn = line.views[ply]?.board[move.to];
          if (before?.board[move.to]?.faceDown && drawn && !drawn.faceDown)
            animateBanqiReveal(frame, move.to);
        }
      }
      hooks.onPlyChange(ply, line.played.length);
    },
    jumpToLine: (atPly, cursor) => {
      const branch = line.lines.get(atPly);
      if (!branch || !Number.isFinite(cursor)) return;
      const index = Math.max(0, Math.min(branch.played.length, Math.trunc(cursor)));
      const view = branch.views[index];
      if (view) {
        inLine = true;
        render(view, branch.hp[index]!, false);
      }
    },
    plyCount: () => line.played.length,
    playedMoves: () => line.played.map((move, i) => ({ ...move, ply: i + 1 })),
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
    moveNumbering: () => ({
      firstMover:
        line.views[0]!.status.type === 'playing' && line.views[0]!.status.turn === 'black'
          ? 'b'
          : 'a',
      firstNumber: line.views[0]!.moveNumber,
    }),
    moveEntries: () =>
      line.labels.map((label, i) => {
        const ply = i + 1;
        const mark = marks.get(ply);
        const glyph = line.annotations.glyphs[ply] ?? mark?.suffix;
        const note = [line.annotations.notes[ply], mark?.comment].filter(Boolean).join(' ');
        const branch = line.lines.get(ply);
        return {
          ply,
          label,
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
          ...(mark?.luck === undefined ? {} : { luck: mark.luck }),
          ...(branch
            ? {
                line: {
                  moves: branch.labels,
                  verdict: line.annotations.lines[ply]?.verdict,
                  note: line.annotations.lines[ply]?.note,
                },
              }
            : {}),
        };
      }),
  };
}
