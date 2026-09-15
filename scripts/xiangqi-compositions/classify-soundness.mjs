#!/usr/bin/env node
/**
 * Rule-based soundness classification from the sweep rows, so no agent has to
 * read engine numbers or run an engine. Writes `<slug>.sound.json`:
 *   { "<id>": { sound, soundNote, claim, publish } }
 *
 * Classes:
 *   ok         engine and record agree, or nothing contradicts the record
 *   unclear    no verdict to compare and the searches are not decisive
 *   suspect    the engine contradicts the claim at the root, or the printed
 *              line ends in a position that refutes the claim outright
 *   rules-draw a claimed draw whose line ends with the claimant's opponent
 *              mating after a perpetual: modern rules score perpetual check as
 *              a loss, the book scores it as a draw. A convention question for
 *              Brian, not a transcription defect; held until decided.
 *   replay     the record does not replay; never publishes
 *
 * publish = sound == ok. `unclear` is held, not published: on the four books
 * where agents also judged, publishing `unclear` disagreed with them on ~15% of
 * records and holding it agreed on ~95%. Thresholds: 150 cp is "better", 300 cp
 * is "winning" at a 4 s search; a mate score is decisive at any depth.
 *
 * The claim is read from comment 0, else from the LAST comment: the 江湖 books
 * put 和局 / 红胜 after the final move rather than in a header line.
 *
 *   node classify-soundness.mjs --dir <corpus dir> --slug <book>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { dir: { type: 'string' }, slug: { type: 'string' } } });
if (!values.dir || !values.slug) {
  console.error('usage: classify-soundness.mjs --dir <corpus dir> --slug <book>');
  process.exit(2);
}
const { dir, slug } = values;
const verify = JSON.parse(readFileSync(join(dir, `${slug}.verify.json`), 'utf8'));
const raw = JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8'));
const commentsById = new Map(raw.map((r) => [r.id, r.comments ?? {}]));
// Whether a record is a full game (result line, no puzzle claim) comes from the
// plan's kind, not from the absence of a diagram: handicap games (饶双先, 饶左马)
// start from a custom binit and are still games. A 'mixed' book is games in its
// 全局 volume and compositions elsewhere.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const plan = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'books.json'), 'utf8'));
const kind = plan.books.find((b) => b.slug === slug)?.kind ?? 'compositions';
const isGame = (r) => (kind === 'games' ? true : kind === 'mixed' ? /全局/.test(r.volName ?? '') : !r.binit);
const gameById = new Map(raw.map((r) => [r.id, isGame(r)]));
const rows = new Map();
const sp = join(dir, `${slug}.soundness.jsonl`);
if (existsSync(sp)) {
  for (const line of readFileSync(sp, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      rows.set(r.id, r);
    } catch {
      // partial last line
    }
  }
}

const other = (s) => (s === 'red' ? 'black' : 'red');
function claimOf(verdict) {
  if (!verdict) return null;
  const v = verdict.slice(0, 24);
  if (/和/.test(v)) return 'draw';
  if (/黑先?胜|黑勝|黑方胜/.test(v)) return 'black';
  if (/红先?胜|紅先?勝|红方胜|胜|勝/.test(v)) return 'red';
  return null;
}
/** Who a search favours: 'red' | 'black' | 'draw', with strength 'win' | 'better' | 'even'. */
function view(search, sideToMove) {
  if (!search?.score) return null;
  const s = search.score;
  if (s.mate !== undefined) return { side: s.mate > 0 ? sideToMove : other(sideToMove), strength: 'win', text: `mate ${s.mate}` };
  const cp = s.cp;
  const side = cp > 0 ? sideToMove : other(sideToMove);
  const a = Math.abs(cp);
  return { side: a < 150 ? 'draw' : side, strength: a >= 300 ? 'win' : a >= 150 ? 'better' : 'even', text: `cp ${cp}` };
}

