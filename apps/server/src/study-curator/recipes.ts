// Study recipes: the configuration the curator runs from. A recipe names a
// study and says which games belong in it (source filters, an opening shape)
// and what each chapter should teach (a model game played through, or the one
// decisive moment parked as a guess-the-move). Recipes live in a JSON file so
// changing the opening under study, adding an event, or tightening the length
// band is an edit and a re-run, never code. The curator re-derives every
// recipe's chapters from the current archive on each run, so a study grows as
// rounds land and shrinks when a stricter filter drops a game.
//
// Piece placements are written the short way ("C@e3": a cannon on e3) and are
// matched mirror-aware, so a recipe for the central cannon covers 炮二平五 and
// 炮八平五 alike (see opening-match.ts).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type StudyRecipeMode = 'model-games' | 'decisive-moments';

export type StudyRecipeVisibility = 'public' | 'unlisted';

export type StudyRecipeOrientation = 'red' | 'black' | 'winner';

export type StudyRecipeResult = '1-0' | '0-1' | '1/2-1/2';

export type StudyRecipeOpening = {
  /** English name, used in chapter comments ("Central Cannon vs Screen Horses"). */
  name: string;
  /** Chinese name for the zh comments; optional. */
  nameZh?: string;
  /** The placements below must all hold in the position after this many plies. */
  byPly: number;
  /** Red placements, "<piece>@<square>": K A E H R C P for general, advisor,
   *  elephant, horse, chariot, cannon, soldier. */
  red?: string[];
  /** Black placements, same grammar. */
  black?: string[];
};

export type StudyRecipeSource = {
  /** Substrings matched (case-insensitively) against tour and round names. */
  events?: string[];
  /** Substrings matched against either player's name (source or English). */
  players?: string[];
  /** ISO dates on the round start; `playedTo` is exclusive. */
  playedFrom?: string;
  playedTo?: string;
  /** Results to keep. Defaults to decisive games only. */
  results?: StudyRecipeResult[];
  plyMin?: number;
  plyMax?: number;
};

export type StudyRecipe = {
  /** Stable identity: the study's slug and the key chapters are tracked under. */
  id: string;
  /** Bump to force every chapter of the study to re-derive. */
  version: number;
  enabled?: boolean;
  study: {
    name: string;
    description: string;
    i18n?: Record<string, { name?: string; description?: string }>;
    visibility: StudyRecipeVisibility;
    /** Which side the board shows at the bottom. `winner` follows the result. */
    orientation?: StudyRecipeOrientation;
  };
  source: StudyRecipeSource;
  opening?: StudyRecipeOpening;
  mode: StudyRecipeMode;
  chapters: {
    /** Upper bound on chapters; the ranker keeps the best this many. */
    max: number;
  };
  annotate?: {
    /** Judged moves that get a comment and a refutation branch (default 6). */
    maxMoments?: number;
    /** Comment the first departure from the explorer's usual moves (default true). */
    openingDeviation?: boolean;
  };
};

export type StudyRecipesFile = {
  version: 1;
  recipes: StudyRecipe[];
};

const PLACEMENT = /^[KAEHRCP]@[a-i](?:[1-9]|10)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class StudyRecipeError extends Error {}

