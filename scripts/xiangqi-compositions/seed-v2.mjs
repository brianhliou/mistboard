/**
 * Seed a mined dpxq classical manual as one study per volume, titled in English.
 *
 * Written for 適情雅趣 (six volumes) and generalized afterwards; `--book` selects
 * the manual and everything volume-shaped comes from the mined data rather than
 * from a constant, so a flat book like 橘中秘's endgame half seeds as one volume.
 *
 * Replaces the first pass, which had 244 of 550 compositions and so ran with
 * large gaps in the numbering (第003, 第004, 第005, 第006, 第010...). The gaps were
 * never missing solutions: the mainline lives in a JS variable on the page, not
 * in the [DhtmlXQ_movelist] tag, and the first extractor only read the tag.
 *
 * Chapter names are English renderings of the four-character literary titles,
 * with the original kept in the zh-Hans overlay and in the chapter comment, so
 * nothing is lost if a rendering is imperfect.
 *
 * Runs against the DB directly because study creation is owner-scoped over HTTP
 * and the session cookie is httpOnly. See run-seed.sh for how DATABASE_URL is
 * supplied without anyone reading it.
 *
 *   node seed-v2.mjs --app <repo> --data <mined.json> --titles <en.json> \
 *     --email <owner> [--book shi-qing-ya-qu] [--visibility unlisted] \
 *     [--dry-run] [--replace]
 *
 * It CREATES. There is no update path here: re-pointing an existing chapter is a
 * PATCH against the live study, not a re-seed, because a delete-and-recreate
 * loses the chapter id, its permalink, and its place in the ordering.
 */
import { readFileSync } from 'node:fs';
import { compositionComment, proseFrom } from './composition-comment.mjs';

const A = process.argv;
const arg = (n, d) => {
  const i = A.indexOf(`--${n}`);
  return i >= 0 && A[i + 1] ? A[i + 1] : d;
};
const has = (n) => A.includes(`--${n}`);
const APP = arg('app', '/app').replace(/\/$/, '');

const { importXiangqiGame, standardXiangqiFen, isStudyEligibleSpecId } = await import(
  `${APP}/node_modules/@mistboard/game/dist/index.js`
);
const persistence = await import(`${APP}/apps/server/dist/persistence-studies.js`);
const { findUserByEmail } = await import(`${APP}/apps/server/dist/persistence-accounts.js`);
const { init: initPersistence } = await import(`${APP}/apps/server/dist/persistence-db.js`);
const { ensureDealtRoot } = await import(`${APP}/apps/server/dist/routes/studies.js`);

/** Copied verbatim from routes/studies.ts — module-private there. */
function isSerializedTree(v) {
  if (!v || typeof v !== 'object') return false;
  if (v.version !== 1) return false;
  return !!v.root && typeof v.root === 'object' && Array.isArray(v.root.children);
}

/** Per-book configuration. Everything that used to be a 適情雅趣 constant. */
const BOOKS = {
  'shi-qing-ya-qu': {
    zh: '適情雅趣',
    era: 'Ming-dynasty',
    volZh: ['卷一', '卷二', '卷三', '卷四', '卷五', '卷六'],
    oldNamePrefix: 'Elegant Pastime Manual (適情雅趣)',
    nameFor: (v, n) => `Elegant Pastime Manual, Vol. ${v}: ${n} classical compositions`,
    slugFor: (v) => `elegant-pastime-vol-${v}`,
  },
  // 橘中秘's endgame half. dpxq serves it as ONE flat 137-record listing, not as
  // the 卷三/卷四 split we published from a different source, so it seeds as a
  // single volume and the mapping onto those two studies is a separate decision.
  'ju-zhong-mi': {
    zh: '橘中秘',
    era: 'Ming-dynasty',
    volZh: ['残局谱'],
    oldNamePrefix: null,
    nameFor: (_v, n) => `Secret in the Tangerine: ${n} endgame compositions`,
    slugFor: () => 'tangerine-endgames',
  },
};

