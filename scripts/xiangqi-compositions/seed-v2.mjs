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
 * EDITS MODE (2026-09-14). `--edits <slug>.edits.json` makes the reviewed edits
 * file the book configuration: study names, descriptions and i18n per volume,
 * chapter numbers, English and Traditional titles, and the comments that
 * survived prose triage all come from it, and a record it marks publish=false
 * is held back. `--book` and `--titles` are then unused. The file's shape is in
 * docs-private/manual-mining-2026-09-14/BRIEF.md.
 *
 *   node seed-v2.mjs --app <repo> --data <mined.json> --edits <slug>.edits.json \
 *     --email <owner> [--visibility unlisted] [--dry-run]
 *
 * It CREATES. There is no update path here: re-pointing an existing chapter is a
 * PATCH against the live study, not a re-seed, because a delete-and-recreate
 * loses the chapter id, its permalink, and its place in the ordering.
 */
import { readFileSync } from 'node:fs';
import { buildChapter } from './composition-chapter.mjs';

const A = process.argv;
const arg = (n, d) => {
  const i = A.indexOf(`--${n}`);
  return i >= 0 && A[i + 1] ? A[i + 1] : d;
};
const has = (n) => A.includes(`--${n}`);
const APP = arg('app', '/app').replace(/\/$/, '');

const {
  importXiangqiGame,
  standardXiangqiFen,
  isStudyEligibleSpecId,
  xiangqiBoardFromDhtmlxqBinit,
  createInitialXiangqiState,
} = await import(`${APP}/node_modules/@mistboard/game/dist/index.js`);
const persistence = await import(`${APP}/apps/server/dist/persistence-studies.js`);
const { findUserByEmail } = await import(`${APP}/apps/server/dist/persistence-accounts.js`);
const { init: initPersistence } = await import(`${APP}/apps/server/dist/persistence-db.js`);
const { ensureDealtRoot } = await import(`${APP}/apps/server/dist/routes/studies.js`);

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

const EDITS = has('edits') ? JSON.parse(readFileSync(arg('edits'), 'utf8')) : null;
const kebab = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** The book block of an edits file as the same shape BOOKS entries have. */
function bookFromEdits(edits) {
  const book = edits.book ?? {};
  const volumes = Array.isArray(book.volumes) && book.volumes.length > 0 ? book.volumes : [{ vol: 1, zh: book.zh }];
  const studyFor = (v) => volumes[v - 1]?.study ?? (volumes.length === 1 ? book.study : null);
  const need = (v, what) => {
    throw new Error(`edits book volume ${v} has no ${what}; the book editor must supply it`);
  };
  return {
    zh: book.zh,
    era: book.dynasty ? `${book.dynasty}-dynasty` : 'classical',
    kind: book.kind ?? arg('kind', 'compositions'),
    volumes,
    volZh: volumes.map((x) => x.zh ?? book.zh),
    oldNamePrefix: null,
    nameFor: (v) => studyFor(v)?.en?.name ?? need(v, 'study.en.name'),
    descFor: (v) => studyFor(v)?.en?.description ?? need(v, 'study.en.description'),
    i18nFor: (v) => {
      const st = studyFor(v) ?? need(v, 'study');
      const out = {};
      for (const locale of ['zh-Hans', 'zh-Hant']) {
        if (st[locale]?.name || st[locale]?.description) out[locale] = { ...st[locale] };
      }
      return out;
    },
    kindFor: (v) => volumes[v - 1]?.kind ?? book.kind ?? arg('kind', 'compositions'),
    slugFor: (v) => {
      const explicit = volumes[v - 1]?.slug ?? (volumes.length === 1 ? book.slug : null);
      if (explicit) return explicit;
      const base = kebab((studyFor(v)?.en?.name ?? book.en ?? edits.slug).split(':')[0]);
      return volumes.length === 1 ? base : `${base}-vol-${v}`;
    },
  };
}

const BOOK_KEY = EDITS ? EDITS.slug : arg('book', 'shi-qing-ya-qu');
const BOOK = EDITS ? bookFromEdits(EDITS) : BOOKS[BOOK_KEY];
if (!BOOK) throw new Error(`unknown --book ${BOOK_KEY}; known: ${Object.keys(BOOKS).join(', ')}`);

const VOL_ZH = BOOK.volZh;
const OLD_NAME_PREFIX = BOOK.oldNamePrefix;
const nameFor = BOOK.nameFor;
const slugFor = BOOK.slugFor;
const descFor = BOOK.descFor ?? ((v, n) =>
  `Volume ${v} (${VOL_ZH[v - 1]}) of ${BOOK.zh}, a ${BOOK.era} manual of xiangqi endgame ` +
  `compositions. All ${n} problems of the volume, each rooted at its own diagram with the ` +
  `book's solution as the mainline. Titles are English renderings of the original ` +
  `four-character names, which are kept alongside. Records come from dpxq.com and are ` +
  `credited on each composition. Every line replays legally through the Mistboard rules ` +
  `kernel, which is a check on the record and not on the book: this text has a single ` +
  `source, and a solution recorded short would still replay cleanly. The compositions are ` +
  `several centuries old and long out of copyright.`);

