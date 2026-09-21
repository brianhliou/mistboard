// The study curator: runs every recipe against the broadcast archive and makes
// the studies match. One run per recipe does, in order: gather candidate games
// (source filters, then the opening shape), make sure the shortlisted games are
// analyzed (a bounded number of new engine sweeps per run, cached under
// `broadcast:<board id>` in game_analysis so nothing is ever computed twice),
// rank the analyzed games, build the chapters, and apply the diff to the study
// keyed by the recipe id. Games still waiting on analysis are picked up by the
// next run, so a study fills in over a few runs and grows as rounds land.
//
// Everything that touches Postgres or the engine comes in through `deps`, so the
// orchestration is testable with fakes and the CLI can run it dry.

import type { XiangqiMove } from '@mistboard/game';
import { logger } from '../obs.js';
import * as persistence from '../persistence.js';
import type { StudyWithChapters } from '../persistence-studies.js';
import { resolveXiangqiAnalysis } from '../routes/xiangqi-games.js';
import { XIANGQI_ANALYSIS_ENGINE_ID } from '../xiangqi-analysis.js';
import {
  ANNOTATOR_VERSION,
  buildDecisiveMomentChapter,
  buildModelGameChapter,
  type ChapterDraft,
  type CuratorGame,
  type ExplorerLookup,
  uciOf,
} from './annotate.js';
import {
  type CuratorPlyEval,
  findDecisiveMoment,
  type GameVerdicts,
  judgeGame,
  scoreModelGame,
} from './moments.js';
import { matchesOpening } from './opening-match.js';
import { type ChapterPlan, type CuratorDenorm, type DesiredChapter, planChapters } from './plan.js';
import { loadStudyRecipes, type StudyRecipe } from './recipes.js';

export type CuratorStudyStore = {
  getBySlug(slug: string): Promise<StudyWithChapters | null>;
  create(input: persistence.CreateStudyInput): Promise<StudyWithChapters | null>;
  updateMeta(
    id: string,
    ownerId: string,
    patch: {
      name?: string;
      description?: string;
      i18n?: Record<string, unknown>;
      visibility?: 'public' | 'unlisted';
    },
  ): Promise<unknown>;
  addChapter(
    studyId: string,
    ownerId: string,
    input: persistence.NewChapterInput,
  ): Promise<{ ok: true; chapter: { id: string } } | { ok: false; error: string }>;
  updateChapterTree(
    chapterId: string,
    ownerId: string,
    patch: { root: unknown; denorm?: unknown },
  ): Promise<{ ok: boolean }>;
  renameChapter(
    chapterId: string,
    ownerId: string,
    name: string,
    i18n?: Record<string, unknown>,
  ): Promise<{ ok: boolean }>;
  setChapterTags(
    chapterId: string,
    ownerId: string,
    tags: persistence.StudyChapterTags,
  ): Promise<{ ok: boolean }>;
  setChapterOrientation(
    chapterId: string,
    ownerId: string,
    orientation: 'red' | 'black',
  ): Promise<{ ok: boolean }>;
  setChapterGamebook(
    chapterId: string,
    ownerId: string,
    gamebook: boolean,
  ): Promise<{ ok: boolean }>;
  deleteChapter(chapterId: string, ownerId: string): Promise<{ ok: boolean }>;
  reorderChapters(studyId: string, ownerId: string, chapterIds: string[]): Promise<{ ok: boolean }>;
};

export type CuratorDeps = {
  /** Finished games matching the recipe's source filters, moves included. */
  listCandidates(recipe: StudyRecipe): Promise<CuratorGame[]>;
  /** The stored analysis for a game (our-uci rows); computes it when allowed. */
  getAnalysis(game: CuratorGame, computeIfMissing: boolean): Promise<CuratorPlyEval[] | null>;
  explorer?: ExplorerLookup;
  studies: CuratorStudyStore;
  ownerId: string;
  engineId: string;
};

export type RunOptions = {
  /** New engine sweeps this run may start, across all recipes. */
  maxAnalyses: number;
  dryRun?: boolean;
};

export type RecipeRunReport = {
  recipeId: string;
  studyId: string | null;
  candidates: number;
  matched: number;
  analyzed: number;
  awaitingAnalysis: number;
  analysesStarted: number;
  chapters: { added: number; updated: number; removed: number; kept: number };
  /** Game ids in final chapter order, with the score that placed them. */
  ranked: { gameId: string; score: number }[];
};

type RankedGame = { game: CuratorGame; verdicts: GameVerdicts; score: number };

/** How many games beyond the chapter cap to analyze, so the ranker has a choice. */
const SHORTLIST_FACTOR = 3;

function byRecency(a: CuratorGame, b: CuratorGame): number {
  return (b.playedOn ?? '').localeCompare(a.playedOn ?? '') || a.id.localeCompare(b.id);
}