function fail(recipe: string, message: string): never {
  throw new StudyRecipeError(`recipe ${recipe}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(recipe: string, field: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.length === 0)) {
    fail(recipe, `${field} must be a list of non-empty strings`);
  }
  return value as string[];
}

function optionalInt(recipe: string, field: string, value: unknown, min = 0): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < min) {
    fail(recipe, `${field} must be an integer >= ${min}`);
  }
  return value as number;
}

/** Validate one recipe object. Throws StudyRecipeError naming the field. */
export function parseStudyRecipe(raw: unknown): StudyRecipe {
  if (!isRecord(raw)) throw new StudyRecipeError('recipe must be an object');
  const id = raw.id;
  if (typeof id !== 'string' || !SLUG.test(id)) {
    throw new StudyRecipeError(`recipe id must be a slug, got ${JSON.stringify(id)}`);
  }
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) {
    fail(id, 'version must be a positive integer');
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    fail(id, 'enabled must be a boolean');
  }
  if (!isRecord(raw.study)) fail(id, 'study is required');
  const study = raw.study;
  if (typeof study.name !== 'string' || study.name.length === 0) fail(id, 'study.name required');
  if (typeof study.description !== 'string') fail(id, 'study.description required');
  if (study.visibility !== 'public' && study.visibility !== 'unlisted') {
    fail(id, 'study.visibility must be public or unlisted');
  }
  if (
    study.orientation !== undefined &&
    study.orientation !== 'red' &&
    study.orientation !== 'black' &&
    study.orientation !== 'winner'
  ) {
    fail(id, 'study.orientation must be red, black or winner');
  }
  if (study.i18n !== undefined && !isRecord(study.i18n)) fail(id, 'study.i18n must be an object');

  if (!isRecord(raw.source)) fail(id, 'source is required');
  const source = raw.source;
  const results = stringList(id, 'source.results', source.results);
  if (results?.some((r) => r !== '1-0' && r !== '0-1' && r !== '1/2-1/2')) {
    fail(id, 'source.results entries must be 1-0, 0-1 or 1/2-1/2');
  }
  for (const field of ['playedFrom', 'playedTo'] as const) {
    const value = source[field];
    if (value !== undefined && (typeof value !== 'string' || !ISO_DATE.test(value))) {
      fail(id, `source.${field} must be YYYY-MM-DD`);
    }
  }
  const plyMin = optionalInt(id, 'source.plyMin', source.plyMin);
  const plyMax = optionalInt(id, 'source.plyMax', source.plyMax);
  if (plyMin !== undefined && plyMax !== undefined && plyMin > plyMax) {
    fail(id, 'source.plyMin exceeds source.plyMax');
  }

  let opening: StudyRecipeOpening | undefined;
  if (raw.opening !== undefined) {
    if (!isRecord(raw.opening)) fail(id, 'opening must be an object');
    const o = raw.opening;
    if (typeof o.name !== 'string' || o.name.length === 0) fail(id, 'opening.name required');
    if (o.nameZh !== undefined && typeof o.nameZh !== 'string') {
      fail(id, 'opening.nameZh must be a string');
    }
    const byPly = optionalInt(id, 'opening.byPly', o.byPly, 1);
    if (byPly === undefined) fail(id, 'opening.byPly required');
    const red = stringList(id, 'opening.red', o.red) ?? [];
    const black = stringList(id, 'opening.black', o.black) ?? [];
    if (red.length + black.length === 0) fail(id, 'opening needs at least one placement');
    for (const placement of [...red, ...black]) {
      if (!PLACEMENT.test(placement)) {
        fail(id, `opening placement ${JSON.stringify(placement)} is not <piece>@<square>`);
      }
    }
    opening = {
      name: o.name,
      ...(o.nameZh ? { nameZh: o.nameZh } : {}),
      byPly,
      red,
      black,
    };
  }

  if (raw.mode !== 'model-games' && raw.mode !== 'decisive-moments') {
    fail(id, 'mode must be model-games or decisive-moments');
  }
  if (!isRecord(raw.chapters)) fail(id, 'chapters is required');
  const max = optionalInt(id, 'chapters.max', raw.chapters.max, 1);
  if (max === undefined) fail(id, 'chapters.max required');

  let annotate: StudyRecipe['annotate'];
  if (raw.annotate !== undefined) {
    if (!isRecord(raw.annotate)) fail(id, 'annotate must be an object');
    const maxMoments = optionalInt(id, 'annotate.maxMoments', raw.annotate.maxMoments);
    const openingDeviation = raw.annotate.openingDeviation;
    if (openingDeviation !== undefined && typeof openingDeviation !== 'boolean') {
      fail(id, 'annotate.openingDeviation must be a boolean');
    }
    annotate = {
      ...(maxMoments !== undefined ? { maxMoments } : {}),
      ...(openingDeviation !== undefined ? { openingDeviation } : {}),
    };
  }

  return {
    id,
    version: raw.version as number,
    ...(raw.enabled !== undefined ? { enabled: raw.enabled as boolean } : {}),
    study: {
      name: study.name,
      description: study.description,
      ...(study.i18n ? { i18n: study.i18n as StudyRecipe['study']['i18n'] } : {}),
      visibility: study.visibility,
      ...(study.orientation ? { orientation: study.orientation as StudyRecipeOrientation } : {}),
    },
    source: {
      ...(stringList(id, 'source.events', source.events)
        ? { events: source.events as string[] }
        : {}),
      ...(stringList(id, 'source.players', source.players)
        ? { players: source.players as string[] }
        : {}),
      ...(source.playedFrom ? { playedFrom: source.playedFrom as string } : {}),
      ...(source.playedTo ? { playedTo: source.playedTo as string } : {}),
      ...(results ? { results: results as StudyRecipeResult[] } : {}),
      ...(plyMin !== undefined ? { plyMin } : {}),
      ...(plyMax !== undefined ? { plyMax } : {}),
    },
    ...(opening ? { opening } : {}),
    mode: raw.mode,
    chapters: { max },
    ...(annotate ? { annotate } : {}),
  };
}

export function parseStudyRecipesFile(raw: unknown): StudyRecipe[] {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.recipes)) {
    throw new StudyRecipeError('recipes file must be { version: 1, recipes: [...] }');
  }
  const recipes = raw.recipes.map(parseStudyRecipe);
  const seen = new Set<string>();
  for (const recipe of recipes) {
    if (seen.has(recipe.id)) throw new StudyRecipeError(`duplicate recipe id ${recipe.id}`);
    seen.add(recipe.id);
  }
  return recipes;
}

/** apps/server/config/study-recipes.json, or MISTBOARD_STUDY_RECIPES when set. */
export function defaultStudyRecipesPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MISTBOARD_STUDY_RECIPES) return env.MISTBOARD_STUDY_RECIPES;
  const here = dirname(fileURLToPath(import.meta.url));
  // src/study-curator/ and dist/study-curator/ both sit two levels under apps/server.
  return join(here, '..', '..', 'config', 'study-recipes.json');
}

export function loadStudyRecipes(path = defaultStudyRecipesPath()): StudyRecipe[] {
  const text = readFileSync(path, 'utf8');
  return parseStudyRecipesFile(JSON.parse(text));
}
