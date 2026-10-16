// /embed/broadcast/xiangqi/board/:boardId — one relayed professional game,
// rendered alone for someone else's page (#454): an English creator's article
// or a club site follows the game on our board, the way lichess broadcasts are
// embedded. Same card as the line and study embeds (mountChapterEmbed): the
// broadcast supplies the moves, the English names, the event and the result,
// and the credit link goes to the game's own broadcast page.
//
// A live game refreshes: every 30 seconds the page asks for the game again and
// redraws when moves have arrived (records reach us after play for most
// events, so "live" here is whatever the source has published).
//
// A game the server has analysed carries the engine's reading, the way the
// review page does: each inaccuracy, mistake and blunder gets its mark, and
// the engine's line from the position before it hangs beside the move as a
// side line the reader can step through. The game becomes a small study tree
// and the study embed's own converter (study-chapter-spec.ts) draws it.

import { type XiangqiMove, xiangqiMoveToFsfUci } from '@mistboard/game';
import { ASSESSMENT_GLYPH } from '../assessment-glyphs.js';
import { advantageSymbol } from '../review/engine/eval-format.js';
import { fetchCachedGameAnalysis, type GameAnalysis } from '../review/game-analysis.js';
import type { StudyChapterPayload, StudyTreeNode } from '../study-chapter-spec.js';
import { lineToChapter } from './embed-line-page.js';
import type { EmbedBroadcastRoute, EmbedLineSpec } from './embed-route.js';
import { mountChapterEmbed } from './embed-study-page.js';
import './embed.css';

type Named = { name: string; nameEn?: string };

type BroadcastBoardPayload = {
  board: {
    id: string;
    tourSlug: string;
    roundId: string;
    red: Named;
    black: Named;
    result: string;
    status: 'scheduled' | 'live' | 'complete';
  };
  timeline: Array<{ ply: number; move: XiangqiMove }>;
};

type BroadcastTourPayload = {
  tour: Named;
  rounds: Array<Named & { id: string }>;
};

const REFRESH_MS = 30_000;

function english(entity: Named): string {
  return entity.nameEn?.trim() || entity.name;
}