const BOOK_KEY = arg('book', 'shi-qing-ya-qu');
const BOOK = BOOKS[BOOK_KEY];
if (!BOOK) throw new Error(`unknown --book ${BOOK_KEY}; known: ${Object.keys(BOOKS).join(', ')}`);

const VOL_ZH = BOOK.volZh;
const OLD_NAME_PREFIX = BOOK.oldNamePrefix;
const nameFor = BOOK.nameFor;
const slugFor = BOOK.slugFor;
const descFor = (v, n) =>
  `Volume ${v} (${VOL_ZH[v - 1]}) of ${BOOK.zh}, a ${BOOK.era} manual of xiangqi endgame ` +
  `compositions. All ${n} problems of the volume, each rooted at its own diagram with the ` +
  `book's solution as the mainline. Titles are English renderings of the original ` +
  `four-character names, which are kept alongside. Records come from dpxq.com and are ` +
  `credited on each composition. Every line replays legally through the Mistboard rules ` +
  `kernel, which is a check on the record and not on the book: this text has a single ` +
  `source, and a solution recorded short would still replay cleanly. The compositions are ` +
  `several centuries old and long out of copyright.`;

const num = (t) => {
  const m = /第\s*(\d+)\s*局/.exec(t || '');
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
const bare = (t) => (t || '').replace(/第\s*\d+\s*局\s*/, '').trim();

// The committed titles file carries two maps that do not overlap: byTitle (537
// entries, keyed by the four-character Chinese name) and byNumber (280, keyed by
// the composition's number in the manual). A flat {zh: en} object is also
// accepted, which is the shape the original run used.
const TITLES_RAW = JSON.parse(readFileSync(arg('titles'), 'utf8'));
const EN = TITLES_RAW.byTitle ?? TITLES_RAW;
const EN_BY_NUMBER = TITLES_RAW.byNumber ?? {};
const englishTitle = (zh, n) => EN[zh] ?? EN_BY_NUMBER[String(n)];
const records = JSON.parse(readFileSync(arg('data'), 'utf8'));
const visibility = arg('visibility', 'unlisted');
if (!persistence.isStudyVisibility(visibility)) throw new Error(`bad visibility ${visibility}`);
const email = arg('email');
if (!email) throw new Error('--email <owner> required');

function chapterFor(rec) {
  const zh = bare(rec.title);
  const n = num(rec.title);
  if (!rec.binit) return { skip: 'no start position on the page' };
  if (!rec.mainline) return { skip: 'no [0_1_0] mainline segment' };
  const raw =
    `[DhtmlXQ]\n[DhtmlXQ_binit]${rec.binit}[/DhtmlXQ_binit]\n` +
    `[DhtmlXQ_movelist]${rec.mainline}[/DhtmlXQ_movelist]\n[/DhtmlXQ]\n`;
  const r = importXiangqiGame(raw);
  // Drop, never truncate: a composition is a puzzle with one answer, so a line
  // cut short at the first illegal ply is a wrong answer stated confidently.
  if (r.error) return { skip: r.error };
  if (!r.initialState || r.moves.length === 0) return { skip: 'no start position or no moves' };

  let child = null;
  for (const mv of [...r.moves].reverse()) {
    child = { uci: `${mv.from}${mv.to}`, children: child ? [child] : [] };
  }
  const en = englishTitle(zh, n);
  const name = en ? `${n}. ${en}` : `${n}. ${zh}`;
  // Say what the source actually gives. A single recorded move is not a
  // "solution" -- but for many of those the source DOES give an answer, in
  // prose, in its comment tags. The first version of this script had not mined
  // the comments and so told 53 readers the source "records only the opening
  // move", which was false about the record and is the sentence this replaces.
  const comment = compositionComment({
    zh,
    en,
    n,
    vol: rec.vol,
    volZh: VOL_ZH[rec.vol - 1],
    bookZh: BOOK.zh,
    moveCount: r.moves.length,
    prose: proseFrom(rec),
    variations: rec.variations?.length ?? 0,
    url: rec.url,
  });

  const root = {
    version: 1,
    rootFen: standardXiangqiFen(r.initialState),
    root: { annotations: { comments: [{ text: comment }] }, children: child ? [child] : [] },
  };
  if (!isStudyEligibleSpecId('xiangqi')) return { skip: 'variant not study-eligible' };
  if (!isSerializedTree(root)) return { skip: 'tree failed the route shape check' };
  return {
    chapter: {
      name: name.length > 80 ? `${name.slice(0, 77)}...` : name,
      i18n: { 'zh-Hans': { name: rec.title } },
      variant: 'xiangqi',
      orientation: 'red',
      root: ensureDealtRoot('xiangqi', root),
    },
    n,
  };
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');
await initPersistence(connectionString);
const owner = await findUserByEmail(email);
if (!owner) throw new Error('no account found for that email');
console.log(`owner: handle=${owner.handle ?? '?'} id=${String(owner.id).slice(0, 8)}...`);

// Remove the partial first pass before writing the complete one.
const existing = await persistence.listStudiesByOwner?.(owner.id).catch(() => null);
if (has('replace')) {
  // Without this, a book with no prior name matches `LIKE 'null%'`, deletes
  // nothing, and reports success -- a silent no-op on a destructive flag.
  if (!OLD_NAME_PREFIX) {
    throw new Error(`--replace needs an oldNamePrefix, and --book ${BOOK_KEY} has none`);
  }
  const { getPool } = await import(`${APP}/apps/server/dist/persistence-db.js`);
  const { rows } = await getPool().query(
    `SELECT id, name FROM studies WHERE owner_id = $1 AND name LIKE $2`,
    [owner.id, `${OLD_NAME_PREFIX}%`],
  );
  for (const r of rows) {
    if (has('dry-run')) {
      console.log(`  would delete ${r.id}  ${r.name}`);
      continue;
    }
    const ok = await persistence.deleteStudy(r.id, owner.id);
    console.log(`  deleted ${r.id} (${ok ? 'ok' : 'FAILED'})  ${r.name}`);
  }
}
void existing;

let total = 0;
const allSkips = [];
// Volume count comes from the mined data, not from a constant: 橘中秘's endgame
// half is one flat listing where 適情雅趣 is six volumes.
const volumes = [...new Set(records.map((r) => r.vol))].sort((a, b) => a - b);
if (volumes.length > VOL_ZH.length) {
  throw new Error(`data has ${volumes.length} volumes, --book ${BOOK_KEY} names ${VOL_ZH.length}`);
}
for (const v of volumes) {
  const built = [];
  for (const rec of records.filter((r) => r.vol === v)) {
    const c = chapterFor(rec);
    if (c.skip) {
      allSkips.push(`${rec.id} ${rec.title}: ${c.skip}`);
      continue;
    }
    built.push(c);
  }
  built.sort((a, b) => a.n - b.n);
  const chapters = built.map((b) => b.chapter);
  const listed = records.filter((r) => r.vol === v).length;
  console.log(`vol ${v}: ${chapters.length}/${listed} chapters ready`);
  if (has('dry-run') || chapters.length === 0) continue;

  const [first, ...rest] = chapters;
  const created = await persistence.createStudy({
    ownerId: owner.id,
    slug: slugFor(v),
    name: nameFor(v, chapters.length),
    description: descFor(v, chapters.length),
    visibility,
    chapter: first,
  });
  if (!created) throw new Error(`vol ${v}: createStudy returned null`);
  for (const ch of rest) {
    const added = await persistence.addChapter(created.id, owner.id, ch);
    if (!added) throw new Error(`vol ${v}: addChapter failed for ${ch.name}`);
  }
  total += chapters.length;
  console.log(`  created ${created.id} (${slugFor(v)}) with ${chapters.length} chapters`);
}

console.log(`\nskipped ${allSkips.length}:`);
for (const s of allSkips.slice(0, 15)) console.log(`  ${s}`);
console.log(has('dry-run') ? 'dry run: nothing written' : `done, ${total} chapters written`);
process.exit(0);
