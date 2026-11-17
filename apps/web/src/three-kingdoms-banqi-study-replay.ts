// Read-only study frames replay observed flips, never a sampled hidden deal.
import {
  applyThreeKingdomsBanqiMove,
  applyThreeKingdomsBanqiReplayMove,
  createInitialThreeKingdomsBanqiReplayState,
  getThreeKingdomsBanqiPlayerView,
  parseThreeKingdomsBanqiFen,
  parseThreeKingdomsBanqiReplayMove,
  THREE_KINGDOMS_BANQI_PUBLIC_REPLAY,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiReplayState,
  type ThreeKingdomsBanqiState,
  threeKingdomsBanqiMoveLabel,
} from '@mistboard/game';
import type { EmbedBoardHandle } from './embed/embed-card.js';
import { installBanqiBoardStyles } from './live-banqi-render.js';
import { analysisMarks, type DecisionOverlay } from './review/analysis-marks.js';
import { flipLuckPieceSvg, publicFlipLuckDetail } from './review/flip-luck.js';
import { attachLuckBadgeCard } from './review/luck-mark-card.js';
import { formatThreeKingdomsBanqiBestMove } from './review/three-kingdoms-banqi-decisions.js';
import { chapterAnnotations, GLYPH_SUFFIX_CLASS } from './study-chapter-annotations.js';
import type { StudyChapterPayload } from './study-chapter-spec.js';
import { threeKingdomsBanqiLastMoverInk } from './three-kingdoms-banqi-board.js';
import {
  animateThreeKingdomsBanqiBoardMove,
  animateThreeKingdomsBanqiReveal,
  renderThreeKingdomsBanqiLiveBoardSvg,
  type TkBoardMarker,
} from './three-kingdoms-banqi-diagrams.js';

function replayFrom(
  root: ThreeKingdomsBanqiReplayState,
  tokens: readonly string[],
  recorded: boolean,
) {
  const states = [root];
  const played: ThreeKingdomsBanqiMove[] = [];
  const labels: string[] = [];
  for (const token of tokens) {
    const plain = /^([a-i][1-5])([a-i][1-5])$/.exec(token);
    const move = recorded
      ? parseThreeKingdomsBanqiReplayMove(token)
      : plain
        ? ({ from: plain[1], to: plain[2] } as ThreeKingdomsBanqiMove)
        : null;
    if (!move) throw new Error('Invalid Three Kingdoms study move.');
    const before = states.at(-1)!;
    const after = recorded
      ? applyThreeKingdomsBanqiReplayMove(before, move)
      : applyThreeKingdomsBanqiMove(before as ThreeKingdomsBanqiState, move);
    if (after === before) throw new Error('Illegal Three Kingdoms study move.');
    const piece = after.board[move.to];
    labels.push(threeKingdomsBanqiMoveLabel(move, piece && !piece.faceDown ? piece : undefined));
    played.push(move);
    states.push(after);
  }
  return { states, played, labels };
}

export function threeKingdomsBanqiStudyLine(chapter: StudyChapterPayload) {
  const annotations = chapterAnnotations(chapter);
  const recorded = chapter.root?.replay === THREE_KINGDOMS_BANQI_PUBLIC_REPLAY;
  let root: ThreeKingdomsBanqiReplayState;
  if (recorded) {
    if (chapter.root?.rootFen !== undefined) throw new Error('Public replay cannot carry a deal.');
    root = createInitialThreeKingdomsBanqiReplayState('embed');
  } else {
    if (chapter.root?.replay !== undefined || !chapter.root?.rootFen)
      throw new Error('Three Kingdoms study needs a root.');
    const parsed = parseThreeKingdomsBanqiFen(chapter.root.rootFen);
    if (!parsed.ok || parsed.sampled) throw new Error('Three Kingdoms study needs a dealt root.');
    root = parsed.state;
  }
  const mainline = replayFrom(root, annotations.moves, recorded);
  const lines = new Map<number, ReturnType<typeof replayFrom>>();
  for (const [ply, line] of Object.entries(annotations.lines)) {
    const before = mainline.states[Number(ply) - 1];
    if (before) lines.set(Number(ply), replayFrom(before, line.moves, recorded));
  }
  // Only masked views cross the renderer boundary, even for authored dealt roots.
  const project = (line: ReturnType<typeof replayFrom>) => ({
    played: line.played,
    labels: line.labels,
    views: line.states.map((state) => getThreeKingdomsBanqiPlayerView(state, 'red')),
  });
  return {
    ...project(mainline),
    annotations,
    lines: new Map([...lines].map(([ply, line]) => [ply, project(line)])),
  };
}

export function mountThreeKingdomsBanqiStudyReplay(
  host: HTMLElement,
  line: ReturnType<typeof threeKingdomsBanqiStudyLine>,
  decisions: DecisionOverlay | null | undefined,
  hooks: { onPlyChange: (ply: number, maxPly: number) => void },
  perspective: 'red' | 'black',
): EmbedBoardHandle {
  installBanqiBoardStyles();
  const frame = document.createElement('div');
  frame.className = 'tk-banqi-live-board';
  host.replaceChildren(frame);
  const marks = analysisMarks({
    analysis: { moves: [], evals: [] },
    decisions,
    quoteEvalBestMove: false,
    formatBestMove: formatThreeKingdomsBanqiBestMove,
  });
  const luckDetail = (ply: number) => {
    const luck = decisions?.byPly.get(ply)?.luck;
    const move = line.played[ply - 1];
    const before = line.views[ply - 1];
    const drawn = move && line.views[ply]?.board[move.to];
    return luck !== undefined && move && before && drawn && !drawn.faceDown
      ? publicFlipLuckDetail('banqi', move, luck, before, drawn)
      : null;
  };
  const detach = attachLuckBadgeCard(
    host.closest<HTMLElement>('.embed-card') ?? host,
    (badge) => luckDetail(Number(badge.dataset.luckPath)),
    (role, color) => flipLuckPieceSvg('banqi', role, color),
  );
  let ply = 0;
  let inLine = false;
  const render = (view = line.views[ply]!, mainline = true) => {
    const glyph = mainline ? (line.annotations.glyphs[ply] ?? marks.get(ply)?.suffix) : undefined;
    const lastMove = view.lastMove;
    const markers: TkBoardMarker[] =
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
    frame.innerHTML = renderThreeKingdomsBanqiLiveBoardSvg(view.board, {
      selected: null,
      targets: [],
      draggingFrom: null,
      lastMove: lastMove ?? null,
      lastMoveInk: threeKingdomsBanqiLastMoverInk(view),
      markers,
    });
  };
  render();
  hooks.onPlyChange(ply, line.played.length);
  return {
    destroy: () => {
      detach();
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
      // Animate only a forward step along the displayed mainline. A flip
      // uses the observed face in that frame, never a hidden deal lookup.
      if (move) {
        if (move.from !== move.to) animateThreeKingdomsBanqiBoardMove(frame, move);
        else {
          const drawn = line.views[ply]?.board[move.to];
          if (before?.board[move.to]?.faceDown && drawn && !drawn.faceDown)
            animateThreeKingdomsBanqiReveal(frame, move.to);
        }
      }
      hooks.onPlyChange(ply, line.played.length);
    },
    jumpToLine: (atPly, cursor) => {
      const branch = line.lines.get(atPly);
      if (!branch || !Number.isFinite(cursor)) return;
      const view = branch.views[Math.max(0, Math.min(branch.played.length, Math.trunc(cursor)))];
      if (view) {
        inLine = true;
        render(view, false);
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
