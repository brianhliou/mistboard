// Whole-game engine analysis for the site's own studies (#510, first version):
// every xiangqi chapter of every non-private study owned by a site handle
// (SITE_OWNED_HANDLES, the same list study:edit is held to) gets the analysis a
// finished game gets, stored with the line it ran on so the study page can
// chart it. Dry run by default.
//
//   npm run study:analyse                         # dry run: the plan per chapter
//   npm run study:analyse -- --apply              # run and store
//   npm run study:analyse -- --study <id> …       # only these studies (repeatable)
//   npm run study:analyse -- --apply --limit 3    # at most 3 engine runs (a sample)
//   npm run study:analyse -- --apply --concurrency 4
//   npm run study:analyse -- --apply --force      # re-run chapters already current
//
// Prod runs it against the prod database from a local checkout, with the
// pinned Pikafish build (the analysis engine id names the binary + net, so a
// different build must not write under it):
//   command railway run -s Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
//     MISTBOARD_PIKAFISH_XIANGQI_PATH=… MISTBOARD_PIKAFISH_XIANGQI_NET=… \
//     npm run -s study:analyse -- --apply --concurrency 4'
//
// A chapter made from a broadcast game whose analysis is already stored copies
// those evals instead of running the engine. A chapter whose stored analysis
// already matches its mainline is left alone; one edited since is re-run.

import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { XiangqiMove } from '@mistboard/game';
import { mapWithConcurrency } from './game-analysis-kernel.js';
import { userIdForHandle } from './persistence-accounts.js';
import { close, init } from './persistence-db.js';
import { getGameAnalysis } from './persistence-game-analysis.js';
import { getStudyById, listStudiesForOwner } from './persistence-studies.js';
import {
  analysedBroadcastBoards,
  getStudyChapterAnalysis,
  saveStudyChapterAnalysis,
} from './persistence-study-analysis.js';
import { analyzeXiangqiPostgame } from './routes/xiangqi-games.js';
import {
  buildBroadcastAnalysisIndex,
  type ChapterAnalysisDeps,
  type ChapterAnalysisPlan,
  planChapterAnalysis,
  runChapterAnalysis,
} from './study-analysis.js';
import { SITE_OWNED_HANDLES } from './study-edit-cli.js';
import { XIANGQI_ANALYSIS_ENGINE_ID, XIANGQI_ANALYSIS_REQUEST_DEPTH } from './xiangqi-analysis.js';
import {
  broadcastAnalysisRoomId,
  broadcastAnalysisTimeline,
} from './xiangqi-broadcast-analysis.js';

type PlannedChapter = {
  studyId: string;
  studyName: string;
  chapterId: string;
  chapterName: string;
  plan: ChapterAnalysisPlan;
};

/** Every chapter of the site's non-private studies, planned. */
async function planAll(opts: {
  studyIds: readonly string[];
  force: boolean;
  reuse: boolean;
}): Promise<PlannedChapter[]> {
  const studies: Array<{ id: string; name: string }> = [];
  if (opts.studyIds.length > 0) {
    for (const id of opts.studyIds) studies.push({ id, name: id });
  } else {
    for (const handle of SITE_OWNED_HANDLES) {
      const ownerId = await userIdForHandle(handle);
      if (!ownerId) throw new Error(`no account with handle @${handle}`);
      for (const study of await listStudiesForOwner(ownerId)) {
        if (study.visibility !== 'private') studies.push({ id: study.id, name: study.name });
      }
    }
  }
  const broadcasts = opts.reuse
    ? buildBroadcastAnalysisIndex(
        await analysedBroadcastBoards({
          engineId: XIANGQI_ANALYSIS_ENGINE_ID,
          depth: XIANGQI_ANALYSIS_REQUEST_DEPTH,
          minPlies: 1,
        }),
      )
    : null;
  const ownerIds = new Set<string>();
  for (const handle of SITE_OWNED_HANDLES) {
    const id = await userIdForHandle(handle);
    if (id) ownerIds.add(id);
  }
  const planned: PlannedChapter[] = [];
  for (const { id } of studies) {
    const study = await getStudyById(id);
    if (!study) throw new Error(`study ${id} not found`);
    // Named by id or found by owner, the rule is the same: the site's own
    // studies only. A person's study gets analysis through #510, not here.
    if (!ownerIds.has(study.ownerId)) {
      throw new Error(`study ${id} is owned by @${study.ownerHandle ?? '?'}, not a site handle`);
    }
    for (const chapter of study.chapters) {
      const stored = await getStudyChapterAnalysis(chapter.id);
      planned.push({
        studyId: study.id,
        studyName: study.name,
        chapterId: chapter.id,
        chapterName: chapter.name,
        plan: planChapterAnalysis(
          {
            chapterId: chapter.id,
            variant: chapter.variant,
            root: chapter.root,
            practice: chapter.practice,
            gamebook: chapter.gamebook,
          },
          stored,
          { engineId: XIANGQI_ANALYSIS_ENGINE_ID, force: opts.force, broadcasts },
        ),
      });
    }
  }
  return planned;
}

