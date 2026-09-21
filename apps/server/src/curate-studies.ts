// CLI for the study curator: run the recipes (or one) against the database now,
// with a chosen engine budget, and print what each study would get. Dry by
// default so a recipe edit can be checked before it writes anything.
//
//   DATABASE_URL=… npx tsx apps/server/src/curate-studies.ts --dry-run
//   DATABASE_URL=… npx tsx apps/server/src/curate-studies.ts --recipe yin-sheng-2026 --apply --max-analyses 6
//
// Analyses are the slow part (one persistent Pikafish sweep per game, about a
// second a ply), so --max-analyses caps how many new games a run may sweep;
// re-run to fill the rest. Cached sweeps cost nothing.

import { parseArgs } from 'node:util';
import { close, init } from './persistence-db.js';
import { liveCuratorDeps, runStudyCurator } from './study-curator/curator.js';
import { defaultStudyRecipesPath, loadStudyRecipes } from './study-curator/recipes.js';

const { values } = parseArgs({
  options: {
    recipe: { type: 'string', multiple: true },
    recipes: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'max-analyses': { type: 'string', default: '2' },
    json: { type: 'boolean', default: false },
  },
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const maxAnalyses = Number.parseInt(values['max-analyses'] ?? '2', 10);
if (!Number.isInteger(maxAnalyses) || maxAnalyses < 0) {
  throw new Error('--max-analyses must be a non-negative integer');
}
const dryRun = !values.apply || values['dry-run'];

const all = loadStudyRecipes(values.recipes ?? defaultStudyRecipesPath());
const wanted = values.recipe?.length ? new Set(values.recipe) : null;
const recipes = wanted ? all.filter((recipe) => wanted.has(recipe.id)) : all;
if (wanted) {
  for (const id of wanted) {
    if (!all.some((recipe) => recipe.id === id)) throw new Error(`no recipe ${id}`);
  }
}

init(databaseUrl);
try {
  const deps = await liveCuratorDeps();
  const reports = await runStudyCurator(recipes, deps, { maxAnalyses, dryRun });
  if (values.json) {
    console.log(JSON.stringify({ dryRun, reports }, null, 2));
  } else {
    console.log(dryRun ? 'dry run (pass --apply to write)' : 'applied');
    for (const report of reports) {
      console.log(
        `${report.recipeId}: ${report.candidates} candidates, ${report.matched} matched, ${report.analyzed} analyzed, ${report.awaitingAnalysis} awaiting analysis (${report.analysesStarted} started this run)`,
      );
      const c = report.chapters;
      console.log(
        `  study ${report.studyId ?? '(not created yet)'}: +${c.added} added, ~${c.updated} updated, -${c.removed} removed, ${c.kept} kept`,
      );
      for (const [index, entry] of report.ranked.entries()) {
        console.log(
          `  ${String(index + 1).padStart(2)}. ${entry.gameId}  score ${entry.score.toFixed(1)}`,
        );
      }
    }
  }
} finally {
  await close();
}
