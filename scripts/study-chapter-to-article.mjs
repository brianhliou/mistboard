#!/usr/bin/env node
// Turn a published study chapter into the `xq-replay` spec an article embeds,
// so the study is the single source of truth for a game and the article stops
// carrying its own copy of the moves and annotations.
//
//   node scripts/study-chapter-to-article.mjs --study ytSzepET --chapter 0BM6N4j4
//   node scripts/study-chapter-to-article.mjs --study ytSzepET --all --out spec.json
//
// Reads the public API, so it works against an UNLISTED study (GET /api/studies/:id
// admits anyone for public and unlisted; only private is owner-only) and needs no
// credential. Baked rather than fetched at render time on purpose: an article is a
// compiled content module, and a runtime fetch would make a published page depend
// on a study still existing and still being readable.

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const studyId = argOf('study');
const chapterId = argOf('chapter');
const outPath = argOf('out');
const base = argOf('base', 'https://mistboard.com');
if (!studyId) {
  console.error('--study <id> is required');
  process.exit(1);
}

// Placement plus side to move. A chapter rooted anywhere else has to carry its
// FEN into the baked spec: the widget's default is the opening, so without this
// an endgame article renders 32 pieces under a line that cannot be played from
// there, and every move label degrades to raw coordinates.
const OPENING = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r';
const positionKey = (fen) => fen.trim().split(/\s+/).slice(0, 2).join(' ');

/** NAG -> the glyph the replay widget renders. Positive codes ride along. */
const GLYPH = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };
function uciToIccs(uci) {
  // uci is fromSquare+toSquare with ranks 1-10, e.g. "h3e3" or "a10a9".
  const m = uci.match(/^([a-i])(\d{1,2})([a-i])(\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}${Number(m[2]) - 1}${m[3]}${Number(m[4]) - 1}`;
}

/**
 * Walk the tree. The FIRST child of a node is the game continuation; any further
 * child is a variation the seeder hung off the same parent, which is exactly how
 * the engine's refutation was attached, so it converts straight back into the
 * `line` the widget steps through.
 */
function convert(chapter) {
  const mainline = [];
  const byPly = {};
  let node = chapter.root.root;
  let ply = 0;
  while (node.children?.length) {
    const played = node.children[0];
    const siblings = node.children.slice(1);
    ply += 1;
    const iccs = uciToIccs(played.uci ?? '');
    if (!iccs) break;
    mainline.push(iccs);

    const glyphs = played.annotations?.glyphs ?? [];
    const comment = played.annotations?.comments?.[0]?.text;
    const glyph = glyphs.map((g) => GLYPH[g]).find(Boolean);
    if (glyph || comment || siblings.length) {
      const line = [];
      let v = siblings[0];
      while (v?.uci) {
        const step = uciToIccs(v.uci);
        if (!step) break;
        line.push(step);
        v = v.children?.[0];
      }
      byPly[ply] = {
        ...(glyph ? { glyph } : {}),
        ...(comment ? { note: comment } : {}),
        ...(line.length ? { line: line.join(' ') } : {}),
      };
    }
    node = played;
  }

  const tags = chapter.tags ?? {};
  const rootFen = chapter.root?.rootFen;
  const startFen = rootFen && positionKey(rootFen) !== OPENING ? rootFen : undefined;
  return {
    chapterId: chapter.id,
    name: chapter.name,
    spec: {
      iccs: mainline.join(' '),
      ...(startFen ? { startFen } : {}),
      red: tags.red ?? 'Red',
      black: tags.black ?? 'Black',
      event: tags.event ?? '',
      ...(chapter.orientation === 'black' ? { perspective: 'black' } : {}),
      resultText: tags.result ?? '*',
      annotations: {
        byPly,
        engine: 'Pikafish (Fairy-Stockfish CC0 net), 1,000,000 nodes per position',
      },
    },
  };
}

const response = await fetch(`${base}/api/studies/${studyId}`);
if (!response.ok) {
  console.error(`GET /api/studies/${studyId} -> ${response.status}`);
  process.exit(1);
}
const payload = await response.json();
const chapters = payload.chapters ?? payload.study?.chapters ?? [];
const picked = chapterId ? chapters.filter((c) => c.id === chapterId) : chapters;
if (picked.length === 0) {
  console.error(`no chapter ${chapterId ?? ''} in study ${studyId}`);
  process.exit(1);
}

const converted = picked.map(convert);
if (outPath) {
  writeFileSync(outPath, `${JSON.stringify(converted, null, 2)}\n`);
  console.log(`wrote ${converted.length} chapter spec(s) to ${outPath}`);
}
for (const c of converted) {
  const marks = Object.values(c.spec.annotations.byPly);
  console.log(
    `${c.chapterId}  ${c.name}\n   ${c.spec.iccs.split(' ').length} plies · ${marks.length} annotated · ` +
      `${marks.filter((m) => m.line).length} with a line · ${marks.filter((m) => m.glyph === '!!' || m.glyph === '!').length} positive`,
  );
}
