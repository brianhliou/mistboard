#!/usr/bin/env node
// Build one study per player from a directory of annotate-game.mjs output: one
// chapter per game, the engine's judged moves as glyphs and comments, each
// engine line hung as a sibling variation. The "all games" link on a player page.
//
//   node scripts/player-study.mjs --dir out/annot --names docs-private/players/yin-sheng/names.json \
//     --name "Yin Sheng 尹昇: 31 games, Aug–Sep 2026" --player 尹昇
//   node scripts/player-study.mjs ... --cookie ~/.mistboard-cookie --create
//   node scripts/player-study.mjs ... --cookie ~/.mistboard-cookie --update <studyId>
//
// Dry run is the default and prints one row per chapter. --create writes an
// UNLISTED study to the account the cookie belongs to; --update syncs an existing
// one by chapter name. The cookie is read from a file and used as a header, never
// printed, never an argument.
//
// Sibling of world-title-study.mjs: same tree shape, same NAGs, same judgment
// sentence (so the study's comments translate), same version-guarded update.
// The tree builders are copied rather than imported because that script runs its
// build on import and exports only ASSESS_NAG; lifting the shared parts into
// scripts/lib is the refactor to do when a third study builder appears.
//
// Differences that matter:
//   - Input is annotate-game JSON straight from the engine, not an article's
//     specs. There is no article to be the source of truth for 31 games; the
//     annotation directory is it, and the page bakes its own five.
//   - Chapter orientation is the PLAYER's side, so the reader sees every game
//     from his seat.
//   - `--year-fix 2029=2026` rewrites a source year the source got wrong (dpxq
//     dated the 2026 league stage-one games 2029). Applied to ordering AND to
//     the date tag: the study should say what happened, and 2029 has not.

import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { parseJudgmentComment } = await import('../packages/game/src/xiangqi-judgment-comment.ts');
const { judgmentCommentI18n } = await import('../apps/server/src/xiangqi-judgment-comment-i18n.ts');

const args = process.argv.slice(2);
const argOf = (k, d = '') => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : (args[i + 1] ?? d);
};
const DIR = argOf('dir');
const PLAYER = argOf('player');
const BASE = argOf('base', 'https://mistboard.com');
const CREATE = args.includes('--create');
const UPDATE = argOf('update');
const STUDY_NAME = argOf('name');
const STUDY_DESCRIPTION = argOf(
  'description',
  'Every game of the run, through the same engine analysis Mistboard runs on your games. Judged moves carry the engine line as a variation you can step into.',
);
/**
 * Reviewed positive glyphs, `{ "<key>": { "<ply>": "!!" | "!" } }`. The
 * analyser marks negatives only; the positives come from
 * xq-positive-glyphs-scan.mjs and are baked only after a human has replayed
 * them (docs-private/xiangqi-positive-annotations-research.md). A ply that is
 * also judged negative keeps the negative: the scan never marks one of those.
 */
const GLYPHS = argOf('glyphs') ? JSON.parse(readFileSync(argOf('glyphs'), 'utf8')) : {};
const POSITIVE_NOTE = {
  '!!': "Brilliant: a piece offered and not recovered, confirmed along the engine's own line.",
  '!': 'Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.',
};
const YEAR_FIX = Object.fromEntries(
  args.flatMap((a, i) => (a === '--year-fix' ? [String(args[i + 1]).split('=')] : [])),
);

if (!DIR || !PLAYER || !STUDY_NAME) {
  console.error(
    'usage: player-study.mjs --dir <annotate-json dir> --player <zh name> --name <study name> [--names names.json] [--glyphs reviewed-positives.json] [--year-fix 2029=2026] [--create | --update <id>] [--cookie path] [--public]',
  );
  process.exit(1);
}

/**
 * zh -> English for everyone who appears on a board. Optional; a name with no
 * entry is shown as the source's last token ("浙江 尹昇" -> "尹昇"). Values are
 * either a string (mainland: one form serves both zh scripts) or {en, hant}
 * for a player whose name converts (Hong Kong, Taiwan, Macau, Vietnam).
 */
