// Turn a persisted study chapter into a replay spec at runtime.
//
// This conversion already existed once, in scripts/study-chapter-to-article.mjs,
// which bakes constants into an article at authoring time. That is the right
// shape for a published article (a page should not depend on a study still
// existing), and the wrong shape for an embed, whose whole promise is that it
// shows what the study says now.
//
// The two are SEPARATE implementations, not one shared with two callers: the
// script is a plain .mjs with no build step and does not import this module. An
// earlier version of this comment claimed they shared logic, and they had
// already drifted -- both dropped the chapter's rootFen, and fixing it here in
// 2026-08 meant fixing it there too. Change one, check the other.

import { createInitialXiangqiState, standardXiangqiFen } from '@mistboard/game';
import { ASSESSMENT_GLYPH } from './assessment-glyphs.js';
import type { XiangqiReplayAnnotation, XiangqiReplaySpec } from './xiangqi-replay.js';

/** NAG codes as the study stores them, mapped to what the widget renders. */
const GLYPH: Record<number, NonNullable<XiangqiReplayAnnotation['glyph']>> = {
  1: '!',
  2: '?',
  3: '!!',
  4: '??',
  6: '?!',
};

export type StudyTreeNode = {
  uci?: string;
  children?: StudyTreeNode[];
  annotations?: {
    glyphs?: number[];
    comments?: { text?: string }[];
  };
};

export type StudyChapterPayload = {
  id: string;
  name?: string;
  variant?: string;
  orientation?: 'red' | 'black' | string;
  tags?: Record<string, string | undefined>;
  root?: { root?: StudyTreeNode; rootFen?: string };
};

/**
 * Placement plus side to move, which is what decides whether a chapter starts
 * somewhere the widget has to be told about. The clocks in fields 5 and 6 are
 * bookkeeping and differ between an authored root and the canonical spelling.
 */
function positionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 2).join(' ');
}

/** `initialStartFen('xiangqi')` is deliberately null (it answers "what must a
 *  NEW document store", and a deterministic variant stores nothing), so the
 *  opening has to be spelled from the kernel's own initial state. */
const OPENING_KEY = positionKey(standardXiangqiFen(createInitialXiangqiState('opening')));

/**
 * UCI here uses ranks 1-10; ICCS, which the widget parses, uses 0-9. Returns
 * null for anything that is not a plain from+to move so a malformed node
 * truncates the line instead of poisoning the spec.
 */
export function uciToIccs(uci: string): string | null {
  const m = /^([a-i])(\d{1,2})([a-i])(\d{1,2})$/.exec(uci);
  if (!m) return null;
  const fromRank = Number(m[2]) - 1;
  const toRank = Number(m[4]) - 1;
  if (fromRank < 0 || fromRank > 9 || toRank < 0 || toRank > 9) return null;
  return `${m[1]}${fromRank}${m[3]}${toRank}`;
}

/**
 * The FIRST child of a node is the game continuation; any later child is a
 * variation hung off the same parent, which is how an engine refutation is
 * attached and so converts straight back into the line the widget steps.
 */
export function studyChapterToReplaySpec(chapter: StudyChapterPayload): XiangqiReplaySpec | null {
  const mainline: string[] = [];
  const byPly: Record<number, XiangqiReplayAnnotation> = {};
  let node = chapter.root?.root;
  let ply = 0;

  // A duck chapter's moves are stored as duck TURN tokens (`from+to@duckTo`,
  // the tree adapter's own spelling), not as chess-style UCI, so uciToIccs
  // rejects every one of them and the mainline comes out empty. That is how a
  // duck chapter used to reach the embed as "no moves to show". Pass those
  // tokens through untouched; the duck board reads them directly.
  const toToken = (uci: string): string | null =>
    chapter.variant === 'duck-xiangqi' ? uci : uciToIccs(uci);

  while (node?.children?.length) {
    const played = node.children[0];
    if (!played) break;
    const iccs = played.uci ? toToken(played.uci) : null;
    if (!iccs) break;
    ply += 1;
    mainline.push(iccs);

    const glyph = (played.annotations?.glyphs ?? [])
      .map((code) => GLYPH[code])
      .find((g): g is NonNullable<XiangqiReplayAnnotation['glyph']> => Boolean(g));
    const note = played.annotations?.comments?.[0]?.text;
    const siblings = node.children.slice(1);

    if (glyph || note || siblings.length) {
      const line: string[] = [];
      let variation: StudyTreeNode | undefined = siblings[0];
      // The verdict closes the line, so it sits on the line's LAST node. Walking
      // past it and forgetting it is how a backfilled study still showed its
      // sidelines ending on nothing: the NAGs were stored, and this hop dropped
      // every code outside the 1-6 the GLYPH map above covers.
      let lineEval: string | undefined;
      while (variation?.uci) {
        const step = toToken(variation.uci);
        if (!step) break;
        line.push(step);
        const assessed = (variation.annotations?.glyphs ?? []).find(
          (code) => ASSESSMENT_GLYPH[code] !== undefined,
        );
        lineEval = assessed === undefined ? undefined : ASSESSMENT_GLYPH[assessed];
        variation = variation.children?.[0];
      }
      byPly[ply] = {
        ...(glyph ? { glyph } : {}),
        ...(note ? { note } : {}),
        ...(line.length ? { line: line.join(' ') } : {}),
        ...(lineEval ? { lineEval } : {}),
      };
    }
    node = played;
  }

  const tags = chapter.tags ?? {};
  // A chapter rooted at the opening is every game record, and the widget's
  // default already is the opening, so leave startFen off rather than routing
  // those through the FEN parser: it returns a state with empty positionCounts,
  // which would change when a long game's threefold fires.
  //
  // Anything else has to travel. Before this the rootFen was read by nobody, so
  // all 32 chapters of an endgame study rendered the opening position under
  // their own moves, and the notation fell out to raw coordinates because the
  // first move was illegal from there.
  const rootFen = chapter.root?.rootFen;
  const startFen = rootFen && positionKey(rootFen) !== OPENING_KEY ? rootFen : undefined;

  // A chapter can legitimately be a position and nothing else: an endgame set
  // from a FEN with no line played on it yet. Before startFen existed there was
  // no way to render one, so an empty mainline could only mean an empty
  // chapter, and this returned null. Now it means show the position. Without a
  // start position AND without moves there is still nothing to draw.
  if (!mainline.length && !startFen) return null;

  return {
    iccs: mainline.join(' '),
    ...(startFen ? { startFen } : {}),
    red: tags.red ?? 'Red',
    black: tags.black ?? 'Black',
    event: tags.event ?? chapter.name ?? '',
    ...(chapter.orientation === 'black' ? { perspective: 'black' as const } : {}),
    resultText: tags.result ?? '*',
    annotations: { byPly },
  };
}
