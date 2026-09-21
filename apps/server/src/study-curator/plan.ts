// The diff between what a study holds and what its recipe now derives. Pure,
// so the add / update / remove / reorder decisions are testable without a
// database. Chapters are matched on the curator mark stored in `denorm`
// (recipe id + game id), never on name: names carry player spellings that a
// source correction can change, and a renamed chapter must not become a
// duplicate. A chapter whose mark carries an older recipe, annotator or engine
// version is rewritten in place so its id (and any link to it) survives.

import type { ChapterDraft } from './annotate.js';

export type CuratorMark = {
  recipeId: string;
  gameId: string;
  recipeVersion: number;
  annotatorVersion: number;
  engineId: string;
};

export type CuratorDenorm = { curator: CuratorMark };

export function readCuratorMark(denorm: unknown): CuratorMark | null {
  if (typeof denorm !== 'object' || denorm === null) return null;
  const mark = (denorm as { curator?: unknown }).curator;
  if (typeof mark !== 'object' || mark === null) return null;
  const m = mark as Partial<CuratorMark>;
  if (
    typeof m.recipeId !== 'string' ||
    typeof m.gameId !== 'string' ||
    typeof m.recipeVersion !== 'number' ||
    typeof m.annotatorVersion !== 'number' ||
    typeof m.engineId !== 'string'
  ) {
    return null;
  }
  return {
    recipeId: m.recipeId,
    gameId: m.gameId,
    recipeVersion: m.recipeVersion,
    annotatorVersion: m.annotatorVersion,
    engineId: m.engineId,
  };
}

export type ExistingChapter = {
  id: string;
  denorm: unknown;
  gamebook: boolean;
};

export type DesiredChapter = {
  mark: CuratorMark;
  draft: ChapterDraft;
};

/** Where a chapter lands in the final order: an existing id, or the index into
 *  `add` of a chapter that does not have an id yet. */
export type OrderRef = { id: string } | { add: number };

export type ChapterPlan = {
  add: DesiredChapter[];
  update: { id: string; desired: DesiredChapter }[];
  /** Existing chapters, marked by this recipe, whose game is no longer wanted. */
  remove: string[];
  /** Existing chapters whose tree is current but whose gamebook flag is not. */
  gamebook: { id: string; gamebook: boolean }[];
  order: OrderRef[];
  /** Chapters in the study that carry no curator mark (or another recipe's). Left alone. */
  foreign: string[];
};

function sameVersion(a: CuratorMark, b: CuratorMark): boolean {
  return (
    a.recipeVersion === b.recipeVersion &&
    a.annotatorVersion === b.annotatorVersion &&
    a.engineId === b.engineId
  );
}

export function planChapters(
  recipeId: string,
  existing: readonly ExistingChapter[],
  desired: readonly DesiredChapter[],
): ChapterPlan {
  const mine = new Map<string, ExistingChapter & { mark: CuratorMark }>();
  const foreign: string[] = [];
  for (const chapter of existing) {
    const mark = readCuratorMark(chapter.denorm);
    if (mark && mark.recipeId === recipeId) mine.set(mark.gameId, { ...chapter, mark });
    else foreign.push(chapter.id);
  }

  const add: DesiredChapter[] = [];
  const update: ChapterPlan['update'] = [];
  const gamebook: ChapterPlan['gamebook'] = [];
  const order: OrderRef[] = [];
  const wanted = new Set<string>();
  for (const chapter of desired) {
    wanted.add(chapter.mark.gameId);
    const current = mine.get(chapter.mark.gameId);
    if (!current) {
      order.push({ add: add.length });
      add.push(chapter);
      continue;
    }
    order.push({ id: current.id });
    if (!sameVersion(current.mark, chapter.mark)) {
      update.push({ id: current.id, desired: chapter });
    } else if (current.gamebook !== chapter.draft.gamebook) {
      gamebook.push({ id: current.id, gamebook: chapter.draft.gamebook });
    }
  }
  const remove = [...mine.values()].filter((c) => !wanted.has(c.mark.gameId)).map((c) => c.id);
  return { add, update, remove, gamebook, order, foreign };
}
