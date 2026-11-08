#!/usr/bin/env node
// Build the world-title study from the committed annotations.
//
//   node scripts/world-title-study.mjs --cookie ~/.mistboard-cookie --dry-run
//   node scripts/world-title-study.mjs --cookie ~/.mistboard-cookie --create
//   node scripts/world-title-study.mjs --cookie ~/.mistboard-cookie --update 1pfJeXA1
//
// Dry run is the default and prints what it would post. --create writes to the
// account the cookie belongs to: one study, then a chapter per game.
//
// The cookie is read from a FILE and used as a header. It is never printed, never
// logged, and never passed as an argument, because an argument is visible in the
// process list.
//
// Direction of truth: this reads the same annotation files the article's specs
// are generated from, so the study and the article are siblings rather than one
// being compiled from the other. The article must not depend on the study still
// existing, which is why it does not fetch it at render time.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve as stubCss } from './lib/stub-css-hooks.mjs';

// The article module imports stylesheets and reads `window` at module scope.
// Same stubs the line-eval script uses, and for the same reason: the article is
// the published source of truth for these boards, so reading it is worth a few
// lines of shim.
registerHooks({ resolve: stubCss });
globalThis.window ??= {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
  location: { pathname: '/', search: '', origin: 'https://mistboard.com' },
};
globalThis.localStorage ??= globalThis.window.localStorage;
globalThis.document ??= {
  documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: {} },
  createElement: () => ({
    style: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    append() {},
  }),
  addEventListener() {},
};

// The generated per-move comments, in all three languages, shared with
// seed-xiangqi-champions-study.ts. Imported rather than reimplemented: the two
// studies are the same content annotated by the same pass, and when this script
// had its own (English-only) copy of the sentence, the sibling study shipped it
// translated and this one did not.
const { parseJudgmentComment } = await import('../packages/game/src/xiangqi-judgment-comment.ts');
const { judgmentCommentI18n } = await import('../apps/server/src/xiangqi-judgment-comment-i18n.ts');

const { personNameForLocale } = await import('../packages/game/src/person-name-scripts.ts');
const DATA = 'scripts/data/world-title-annotations';

// Champion identity spellings; display follows the page script (2026-11-06).
const CHAMPION_ZH = {
  'Lü Qin': '吕钦',
  'Zhao Guorong': '赵国荣',
  'Xu Yinchuan': '许银川',
  'Zhao Xinxin': '赵鑫鑫',
  'Jiang Chuan': '蒋川',
  'Wang Tianyi': '王天一',
  'Zheng Weitong': '郑惟桐',
  'Xu Chao': '徐超',
  'Meng Chen': '孟辰',
};

// Checked study participant spellings.
const PERSON_ZH = {
  ...CHAMPION_ZH,
  'Wu Guilin': { hans: '吴贵临', hant: '吳貴臨' },
  'Lei Kam Fun': { hans: '李锦欢', hant: '李錦歡' },
  'Huang Xueqian': { hans: '黄学谦', hant: '黃學謙' },
  'Wang Kuo': '王廓',
  'Nguyễn Vũ Quân': '阮武君',
  'Nguyễn Thành Bảo': '阮成保',
  'Lại Lý Huynh': { hans: '赖理兄', hant: '賴理兄' },
};

export const zhName = (name, script) => {
  const entry = PERSON_ZH[name];
  if (!entry) return undefined;
  const hans = typeof entry === 'string' ? entry : entry.hans;
  return personNameForLocale({ name: hans }, script === 'hans' ? 'zh-Hans' : 'zh-Hant');
};

/** "2019 16th World Xiangqi Championship" -> the Chinese name of that edition. */
const ORDINAL_ZH = {
  '2nd': '第二届',
  '5th': '第五届',
  '10th': '第十届',
  '11th': '第十一届',
  '12th': '第十二届',
  '14th': '第十四届',
  '16th': '第十六届',
  '17th': '第十七届',
  '18th': '第十八届',
  '19th': '第十九届',
};

function zhEvent(event, script) {
  const m = /^(\d{4})\s+(\S+)\s+World Xiangqi Championship$/.exec(String(event).trim());
  const ordinal = m && ORDINAL_ZH[m[2]];
  if (!ordinal) return undefined;
  const hans = `${m[1]}年${ordinal}世界象棋锦标赛`;
  return script === 'hans'
    ? hans
    : hans.replace('届', '屆').replace('世界象棋锦标赛', '世界象棋錦標賽');
}

