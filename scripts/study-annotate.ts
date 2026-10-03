// Engine evaluations in, an annotated study tree out: the lichess-style set a
// study:edit plan (apps/server/src/study-edit-cli.ts) stores, so a post that
// argues from engine numbers gets glyphs, verdicts, comments and sidelines
// without hand annotation. First used by the KataGo post
// (scripts/variant-lab/jungle-katago-annotated-study.ts).
//
// What it writes, every number from the caller's evaluations:
//   - a move glyph (?!, ?, ??) on each judged move, from the mover's expected
//     score before and after it on the site's review cutoffs (moveJudgment:
//     5, 10 and 15 points). A move the engine itself preferred is never marked:
//     two searches differ by a few points of noise. `!` is not emitted; it needs
//     the gap to the engine's second choice, which per-ply evals do not carry.
//   - a position assessment (=, ⩲, ±, +−, and the mirror for the second mover)
//     on the last move of every sideline, where a line's verdict goes. A
//     mainline move carries its move glyph only, as on every other variant's
//     study (Brian, 2026-10-02). From red's expected score through the site's own maps: the
//     score is turned back into centipawns on the analysis board's win curve
//     (winPercent, WIN_PCT_K) and read by advantageSymbol, the bands the
//     review's engine lines close on (60 / 180 / 450 cp: 55.5%, 66.0% and 84.0%
//     for red). Stored as the PGN assessment NAG that assessment-glyphs.ts decodes.
//   - each sideline as the played move's sibling, with its own comment and a
//     green arrow on the position it leaves from, and ONLY beside a move that
//     earned a glyph: a line exists because the move played was worse, so a
//     candidate line off an unfaulted move is dropped (Brian, 2026-10-02).
//   - one comment per move (the study shows the first only), notes joined.
//   - a move whose next position carries luck (a jieqi reveal) is graded on
//     its own search from the position before (moveScore), the mover's view.
//
// Moves are tokens in the chapter's own spelling; the caller checks legality.

import { moveJudgment, WIN_PCT_K } from '@mistboard/game';
import { ASSESSMENT_GLYPH } from '../apps/web/src/assessment-glyphs.ts';
import { advantageSymbol } from '../apps/web/src/review/engine/eval-format.ts';

export const MOVE_NAG = { '?!': 6, '?': 2, '??': 4 } as const;
export type MoveGlyph = keyof typeof MOVE_NAG;
const GLYPH_FOR: Record<'inaccuracy' | 'mistake' | 'blunder', MoveGlyph> = {
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};
const NAG_FOR_ASSESSMENT: Record<string, number> = Object.fromEntries(
  Object.entries(ASSESSMENT_GLYPH).map(([nag, symbol]) => [symbol, Number(nag)]),
);

/** Red's expected score in [0, 1] as centipawns on the analysis board's win curve. */
export function cpForRedScore(score: number): number {
  const p = Math.min(1 - 1e-6, Math.max(1e-6, score));
  return Math.log(p / (1 - p)) / WIN_PCT_K;
}

/** The informant symbol and its PGN NAG for red's expected score. */
export function assessmentForRedScore(score: number): { symbol: string; nag: number } {
  const symbol = advantageSymbol(Math.round(cpForRedScore(score)), null);
  const nag = NAG_FOR_ASSESSMENT[symbol];
  if (nag === undefined) throw new Error(`no assessment NAG for "${symbol}"`);
  return { symbol, nag };
}

/** The move glyph for a mover who went from `before` to `after` (their own expected score). */
export function moveGlyphFor(before: number, after: number): MoveGlyph | null {
  const judgment = moveJudgment(before * 100, after * 100);
  return judgment ? GLYPH_FOR[judgment] : null;
}

export type StudyNode = {
  uci?: string;
  annotations?: {
    comments?: { text: string }[];
    glyphs?: number[];
    shapes?: { kind: 'arrow'; brush: string; orig: string; dest: string }[];
  };
  children: StudyNode[];
};

export type EngineSideline = {
  /** Plies played before the sideline; it replaces mainline move ply + 1. */
  ply: number;
  moves: readonly string[];
  /** Red's expected score at the end of the sideline (its verdict). */
  redScoreEnd: number | null;
  comment?: string;
};

export type JudgedMove = {
  /** 1-based ply of the move. */
  ply: number;
  uci: string;
  mover: 'red' | 'black';
  glyph: MoveGlyph;
  /** The mover's expected score before and after. */
  before: number;
  after: number;
  best: string | null;
};