const NAMES = argOf('names') ? JSON.parse(readFileSync(argOf('names'), 'utf8')) : {};
const lastToken = (raw) =>
  String(raw ?? '')
    .trim()
    .split(/\s+/)
    .at(-1) ?? '';
function zhOf(raw) {
  for (const zh of Object.keys(NAMES)) if (String(raw ?? '').includes(zh)) return zh;
  return lastToken(raw);
}
function enOf(raw) {
  const zh = zhOf(raw);
  const entry = NAMES[zh];
  if (!entry) return zh;
  return typeof entry === 'string' ? entry : entry.en;
}
function zhScript(raw, script) {
  const zh = zhOf(raw);
  const entry = NAMES[zh];
  if (entry && typeof entry === 'object' && script === 'hant' && entry.hant) return entry.hant;
  return zh;
}

/** Study trees use ranks 1-10; the analyser emits ICCS 0-9. */
const toStudyUci = (iccs) => `${iccs[0]}${Number(iccs[1]) + 1}${iccs[2]}${Number(iccs[3]) + 1}`;
const NAG = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
/** Assessment symbols -> PGN NAGs, same table as world-title-study.mjs. */
const ASSESS_NAG = { '=': 10, '∞': 13, '⩲': 14, '⩱': 15, '±': 16, '∓': 17, '+−': 18, '−+': 19 };

/**
 * Verdict on an engine line, red POV, the article-line-evals.mjs bands. A line
 * is the engine's best play from the position it starts in, so its value is
 * that position's root score, which the analyser already measured: the eval
 * after ply p-1 is the position ply p's line starts from. No second search.
 * Against the article script's own re-search at the same budget this agreed
 * on 30 of 34 lines on the 尹昇 page; the four differed by one band on scores
 * within 5cp of a threshold, which is the engine's run-to-run noise, not a
 * method difference.
 */
function assessSymbol(cp, mate) {
  if (mate != null && mate !== 0) return mate > 0 ? '+−' : '−+';
  if (cp == null) return null;
  const a = Math.abs(cp);
  if (a < 30) return '=';
  const sign = cp > 0;
  if (a < 90) return sign ? '⩲' : '⩱';
  if (a < 250) return sign ? '±' : '∓';
  return sign ? '+−' : '−+';
}

