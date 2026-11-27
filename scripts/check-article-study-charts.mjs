#!/usr/bin/env node
// Check that every game chapter an article embeds carries its chart data.
//
//   npm run articles:study-charts                       # against https://mistboard.com
//   npm run articles:study-charts -- --base http://localhost:3000
//   npm run articles:study-charts -- --embeds <file>    # skip the extraction step
//   npm run articles:study-charts -- --json             # verdicts as JSON on stdout
//
// Studies live in the database, so no repo test sees whether an embedded
// chapter has its advantage chart (`scoreSeries`) or, in a chance variant, its
// luck split (stored decisions). This reads the live records: it collects the
// study embeds of every published article in every language it is served in
// (the source, plus each published zh translation; vi derivatives are their own
// articles; one dated into the future counts, so it is read before it goes
// live), GETs each study once from `<base>/api/studies/<id>`, and judges
// each embed with the pure `judgeStudyCharts` (scripts/lib/article-study-charts.mjs).
// It writes nothing anywhere.
//
// Game or position. A chapter must carry a chart when it is a played game:
//   1. a gamebook or practice chapter is never a game;
//   2. a chapter whose tags name both sides (`red` or `white`, and `black`) and a
//      decided result (1-0, 0-1, 1/2-1/2) is a game;
//   3. any other chapter is a game when its mainline runs at least 10 plies from
//      the variant's opening: no stored `rootFen`, the xiangqi, jungle or chess
//      opening board, or a dealt start where every piece but the generals is face
//      down (banqi, jieqi, Flip Jungle).
// Everything else is a position and needs no chart: a composition, helpmate or
// tablebase line from a set-up position, a chess middlegame from an accuracy
// sample, an opening line, an unfinished `*` game. Rule 3 exists because some
// engine-game chapters were imported with no tags at all. On 2026-11-23 every
// embedded chapter fell into the class a reader would give it, except three
// cooperative stalemate constructions with game tags, which are allowlisted.
//
// Verdicts that fail (exit 1), each named by article, language, study and chapter:
//   no-chart      a game chapter with no scoreSeries
//   bad-series    a series whose length is not mainline plies + 1
//   no-decisions  a game in a decision variant (jieqi, banqi, three-kingdoms-banqi,
//                 ffq-banqi, jungle-flip) with a series but no stored decisions:
//                 its embed shows the chart with no luck split, the gap the
//                 rebirthfox Banqi and Jieqi chapters had, so it fails too
//   unreadable    the embed path, the study or the chapter could not be read
// A game chapter that deliberately has no chart goes in STUDY_CHART_ALLOWLIST
// (same lib), one chapter per entry with its reason; it is printed, never failed.
//
// Not wired into release:prod or CI. Fits as a post-deploy smoke (after
// prod:wait-revision in release:prod) or a scheduled read beside the daily
// readout workflow, since a study edit can break it with no deploy at all.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAILING_VERDICTS,
  judgeStudyCharts,
  STUDY_CHART_ALLOWLIST,
} from './lib/article-study-charts.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'mistboard-article-study-charts';

function parseArgs(argv) {
  const opts = { base: 'https://mistboard.com', embeds: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--base') opts.base = value().replace(/\/+$/, '');
    else if (arg.startsWith('--base=')) opts.base = arg.slice(7).replace(/\/+$/, '');
    else if (arg === '--embeds') opts.embeds = value();
    else if (arg.startsWith('--embeds=')) opts.embeds = arg.slice(9);
    else if (arg === '--json') opts.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

/** Run the web test that walks the served articles and writes their study embeds. */
function extractEmbeds() {
  const dir = mkdtempSync(join(tmpdir(), 'article-study-embeds-'));
  const out = join(dir, 'embeds.json');
  try {
    const result = spawnSync(
      'npm',
      [
        'run',
        'test:unit',
        '--workspace',
        '@mistboard/web',
        '--',
        'src/article-study-embeds-dump.test.ts',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, ARTICLE_STUDY_EMBEDS_OUT: out },
      },
    );
    if (result.status !== 0) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      throw new Error(`embed extraction failed (exit ${result.status})`);
    }
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** GET each study once; a failed read becomes `{ error }` for the judge to report. */
async function fetchStudies(base, studyIds) {
  const studies = {};
  for (const id of studyIds) {
    try {
      const res = await fetch(`${base}/api/studies/${encodeURIComponent(id)}`, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: `HTTP ${res.status}, not JSON` };
      }
      studies[id] = res.ok ? body : { error: `HTTP ${res.status} ${body?.error ?? ''}`.trim() };
    } catch (error) {
      studies[id] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return studies;
}

/** One printed row per article, study and chapter, with every language it is served in. */
function rows(verdicts) {
  const groups = new Map();
  for (const v of verdicts) {
    const key = `${v.slug}|${v.studyId}|${v.chapterId}|${v.verdict}`;
    const group = groups.get(key);
    if (group) {
      if (!group.langs.includes(v.lang)) group.langs.push(v.lang);
    } else groups.set(key, { ...v, langs: [v.lang] });
  }
  return [...groups.values()].map((v) => {
    const chapter = v.chapterName
      ? `${v.chapterId} "${v.chapterName}"`
      : (v.chapterId ?? '(first)');
    const variant = v.variant ? ` [${v.variant}]` : '';
    return `  ${v.slug} (${v.langs.join(', ')})  study ${v.studyId ?? '?'} chapter ${chapter}${variant}: ${v.why ?? v.verdict}`;
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const embeds = opts.embeds ? JSON.parse(readFileSync(opts.embeds, 'utf8')) : extractEmbeds();
  const studyIds = [...new Set(embeds.map((e) => e.studyId).filter(Boolean))];
  const studies = await fetchStudies(opts.base, studyIds);
  const verdicts = judgeStudyCharts(embeds, studies, STUDY_CHART_ALLOWLIST);
  const failing = verdicts.filter((v) => FAILING_VERDICTS.has(v.verdict));

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(verdicts, null, 1)}\n`);
  } else {
    const count = (kind) => verdicts.filter((v) => v.verdict === kind).length;
    console.log(
      `${embeds.length} study embeds, ${studyIds.length} studies, base ${opts.base}: ` +
        `${count('ok')} ok, ${count('position')} positions, ${count('allowlisted')} allowlisted, ${failing.length} failing (counted per language)`,
    );
    for (const kind of FAILING_VERDICTS) {
      const kindRows = rows(failing.filter((v) => v.verdict === kind));
      if (kindRows.length === 0) continue;
      console.log(`\n${kind} (${kindRows.length}):`);
      for (const row of kindRows) console.log(row);
    }
    const allowed = rows(verdicts.filter((v) => v.verdict === 'allowlisted'));
    if (allowed.length > 0) {
      console.log(`\nallowlisted (${allowed.length}):`);
      for (const row of allowed) console.log(row);
    }
  }
  process.exit(failing.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