const num = (t) => {
  const m = /第\s*(\d+)\s*局/.exec(t || '');
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
const bare = (t) => (t || '').replace(/第\s*\d+\s*局\s*/, '').trim();

// The committed titles file carries two maps that do not overlap: byTitle (537
// entries, keyed by the four-character Chinese name) and byNumber (280, keyed by
// the composition's number in the manual). A flat {zh: en} object is also
// accepted, which is the shape the original run used.
const TITLES_RAW = has('titles') ? JSON.parse(readFileSync(arg('titles'), 'utf8')) : {};
if (!EDITS && !has('titles')) throw new Error('--titles <en.json> is required without --edits');
const EN = TITLES_RAW.byTitle ?? TITLES_RAW;
const EN_BY_NUMBER = TITLES_RAW.byNumber ?? {};
const englishTitle = (zh, n) => EN[zh] ?? EN_BY_NUMBER[String(n)];
const records = JSON.parse(readFileSync(arg('data'), 'utf8'));
if (EDITS) {
  // Every record must have been reviewed; a record the edits file does not know
  // is a record no witness looked at, and it does not seed.
  const unknown = records.filter((r) => !EDITS.records?.[String(r.id)]);
  if (unknown.length > 0) {
    console.log(`edits file does not cover ${unknown.length} record(s); they will be skipped:`);
    for (const r of unknown.slice(0, 10)) console.log(`  ${r.id} ${r.title}`);
  }
}
const visibility = arg('visibility', 'unlisted');
if (!persistence.isStudyVisibility(visibility)) throw new Error(`bad visibility ${visibility}`);
const email = arg('email');
if (!email) throw new Error('--email <owner> required');

const DEPS = {
  importXiangqiGame,
  standardXiangqiFen,
  isStudyEligibleSpecId,
  xiangqiBoardFromDhtmlxqBinit,
  createInitialXiangqiState,
  ensureDealtRoot,
};
const singleVolume = VOL_ZH.length === 1;
const GLOSS = JSON.parse(readFileSync(new URL('../data/xiangqi-compositions/verdict-gloss.json', import.meta.url), 'utf8'));
const chapterFor = (rec) => {
  const edit = EDITS ? EDITS.records?.[String(rec.id)] : undefined;
  if (EDITS && !edit) return { skip: 'not in the edits file' };
  return buildChapter(rec, DEPS, {
    englishTitle,
    volZh: VOL_ZH,
    bookZh: BOOK.zh,
    edit,
    kind: BOOK.kindFor ? BOOK.kindFor(rec.vol) : 'compositions',
    singleVolume,
    gloss: GLOSS,
  });
};

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
// A game manual whose dpxq "volumes" are opening families (梅花谱's six) is one
// study, not six of five games: `book.singleStudy` folds every record into
// volume 1 and the family label lives in the chapter's English name.
if (EDITS?.book?.singleStudy) for (const r of records) r.vol = 1;
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
  // The study name carries the chapter count ("Vol. 6: 83 classical compositions",
  // 九十二局). In edits mode the editor wrote it from their publish count; if the
  // seeder holds back anything else the name lies on the study card, so stop.
  const stated = /\b(\d+)\s+(?:classical|endgame|full)/.exec(nameFor(v, chapters.length));
  if (EDITS && stated && Number(stated[1]) !== chapters.length && !has('allow-count-mismatch')) {
    throw new Error(
      `vol ${v}: study name says ${stated[1]} but ${chapters.length} chapters will seed; ` +
        'fix the edits file (name in all three locales) or pass --allow-count-mismatch',
    );
  }
  if (has('dry-run')) {
    console.log(`  would create slug=${slugFor(v)}`);
    console.log(`  name: ${nameFor(v, chapters.length)}`);
    if (BOOK.i18nFor) for (const [loc, f] of Object.entries(BOOK.i18nFor(v))) console.log(`  ${loc}: ${f.name ?? ''}`);
    for (const b of built.slice(0, 3)) console.log(`  ${b.chapter.name}  [${b.turn} to move]`);
  }
  if (has('dry-run') || chapters.length === 0) continue;

  const [first, ...rest] = chapters;
  const created = await persistence.createStudy({
    ownerId: owner.id,
    slug: slugFor(v),
    name: nameFor(v, chapters.length),
    description: descFor(v, chapters.length),
    i18n: BOOK.i18nFor ? BOOK.i18nFor(v) : {},
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
