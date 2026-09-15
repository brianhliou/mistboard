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
  // No binit means a full game from the standard array (the 古谱全局 manuals),
  // not a defective record: omit the tag and the kernel starts from the opening.
  const binit = rec.binit ? `[DhtmlXQ_binit]${rec.binit}[/DhtmlXQ_binit]\n` : '';
  const raw = `[DhtmlXQ]\n${binit}[DhtmlXQ_movelist]${rec.mainline}[/DhtmlXQ_movelist]\n[/DhtmlXQ]\n`;

  let asRed;
  try {
    asRed = deps.importXiangqiGame(raw);
  } catch (e) {
    // elephantops rejects an impossible diagram (too many soldiers, generals
    // facing) by throwing from setup validation; report it as a record error.
    return { error: `invalid position: ${e?.message ?? e}`, turn: null };
  }
  if (!asRed.error && asRed.moves.length > 0 && (asRed.initialState || !rec.binit)) {
    const initialState = asRed.initialState ?? deps.createInitialXiangqiState?.('import');
    if (initialState) return { ...asRed, initialState, turn: 'red' };
  }
  if (!rec.binit)
    return { error: asRed.error ?? 'no legal replay from the standard start', turn: null };

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
 * `opts.edit`, when present, is the reviewed per-record entry from a book's
 * edits file (docs-private/manual-mining-2026-09-14/BRIEF.md): it supplies the
 * chapter number, the English and Traditional titles, and the comments that
 * survived prose triage. Without it the builder falls back to the title number,
 * the titles file, and every comment on the record, which is how 適情雅趣 was
 * seeded before triage existed.
 *
 * @returns {{chapter: object, n: number, turn: string} | {skip: string}}
 */
export function buildChapter(rec, deps, opts) {
  const edit = opts.edit ?? null;
  const zh = edit?.zh || bareTitle(rec.title);
  const n = edit?.n ?? numberOf(rec.title);
  if (edit && edit.publish === false)
    return { skip: `held back: ${edit.soundNote || edit.notes || edit.sound || 'publish=false'}` };
  if (!rec.binit && opts.kind !== 'games') return { skip: 'no start position on the page' };
  if (!rec.mainline) return { skip: 'no mainline' };
  if (n === Number.MAX_SAFE_INTEGER)
    return { skip: 'no chapter number: the title carries none and no edit supplies one' };

  const r = importEitherSide(rec, deps);
  // Drop, never truncate: a composition is a puzzle with one answer, so a line
  // cut short at the first illegal ply is a wrong answer stated confidently.
  if (r.error) return { skip: r.error };
  if (!r.initialState || r.moves.length === 0) return { skip: 'no start position or no moves' };

  let child = null;
  for (const mv of [...r.moves].reverse()) {
    child = { uci: `${mv.from}${mv.to}`, children: child ? [child] : [] };
  }

  const en = edit?.en || opts.englishTitle?.(zh, n);
  const name = en ? `${n}. ${en}` : `${n}. ${zh}`;
  // Triage keeps a subset of the record's comments, keyed like the record; the
  // untriaged path quotes them all, which is the 2026-09-11 behaviour.
  const prose = edit?.prose ? proseFrom({ comments: edit.prose }) : proseFrom(rec);
  const comment = compositionComment({
    zh,
    en,
    n,
    vol: rec.vol,
    volZh: opts.volZh[rec.vol - 1],
    bookZh: opts.bookZh,
    moveCount: r.moves.length,
    prose,
    url: rec.url,
    unit: opts.kind === 'games' ? 'Game' : 'Problem',
    singleVolume: opts.singleVolume === true,
    gloss: opts.gloss,
  });
  const i18n = { 'zh-Hans': { name: rec.title } };
  if (edit?.hant) {
    // The Traditional title keeps whatever number prefix dpxq's title carries.
    const bareZh = bareTitle(rec.title);
    const hantTitle =
      bareZh && rec.title.includes(bareZh) ? rec.title.replace(bareZh, edit.hant) : edit.hant;
    i18n['zh-Hant'] = { name: hantTitle };
  }

  // A reviewed record may carry one editorial line of ours (the perpetual-check
  // convention note); it follows the source credit, never the book's prose.
  const text = edit?.releaseNote ? `${comment}\n\n${edit.releaseNote}` : comment;
  const root = {
    version: 1,
    rootFen: deps.standardXiangqiFen(r.initialState),
    root: { annotations: { comments: [{ text }] }, children: child ? [child] : [] },
  };
  if (!deps.isStudyEligibleSpecId('xiangqi')) return { skip: 'variant not study-eligible' };
  if (!isSerializedTree(root)) return { skip: 'tree failed the route shape check' };

  return {
    n,
    turn: r.turn,
    chapter: {
      // 120 is the chapter tag cap in routes/studies.ts; the route itself does
      // not cap the name, and the editor's 80-character text input is a UI
      // width, not a limit. Game-manual labels ("Two-Horse Odds, Right Cannon
      // Riverbank vs Opposite Cannons: 3.16") need the room.
      name: name.length > 120 ? `${name.slice(0, 117)}...` : name,
      i18n,
      variant: 'xiangqi',
      // The board faces red regardless; the side to move rides in the rootFen.
      orientation: 'red',
      root: deps.ensureDealtRoot('xiangqi', root),
    },
  };
}
