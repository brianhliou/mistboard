// Offline-only reuse of exact budget-specific analysis. No engine or network.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { articleAnalysisKey } from '../../apps/web/src/article-analysis-key.js';
export const ARTICLE_CHART_ENGINE_ID = 'pikafish-xiangqi-analysis@5';
const movesOf = (record) => record.iccs.trim().split(/\s+/).filter(Boolean);
const nodesOf = (record) => record.analysisNodes ?? 1_000_000;
const engineId = (nodes) =>
  nodes === 1_000_000 ? ARTICLE_CHART_ENGINE_ID : `${ARTICLE_CHART_ENGINE_ID}:nodes=${nodes}`;
function score(value) {
  if (!value || typeof value !== 'object') return null;
  const cp = value.cp ?? null;
  const mate = value.mate ?? null;
  return (cp === null || Number.isFinite(cp)) &&
    (mate === null || Number.isInteger(mate)) &&
    (cp !== null || mate !== null)
    ? { cp, mate }
    : null;
}
function studyMove(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(value))
    throw new Error('invalid stored best move');
  return `${value[0]}${Number(value[1]) + 1}${value[2]}${Number(value[3]) + 1}`;
}
export function validArticleChart(site, record) {
  const nodes = nodesOf(record);
  const budgetMatches =
    nodes === 1_000_000
      ? (site?.nodes === undefined || site.nodes === nodes) && Number.isInteger(site?.depth)
      : nodes === 10_000_000 && site?.nodes === nodes && site.depth === 0;
  return (
    !record.startFen &&
    budgetMatches &&
    site?.engineId === engineId(nodes) &&
    Array.isArray(site.plies) &&
    site.plies.length === movesOf(record).length + 1 &&
    site.plies.every(
      (p, i) =>
        p.ply === i &&
        p.cp !== undefined &&
        p.mate !== undefined &&
        score(p) &&
        (p.best === null || typeof p.best === 'string'),
    )
  );
}
export function storedArticleChart(annot, record) {
  const moves = movesOf(record);
  if (
    record.startFen ||
    !Array.isArray(annot?.rows) ||
    annot.rows.length !== moves.length ||
    !annot.rows.every((row, i) => row.uci === moves[i])
  )
    return null;
  const nodes = nodesOf(record);
  if (nodes === 10_000_000) {
    // Raw deep rows are evals AFTER each move, from Red's point of view.
    // The best move at position i belongs to the NEXT row's pre-move search.
    // annot.site, if present, remains a separate 1M pass and is never used.
    if (
      annot.engine?.nodes !== nodes ||
      !score(annot.initial) ||
      !annot.rows.every((row, i) => row.ply === i + 1 && score(row))
    )
      return null;
    try {
      const positions = [annot.initial, ...annot.rows];
      return {
        engineId: engineId(nodes),
        nodes,
        depth: 0,
        plies: positions.map((position, ply) => ({
          ply,
          ...score(position),
          best: ply < moves.length ? studyMove(annot.rows[ply].best) : null,
        })),
      };
    } catch {
      return null;
    }
  }
  if (nodes !== 1_000_000 || !validArticleChart(annot.site, record)) return null;
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
      /* replace invalid series from the verified source below */
    }
  }
  let body;
  try {
    body = storedArticleChart(JSON.parse(readFileSync(annotationPath, 'utf8')), record);
  } catch {
    /* uniform actionable failure */
  }
  if (!body) {
    const budget = nodesOf(record);
    throw new Error(
      budget === 1_000_000
        ? 'no matching complete stored site analysis for chart; prepare annot1m with the exact record and pikafish-xiangqi-analysis@5 (no automatic engine run)'
        : `no matching complete ${budget}-node analysis for chart; prepare annot10m with exact moves, sequential plies, finite initial/row evaluations and engine.nodes=10000000 (no 1M fallback or automatic engine run)`,
    );
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...body, source })}\n`);
  return file;
}