function scoreFor(recipe: StudyRecipe, game: CuratorGame, verdicts: GameVerdicts): number | null {
  if (recipe.mode === 'model-games') {
    const scored = scoreModelGame(game.result, verdicts);
    return scored && scored.score > 0 ? scored.score : null;
  }
  const moment = findDecisiveMoment(game.result, verdicts);
  return moment ? moment.score : null;
}

async function draftFor(
  recipe: StudyRecipe,
  ranked: RankedGame,
  explorer: ExplorerLookup | undefined,
): Promise<ChapterDraft | null> {
  if (recipe.mode === 'model-games') {
    return buildModelGameChapter(ranked.game, ranked.verdicts, recipe, explorer);
  }
  return buildDecisiveMomentChapter(ranked.game, ranked.verdicts, recipe);
}

function chapterInput(desired: DesiredChapter): persistence.NewChapterInput {
  const denorm: CuratorDenorm = { curator: desired.mark };
  return {
    name: desired.draft.name,
    i18n: desired.draft.i18n,
    variant: 'xiangqi',
    orientation: desired.draft.orientation,
    root: desired.draft.root,
    denorm,
    tags: desired.draft.tags,
  };
}

async function applyPlan(
  recipe: StudyRecipe,
  study: StudyWithChapters | null,
  plan: ChapterPlan,
  deps: CuratorDeps,
): Promise<{ studyId: string | null }> {
  const { studies, ownerId } = deps;
  let studyId = study?.id ?? null;
  const addedIds: string[] = [];

  if (!studyId) {
    const first = plan.add[0];
    if (!first) return { studyId: null };
    const created = await studies.create({
      ownerId,
      slug: recipe.id,
      name: recipe.study.name,
      description: recipe.study.description,
      ...(recipe.study.i18n ? { i18n: recipe.study.i18n } : {}),
      visibility: recipe.study.visibility,
      chapter: chapterInput(first),
    });
    if (!created) throw new Error(`study ${recipe.id}: create failed`);
    studyId = created.id;
    const firstId = created.chapters[0]?.id;
    if (!firstId) throw new Error(`study ${recipe.id}: created without a chapter`);
    addedIds.push(firstId);
    if (first.draft.gamebook) await studies.setChapterGamebook(firstId, ownerId, true);
    for (const desired of plan.add.slice(1)) {
      const added = await studies.addChapter(studyId, ownerId, chapterInput(desired));
      if (!added.ok) throw new Error(`study ${recipe.id}: add chapter failed (${added.error})`);
      addedIds.push(added.chapter.id);
      if (desired.draft.gamebook) await studies.setChapterGamebook(added.chapter.id, ownerId, true);
    }
  } else {
    if (
      study &&
      (study.name !== recipe.study.name ||
        study.description !== recipe.study.description ||
        study.visibility !== recipe.study.visibility)
    ) {
      await studies.updateMeta(studyId, ownerId, {
        name: recipe.study.name,
        description: recipe.study.description,
        ...(recipe.study.i18n ? { i18n: recipe.study.i18n } : {}),
        visibility: recipe.study.visibility,
      });
    }
    for (const desired of plan.add) {
      const added = await studies.addChapter(studyId, ownerId, chapterInput(desired));
      if (!added.ok) throw new Error(`study ${recipe.id}: add chapter failed (${added.error})`);
      addedIds.push(added.chapter.id);
      if (desired.draft.gamebook) await studies.setChapterGamebook(added.chapter.id, ownerId, true);
    }
  }

  for (const { id, desired } of plan.update) {
    const denorm: CuratorDenorm = { curator: desired.mark };
    await studies.updateChapterTree(id, ownerId, { root: desired.draft.root, denorm });
    await studies.renameChapter(id, ownerId, desired.draft.name, desired.draft.i18n);
    await studies.setChapterTags(id, ownerId, desired.draft.tags);
    await studies.setChapterOrientation(id, ownerId, desired.draft.orientation);
    await studies.setChapterGamebook(id, ownerId, desired.draft.gamebook);
  }
  for (const { id, gamebook } of plan.gamebook) {
    await studies.setChapterGamebook(id, ownerId, gamebook);
  }
  // Removals go before the reorder: the reorder wants the exact current id set.
  for (const id of plan.remove) {
    await studies.deleteChapter(id, ownerId);
  }
  const order = plan.order.map((ref) => ('id' in ref ? ref.id : addedIds[ref.add]));
  if (order.some((id) => !id)) throw new Error(`study ${recipe.id}: order references a missing id`);
  // Chapters this recipe does not own keep their place after the curated ones.
  const finalOrder = [...(order as string[]), ...plan.foreign];
  if (finalOrder.length > 1) await studies.reorderChapters(studyId, ownerId, finalOrder);
  return { studyId };
}