const out = {};
const counts = {};
for (const rec of verify.records) {
  const id = rec.id;
  let sound;
  let note;
  const cm = commentsById.get(id) ?? {};
  const keys = Object.keys(cm).map(Number).sort((a, b) => a - b);
  const last = keys.length ? cm[String(keys.at(-1))] : null;
  // 烂柯神机 prints the verdict as a title suffix (一击惊人 正和); read that too.
  const titleTail = /\s(正和|和局|和|红胜|黑胜|红先胜|黑先胜)(\(\d\))?$/.exec(rec.title ?? '');
  const claim =
    claimOf(rec.verdict) ??
    (keys.length > 1 || (keys.length === 1 && keys[0] !== 0) ? claimOf(last?.slice(-12)) : null) ??
    (titleTail ? claimOf(titleTail[1]) : null);
  if (rec.error) {
    sound = 'replay';
    note = rec.error;
  } else {
    const row = rows.get(id);
    const pov = rec.turn;
    const mated = rec.end?.status?.type === 'finished' && rec.end.status.reason === 'checkmate';
    const lastMover = rec.plies % 2 === 1 ? pov : other(pov); // side that played the final ply
    const endSide = rec.end?.sideToMoveAtEnd ?? null;
    const root = row ? view(row.root, pov) : null;
    const end = row && !mated ? view(row.end, endSide) : null;
    const rootTxt = root ? `root ${root.text} (${row.root.depth}) for ${pov}` : 'no root search';
    const endTxt = mated ? `line mates (${lastMover} wins)` : end ? `end ${end.text} (${row.end.depth}) for ${endSide}` : 'no end search';
    note = `${rootTxt}; ${endTxt}`;
    if (!row) {
      sound = 'unclear';
      note = 'no soundness row';
    } else if (gameById.get(id)) {
      // A full game (no diagram of its own) is not a puzzle with an answer: its
      // result line is a historical outcome, and a 4 s engine disagreeing with a
      // 300-year-old game's result is the norm, not a transcription signal.
      // Legal replay is the whole check; the engine view stays in the note.
      sound = 'ok';
    } else if (claim === 'draw') {
      if (root && root.strength === 'win' && root.side !== 'draw') {
        // A claimed draw the engine calls won from the diagram: cooked or mis-set.
        sound = 'suspect';
      } else if (!mated && end && end.strength === 'win' && end.side !== 'draw') {
        // Drawn from the diagram, but the printed line ends lost for someone:
        // the perpetual-check convention when the loser is the claimant's
        // checking side, a transcription defect otherwise.
        sound = root && root.side === 'draw' ? 'rules-draw' : 'suspect';
      } else if (mated) {
        sound = 'suspect'; // a draw whose line delivers mate is not a draw
      } else {
        sound = 'ok';
      }
    } else if (claim === 'red' || claim === 'black') {
      const w = claim;
      if (mated && lastMover === w) sound = 'ok';
      else if (mated && lastMover !== w) sound = 'suspect';
      else if (root && root.side === other(w) && root.strength !== 'even') sound = 'suspect';
      else if (end && end.side === other(w) && end.strength === 'win') sound = 'suspect';
      else if (root && root.side === w) sound = 'ok';
      else if (end && end.side === w) sound = 'ok';
      else sound = 'unclear';
    } else {
      // No verdict: nothing to contradict. Decisive agreement between root and
      // end is 'ok'; anything else is 'unclear' and still publishes.
      if (mated) sound = 'ok';
      else if (root && end && root.side === end.side) sound = 'ok';
      else sound = 'unclear';
    }
  }
  out[String(id)] = { sound, soundNote: note, claim, publish: sound === 'ok' };
  counts[sound] = (counts[sound] ?? 0) + 1;
}
writeFileSync(join(dir, `${slug}.sound.json`), `${JSON.stringify(out, null, 1)}\n`, 'utf8');
console.log(`${slug}: ${verify.records.length} records  ${JSON.stringify(counts)}`);