function note(root: HTMLElement, message: string): void {
  const box = document.createElement('p');
  box.className = 'embed-note';
  box.textContent = message;
  root.replaceChildren(box);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The card's line: the moves as the xiangqi line tokens (h3e3), the names
 *  in English, the event and round as the card's header. */
export function broadcastLine(
  data: BroadcastBoardPayload,
  tour: BroadcastTourPayload | null,
): EmbedLineSpec {
  const round = tour?.rounds.find((entry) => entry.id === data.board.roundId);
  const event = [tour ? english(tour.tour) : null, round ? english(round) : null]
    .filter(Boolean)
    .join(' · ');
  return {
    fen: null,
    moves: [...data.timeline]
      .sort((a, b) => a.ply - b.ply)
      .map((entry) => xiangqiMoveToFsfUci(entry.move)),
    red: english(data.board.red),
    black: english(data.board.black),
    event: event || null,
    result: data.board.result === '*' ? null : data.board.result,
  };
}

// The study's NAG codes for the review's judgments.
const JUDGMENT_NAG: Record<string, number> = { inaccuracy: 6, mistake: 2, blunder: 4 };
// An engine line long enough to show the idea, short enough to read.
const SIDE_LINE_PLIES = 8;
// The assessment NAG for each symbol, the inverse of ASSESSMENT_GLYPH.
const NAG_FOR_SYMBOL = new Map(
  Object.entries(ASSESSMENT_GLYPH).map(([code, symbol]) => [symbol, Number(code)]),
);

/** The game as a study chapter: the mainline, and where the engine judged a
 *  move, its mark and the engine's line from the position before it. */
export function broadcastChapter(
  line: EmbedLineSpec,
  analysis: Pick<GameAnalysis, 'moves' | 'evals'> | null,
): StudyChapterPayload {
  const chapter = lineToChapter({ variant: 'xiangqi' }, line);
  if (!analysis) return chapter;
  // The mainline as an array: nodes[p] is the node whose move is ply p, and
  // nodes[0] the root, so a move's parent is nodes[p - 1].
  const root = chapter.root?.root as StudyTreeNode;
  const nodes: StudyTreeNode[] = [root];
  for (let node = root.children?.[0]; node; node = node.children?.[0]) nodes.push(node);
  const evalByPly = new Map(analysis.evals.map((entry) => [entry.ply, entry]));
  for (const move of analysis.moves) {
    const judged = JUDGMENT_NAG[move.judgment ?? ''];
    const played = nodes[move.ply];
    const parent = nodes[move.ply - 1];
    if (!judged || !played || !parent) continue;
    played.annotations = { ...played.annotations, glyphs: [judged] };
    const before = evalByPly.get(move.ply - 1);
    const pv = before?.pv?.length ? before.pv : before?.best ? [before.best] : [];
    // Nothing to show when the engine's first choice is the move played.
    if (pv.length === 0 || pv[0] === played.uci) continue;
    const steps = pv.slice(0, SIDE_LINE_PLIES).map((uci): StudyTreeNode => ({ uci, children: [] }));
    for (let i = 0; i + 1 < steps.length; i++) steps[i]!.children = [steps[i + 1]!];
    const first = steps[0];
    const last = steps.at(-1);
    if (!first || !last) continue;
    // Where the line ends up, from the same search that chose it (the eval of
    // the position before the move, Red's side): the symbol closes the line,
    // the way the article widget closes its engine lines.
    const nag = NAG_FOR_SYMBOL.get(advantageSymbol(before?.cp ?? null, before?.mate ?? null));
    if (nag !== undefined) last.annotations = { glyphs: [nag] };
    parent.children = [...(parent.children ?? []), first];
  }
  return chapter;
}

export async function mountEmbedBroadcast(
  root: HTMLElement,
  route: EmbedBroadcastRoute,
  options: { startPly?: number | null } = {},
): Promise<void> {
  document.body.classList.add('embed-body');
  document.documentElement.dataset.embed = 'broadcast';
  root.className = 'embed-root';
  const boardUrl = `/api/xiangqi/broadcasts/boards/${encodeURIComponent(route.boardId)}`;
  const data = await fetchJson<BroadcastBoardPayload>(boardUrl);
  if (!data) {
    note(root, 'This broadcast game is not available.');
    return;
  }
  const tour = await fetchJson<BroadcastTourPayload>(
    `/api/xiangqi/broadcasts/${encodeURIComponent(data.board.tourSlug)}`,
  );
  // The server's analysis of the game, when it has run (null until then, and
  // for a game still being played).
  const analysis =
    data.board.status === 'complete'
      ? await fetchCachedGameAnalysis('xiangqi-broadcasts', route.boardId).catch(() => null)
      : null;
  const credit = {
    href: `/broadcast/xiangqi/board/${encodeURIComponent(route.boardId)}`,
    text: 'mistboard.com',
  };
  const draw = async (payload: BroadcastBoardPayload, startPly: number | null | undefined) => {
    const line = broadcastLine(payload, tour);
    if (line.moves.length === 0) {
      note(root, 'This game has not started yet.');
      return;
    }
    // A finished game opens at its start, like a study; a live one on its
    // latest move, which is the one a follower came for.
    const live = payload.board.status !== 'complete';
    await mountChapterEmbed(root, credit, broadcastChapter(line, analysis), {
      startPly: startPly ?? (live ? line.moves.length : null),
    });
  };
  await draw(data, options.startPly);
  if (data.board.status === 'complete') return;

  // Live: redraw when the game has moved on; stop once it is over.
  let plies = data.timeline.length;
  const timer = window.setInterval(async () => {
    const next = await fetchJson<BroadcastBoardPayload>(boardUrl);
    if (!next) return;
    if (next.timeline.length !== plies || next.board.status === 'complete') {
      plies = next.timeline.length;
      await draw(next, null);
    }
    if (next.board.status === 'complete') window.clearInterval(timer);
  }, REFRESH_MS);
}