export async function runRecipe(
  recipe: StudyRecipe,
  deps: CuratorDeps,
  options: RunOptions,
  budget: { remaining: number },
): Promise<RecipeRunReport> {
  const candidates = await deps.listCandidates(recipe);
  const matched = recipe.opening
    ? candidates.filter((game) =>
        matchesOpening(game.moves, recipe.opening as NonNullable<StudyRecipe['opening']>),
      )
    : candidates;
  const shortlist = [...matched].sort(byRecency).slice(0, recipe.chapters.max * SHORTLIST_FACTOR);

  const analyzed: RankedGame[] = [];
  let awaiting = 0;
  let started = 0;
  for (const game of shortlist) {
    let rows = await deps.getAnalysis(game, false);
    if (!rows && budget.remaining > 0 && !options.dryRun) {
      budget.remaining -= 1;
      started += 1;
      rows = await deps.getAnalysis(game, true);
    }
    if (!rows) {
      awaiting += 1;
      continue;
    }
    const verdicts = judgeGame(game.moves.map(uciOf), rows);
    const score = scoreFor(recipe, game, verdicts);
    if (score === null) continue;
    analyzed.push({ game, verdicts, score });
  }
  analyzed.sort((a, b) => b.score - a.score || byRecency(a.game, b.game));

  const desired: DesiredChapter[] = [];
  const ranked: RecipeRunReport['ranked'] = [];
  for (const entry of analyzed) {
    if (desired.length >= recipe.chapters.max) break;
    const draft = await draftFor(recipe, entry, deps.explorer);
    if (!draft) continue;
    desired.push({
      mark: {
        recipeId: recipe.id,
        gameId: entry.game.id,
        recipeVersion: recipe.version,
        annotatorVersion: ANNOTATOR_VERSION,
        engineId: deps.engineId,
      },
      draft,
    });
    ranked.push({ gameId: entry.game.id, score: entry.score });
  }

  const study = await deps.studies.getBySlug(recipe.id);
  const plan = planChapters(
    recipe.id,
    (study?.chapters ?? []).map((c) => ({ id: c.id, denorm: c.denorm, gamebook: c.gamebook })),
    desired,
  );
  const kept = plan.order.filter((ref) => 'id' in ref).length - plan.update.length;
  let studyId = study?.id ?? null;
  if (!options.dryRun) {
    studyId = (await applyPlan(recipe, study, plan, deps)).studyId;
  }
  return {
    recipeId: recipe.id,
    studyId,
    candidates: candidates.length,
    matched: matched.length,
    analyzed: analyzed.length,
    awaitingAnalysis: awaiting,
    analysesStarted: started,
    chapters: {
      added: plan.add.length,
      updated: plan.update.length,
      removed: plan.remove.length,
      kept,
    },
    ranked,
  };
}

export async function runStudyCurator(
  recipes: readonly StudyRecipe[],
  deps: CuratorDeps,
  options: RunOptions,
): Promise<RecipeRunReport[]> {
  const budget = { remaining: options.maxAnalyses };
  const reports: RecipeRunReport[] = [];
  for (const recipe of recipes) {
    if (recipe.enabled === false) continue;
    reports.push(await runRecipe(recipe, deps, options, budget));
  }
  return reports;
}

// --- live wiring ------------------------------------------------------------

/** Default owner of curated studies: the site identity, never a player. */
export const STUDY_CURATOR_OWNER_HANDLE =
  process.env.MISTBOARD_STUDY_CURATOR_OWNER_HANDLE ?? 'mistboard';

function timelineOf(moves: readonly XiangqiMove[]) {
  return { timeline: moves.map((move) => ({ type: 'move-played', move })) };
}

/** A broadcast board's analysis lives under this room key (game_analysis has no FK). */
export function broadcastAnalysisRoomId(boardId: string): string {
  return `broadcast:${boardId}`;
}

async function listBroadcastCandidates(recipe: StudyRecipe): Promise<CuratorGame[]> {
  const results = recipe.source.results ?? ['1-0', '0-1'];
  const events = recipe.source.events?.length ? recipe.source.events : [undefined];
  const players = recipe.source.players?.length ? recipe.source.players : [undefined];
  const seen = new Map<string, persistence.XiangqiBroadcastBoardSearchItem>();
  for (const event of events) {
    for (const player of players) {
      for (const result of results) {
        const page = await persistence.queryCompletedXiangqiBroadcastBoards({
          ...(event ? { event } : {}),
          ...(player ? { player } : {}),
          result,
          ...(recipe.source.playedFrom ? { playedFrom: recipe.source.playedFrom } : {}),
          ...(recipe.source.playedTo ? { playedTo: recipe.source.playedTo } : {}),
          ...(recipe.source.plyMin !== undefined ? { plyMin: recipe.source.plyMin } : {}),
          ...(recipe.source.plyMax !== undefined ? { plyMax: recipe.source.plyMax } : {}),
          sort: 'recent',
          limit: 200,
        });
        for (const board of page.boards) seen.set(board.id, board);
      }
    }
  }
  const games: CuratorGame[] = [];
  for (const item of seen.values()) {
    const board = await persistence.getXiangqiBroadcastBoard(item.id);
    if (!board || board.result === '*') continue;
    games.push({
      id: board.id,
      kind: 'broadcast',
      moves: board.moves,
      result: board.result,
      red: { name: board.red.name, nameEn: board.red.nameEn ?? item.redNameEn ?? null },
      black: { name: board.black.name, nameEn: board.black.nameEn ?? item.blackNameEn ?? null },
      event: { name: item.tourName, nameEn: item.tourNameEn },
      round: { name: item.roundName, nameEn: item.roundNameEn },
      playedOn: item.playedOn,
      sourceUrl: item.sourceUrl,
    });
  }
  return games;
}

