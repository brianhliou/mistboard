#!/usr/bin/env node
/**
 * Replay every mined record through the rules kernel and write what happened.
 *
 * The first oracle. For each `<slug>.json` the miner produced this writes
 * `<slug>.verify.json`: per record, which side to move replayed the mainline
 * (red, black via the 黑先 retry, or neither), how many plies, the root FEN the
 * soundness sweep will search from, and the terminal state the line reaches.
 * Nothing here judges the book; it judges the record, so an agent reading a
 * book downstream starts from facts rather than re-deriving them.
 *
 * A record without a start position is a full game from the standard array
 * (the 古谱全局 books), not a defect: the binit tag is simply omitted and the
 * kernel starts from the opening.
 *
 *   node verify-records.mjs --app <repo> --dir ~/projects/xiangqi-corpus/dpxq-compositions
 *   node verify-records.mjs --app <repo> --dir ... --only hu-ya-ji,mei-hua-pu
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    dir: { type: 'string' },
    only: { type: 'string', default: '' },
  },
});
if (!values.app || !values.dir) {
  console.error('usage: verify-records.mjs --app <repo> --dir <corpus dir> [--only slug,slug]');
  process.exit(2);
}

const game = await import(`${values.app}/packages/game/dist/index.js`);

/** Same shape the seeder builds; an empty binit means the standard opening. */
function rawRecord(rec) {
  const binit = rec.binit ? `[DhtmlXQ_binit]${rec.binit}[/DhtmlXQ_binit]\n` : '';
  return `[DhtmlXQ]\n${binit}[DhtmlXQ_movelist]${rec.mainline}[/DhtmlXQ_movelist]\n[/DhtmlXQ]\n`;
}

/** Mirrors composition-chapter.mjs importEitherSide, plus the standard-start case. */
function replay(rec) {
  const raw = rawRecord(rec);
  const asRed = game.importXiangqiGame(raw);
  if (!asRed.error && asRed.moves.length > 0) {
    return { ...asRed, turn: 'red', initialState: asRed.initialState ?? game.createInitialXiangqiState('import') };
  }
  if (!rec.binit) return { error: asRed.error ?? 'no legal replay', turn: null };
  const board = game.xiangqiBoardFromDhtmlxqBinit(rec.binit);
  if (!board) return { error: asRed.error ?? 'binit did not decode', turn: null };
  const blackStart = {
    id: 'import',
    board,
    status: { type: 'playing', turn: 'black' },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
  const asBlack = game.importXiangqiGame(raw, { initialState: blackStart });
  if (!asBlack.error && asBlack.moves.length > 0) {
    return { ...asBlack, turn: 'black', initialState: blackStart };
  }
  return { error: asRed.error ?? asBlack.error ?? 'no legal replay', turn: null, redError: asRed.error, blackError: asBlack.error };
}

/** Where the mainline ends: playing, checkmate, stalemate, or a draw rule. */
function terminal(initialState, moves) {
  let state = initialState;
  for (const mv of moves) state = game.applyStandardXiangqiMove(state, mv);
  const legal = state.status.type === 'playing' ? game.getStandardXiangqiLegalMoves(state).length : 0;
  return { status: state.status, legalRepliesAtEnd: legal, sideToMoveAtEnd: state.status.turn ?? null };
}

const only = new Set(values.only.split(',').filter(Boolean));
const books = readdirSync(values.dir)
  .filter((f) => f.endsWith('.json') && !f.includes('.verify.') && !f.includes('.summary.') && !f.includes('.partial.'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((slug) => only.size === 0 || only.has(slug))
  .sort();

for (const slug of books) {
  const records = JSON.parse(readFileSync(join(values.dir, `${slug}.json`), 'utf8'));
  const summaryPath = join(values.dir, `${slug}.json.summary.json`);
  const complete = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')).complete : null;
  const out = [];
  const counts = { total: records.length, red: 0, black: 0, error: 0, noMainline: 0, standardStart: 0, mate: 0, oneMove: 0 };
  for (const rec of records) {
    const row = { id: rec.id, vol: rec.vol, volName: rec.volName, title: rec.title, url: rec.url };
    if (!rec.mainline) {
      counts.noMainline += 1;
      out.push({ ...row, turn: null, plies: 0, error: 'no mainline' });
      continue;
    }
    if (!rec.binit) counts.standardStart += 1;
    // A diagram the kernel refuses to build (six soldiers a side, two generals
    // on one file) throws from elephantops' setup validation instead of
    // returning an import error; one such record must not end the book.
    let r;
    try {
      r = replay(rec);
    } catch (e) {
      r = { error: `invalid position: ${e?.message ?? e}`, turn: null };
    }
    if (r.error) {
      counts.error += 1;
      out.push({ ...row, turn: null, plies: 0, error: r.error, redError: r.redError, blackError: r.blackError });
      continue;
    }
    counts[r.turn] += 1;
    if (r.moves.length <= 1) counts.oneMove += 1;
    const end = terminal(r.initialState, r.moves);
    if (end.status.type === 'checkmate' || (end.status.type === 'finished' && end.status.reason === 'checkmate')) counts.mate += 1;
    out.push({
      ...row,
      turn: r.turn,
      plies: r.moves.length,
      rootFen: game.standardXiangqiFen(r.initialState),
      // Kernel squares, the same pair the chapter builder writes as `uci`.
      uci: r.moves.map((mv) => `${mv.from}${mv.to}`),
      // What Pikafish accepts: 'w'/'b' for the turn and ranks 0-9, both unlike
      // the kernel's own key (packages/game/src/xiangqi-uci.ts says why).
      engineFen: game.standardXiangqiEngineFen(r.initialState),
      engineUci: r.moves.map((mv) => game.xiangqiMoveToPikafishUci(mv)),
      end,
      verdict: rec.comments?.['0'] ?? null,
      commentPlies: Object.keys(rec.comments ?? {}).length,
    });
  }
  writeFileSync(
    join(values.dir, `${slug}.verify.json`),
    `${JSON.stringify({ slug, complete, counts, records: out }, null, 1)}\n`,
    'utf8',
  );
  const c = counts;
  console.log(
    `${slug.padEnd(28)} ${String(c.total).padStart(4)} records  red ${c.red}  black ${c.black}  ` +
      `error ${c.error}  no-mainline ${c.noMainline}  one-move ${c.oneMove}  std-start ${c.standardStart}` +
      (complete === false ? '  (FETCH INCOMPLETE)' : ''),
  );
}
