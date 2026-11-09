// Offline-only reuse of the exact site-budget series. No engine or network.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { articleAnalysisKey } from '../../apps/web/src/article-analysis-key.js';
export const ARTICLE_CHART_ENGINE_ID = 'pikafish-xiangqi-analysis@5';
const movesOf = (record) => record.iccs.trim().split(/\s+/).filter(Boolean);
export function validArticleChart(site, record) {
  const length = movesOf(record).length + 1;
  return (
    !record.startFen &&
    site?.engineId === ARTICLE_CHART_ENGINE_ID &&
    Number.isInteger(site.depth) &&
    Array.isArray(site.plies) &&
    site.plies.length === length &&
    site.plies.every(
      (p, i) =>
        p.ply === i &&
        (p.cp === null || Number.isFinite(p.cp)) &&
        (p.mate === null || Number.isInteger(p.mate)) &&
        (p.cp !== null || p.mate !== null) &&
        (p.best === null || typeof p.best === 'string'),
    )
  );
}
export function storedArticleChart(annot, record) {
  const moves = movesOf(record);
  if (
    !Array.isArray(annot?.rows) ||
    annot.rows.length !== moves.length ||
    !annot.rows.every((row, i) => row.uci === moves[i]) ||
    !validArticleChart(annot.site, record)
  )
    return null;
  return {
    engineId: annot.site.engineId,
    depth: annot.site.depth,
    plies: annot.site.plies.map((p) => ({ ply: p.ply, cp: p.cp, mate: p.mate, best: p.best })),
  };
}
export function prepareArticleChart(record, annotationPath, outputDir, source) {
  const file = join(outputDir, `${articleAnalysisKey(record)}.json`);
  if (existsSync(file)) {
    try {
      if (validArticleChart(JSON.parse(readFileSync(file, 'utf8')), record)) return file;
    } catch {
      /* replace invalid series from a verified cache below */
    }
  }
  let body;
  try {
    body = storedArticleChart(JSON.parse(readFileSync(annotationPath, 'utf8')), record);
  } catch {
    /* uniform actionable failure */
  }
  if (!body)
    throw new Error(
      'no matching complete stored site analysis for chart; prepare annot1m with the exact record and pikafish-xiangqi-analysis@5 (no automatic engine run)',
    );
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...body, source })}\n`);
  return file;
}