async function liveAnalysis(game: CuratorGame, computeIfMissing: boolean) {
  const analysis = await resolveXiangqiAnalysis(
    broadcastAnalysisRoomId(game.id),
    timelineOf(game.moves),
    undefined,
    undefined,
    computeIfMissing,
  );
  return analysis ? (analysis.plies as CuratorPlyEval[]) : null;
}

const liveExplorer: ExplorerLookup = async (positionKey) => {
  const rows = await persistence.lookupXiangqiOpeningMoves(positionKey);
  return rows.map((row) => ({ move: uciOf(row.move), games: row.games }));
};

export async function liveCuratorDeps(): Promise<CuratorDeps> {
  const ownerId = await persistence.userIdForHandle(STUDY_CURATOR_OWNER_HANDLE);
  if (!ownerId)
    throw new Error(`study curator: no account with handle @${STUDY_CURATOR_OWNER_HANDLE}`);
  return {
    listCandidates: listBroadcastCandidates,
    getAnalysis: liveAnalysis,
    explorer: liveExplorer,
    studies: {
      getBySlug: persistence.getStudyBySlug,
      create: persistence.createStudy,
      updateMeta: persistence.updateStudyMeta,
      addChapter: persistence.addChapter,
      updateChapterTree: persistence.updateChapterTree,
      renameChapter: persistence.renameChapter,
      setChapterTags: persistence.setChapterTags,
      setChapterOrientation: persistence.setChapterOrientation,
      setChapterGamebook: persistence.setChapterGamebook,
      deleteChapter: persistence.deleteChapter,
      reorderChapters: persistence.reorderStudyChapters,
    },
    ownerId,
    engineId: XIANGQI_ANALYSIS_ENGINE_ID,
  };
}

// --- scheduler --------------------------------------------------------------

export const STUDY_CURATOR_INTERVAL_MS = 60 * 60 * 1000;
export const STUDY_CURATOR_ANALYSES_PER_TICK = 2;

export function studyCuratorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MISTBOARD_STUDY_CURATOR_ENABLED === 'true';
}

export type StudyCuratorOptions = {
  intervalMs?: number;
  isPersistenceInitialized?: () => boolean;
  enabled?: () => boolean;
  run?: () => Promise<RecipeRunReport[]>;
  now?: () => number;
};

export type StudyCurator = { stop(): void; tick(): Promise<void> };

async function liveRun(): Promise<RecipeRunReport[]> {
  const recipes = loadStudyRecipes();
  const deps = await liveCuratorDeps();
  return runStudyCurator(recipes, deps, { maxAnalyses: STUDY_CURATOR_ANALYSES_PER_TICK });
}

/**
 * Hourly in-process job, on the sweeper pattern. Always started; the tick
 * no-ops unless MISTBOARD_STUDY_CURATOR_ENABLED=true, read at tick time so ops
 * can flip it without a restart. A run is serialised: a tick that fires while
 * the previous run is still analyzing is skipped, not queued.
 */
export function startStudyCurator(options: StudyCuratorOptions = {}): StudyCurator {
  const intervalMs = options.intervalMs ?? STUDY_CURATOR_INTERVAL_MS;
  const isInitialized = options.isPersistenceInitialized ?? persistence.isInitialized;
  const enabled = options.enabled ?? studyCuratorEnabled;
  const run = options.run ?? liveRun;
  const now = options.now ?? Date.now;
  let running = false;

  async function tick(): Promise<void> {
    if (!isInitialized() || !enabled() || running) return;
    running = true;
    const startedAt = now();
    try {
      const reports = await run();
      logger.info(
        { kind: 'study_curator_run', reports, elapsedMs: now() - startedAt },
        'study curator run',
      );
    } catch (err) {
      logger.error(
        { kind: 'study_curator_failure', error: (err as Error).message, at: now() },
        'study curator failure',
      );
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), tick };
}
