/**
 * Turn one mined dpxq record into a study chapter.
 *
 * Shared for the same reason as the comment builder: `seed-v2.mjs` creates a
 * whole manual and `add-missing-chapters.mjs` fills gaps in one already
 * published, and two builders that drift produce a study whose chapters
 * disagree about their own source.
 *
 * The game-package functions arrive as `deps` because callers load them from a
 * checked-out app directory (`--app`), not from this script's own node_modules.
 */
import { compositionComment, proseFrom } from './composition-comment.mjs';

export const numberOf = (title) => {
  const m = /第\s*(\d+)\s*局/.exec(title ?? '');
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
export const bareTitle = (title) => (title ?? '').replace(/第\s*\d+\s*局\s*/, '').trim();

/** Copied from routes/studies.ts, where it is module-private. */
export function isSerializedTree(v) {
  if (!v || typeof v !== 'object') return false;
  if (v.version !== 1) return false;
  return !!v.root && typeof v.root === 'object' && Array.isArray(v.root.children);
}

/**
 * DhtmlXQ's binit carries no side to move, and `dhtmlxqStateFromBinit` assumes
 * red (packages/game/src/xiangqi-import.ts). A 黑先 composition therefore has an
 * illegal move 1 for structural reasons rather than because its record is
 * corrupt, and the seeder dropped it as unreplayable.
 *
 * So: try the default, and on failure build the same position with black to
 * move and try again. `importXiangqiGame`'s caller-supplied `initialState` wins
 * over the binit decode, which is what makes this possible without touching the
 * kernel. Returns which side worked, because "this is a black-first problem" is
 * something the reader needs and the board must be told.
 */
export function importEitherSide(rec, deps) {
  const raw =
    `[DhtmlXQ]\n[DhtmlXQ_binit]${rec.binit}[/DhtmlXQ_binit]\n` +
    `[DhtmlXQ_movelist]${rec.mainline}[/DhtmlXQ_movelist]\n[/DhtmlXQ]\n`;

  const asRed = deps.importXiangqiGame(raw);
  if (!asRed.error && asRed.initialState && asRed.moves.length > 0) {
    return { ...asRed, turn: 'red' };
  }

  const board = deps.xiangqiBoardFromDhtmlxqBinit(rec.binit);
  if (!board) return { error: asRed.error ?? 'binit did not decode', turn: null };
  const blackStart = {
    id: 'import',
    board,
    status: { type: 'playing', turn: 'black' },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
  const asBlack = deps.importXiangqiGame(raw, { initialState: blackStart });
  if (!asBlack.error && asBlack.initialState && asBlack.moves.length > 0) {
    return { ...asBlack, turn: 'black' };
  }
  // Report the RED failure: it is the one that describes the record, where the
  // black attempt usually just says "move 1 illegal" for a red-first problem.
  return { error: asRed.error ?? asBlack.error ?? 'no legal replay', turn: null };
}

/**
 * @returns {{chapter: object, n: number, turn: string} | {skip: string}}
 */
export function buildChapter(rec, deps, opts) {
  const zh = bareTitle(rec.title);
  const n = numberOf(rec.title);
  if (!rec.binit) return { skip: 'no start position on the page' };
  if (!rec.mainline) return { skip: 'no mainline' };

  const r = importEitherSide(rec, deps);
  // Drop, never truncate: a composition is a puzzle with one answer, so a line
  // cut short at the first illegal ply is a wrong answer stated confidently.
  if (r.error) return { skip: r.error };
  if (!r.initialState || r.moves.length === 0) return { skip: 'no start position or no moves' };

  let child = null;
  for (const mv of [...r.moves].reverse()) {
    child = { uci: `${mv.from}${mv.to}`, children: child ? [child] : [] };
  }

  const en = opts.englishTitle(zh, n);
  const name = en ? `${n}. ${en}` : `${n}. ${zh}`;
  const comment = compositionComment({
    zh,
    en,
    n,
    vol: rec.vol,
    volZh: opts.volZh[rec.vol - 1],
    bookZh: opts.bookZh,
    moveCount: r.moves.length,
    prose: proseFrom(rec),
    variations: rec.variations?.length ?? 0,
    url: rec.url,
  });

  const root = {
    version: 1,
    rootFen: deps.standardXiangqiFen(r.initialState),
    root: { annotations: { comments: [{ text: comment }] }, children: child ? [child] : [] },
  };
  if (!deps.isStudyEligibleSpecId('xiangqi')) return { skip: 'variant not study-eligible' };
  if (!isSerializedTree(root)) return { skip: 'tree failed the route shape check' };

  return {
    n,
    turn: r.turn,
    chapter: {
      name: name.length > 80 ? `${name.slice(0, 77)}...` : name,
      i18n: { 'zh-Hans': { name: rec.title } },
      variant: 'xiangqi',
      // The board faces red regardless; the side to move rides in the rootFen.
      orientation: 'red',
      root: deps.ensureDealtRoot('xiangqi', root),
    },
  };
}
