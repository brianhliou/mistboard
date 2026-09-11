/**
 * Re-seed 適情雅趣 as six volume studies, complete and titled in English.
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
 *     --email <owner> [--visibility unlisted] [--dry-run] [--replace]
 */
import { readFileSync } from 'node:fs';

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

const VOL_ZH = ['卷一', '卷二', '卷三', '卷四', '卷五', '卷六'];
const OLD_NAME_PREFIX = 'Elegant Pastime Manual (適情雅趣)';
const nameFor = (v, n) => `Elegant Pastime Manual, Vol. ${v}: ${n} classical compositions`;
const slugFor = (v) => `elegant-pastime-vol-${v}`;
const descFor = (v, n) =>
  `Volume ${v} (${VOL_ZH[v - 1]}) of 適情雅趣, a Ming-dynasty manual of xiangqi endgame ` +
  `compositions. All ${n} problems of the volume, each rooted at its own diagram with the ` +
  `book's solution as the mainline, every line replayed move by move through the Mistboard ` +
  `rules kernel. Titles are English renderings of the original four-character names, which ` +
  `are kept alongside. Positions transcribed from dpxq.com; the compositions are ` +
  `several centuries old and long out of copyright.`;

const num = (t) => {
  const m = /第\s*(\d+)\s*局/.exec(t || '');
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
const bare = (t) => (t || '').replace(/第\s*\d+\s*局\s*/, '').trim();

const EN = JSON.parse(readFileSync(arg('titles'), 'utf8'));
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
  const en = EN[zh];
  const name = en ? `${n}. ${en}` : `${n}. ${zh}`;
  // Say what the source actually gives. A single recorded move is not a
  // "solution", and none of the 60 such records ends in mate -- claiming
  // otherwise would be the confident-wrong-answer failure in prose instead of
  // in the movelist.
  const line =
    r.moves.length === 1
      ? `The source records only the opening move of the solution, played below.`
      : `The source's solution runs ${r.moves.length} moves and is played out as the mainline below.`;
  const comment =
    `${zh}${en ? ` — "${en}"` : ''}\n\n` +
    `Problem ${n} of 適情雅趣, volume ${rec.vol} (${VOL_ZH[rec.vol - 1]}). ${line}` +
    (rec.variations?.length
      ? ` The source also records ${rec.variations.length} printed variation${rec.variations.length === 1 ? '' : 's'}, not yet included here.`
      : '') +
    (rec.url ? `\n\nTranscribed from ${rec.url}` : '');

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
for (let v = 1; v <= 6; v += 1) {
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
