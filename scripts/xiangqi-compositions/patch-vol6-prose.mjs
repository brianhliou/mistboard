/**
 * Rewrite the root comment on already-published composition chapters, using the
 * source's prose answer where there is one.
 *
 * 53 of 適情雅趣 卷六's 81 published chapters say "The source records only the
 * opening move of the solution". That is false about the record: dpxq keeps
 * those answers in [DhtmlXQ_comment0/1] because a draw study's answer is a
 * principle rather than a forced line, and nothing in the pipeline read those
 * tags until 2026-09-11.
 *
 *   command railway run -s Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node patch-vol6-prose.mjs --data <mined.json>'
 *   ... add --apply to write.
 *
 * PATCHES IN PLACE and never deletes. A delete-and-recreate would lose the
 * chapter id, break its /study/:id/:cid permalink and its sitemap entry, and
 * send it to the end of the ordering, because addChapter appends at
 * MAX(ordinal)+1.
 *
 * The move tree is not touched: only the comment inside it. The mainline stored
 * today is what the reader sees, so the comment is rebuilt against THAT ply
 * count rather than against the freshly mined one, and any disagreement between
 * the two is reported instead of silently resolved.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { compositionComment, proseFrom } from './composition-comment.mjs';

const { values } = parseArgs({
  options: {
    data: { type: 'string' },
    slug: { type: 'string', default: 'elegant-pastime-vol-6' },
    vol: { type: 'string', default: '6' },
    book: { type: 'string', default: '適情雅趣' },
    apply: { type: 'boolean', default: false },
  },
});
if (!values.data) {
  console.error('usage: patch-vol6-prose.mjs --data <mined.json> [--slug ...] [--apply]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set; run through `command railway run -s Postgres`');
  process.exit(1);
}

const VOL_ZH = ['卷一', '卷二', '卷三', '卷四', '卷五', '卷六'];
const VOL = Number(values.vol);
const numOf = (title) => {
  const m = /第\s*(\d+)\s*局/.exec(title ?? '');
  return m ? Number(m[1]) : null;
};
const bare = (title) => (title ?? '').replace(/第\s*\d+\s*局\s*/, '').trim();
const plies = (node) => {
  let n = 0;
  let cur = node;
  while (cur?.children?.length) {
    n += 1;
    cur = cur.children[0];
  }
  return n;
};

const mined = JSON.parse(readFileSync(values.data, 'utf8')).filter((r) => r.vol === VOL);
const byNumber = new Map(mined.map((r) => [numOf(r.title), r]));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let changed = 0;
let unchanged = 0;
const refused = [];

try {
  const { rows } = await client.query(
    `SELECT c.id, c.name, c.i18n, c.root, c.version
       FROM studies s JOIN study_chapters c ON c.study_id = s.id
      WHERE s.slug = $1 ORDER BY c.ordinal`,
    [values.slug],
  );
  console.log(`${rows.length} published chapters, ${mined.length} mined records\n`);

  const live = new Set();
  for (const ch of rows) {
    const n = Number(/^(\d+)\./.exec(ch.name)?.[1]);
    live.add(n);
    const rec = byNumber.get(n);
    if (!rec) {
      refused.push(`${ch.name}: no mined record for composition ${n}`);
      continue;
    }
    // The Chinese title is the identity both sides agree on; if it has moved,
    // the join is wrong and rewriting the comment would mislabel a position.
    const liveZh = bare(ch.i18n?.['zh-Hans']?.name);
    if (liveZh && liveZh !== bare(rec.title)) {
      refused.push(`${ch.name}: live title ${liveZh} != mined ${bare(rec.title)}`);
      continue;
    }

    const stored = plies(ch.root?.root);
    const minedPlies = rec.mainline ? rec.mainline.length / 4 : 0;
    if (stored !== minedPlies) {
      console.log(`  note ${ch.name}: stored ${stored} plies, dpxq now serves ${minedPlies}`);
    }

    const comments = ch.root?.root?.annotations?.comments ?? [];
    if (comments.length !== 1) {
      refused.push(`${ch.name}: expected 1 root comment, found ${comments.length}`);
      continue;
    }
    const en = /^\d+\.\s+(.+)$/.exec(ch.name)?.[1];
    const next = compositionComment({
      zh: bare(rec.title),
      en,
      n,
      vol: VOL,
      volZh: VOL_ZH[VOL - 1],
      bookZh: values.book,
      moveCount: stored,
      prose: proseFrom(rec),
      variations: rec.variations?.length ?? 0,
      url: rec.url,
    });
    if (next === comments[0].text) {
      unchanged += 1;
      continue;
    }
    changed += 1;
    if (changed <= 3) {
      console.log(`--- ${ch.name}\n${next}\n`);
    }
    if (!values.apply) continue;

    const root = {
      ...ch.root,
      root: {
        ...ch.root.root,
        annotations: {
          ...ch.root.root.annotations,
          comments: [{ ...comments[0], text: next }],
        },
      },
    };
    const res = await client.query(
      `UPDATE study_chapters SET root = $2::jsonb, version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $3`,
      [ch.id, JSON.stringify(root), ch.version],
    );
    if (res.rowCount !== 1) refused.push(`${ch.name}: version moved under us, not written`);
  }

  const missing = [...byNumber.keys()]
    .filter((n) => n !== null && !live.has(n))
    .sort((a, b) => a - b);
  console.log(
    `\n${changed} comments ${values.apply ? 'rewritten' : 'would change'}, ` +
      `${unchanged} already correct, ${refused.length} refused`,
  );
  for (const r of refused.slice(0, 20)) console.log(`  REFUSED ${r}`);
  if (missing.length) {
    console.log(`\n${missing.length} compositions dpxq lists that we never published:`);
    for (const n of missing) {
      const rec = byNumber.get(n);
      const why = !rec.binit ? 'no start position' : !rec.mainline ? 'no mainline' : 'unknown';
      console.log(`  第${n}局 ${bare(rec.title)}  (${why})  ${rec.url}`);
    }
  }
  if (!values.apply) console.log('\ndry run: nothing written. Re-run with --apply.');
} finally {
  await client.end();
}
