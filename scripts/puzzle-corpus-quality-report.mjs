#!/usr/bin/env node
// Join a completed, read-only Modal audit to its exact served snapshot.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  puzzleShortCode,
  XIANGQI_PUZZLE_MINIMUM_ROOT_MOVES,
  XIANGQI_PUZZLE_ROOT_CHOICE_VERSION,
} from '../packages/game/dist/index.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const dispositions = ['keep', 'shorter-replacement', 'withhold-candidate', 'needs-review'];
const tally = (items, key) =>
  items.reduce((counts, item) => {
    const name = key(item);
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});

export function buildCorpusQualityReport(snapshotText, manifest, shards) {
  const snapshot = JSON.parse(snapshotText);
  const selectedIds = manifest.ids ?? manifest.shards.flatMap((shard) => shard.ids);
  assert.equal(sha(snapshotText), manifest.snapshotSha256, 'Snapshot hash mismatch');
  assert.equal(selectedIds.length, manifest.puzzles, 'Manifest count mismatch');
  assert.equal(new Set(selectedIds).size, manifest.puzzles, 'Duplicate manifest ids');
  assert.equal(shards.length, manifest.shards.length, 'Missing shard');
  const source = new Map(snapshot.rows.map((row) => [row.id, row]));
  assert.equal(source.size, snapshot.rows.length, 'Duplicate snapshot ids');
  const completed = new Map();
  const receipts = [];
  let engine;
  let policy;
  for (const [index, rows] of shards.entries()) {
    const expected = manifest.shards[index];
    const verified = rows.filter((row) => row.type === 'verified-profile');
    const profiles = rows.filter((row) => row.type === 'policy-profile');
    const complete = rows.filter((row) => row.type === 'complete');
    const receipt = rows.filter((row) => row.type === 'shard-receipt');
    const puzzles = rows.filter((row) => row.type === 'puzzle');
    assert.equal(verified.length, 1, 'Missing or duplicate engine profile');
    assert.equal(profiles.length, 1, 'Missing or duplicate policy profile');
    assert.equal(complete.length, 1, 'Incomplete shard');
    assert.equal(receipt.length, 1, 'Missing shard receipt');
    const { shard, executionId, snapshotSha256, sourceHashes, ...identity } = verified[0].profile;
    assert.equal(shard, expected.shard, 'Wrong shard identity');
    assert.equal(executionId, manifest.executionId, 'Mixed executions');
    assert.equal(snapshotSha256, manifest.snapshotSha256, 'Mixed snapshots');
    assert.deepEqual(sourceHashes, manifest.sources, 'Mixed source versions');
    assert.deepEqual(engine ?? identity, identity, 'Mixed engine profiles');
    assert.deepEqual(policy ?? profiles[0], profiles[0], 'Mixed policy profiles');
    engine = identity;
    policy = profiles[0];
    assert.equal(complete[0].puzzles, expected.ids.length, 'Incomplete shard count');
    assert.equal(receipt[0].shard, expected.shard, 'Wrong receipt identity');
    assert.equal(receipt[0].puzzles, expected.ids.length, 'Incomplete receipt count');
    assert.deepEqual(
      puzzles.map((row) => row.id),
      expected.ids,
      'Missing or reordered puzzle results',
    );
    receipts.push(receipt[0]);
    for (const row of puzzles) {
      assert.ok(!completed.has(row.id), 'Duplicate puzzle result');
      assert.ok(selectedIds.includes(row.id), 'Unexpected puzzle result');
      const input = source.get(row.id);
      assert.ok(input, 'Puzzle missing from snapshot');
      assert.equal(row.puzzleHash, sha(JSON.stringify(input.puzzle)), 'Stale puzzle content');
      assert.ok(dispositions.includes(row.decision?.disposition), 'Unknown disposition');
      const root = row.evidence.find((ply) => ply.solutionPly === 0);
      const rootCount =
        root?.mateGoalEvidence?.legalMoveCount ??
        root?.searches.at(-1)?.moveCoverage?.legalMoveCount;
      const noChoice =
        Number.isInteger(rootCount) &&
        rootCount >= 0 &&
        rootCount < XIANGQI_PUZZLE_MINIMUM_ROOT_MOVES;
      completed.set(row.id, {
        ...row,
        ...(noChoice
          ? {
              rawDecision: row.decision,
              decision: {
                disposition: 'withhold-candidate',
                reason: 'no-choice-at-root',
                firstProblemPly: 0,
              },
            }
          : {}),
        code: puzzleShortCode(row.id),
        puzzle: input.puzzle,
      });
    }
  }
  assert.equal(completed.size, manifest.puzzles, 'Incomplete corpus coverage');
  const entries = selectedIds.map((id) => completed.get(id));
  const decisions = Object.fromEntries(dispositions.map((name) => [name, 0]));
  Object.assign(
    decisions,
    tally(entries, (row) => row.decision.disposition),
  );
  return {
    generatedAt: new Date().toISOString(),
    exportedAt: snapshot.exportedAt,
    executionId: manifest.executionId,
    snapshotSha256: manifest.snapshotSha256,
    sourceHashes: manifest.sources,
    engine,
    policy,
    sourcePolicy: {
      rootChoiceVersion: XIANGQI_PUZZLE_ROOT_CHOICE_VERSION,
      minimumRootLegalMoves: XIANGQI_PUZZLE_MINIMUM_ROOT_MOVES,
    },
    forcedStarts: entries.filter((row) => row.decision.reason === 'no-choice-at-root').length,
    canary: manifest.canary,
    servedSnapshotSize: snapshot.rows.length,
    audited: entries.length,
    decisions,
    reasons: tally(entries, (row) => row.decision.reason),
    solverPositions: entries.reduce((sum, row) => sum + row.judgments.length, 0),
    searches: entries.reduce(
      (sum, row) => sum + row.evidence.reduce((n, ply) => n + ply.searches.length, 0),
      0,
    ),
    workerWallSeconds: receipts.reduce((sum, row) => sum + row.workerWallSeconds, 0),
    receipts,
    entries,
  };
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const moveText = (move) => `${move.from}-${move.to}`;
const scoreText = (line) =>
  line.score.mate === null
    ? `${line.score.cp >= 0 ? '+' : ''}${(line.score.cp / 100).toFixed(2)}`
    : `mate ${line.score.mate}`;

const mateProofHtml = (proof, index) =>
  `<p>Board proof ${index + 1} · mate within ${escapeHtml(proof.mateIn)} moves · ${escapeHtml(proof.verdict)} · ${escapeHtml(proof.reason)} · ${proof.nodes} nodes${proof.limits ? ` · ${proof.limits.maxNodes.toLocaleString('en-US')} node / ${proof.limits.maxTimeMs / 1000}s cap` : ''}</p><p>Proven within-bound keys: ${escapeHtml(proof.winningMoves.map(moveText).join(' ') || 'none found')}. ${proof.complete ? 'All legal starting moves checked.' : 'Uniqueness is not certified by a partial search; two proved keys already establish ambiguity.'}</p>`;

export function corpusQualityReportHtml(report) {
  const rows = report.entries
    .map((entry) => {
      const d = entry.decision;
      const proposed = d.replacement?.solution;
      const evidence = entry.evidence
        .map(
          (
            ply,
          ) => `<h4>Solver turn ${ply.solutionPly / 2 + 1} · solution ply ${ply.solutionPly + 1}</h4>
      ${(ply.mateGoalAttempts?.length ? ply.mateGoalAttempts : ply.mateGoalEvidence ? [ply.mateGoalEvidence] : []).map(mateProofHtml).join('')}
      ${ply.searches
        .map(
          (
            search,
            budget,
          ) => `<p>${ply.budgets?.[budget] ? `${ply.budgets[budget].toLocaleString('en-US')} node cap` : 'Engine search'} · ${escapeHtml(search.reason)}</p>
      <div class="scroll"><table><thead><tr><th>Rank</th><th>Score</th><th>Depth</th><th>Nodes</th><th>Continuation (UCI)</th></tr></thead><tbody>
      ${search.lines.map((line) => `<tr><td>${line.rank}</td><td>${escapeHtml(scoreText(line))}</td><td>${line.depth ?? '?'}</td><td>${line.nodes ?? '?'}</td><td>${escapeHtml(line.pvUci.join(' '))}</td></tr>`).join('')}</tbody></table></div>`,
        )
        .join('')}`,
        )
        .join('');
      const text = `${entry.code} ${entry.id} ${entry.puzzle.title} ${d.reason}`.toLowerCase();
      return `<details data-disposition="${d.disposition}" data-search="${escapeHtml(text)}"><summary><span class="tag ${d.disposition}">${d.disposition}</span> <a href="https://mistboard.com/puzzles/${entry.code}" target="_blank" rel="noreferrer">${entry.code}</a> · ${escapeHtml(entry.puzzle.title)} · ${escapeHtml(d.reason)}</summary>
      <p>Goal: ${escapeHtml(entry.puzzle.goal.type)}. First problem: ${d.firstProblemPly === null ? 'none' : `solver turn ${d.firstProblemPly / 2 + 1}`}.</p>
      <p>Stored: ${escapeHtml(entry.puzzle.solution.map(moveText).join(' '))}</p>
      ${proposed ? `<p>Proposed replacement: ${escapeHtml(proposed.map(moveText).join(' '))} (${escapeHtml(d.replacement.endpointKind)}). Review as a separate record.</p>` : ''}
      <p>${escapeHtml(entry.judgments.map((j) => `Turn ${j.solutionPly / 2 + 1}: ${j.verdict} (${j.reason})`).join('; '))}</p>
      ${evidence || '<p>No usable search evidence.</p>'}
      <details><summary>Exact source puzzle</summary><pre>${escapeHtml(JSON.stringify(entry.puzzle, null, 2))}</pre></details></details>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xiangqi corpus quality review</title>
  <style>body{font:16px/1.5 system-ui;margin:24px auto;padding:0 16px;max-width:1200px;color:#23342e;background:#f7f8f6}h1{font-size:26px}.counts{display:flex;gap:12px;flex-wrap:wrap}.counts span,details{background:white;border:1px solid #d8dfda;border-radius:8px;padding:12px;margin:10px 0}summary{cursor:pointer}details details{background:#f9faf9}p{overflow-wrap:anywhere}input,select{font:inherit;padding:9px;margin:8px 6px 8px 0;max-width:90%}a{color:#17684a}.tag{font-size:12px;padding:3px 7px;border-radius:4px;background:#e9ece9}.keep{background:#daf1df}.withhold-candidate{background:#f6dfda}.shorter-replacement{background:#dfeaf7}.needs-review{background:#fff0c9}table{border-collapse:collapse;font-size:13px;width:100%}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #dde3de;padding:6px}td:last-child{min-width:280px}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}[hidden]{display:none!important}</style>
  <h1>Xiangqi corpus quality review</h1><p>${report.audited} / ${report.servedSnapshotSize} served puzzles audited${report.canary ? ' · canary only' : ''}. Read-only proposals; no serving data, ratings or attempts changed.</p>
  <div class="counts">${Object.entries(report.decisions)
    .map(([name, count]) => `<span>${name}: <b>${count}</b></span>`)
    .join('')}</div>
  <p>Single stored answer, with the grader's immediate-win equivalence at the finish. Mate-in-N admission proves a unique key within the stated bound against every legal defence; slower wins are outside that objective. Exhausted proof budgets stay in review. General winning-advantage tasks retain the frozen CC0 score-separation rule; percentages are score comparisons, not independently calibrated human win rates. Actual engine budgets appear with each search. Under-depth, unstable or missing engine evidence stays in review; engine mate scores alone are not board-mate proofs.</p>
  <p>The initial position must offer at least two legal moves. This source guard is applied to the kernel coverage recorded by the workers; any overridden raw decision remains in the JSON report.</p>
  <p>Shorter versions are proposals for separate records. Mate goals are never converted into an earlier material win. A withhold candidate failed this policy; it is not automatically an editorially bad exercise. The audit stops at the first unresolved or failing solver turn.</p>
  <label>Disposition <select id="kind"><option value="">All</option>${dispositions.map((name) => `<option>${name}</option>`).join('')}</select></label>
  <label>Search <input id="query" type="search" placeholder="Code, title or reason"></label><output id="visible"></output>
  <main>${rows}</main><details><summary>Reproducibility</summary><pre>${escapeHtml(JSON.stringify({ executionId: report.executionId, snapshotSha256: report.snapshotSha256, engine: report.engine, policy: report.policy, sourcePolicy: report.sourcePolicy, sourceHashes: report.sourceHashes, receipts: report.receipts }, null, 2))}</pre></details>
  <script>const items=[...document.querySelectorAll('main>details')],kind=document.getElementById('kind'),query=document.getElementById('query');function filter(){let count=0;for(const item of items){item.hidden=Boolean(kind.value&&item.dataset.disposition!==kind.value)||!item.dataset.search.includes(query.value.toLowerCase().trim());if(!item.hidden)count++}document.getElementById('visible').textContent=count+' shown'}kind.addEventListener('change',filter);query.addEventListener('input',filter);filter();</script></html>`;
}

function main() {
  const { values } = parseArgs({
    options: { snapshot: { type: 'string' }, audit: { type: 'string' } },
  });
  if (!values.snapshot || !values.audit)
    throw new Error('--snapshot PATH --audit COMPLETED_DIRECTORY required');
  const directory = resolve(values.audit);
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const shards = manifest.shards.map(({ shard }) =>
    readFileSync(join(directory, `shard-${shard}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
  const report = buildCorpusQualityReport(readFileSync(values.snapshot, 'utf8'), manifest, shards);
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report));
  writeFileSync(join(directory, 'review.html'), corpusQualityReportHtml(report));
  const { entries: _, ...summary } = report;
  writeFileSync(join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ audited: report.audited, decisions: report.decisions, solverPositions: report.solverPositions, searches: report.searches, workerWallSeconds: report.workerWallSeconds })}\n`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