export type EngineAnnotationInput = {
  rootFen: string;
  moves: readonly string[];
  /** Red's expected score at each position 0..moves.length - 1 (and the final one if known). */
  redScore: readonly number[];
  /** The engine's preferred move at each position, if known. */
  best?: readonly (string | null)[];
  /** Red's expected score of move i as searched from the position before it,
   *  where the next position would grade it unfairly: a move that turns over a
   *  hidden piece (jieqi) is worth the average over what it could be, and the
   *  next position already knows which it was. When set, it grades move i in
   *  place of redScore[i + 1]. */
  moveScore?: readonly (number | null)[];
  /** Whose moves are judged; both by default. */
  judge?: 'red' | 'black' | 'both';
  sidelines?: readonly EngineSideline[];
  /** Notes on mainline moves, by 1-based ply. */
  comments?: Readonly<Record<number, string>>;
  /** The comment for a judged move; joined before any note on the same move. */
  judgedComment?: (move: JudgedMove) => string;
  /** The root's comment. */
  intro?: string;
};

function comment(node: StudyNode, text: string): void {
  node.annotations ??= {};
  const prior = node.annotations.comments?.[0]?.text;
  node.annotations.comments = [{ text: prior ? `${prior} ${text}` : text }];
}
function glyph(node: StudyNode, nag: number): void {
  node.annotations ??= {};
  node.annotations.glyphs = [...(node.annotations.glyphs ?? []), nag];
}

/** The judged moves alone (what the tree marks), for callers that chart them too. */
export function judgedMoves(input: EngineAnnotationInput): JudgedMove[] {
  const out: JudgedMove[] = [];
  const judge = input.judge ?? 'both';
  for (let i = 0; i + 1 < input.redScore.length && i < input.moves.length; i += 1) {
    const mover = i % 2 === 0 ? 'red' : 'black';
    if (judge !== 'both' && judge !== mover) continue;
    const uci = input.moves[i]!;
    const best = input.best?.[i] ?? null;
    if (best === uci) continue;
    const forMover = (red: number): number => (mover === 'red' ? red : 1 - red);
    const before = forMover(input.redScore[i]!);
    const after = forMover(input.moveScore?.[i] ?? input.redScore[i + 1]!);
    const g = moveGlyphFor(before, after);
    if (g) out.push({ ply: i + 1, uci, mover, glyph: g, before, after, best });
  }
  return out;
}

export function annotateFromEngine(input: EngineAnnotationInput): {
  version: 1;
  rootFen: string;
  root: StudyNode;
} {
  const judged = new Map(judgedMoves(input).map((m) => [m.ply, m]));
  const sidelines = new Map((input.sidelines ?? []).map((s) => [s.ply, s]));
  const root: StudyNode = { children: [] };
  if (input.intro) comment(root, input.intro);
  let cursor = root;
  input.moves.forEach((uci, i) => {
    const ply = i + 1;
    const node: StudyNode = { uci, children: [] };
    const mark = judged.get(ply);
    if (mark) {
      glyph(node, MOVE_NAG[mark.glyph]);
      if (input.judgedComment) comment(node, input.judgedComment(mark));
    }
    const note = input.comments?.[ply];
    if (note) comment(node, note);
    cursor.children.push(node);
    // A sideline hangs only off a move that earns a glyph (lichess convention):
    // the line is there because the move played was worse. A candidate line
    // off a move the engine does not fault is dropped.
    const side = mark ? sidelines.get(i) : undefined;
    if (side?.moves.length) {
      if (side.moves[0] === uci) throw new Error(`sideline at ply ${i} repeats the game move`);
      let head: StudyNode | null = null;
      let tail: StudyNode | null = null;
      for (const move of side.moves) {
        const n: StudyNode = { uci: move, children: [] };
        if (tail) tail.children.push(n);
        else head = n;
        tail = n;
      }
      if (side.comment) comment(head!, side.comment);
      if (side.redScoreEnd != null) glyph(tail!, assessmentForRedScore(side.redScoreEnd).nag);
      cursor.children.push(head!);
      cursor.annotations = {
        ...(cursor.annotations ?? {}),
        shapes: [
          ...(cursor.annotations?.shapes ?? []),
          {
            kind: 'arrow',
            brush: 'green',
            orig: side.moves[0]!.slice(0, 2),
            dest: side.moves[0]!.slice(2, 4),
          },
        ],
      };
    }
    cursor = node;
  });
  return { version: 1, rootFen: input.rootFen, root };
}
