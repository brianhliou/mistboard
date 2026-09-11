/**
 * Structural validation for the classical-manual studies.
 *
 * Different question from `npm run studies:i18n-sweep`, which counts
 * untranslated strings. This one asks whether the content is internally
 * consistent, which is the failure the July 橘中秘 pull was: every gate green,
 * the study wrong.
 *
 * Each composition states its identity in THREE places that were assembled from
 * separate files by a merge step -- the English chapter name, the zh-Hans name,
 * and the root comment. A disagreement between them is a mis-joined
 * composition: the wrong English title sitting on the wrong position, which no
 * legality check can see.
 *
 * Also checks numbering (contiguous, no gaps, volumes tiling the manual) and
 * duplicate titles. A repeated title is fine when the SOURCE repeats it; a
 * repeated English title over two different Chinese titles is a translation
 * collision that makes two compositions indistinguishable in the index.
 *
 *   command railway run -s Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node validate-studies.mjs'
 *   ... --prefix tangerine- to point it at another manual.
 *
 * Read-only. Exits non-zero when any problem is found.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    prefix: { type: 'string', default: 'elegant-pastime-vol-' },
    book: { type: 'string', default: '適情雅趣' },
  },
});
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set; run through `command railway run -s Postgres`');
  process.exit(1);
}

const VOL_ZH = ['卷一', '卷二', '卷三', '卷四', '卷五', '卷六'];
const CJK = /[㐀-鿿]/;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const push = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);

try {
  const studies = await client.query(
    `SELECT id, slug, name, description, i18n, visibility FROM studies
      WHERE slug LIKE $1 ORDER BY slug`,
    [`${values.prefix}%`],
  );
  console.log('=== STUDY LEVEL ===');
  for (const s of studies.rows) {
    const locales = Object.keys(s.i18n ?? {});
    console.log(
      `${s.slug}  [${s.visibility}]  i18n: ${locales.length ? locales.join(', ') : 'NONE'}  ` +
        `nameLen=${s.name.length} descLen=${s.description.length}`,
    );
  }

  const chapters = await client.query(
    `SELECT s.slug, c.id, c.name, c.i18n, c.root
       FROM studies s JOIN study_chapters c ON c.study_id = s.id
      WHERE s.slug LIKE $1`,
    [`${values.prefix}%`],
  );

  const problems = [];
  const enTitles = new Map();
  const zhTitles = new Map();
  const numbersByVol = new Map();
  let commentsWithI18n = 0;

  for (const c of chapters.rows) {
    const vol = Number(c.slug.split('-').pop());
    const where = `${c.slug}/${c.name}`;

    const en = /^(\d+)\.\s+(.+)$/.exec(c.name);
    if (!en) {
      problems.push(`${where}: English name does not match "<n>. <Title>"`);
      continue;
    }
    const num = Number(en[1]);
    const enTitle = en[2];
    push(numbersByVol, vol, num);
    push(enTitles, enTitle, { where, num });
    if (CJK.test(enTitle)) problems.push(`${where}: English title contains Chinese`);

    const zhName = c.i18n?.['zh-Hans']?.name;
    if (!zhName) problems.push(`${where}: no zh-Hans name`);
    else {
      const zh = /^第(\d+)局\s*(.+)$/.exec(zhName);
      if (!zh) problems.push(`${where}: zh name is not "第N局 <title>" (${zhName})`);
      else {
        if (Number(zh[1]) !== num) problems.push(`${where}: number en=${num} zh=${zh[1]}`);
        push(zhTitles, zh[2], where);
      }
    }
    // The base name is English, so a missing overlay serves English to a Chinese
    // reader rather than falling through to the other script.
    if (!c.i18n?.['zh-Hant']?.name) problems.push(`${where}: no zh-Hant name`);

    const comments = c.root?.root?.annotations?.comments ?? [];
    const text = comments[0]?.text ?? '';
    if (comments[0]?.i18n) commentsWithI18n += 1;
    if (!text) problems.push(`${where}: no root comment`);
    else {
      const m = new RegExp(`Problem (\\d+) of ${values.book}, volume (\\d+) \\((.+?)\\)`).exec(
        text,
      );
      if (!m) problems.push(`${where}: comment has no "Problem N of ... volume V" line`);
      else {
        if (Number(m[1]) !== num)
          problems.push(`${where}: comment says problem ${m[1]}, not ${num}`);
        if (Number(m[2]) !== vol)
          problems.push(`${where}: comment says volume ${m[2]}, not ${vol}`);
        if (m[3] !== VOL_ZH[vol - 1])
          problems.push(`${where}: comment 卷 ${m[3]} wrong for vol ${vol}`);
      }
      if (!text.includes(enTitle))
        problems.push(`${where}: comment does not quote its English title`);
      if (!text.includes('dpxq.com')) problems.push(`${where}: comment carries no dpxq credit`);
    }
  }

  console.log('\n=== NUMBERING ===');
  let expected = null;
  for (const vol of [...numbersByVol.keys()].sort((a, b) => a - b)) {
    const nums = [...numbersByVol.get(vol)].sort((a, b) => a - b);
    const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    const tiles = expected === null || nums[0] === expected;
    console.log(
      `vol ${vol}: ${nums.length} chapters, ${nums[0]}-${nums.at(-1)}, ` +
        `contiguous=${contiguous} tilesFromPrevious=${tiles}`,
    );
    if (!tiles)
      problems.push(`vol ${vol}: starts at ${nums[0]}, previous ended at ${expected - 1}`);
    expected = nums.at(-1) + 1;
  }

  console.log('\n=== TITLE COLLISIONS ===');
  let collisions = 0;
  for (const [en, list] of enTitles) {
    if (list.length < 2) continue;
    const zhFor = (num) =>
      chapters.rows.find((c) => c.name.startsWith(`${num}. `))?.i18n?.['zh-Hans']?.name ?? '';
    const distinct = new Set(list.map((x) => zhFor(x.num).replace(/^第\d+局\s*/, '')));
    if (distinct.size === 1) continue; // the source repeats the title too
    collisions += 1;
    console.log(
      `  "${en}" over ${distinct.size} different Chinese titles: ${[...distinct].join(' / ')}`,
    );
  }
  console.log(`${collisions} English titles covering more than one Chinese title`);

  console.log(`\nroot comments with any i18n: ${commentsWithI18n}/${chapters.rowCount}`);
  console.log(`\n=== PROBLEMS: ${problems.length} ===`);
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
  if (problems.length) process.exitCode = 1;
} finally {
  await client.end();
}