/** Per-locale overrides for the tags that carry language. A date and a result
 *  do not, so neither is translated. */
export function tagsI18nFor(spec) {
  const out = {};
  for (const [locale, script] of [
    ['zh-Hans', 'hans'],
    ['zh-Hant', 'hant'],
  ]) {
    const tags = {
      ...(zhName(spec.red, script) ? { red: zhName(spec.red, script) } : {}),
      ...(zhName(spec.black, script) ? { black: zhName(spec.black, script) } : {}),
      ...(zhEvent(spec.event, script) ? { event: zhEvent(spec.event, script) } : {}),
    };
    if (Object.keys(tags).length) out[locale] = tags;
  }
  return out;
}

const STUDY_NAME = 'Every Xiangqi World Champion';
const STUDY_DESCRIPTION =
  'One world-championship game for each man who has won the title, from the edition he won it in. Engine annotations throughout; the losing lines are variations you can step into.';

/** MACHINE-DRAFTED, NOT NATIVE-REVIEWED, same standing as the article's zh. */
const STUDY_I18N = {
  'zh-Hans': {
    name: '世界象棋冠军谱',
    description:
      '每一位世界冠军各一局，选自他夺冠的那一届。全程由引擎注解；落败的一方走过的岔路，都做成可以走进去的变化分支。',
  },
  'zh-Hant': {
    name: '世界象棋冠軍譜',
    description:
      '每一位世界冠軍各一局，選自他奪冠的那一屆。全程由引擎注解；落敗的一方走過的岔路，都做成可以走進去的變化分支。',
  },
};

const args = process.argv.slice(2);
const argOf = (k, d = '') => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : (args[i + 1] ?? d);
};
const BASE = argOf('base', 'https://mistboard.com');
const CREATE = args.includes('--create');
const UPDATE = argOf('update');

/** Study trees use ranks 1-10; everything upstream of here is ICCS 0-9. */
const toStudyUci = (iccs) => `${iccs[0]}${Number(iccs[1]) + 1}${iccs[2]}${Number(iccs[3]) + 1}`;

/** The widget's glyphs, back to the NAG codes a study node stores. */
const NAG = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };

/**
 * The article's `lineEval` symbols, back to the standard PGN assessment NAGs.
 *
 * The article closes each engine sideline with a verdict (`+-`, `-+`, `+/-`,
 * `+=`, `=`) measured by Pikafish at a million nodes. Those symbols were baked
 * into the article and stopped there, so the study rendered the same lines with
 * no verdict at the end of any of them. The study now carries them as real NAGs
 * on the line's LAST node, which is where an opening book puts its verdict and
 * where the move tree's assessment slot already looks.
 */
// Exported so a sibling script can reuse it rather than keep a third copy: the
// last time this vocabulary lived in three places they drifted, and a study
// showed the engine's verdict and an annotated one in different notations.
// line-assessment-roundtrip.test.ts reads this literal out of the source text,
// so it stays here rather than moving to a shared module.
export const ASSESS_NAG = {
  '=': 10,
  '∞': 13,
  '⩲': 14,
  '⩱': 15,
  '±': 16,
  '∓': 17,
  '+−': 18,
  '−+': 19,
};

/**
 * A chapter tree: the mainline as first children, and each engine line hung as a
 * SIBLING on the node the refuted move was played from. That is exactly the
 * shape study-chapter-to-article reads back, so a chapter built here converts
 * into the same spec the article already carries.
 */
/**
 * One tree comment, translated when it is one of ours to translate.
 *
 * A note that parses as the generated judgment sentence gets the overlay; a note
 * that does not is hand-written prose about the game, and gets nothing. The
 * parser deciding this rather than a flag is what keeps a later hand-edited note
 * from being handed a machine translation of a sentence it no longer is.
 */
function comment(note) {
  const judgment = parseJudgmentComment(note);
  return judgment ? { text: note, i18n: judgmentCommentI18n(judgment) } : { text: note };
}