/** Eval AFTER the played move, red POV, as the judgment sentence reads it. */
function evalText(row) {
  if (row.mate != null) return `#${row.mate}`;
  if (row.cp == null) return '';
  const pawns = row.cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

/** annotate-game rows -> the byPly map annotated-game-to-spec.mjs would emit. */
function annotationsOf(rows, key) {
  const byPly = {};
  for (const [ply, glyph] of Object.entries(GLYPHS[key] ?? {})) {
    if (POSITIVE_NOTE[glyph]) byPly[String(ply)] = { glyph, note: POSITIVE_NOTE[glyph] };
  }
  for (const row of rows) {
    if (!row.symbol || !row.judgment) continue;
    const line = (row.pv ?? []).join(' ');
    const evaluation = evalText(row);
    // The position the line starts from is the one after the previous ply.
    const before = row.ply >= 2 ? rows[row.ply - 2] : null;
    const lineEval = before ? assessSymbol(before.cp, before.mate) : null;
    // Same sentence as the champions article and the world-title study, so the
    // parser recognises it and the comment ships translated.
    const note =
      `${row.judgment}: ${row.lost?.toFixed(1)} win% given up` +
      (evaluation ? `, eval ${evaluation} after` : '') +
      '. The engine wanted the line in the sibling branch.';
    byPly[String(row.ply)] = {
      glyph: row.symbol,
      note,
      ...(line ? { line } : {}),
      ...(line && lineEval ? { lineEval } : {}),
    };
  }
  return byPly;
}

function comment(note) {
  const judgment = parseJudgmentComment(note);
  return judgment ? { text: note, i18n: judgmentCommentI18n(judgment) } : { text: note };
}

/** Mainline as first children; each engine line a sibling on the node the
 *  refuted move was played from. The shape study-chapter-to-article reads back. */
function buildTree(iccs, byPly) {
  const mainline = iccs.trim().split(/\s+/);
  const root = { annotations: {}, children: [] };
  const nodes = [root];
  for (const [index, token] of mainline.entries()) {
    const node = { uci: toStudyUci(token), children: [] };
    const annotation = byPly[String(index + 1)];
    if (annotation) {
      const glyph = NAG[annotation.glyph];
      node.annotations = {
        ...(glyph ? { glyphs: [glyph] } : {}),
        ...(annotation.note ? { comments: [comment(annotation.note)] } : {}),
      };
    }
    nodes[index].children.push(node);
    nodes.push(node);
  }
  for (const [plyKey, annotation] of Object.entries(byPly)) {
    if (!annotation.line) continue;
    const parent = nodes[Number(plyKey) - 1];
    if (!parent) continue;
    let cursor = parent;
    for (const token of annotation.line.trim().split(/\s+/)) {
      const node = { uci: toStudyUci(token), children: [] };
      cursor.children.push(node);
      cursor = node;
    }
    // The verdict closes the line: last node, where the tree's assessment slot is.
    const assess = ASSESS_NAG[annotation.lineEval];
    if (assess !== undefined && cursor !== parent) {
      cursor.annotations = { ...cursor.annotations, glyphs: [assess] };
    }
  }
  return { version: 1, root };
}

function fixDate(raw) {
  const date = String(raw ?? '')
    .slice(0, 10)
    .replace(/-00$/, '');
  const year = date.slice(0, 4);
  return YEAR_FIX[year] ? `${YEAR_FIX[year]}${date.slice(4)}` : date;
}

function loadGames() {
  const games = [];
  for (const file of readdirSync(DIR)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    const game = data.game ?? {};
    const rows = data.rows ?? [];
    if (!rows.length) continue;
    const red = String(game.red ?? '');
    const black = String(game.black ?? '');
    const side = red.includes(PLAYER) ? 'red' : black.includes(PLAYER) ? 'black' : null;
    if (!side) {
      console.error(`  skip ${file}: ${PLAYER} is on neither side`);
      continue;
    }
    games.push({
      key: game.key ?? file.replace(/\.json$/, ''),
      date: fixDate(game.date),
      event: String(game.event ?? ''),
      red,
      black,
      side,
      result: String(game.result ?? ''),
      sourceUrl: game.sourceUrl ?? '',
      iccs: rows.map((r) => r.uci).join(' '),
      byPly: annotationsOf(rows, game.key ?? file.replace(/\.json$/, '')),
      plies: rows.length,
    });
  }
  // Date, then source key: within a day the key is the only order the source
  // gives, and it is NOT play order (a seven-game match posts in one batch).
  games.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  return games;
}

const chapterName = (g) => `${g.date} · ${enOf(g.red)} vs ${enOf(g.black)} · ${g.result}`;

function chapterFor(g) {
  const i18n = {};
  for (const [locale, script] of [
    ['zh-Hans', 'hans'],
    ['zh-Hant', 'hant'],
  ]) {
    i18n[locale] = {
      name: `${g.date} · ${zhScript(g.red, script)} 对 ${zhScript(g.black, script)} · ${g.result}`,
      tags: { red: zhScript(g.red, script), black: zhScript(g.black, script), event: g.event },
    };
  }
  return {
    name: chapterName(g),
    variant: 'xiangqi',
    orientation: g.side,
    root: buildTree(g.iccs, g.byPly),
    // Lowercase, only these keys: the server allowlists
    // red/black/result/event/date/round/site and silently drops the rest.
    tags: {
      red: enOf(g.red),
      black: enOf(g.black),
      result: g.result,
      event: g.event,
      ...(g.date ? { date: g.date } : {}),
      ...(g.sourceUrl ? { site: g.sourceUrl } : {}),
    },
    i18n,
  };
}

/** Key-order-independent JSON compare: Postgres JSONB reorders keys. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

async function send(method, path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

async function update(studyId, games, cookie) {
  const current = await (await fetch(`${BASE}/api/studies/${studyId}`)).json();
  const byName = new Map((current.chapters ?? []).map((c) => [c.name, c]));
  let changed = 0;
  for (const g of games) {
    const name = chapterName(g);
    const chapter = byName.get(name);
    const wanted = chapterFor(g);
    if (!chapter) {
      await send('POST', `/api/studies/${studyId}/chapters`, wanted, cookie);
      console.log(`  + ${name}`);
      changed += 1;
      continue;
    }
    const treeStale = stable(chapter.root) !== stable(wanted.root);
    const tagsStale = Object.entries(wanted.tags).some(([k, v]) => (chapter.tags ?? {})[k] !== v);
    const i18nStale = stable(chapter.i18n ?? {}) !== stable(wanted.i18n);
    if (!treeStale && !tagsStale && !i18nStale) {
      console.log(`  = ${name}`);
      continue;
    }
    await send(
      'PATCH',
      `/api/studies/${studyId}/chapters/${chapter.id}`,
      {
        ...(treeStale ? { root: wanted.root, version: chapter.version } : {}),
        ...(tagsStale ? { tags: wanted.tags } : {}),
        ...(i18nStale ? { i18n: wanted.i18n } : {}),
      },
      cookie,
    );
    console.log(`  ~ ${name}`);
    changed += 1;
  }
  console.log(`${changed} chapter(s) written`);
}

async function main() {
  const games = loadGames();
  if (!games.length) {
    console.error(`no games for ${PLAYER} in ${DIR}`);
    process.exit(1);
  }
  let totalComments = 0;
  let totalTranslated = 0;
  for (const g of games) {
    const tree = buildTree(g.iccs, g.byPly);
    let comments = 0;
    let translated = 0;
    (function count(node) {
      for (const c of node.annotations?.comments ?? []) {
        comments += 1;
        if (c.i18n?.['zh-Hans'] && c.i18n?.['zh-Hant']) translated += 1;
      }
      (node.children ?? []).forEach(count);
    })(tree.root);
    totalComments += comments;
    totalTranslated += translated;
    const lines = Object.values(g.byPly).filter((a) => a.line).length;
    console.log(
      `${chapterName(g).padEnd(48)} ${String(g.plies).padStart(3)} plies, ${String(lines).padStart(2)} lines, ${translated}/${comments} translated, ${g.side}`,
    );
  }
  console.log(
    `\n${games.length} chapters, ${totalTranslated}/${totalComments} comments translated`,
  );

  if (!CREATE && !UPDATE) {
    console.log('dry run. --create writes a new unlisted study, --update <id> syncs one.');
    return;
  }
  const cookie = readFileSync(argOf('cookie', join(homedir(), '.mistboard-cookie')), 'utf8').trim();
  if (UPDATE) {
    await update(UPDATE, games, cookie);
    console.log(`${BASE}/study/${UPDATE}`);
    return;
  }
  const [first, ...rest] = games;
  const study = await send(
    'POST',
    '/api/studies',
    {
      name: STUDY_NAME,
      description: STUDY_DESCRIPTION,
      visibility: args.includes('--public') ? 'public' : 'unlisted',
      chapter: chapterFor(first),
    },
    cookie,
  );
  const studyId = study.study?.id ?? study.id;
  console.log(`\ncreated study ${studyId}`);
  for (const g of rest) {
    await send('POST', `/api/studies/${studyId}/chapters`, chapterFor(g), cookie);
    console.log(`  + ${chapterName(g)}`);
  }
  console.log(`\n${BASE}/study/${studyId}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