function describe(plan: ChapterAnalysisPlan): string {
  switch (plan.kind) {
    case 'skip':
      return `skip (${plan.reason})`;
    case 'current':
      return `current (${plan.plies} plies)`;
    case 'reuse':
      return `copy broadcast ${plan.boardId} (${plan.ucis.length} plies)${plan.replaces ? ', replaces stored' : ''}`;
    case 'run':
      return `run engine (${plan.ucis.length} plies)${plan.replaces ? ', replaces stored' : ''}`;
  }
}

function liveDeps(): ChapterAnalysisDeps {
  return {
    engineId: XIANGQI_ANALYSIS_ENGINE_ID,
    depth: XIANGQI_ANALYSIS_REQUEST_DEPTH,
    analyse: (moves: readonly XiangqiMove[]) =>
      analyzeXiangqiPostgame(broadcastAnalysisTimeline(moves)),
    broadcastPlies: (boardId) =>
      getGameAnalysis(
        broadcastAnalysisRoomId(boardId),
        XIANGQI_ANALYSIS_ENGINE_ID,
        XIANGQI_ANALYSIS_REQUEST_DEPTH,
      ),
    save: saveStudyChapterAnalysis,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'no-reuse': { type: 'boolean', default: false },
      study: { type: 'string', multiple: true },
      limit: { type: 'string' },
      concurrency: { type: 'string' },
    },
  });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'usage: DATABASE_URL=… study-analyse [--apply] [--study <id>]… [--limit N] [--concurrency N] [--force] [--no-reuse]',
    );
    process.exit(2);
  }
  const limit = values.limit === undefined ? Number.POSITIVE_INFINITY : Number(values.limit);
  const concurrency = Math.min(8, Math.max(1, Number(values.concurrency ?? 1) || 1));
  // The analysis pool reads its size on every acquire; one slot per worker.
  process.env.MISTBOARD_PIKAFISH_ANALYSIS_MAX_PROCESSES = String(concurrency);
  init(url, { maxPoolConnections: Math.max(2, concurrency + 1) });
  try {
    const planned = await planAll({
      studyIds: values.study ?? [],
      force: values.force ?? false,
      reuse: !values['no-reuse'],
    });
    const counts = { skip: 0, current: 0, reuse: 0, run: 0 };
    let runPlies = 0;
    let lastStudy = '';
    for (const entry of planned) {
      counts[entry.plan.kind] += 1;
      if (entry.plan.kind === 'run') runPlies += entry.plan.ucis.length;
      if (entry.studyId !== lastStudy) {
        console.log(`${entry.studyId} "${entry.studyName}"`);
        lastStudy = entry.studyId;
      }
      console.log(`  ${entry.chapterId} "${entry.chapterName}": ${describe(entry.plan)}`);
    }
    console.log(
      `plan: ${counts.run} to run (${runPlies} plies), ${counts.reuse} to copy from broadcasts, ` +
        `${counts.current} current, ${counts.skip} skipped`,
    );
    if (!values.apply) {
      console.log('dry run: nothing written (pass --apply)');
      return;
    }

    const deps = liveDeps();
    const work = planned.filter(
      (
        entry,
      ): entry is PlannedChapter & {
        plan: Extract<ChapterAnalysisPlan, { kind: 'reuse' | 'run' }>;
      } => entry.plan.kind === 'reuse' || entry.plan.kind === 'run',
    );
    // Copies are free; the limit counts engine runs only.
    let runsLeft = limit;
    const chosen = work.filter((entry) => {
      if (entry.plan.kind === 'reuse') return true;
      if (runsLeft <= 0) return false;
      runsLeft -= 1;
      return true;
    });
    const started = Date.now();
    let done = 0;
    let failed = 0;
    await mapWithConcurrency(chosen, concurrency, async (entry) => {
      const t0 = Date.now();
      try {
        const result = await runChapterAnalysis(entry.chapterId, entry.plan, deps);
        done += 1;
        console.log(
          `[${done + failed}/${chosen.length}] ${entry.chapterId} ${result.plies} plies from ${result.source} ` +
            `in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
      } catch (error) {
        failed += 1;
        console.error(
          `[${done + failed}/${chosen.length}] ${entry.chapterId} FAILED: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    console.log(
      `stored ${done}, failed ${failed}, in ${((Date.now() - started) / 60000).toFixed(1)} min`,
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