function buildTree(spec) {
  const mainline = spec.iccs.trim().split(/\s+/);
  const root = { annotations: {}, children: [] };
  const nodes = [root];
  for (const [index, token] of mainline.entries()) {
    const node = { uci: toStudyUci(token), children: [] };
    const annotation = spec.annotations.byPly[String(index + 1)];
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
  // Variations second, so the game continuation stays child zero everywhere.
  for (const [plyKey, annotation] of Object.entries(spec.annotations.byPly)) {
    if (!annotation.line) continue;
    const parent = nodes[Number(plyKey) - 1];
    if (!parent) continue;
    let cursor = parent;
    for (const token of annotation.line.trim().split(/\s+/)) {
      const node = { uci: toStudyUci(token), children: [] };
      cursor.children.push(node);
      cursor = node;
    }
    // The verdict closes the line, so it belongs to the last node of it and
    // nowhere else. A line whose eval was never measured simply ends without
    // one rather than being given a neutral `=` it did not earn.
    const assess = ASSESS_NAG[annotation.lineEval];
    if (assess !== undefined && cursor !== parent) {
      cursor.annotations = { ...cursor.annotations, glyphs: [assess] };
    }
  }
  return { version: 1, root };
}

/**
 * Lowercase keys, and only these seven. The server allowlists
 * red/black/result/event/date/round/site and silently DROPS anything else, so
 * the first run sent PGN's capitalised Red/Black/Event/Result, got nine 201s
 * back, and stored {} nine times: no players, no event and no result anywhere
 * in the study UI.
 *
 * One helper for both the create and the update path, so the two cannot drift
 * into writing different metadata for the same game.
 */
function tagsFor(game, spec) {
  return {
    red: spec.red,
    black: spec.black,
    result: spec.resultText,
    event: spec.event,
    ...(game.date ? { date: game.date } : {}),
    ...(game.sourceUrl ? { site: game.sourceUrl } : {}),
  };
}

// Chapter and person tags follow the page script (2026-11-06).
export function chapterI18n(game) {
  const zh = CHAMPION_ZH[game.champion];
  if (!zh) return undefined;
  const name = `${game.year} · ${zh}`;
  const tags = tagsI18nFor(game.spec);
  return {
    'zh-Hans': { name, ...(tags['zh-Hans'] ? { tags: tags['zh-Hans'] } : {}) },
    'zh-Hant': {
      name: `${game.year} · ${personNameForLocale({ name: zh }, 'zh-Hant')}`,
      ...(tags['zh-Hant'] ? { tags: tags['zh-Hant'] } : {}),
    },
  };
}

function chapterFor(game, spec) {
  const i18n = chapterI18n(game);
  return {
    name: `${game.year} · ${game.champion}`,
    variant: 'xiangqi',
    orientation: 'red',
    root: buildTree(spec),
    tags: tagsFor(game, spec),
    ...(i18n ? { i18n } : {}),
  };
}

/**
 * Compare two JSON values without caring about key order.
 *
 * Postgres JSONB does not preserve the order keys were written in, so a tree
 * read back comes out as {root, version} where it went up as {version, root}.
 * A raw JSON.stringify comparison therefore NEVER matched, and every run
 * rewrote all nine chapters and bumped all nine versions. That is not just
 * wasted work: each rewrite is a version-guarded save, so a routine re-sync was
 * one concurrent edit away from either clobbering someone's work or 409ing on
 * it, for chapters that had not changed at all.
 */
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

/**
 * Bring an existing study's chapters in line with the annotations.
 *
 * Matched by chapter NAME, which is `year · champion` and unique per study. The
 * tree save is version-guarded, so a chapter edited in the study UI since the
 * last run makes this 409 rather than overwrite the edit.
 */
async function update(studyId, games, cookie) {
  const current = await (await fetch(`${BASE}/api/studies/${studyId}`)).json();
  const byName = new Map(current.chapters.map((c) => [c.name, c]));
  let changed = 0;
  for (const game of games) {
    const name = `${game.year} · ${game.champion}`;
    const chapter = byName.get(name);
    if (!chapter) {
      console.log(`  ? no chapter named "${name}"`);
      continue;
    }
    const root = buildTree(game.spec);
    const tags = tagsFor(game, game.spec);
    const i18n = chapterI18n(game);
    const treeStale = stable(chapter.root) !== stable(root);
    const tagsStale = Object.entries(tags).some(([k, v]) => chapter.tags?.[k] !== v);
    const i18nStale = !!i18n && stable(chapter.i18n ?? {}) !== stable(i18n);
    if (!treeStale && !tagsStale && !i18nStale) {
      console.log(`  = ${name}`);
      continue;
    }
    await send(
      'PATCH',
      `/api/studies/${studyId}/chapters/${chapter.id}`,
      {
        ...(treeStale ? { root, baseVersion: chapter.version } : {}),
        ...(tagsStale ? { tags } : {}),
        // The rename path takes `name` and `i18n` together, and sending i18n
        // without name would be a rename to nothing.
        ...(i18nStale ? { name, i18n } : {}),
      },
      cookie,
    );
    const what = [treeStale && 'tree', tagsStale && 'tags', i18nStale && 'i18n'].filter(Boolean);
    console.log(`  ~ ${name} ${what.join(' ')}`);
    changed += 1;
  }

  // The study's own name and description are metadata on the study, not on any
  // chapter, so they need their own call. Without this an existing study keeps
  // whatever it was created with and the zh reader gets an English title over
  // Chinese chapters.
  const meta = current.study ?? {};
  if (stable(meta.i18n ?? {}) !== stable(STUDY_I18N)) {
    await send('PATCH', `/api/studies/${studyId}`, { i18n: STUDY_I18N }, cookie);
    console.log('  ~ study name + description (zh)');
    changed += 1;
  }
  console.log(`\n${changed} update(s)`);
  await verify(studyId, games);
}

/**
 * Read the study back and require every chapter to carry the players, the event
 * and the result.
 *
 * This exists because the first run of this script reported nine successful
 * writes and produced nine chapters with NO metadata: the tags went up under
 * PGN's capitalised key names, the server's allowlist is lowercase, and it drops
 * unknown keys without complaining. Every response was a 201. The only place
 * that failure was visible was the study page itself.
 *
 * A write that a server may partly ignore is not confirmed by its own status
 * code, so this reads the stored document instead of trusting the response.
 */
async function verify(studyId, games) {
  const study = await (await fetch(`${BASE}/api/studies/${studyId}`)).json();
  const byName = new Map(study.chapters.map((c) => [c.name, c]));
  const bad = [];
  for (const game of games) {
    const name = `${game.year} · ${game.champion}`;
    const stored = byName.get(name);
    if (!stored) {
      bad.push(`${name}: missing`);
      continue;
    }
    const missing = ['red', 'black', 'result', 'event'].filter((k) => !stored.tags?.[k]);
    if (missing.length) bad.push(`${name}: no ${missing.join(', ')}`);
    // Same read-back rule as the tags: the rename path is one where a partly
    // ignored body still returns 200.
    for (const lang of ['zh-Hans', 'zh-Hant']) {
      if (!stored.i18n?.[lang]?.name) bad.push(`${name}: no ${lang} name`);
    }
    // And the comments inside the tree. Checking only the chapter NAME is how 52
    // untranslated comments sat in this study while the verifier reported green:
    // the overlay it looked at was not the overlay the reader reads.
    const untranslated = [];
    (function walk(node) {
      for (const c of node.annotations?.comments ?? []) {
        if (!parseJudgmentComment(c.text)) continue;
        for (const lang of ['zh-Hans', 'zh-Hant']) {
          if (!c.i18n?.[lang]) untranslated.push(lang);
        }
      }
      (node.children ?? []).forEach(walk);
    })(stored.root?.root ?? { children: [] });
    if (untranslated.length) {
      bad.push(`${name}: ${untranslated.length} untranslated generated comments`);
    }
  }
  if (!study.study?.i18n?.['zh-Hans']?.name) bad.push('the study itself has no zh-Hans name');
  if (bad.length) {
    console.error(`\ntags did not stick:\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`verified: ${games.length} chapters carry players, event and result`);
}

async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

/**
 * Every xq-replay spec on the world-title page, keyed by its mainline.
 *
 * Keyed by event rather than by position in the file: the specs are top-level
 * consts whose order in the source is not the order the sections use them in,
 * and keying by order put four dozen symbols on the wrong games once already.
 * One game per championship edition makes the event unique, and it is the one
 * field the manifest and the article both state in the same words. The players
 * are not usable as a key here: the manifest records them as the source wrote
 * them ("广东 吕钦"), the article as the page renders them ("Lü Qin").
 */
async function loadArticleSpecs() {
  const mod = await import('../apps/web/src/articles/content/xiangqi-world-championship.ts');
  const article = Object.values(mod).find((v) => v && typeof v === 'object' && 'sections' in v);
  const specs = new Map();
  for (const section of article.sections ?? []) {
    for (const block of section.blocks ?? []) {
      if (block?.kind !== 'xq-replay' || !block.spec?.iccs) continue;
      specs.set(String(block.spec.event ?? '').trim(), block.spec);
    }
  }
  return specs;
}

async function main() {
  const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8'));
  // Specs come from the ARTICLE, not from a scratch directory. The generated
  // specs in /tmp are the raw conversion; the article's copies are those plus
  // every later edit, including the measured `lineEval` verdicts. Reading /tmp
  // meant the study was built from a file that had to still exist and that had
  // already diverged from the page, so the two could disagree silently and the
  // study could not be rebuilt at all once /tmp was cleared.
  const article = await loadArticleSpecs();
  const games = manifest.games.map((game) => {
    const source = JSON.parse(readFileSync(join(DATA, `${game.slug}.json`), 'utf8')).game;
    const spec = article.get(game.event);
    if (!spec) throw new Error(`no board in the article for ${game.slug} (${game.event})`);
    const year = /^(\d{4})/.exec(spec.event)?.[1] ?? '';
    // The champion is whichever side is not the opponent, read off the result.
    const champion = spec.resultText === '1-0' ? spec.red : spec.black;
    return {
      slug: game.slug,
      year,
      champion,
      spec,
      // dpxq records a month with no day as `1997-11-00`, which is not a date
      // and reads as one. Trim the zero day rather than inventing a first of
      // the month: the study should say what the source knows.
      date: (source.date ?? '').slice(0, 10).replace(/-00$/, ''),
      sourceUrl: source.sourceUrl ?? '',
    };
  });
  games.sort((a, b) => a.year.localeCompare(b.year));

  for (const game of games) {
    const tree = buildTree(game.spec);
    const depth = (function walk(node, n = 0) {
      return node.children.length ? walk(node.children[0], n + 1) : n;
    })(tree.root);
    const lines = Object.values(game.spec.annotations.byPly).filter((a) => a.line).length;
    // Comments are counted as translated / total rather than left implicit: this
    // is the number that was silently zero, and a dry run that does not print it
    // cannot be used to check it.
    let comments = 0;
    let translated = 0;
    (function count(node) {
      for (const c of node.annotations?.comments ?? []) {
        comments += 1;
        if (c.i18n?.['zh-Hans'] && c.i18n?.['zh-Hant']) translated += 1;
      }
      (node.children ?? []).forEach(count);
    })(tree.root);
    console.log(
      `${game.year} · ${game.champion.padEnd(14)} ${String(depth).padStart(3)} plies, ${lines} lines, ` +
        `${translated}/${comments} comments translated`,
    );
  }

  if (!CREATE && !UPDATE) {
    console.log(
      `\ndry run: ${games.length} chapters. --create writes a new study, --update <id> syncs one.`,
    );
    return;
  }

  const cookiePath = argOf('cookie', join(homedir(), '.mistboard-cookie'));
  const cookie = readFileSync(cookiePath, 'utf8').trim();

  if (UPDATE) {
    await update(UPDATE, games, cookie);
    console.log(`${BASE}/study/${UPDATE}`);
    return;
  }
  const [first, ...rest] = games;
  const study = await post(
    '/api/studies',
    {
      name: STUDY_NAME,
      description: STUDY_DESCRIPTION,
      i18n: STUDY_I18N,
      // Unlisted, not public. The article that frames these games is still a
      // draft, and a public study would put ten annotated world-championship
      // games on /study before the piece explaining them exists. Unlisted is
      // fully readable by link and fully embeddable; flipping it to public is
      // one control in the study UI once the article ships.
      visibility: args.includes('--public') ? 'public' : 'unlisted',
      chapter: chapterFor(first, first.spec),
    },
    cookie,
  );
  const studyId = study.study?.id ?? study.id;
  console.log(`\ncreated study ${studyId}`);
  for (const game of rest) {
    await post(`/api/studies/${studyId}/chapters`, chapterFor(game, game.spec), cookie);
    console.log(`  + ${game.year} · ${game.champion}`);
  }
  await verify(studyId, games);
  console.log(`\n${BASE}/study/${studyId}`);
}

// Guarded: importing this module for ASSESS_NAG must not run a build.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}
