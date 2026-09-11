/**
 * Add compositions the source lists but a published study does not have.
 *
 * 適情雅趣 卷六 shipped with 81 of the volume's 84. All three gaps were records
 * the seeder dropped because their lines would not replay, and two of those
 * turned out to be 黑先 problems rather than bad records: DhtmlXQ's binit carries
 * no side to move and `dhtmlxqStateFromBinit` assumes red, so move 1 is illegal
 * for a structural reason. `composition-chapter.mjs` retries as black.
 *
 *   command railway run -s Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node add-missing-chapters.mjs \
 *        --app <checkout> --data <mined.json> --slug elegant-pastime-vol-6 --vol 6'
 *   ... add --apply to write.
 *
 * APPENDS. `addChapter` puts a new chapter at MAX(ordinal)+1, so a composition
 * added later sits at the end of the study rather than in numerical order. That
 * is the honest trade: reordering rewrites every ordinal in the study, and the
 * chapter list is numbered in its own titles anyway. Pass --reorder to sort the
 * whole study by composition number afterwards.
 */
import { readFileSync } from 'node:fs';

const A = process.argv;
const arg = (n, d) => {
  const i = A.indexOf(`--${n}`);
  return i >= 0 && A[i + 1] ? A[i + 1] : d;
};
const has = (n) => A.includes(`--${n}`);
const APP = arg('app', '/app').replace(/\/$/, '');
const SLUG = arg('slug');
const VOL = Number(arg('vol', '6'));
const BOOK_ZH = arg('book', '適情雅趣');
if (!SLUG || !arg('data')) {
  console.error(
    'usage: add-missing-chapters.mjs --app <dir> --data <mined.json> --slug <slug> [--vol N] [--apply]',
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set; run through `command railway run -s Postgres`');
  process.exit(1);
}

const {
  importXiangqiGame,
  standardXiangqiFen,
  isStudyEligibleSpecId,
  xiangqiBoardFromDhtmlxqBinit,
} = await import(`${APP}/node_modules/@mistboard/game/dist/index.js`);
const persistence = await import(`${APP}/apps/server/dist/persistence-studies.js`);
const { init: initPersistence, getPool } = await import(
  `${APP}/apps/server/dist/persistence-db.js`
);
const { ensureDealtRoot } = await import(`${APP}/apps/server/dist/routes/studies.js`);
const { buildChapter, numberOf } = await import('./composition-chapter.mjs');

const VOL_ZH = ['卷一', '卷二', '卷三', '卷四', '卷五', '卷六'];
const TITLES = JSON.parse(readFileSync(arg('titles'), 'utf8'));
const byTitle = TITLES.byTitle ?? TITLES;
const byNumber = TITLES.byNumber ?? {};
const englishTitle = (zh, n) => byTitle[zh] ?? byNumber[String(n)];

const records = JSON.parse(readFileSync(arg('data'), 'utf8')).filter((r) => r.vol === VOL);

await initPersistence(process.env.DATABASE_URL);
const pool = getPool();

const { rows: studyRows } = await pool.query(
  `SELECT id, owner_id, name FROM studies WHERE slug = $1`,
  [SLUG],
);
const study = studyRows[0];
if (!study) throw new Error(`no study with slug ${SLUG}`);

const { rows: chapterRows } = await pool.query(
  `SELECT name FROM study_chapters WHERE study_id = $1`,
  [study.id],
);
const present = new Set(chapterRows.map((c) => Number(/^(\d+)\./.exec(c.name)?.[1])));
console.log(`${study.name}\n  ${present.size} chapters present, ${records.length} records mined\n`);

const deps = {
  importXiangqiGame,
  standardXiangqiFen,
  isStudyEligibleSpecId,
  xiangqiBoardFromDhtmlxqBinit,
  ensureDealtRoot,
};
const opts = { englishTitle, volZh: VOL_ZH, bookZh: BOOK_ZH };

const missing = records.filter((r) => !present.has(numberOf(r.title)));
let added = 0;
for (const rec of missing) {
  const built = buildChapter(rec, deps, opts);
  if (built.skip) {
    console.log(`SKIP 第${numberOf(rec.title)}局 ${rec.title}: ${built.skip}`);
    continue;
  }
  console.log(`ADD  ${built.chapter.name}   (${built.turn} to move)`);
  console.log(`     ${built.chapter.root.rootFen}`);
  if (!has('apply')) continue;
  const ok = await persistence.addChapter(study.id, study.owner_id, built.chapter);
  if (!ok) throw new Error(`addChapter failed for ${built.chapter.name}`);
  added += 1;
}

if (has('apply') && has('reorder')) {
  const { rows } = await pool.query(`SELECT id, name FROM study_chapters WHERE study_id = $1`, [
    study.id,
  ]);
  const ordered = rows
    .map((r) => ({ id: r.id, n: Number(/^(\d+)\./.exec(r.name)?.[1] ?? Number.MAX_SAFE_INTEGER) }))
    .sort((a, b) => a.n - b.n)
    .map((r) => r.id);
  // reorderStudyChapters demands the complete current id set, so this cannot
  // partially apply.
  const done = await persistence.reorderStudyChapters(study.id, study.owner_id, ordered);
  console.log(
    done ? `reordered ${ordered.length} chapters by composition number` : 'reorder REFUSED',
  );
}

console.log(
  has('apply')
    ? `\n${added} chapters added${has('reorder') ? ', study reordered' : ''}`
    : `\n${missing.length} missing, dry run: nothing written. Re-run with --apply.`,
);
process.exit(0);
