#!/usr/bin/env node
// Read-only corpus triage and resumable native rechecks for #1034.
// Build @mistboard/game first. Export through the repository tunnel:
//   npm run prod:db -- --read-only node scripts/puzzle-winning-audit.mjs --export /tmp/puzzles.json
//   node scripts/puzzle-winning-audit.mjs --snapshot /tmp/puzzles.json --out tmp/puzzle-audit
//   node_modules/.bin/tsx scripts/puzzle-winning-audit.mjs --snapshot /tmp/puzzles.json --out tmp/puzzle-audit --recheck --binary PATH --binary-sha256 SHA --net PATH --net-sha256 SHA
// There is deliberately no apply/withhold mode. Reports never change ratings,
// attempts, puzzle content or serving state. Old evidence is a triage signal.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  applyStandardXiangqiMove,
  classifyXiangqiSolverMoveUniqueness,
  puzzleShortCode,
  validateStandardXiangqiPuzzle,
  XIANGQI_PUZZLE_ADMISSION_PROFILE,
  XIANGQI_SOLVER_GATE_DEFAULTS,
  XIANGQI_SOLVER_GATE_VERSION,
  XIANGQI_SOLVER_SCORE_PROFILE,
  xiangqiPuzzleHasStartingChoice,
  xiangqiSolverMoveCoverage,
} from '../packages/game/dist/index.js';

export const GATE_OPTIONS = { ...XIANGQI_SOLVER_GATE_DEFAULTS };
const sha = (value) => createHash('sha256').update(value).digest('hex');
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const mate = (value) => value === null || (Number.isInteger(value) && Number.isFinite(value));

export function assessStoredAudit(row) {
  const unknown = { status: 'needs-reanalysis', failures: [] };
  const evidence = row.evidence;
  const length = row.puzzle?.solution?.length;
  if (
    row.network_sha256 !== XIANGQI_SOLVER_SCORE_PROFILE.networkSha256 ||
    evidence?.solverGateVersion !== XIANGQI_SOLVER_GATE_VERSION ||
    !row.audit_matches_puzzle ||
    row.audit_verdict !== 'pass' ||
    !length ||
    !record(evidence) ||
    !Array.isArray(evidence.plies) ||
    evidence.plies.length !== Math.ceil(length / 2)
  )
    return unknown;
  const failures = [];
  for (const [index, ply] of evidence.plies.entries()) {
    if (
      !record(ply) ||
      ply.solutionPly !== index * 2 ||
      ply.matchesShipped !== true ||
      !finite(ply.bestCp) ||
      !mate(ply.bestMate) ||
      !mate(ply.secondMate) ||
      !(ply.secondCp === null || finite(ply.secondCp)) ||
      (ply.secondCp === null && ply.secondMate !== null)
    )
      return unknown;
    // Scalar summaries cannot establish that a missing runner-up is an only
    // legal move, or search beyond several immediate mates. Fresh evidence is
    // required for either case; absence is not an ambiguity verdict.
    if (ply.secondCp === null || (ply.bestMate === 1 && ply.secondMate === 1)) return unknown;
    const verdict = classifyXiangqiSolverMoveUniqueness(
      { scoreCp: ply.bestCp, mate: ply.bestMate },
      ply.secondCp === null ? undefined : { scoreCp: ply.secondCp, mate: ply.secondMate },
      GATE_OPTIONS,
    );
    if (!verdict.unique)
      failures.push({
        ply: ply.solutionPly,
        reason: verdict.reason,
        bestMate: ply.bestMate,
        bestCp: ply.bestCp,
        secondMate: ply.secondMate,
        secondCp: ply.secondCp,
      });
  }
  return { status: failures.length ? 'flagged' : 'not-flagged-by-stored-evidence', failures };
}

export async function exportSnapshot(path) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '20s'");
    const { rows } = await client.query(`SELECT p.id, p.data AS puzzle, p.source_kind,
      p.mining_candidate_id AS candidate_id, c.run_id,
      (c.puzzle_data::jsonb->'solution' = p.data::jsonb->'solution'
       AND c.puzzle_data::jsonb->'initial'->'board' = p.data::jsonb->'initial'->'board'
       AND c.puzzle_data::jsonb#>>'{initial,status,turn}' = p.data::jsonb#>>'{initial,status,turn}') AS audit_matches_puzzle,
      j.id::text AS audit_id, j.profile_version, j.verdict AS audit_verdict,
      j.evidence, j.created_at AS audited_at,
      j.engine_profile#>>'{binary,sha256}' AS binary_sha256,
      j.engine_profile#>>'{network,sha256}' AS network_sha256
      FROM puzzles p
      LEFT JOIN xiangqi_puzzle_mining_candidates c ON c.id=p.mining_candidate_id
      LEFT JOIN LATERAL (
        SELECT id, profile_version, verdict, evidence, created_at, engine_profile
        FROM xiangqi_puzzle_mining_judgments WHERE candidate_id=c.id AND stage='audit'
        ORDER BY created_at DESC,id DESC LIMIT 1
      ) j ON true
      WHERE p.variant='xiangqi' AND p.hidden_reason IS NULL ORDER BY p.seq,p.id`);
    await client.query('COMMIT');
    writeFileSync(path, JSON.stringify({ exportedAt: new Date().toISOString(), rows }));
    return { served: rows.length, path };
  } finally {
    await client.end();
  }
}

export async function recheckPuzzle(puzzle, analyze) {
  const validation = validateStandardXiangqiPuzzle(puzzle);
  if (!validation.ok) return { verdict: 'needs-reanalysis', reason: 'invalid-puzzle', plies: [] };
  if (!xiangqiPuzzleHasStartingChoice(puzzle.initial))
    return { verdict: 'confirmed-gate-failure', reason: 'no-choice-at-root', plies: [] };
  const plies = [];
  let state = puzzle.initial;
  for (const [ply, move] of puzzle.solution.entries()) {
    if (ply % 2 === 0) {
      const result = await analyze(state);
      plies.push({
        ply,
        unique: result.unique,
        reason: result.reason,
        best: result.best,
        second: result.second,
        lines: result.lines,
      });
      if (!result.unique) return { verdict: 'confirmed-gate-failure', plies };
      const token = `${move.from[0]}${Number(move.from.slice(1)) - 1}${move.to[0]}${Number(move.to.slice(1)) - 1}`;
      const equivalentImmediateWin =
        result.best?.mate === 1 &&
        xiangqiSolverMoveCoverage(state).immediateWins.some(
          (win) => win.from === move.from && win.to === move.to,
        );
      if (result.lines[0]?.pvUci[0] !== token && !equivalentImmediateWin)
        return { verdict: 'engine-disagrees', plies };
    }
    state = applyStandardXiangqiMove(state, move);
  }
  return { verdict: 'passes-current-search', plies };
}

export function checkpointKey(result) {
  return `${result.id}:${result.profileHash}:${result.puzzleHash}`;
}

async function recheck(rows, directory, options) {
  const binary = resolve(options.binary ?? '');
  const net = resolve(options.net ?? '');
  for (const [path, expected, label] of [
    [binary, options['binary-sha256'], 'binary'],
    [net, options['net-sha256'], 'net'],
  ]) {
    if (!expected || sha(readFileSync(path)) !== expected)
      throw new Error(`${label} requires its matching --${label}-sha256 pin`);
  }
  if (options['net-sha256'] !== XIANGQI_SOLVER_SCORE_PROFILE.networkSha256)
    throw new Error('Mining score profile requires the pinned CC0 network');
  const { PikafishEngine, analyzeXiangqiSolverPly } = await import(
    './variant-lab/xiangqi-pikafish-uci.ts'
  );
  const profile = {
    ...XIANGQI_PUZZLE_ADMISSION_PROFILE,
    gateVersion: XIANGQI_SOLVER_GATE_VERSION,
    scoreProfileId: XIANGQI_SOLVER_SCORE_PROFILE.id,
    binarySha256: options['binary-sha256'],
    networkSha256: options['net-sha256'],
    threads: 1,
    hashMb: 16,
    multiPv: 2,
    depth: 22,
    nodes: null,
    clearHash: true,
    ...GATE_OPTIONS,
  };
  const profileHash = sha(JSON.stringify(profile));
  const path = join(directory, 'fresh.jsonl');
  const previous = readCheckpoints(path);
  const done = new Set(previous.map(checkpointKey));
  let engine = new PikafishEngine(binary, net);
  try {
    await engine.init();
    for (const row of rows) {
      const puzzleHash = sha(JSON.stringify(row.puzzle));
      if (done.has(checkpointKey({ id: row.id, profileHash, puzzleHash }))) continue;
      const started = Date.now();
      let result;
      try {
        result = await recheckPuzzle(row.puzzle, (state) =>
          analyzeXiangqiSolverPly(engine, state, { depth: 22 }, GATE_OPTIONS),
        );
      } catch {
        result = { verdict: 'needs-reanalysis', reason: 'engine-search-failed', plies: [] };
        engine.kill();
        engine = new PikafishEngine(binary, net);
        await engine.init();
      }
      appendFileSync(
        path,
        `${JSON.stringify({ id: row.id, profileHash, profile, puzzleHash, ...result, elapsedMs: Date.now() - started })}\n`,
      );
    }
  } finally {
    engine.quit();
  }
}

export function readCheckpoints(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function buildReport(snapshot, fresh = []) {
  if (new Set(fresh.map((result) => result.profileHash)).size > 1) {
    throw new Error('A corpus report requires one fixed search profile');
  }
  const entries = snapshot.rows.map((row) => {
    const stored = assessStoredAudit(row);
    const puzzleHash = sha(JSON.stringify(row.puzzle));
    const current =
      fresh
        .filter(
          (result) =>
            result.id === row.id &&
            result.puzzleHash === puzzleHash &&
            result.profile?.gateVersion === XIANGQI_SOLVER_GATE_VERSION,
        )
        .at(-1) ?? null;
    return {
      id: row.id,
      code: puzzleShortCode(row.id),
      auditId: row.audit_id,
      auditProfile: row.profile_version,
      goal: row.puzzle.goal.type,
      solutionPlies: row.puzzle.solution.length,
      stored,
      fresh: current,
    };
  });
  const count = (select) =>
    Object.fromEntries(
      [...new Set(entries.map(select))].map((key) => [
        key,
        entries.filter((row) => select(row) === key).length,
      ]),
    );
  return {
    ...XIANGQI_PUZZLE_ADMISSION_PROFILE,
    gateVersion: XIANGQI_SOLVER_GATE_VERSION,
    scoreProfileId: XIANGQI_SOLVER_SCORE_PROFILE.id,
    gateOptions: GATE_OPTIONS,
    exportedAt: snapshot.exportedAt,
    total: entries.length,
    storedCounts: count((row) => row.stored.status),
    freshCounts: count((row) => row.fresh?.verdict ?? 'not-rechecked'),
    entries,
  };
}

export function reportHtml(report) {
  const rows = report.entries.filter(
    (row) => row.stored.status !== 'not-flagged-by-stored-evidence',
  );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Puzzle winning-answer audit</title><style>body{font:16px system-ui;max-width:1100px;margin:24px auto;padding:16px;color:#222}table{border-collapse:collapse;width:100%}td,th{padding:9px;text-align:left;border-bottom:1px solid #ddd}code{overflow-wrap:anywhere}summary{cursor:pointer}a{color:#16755f}td{vertical-align:top}</style><h1>Puzzle winning-answer audit</h1><p>Read-only evidence from ${esc(report.exportedAt)}. Policy: ${esc(report.gateVersion)}. No serving state, attempts or ratings changed.</p><p>Stored evidence: ${esc(JSON.stringify(report.storedCounts))}. Fresh search: ${esc(JSON.stringify(report.freshCounts))}.</p><p>Fresh checks use one pinned native engine, one thread, 16 MB hash, cleared hash before each solver position, MultiPV 2 and depth 22. A confirmed gate failure means this fixed search found evidence against admitting the stored single line. Other search configurations can differ. Later-ply failures may support a shorter puzzle; root failures support withholding candidates. None are applied automatically.</p><p><a href="report.json">Full evidence and exact IDs</a></p><table><thead><tr><th>Puzzle</th><th>Stored failures (solution ply)</th><th>Fresh result</th></tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr><td><a href="https://mistboard.com/puzzles/${row.code}">#${row.code}</a><br>${esc(row.goal)}<details><summary>ID and audit</summary><code>${esc(row.id)}</code><p>Audit ${esc(row.auditId)}, ${esc(row.auditProfile)}</p></details></td><td>${row.stored.failures.map((ply) => `${ply.ply}: ${esc(ply.reason)} (best ${esc(ply.bestMate === null ? ply.bestCp : `mate ${ply.bestMate}`)}, second ${esc(ply.secondMate === null ? ply.secondCp : `mate ${ply.secondMate}`)})`).join('<br>') || esc(row.stored.status)}</td><td>${esc(row.fresh?.verdict ?? 'not rechecked')}<br>${
          row.fresh?.plies
            .filter((ply) => !ply.unique)
            .map((ply) => `${ply.ply}: ${esc(ply.reason)}`)
            .join('<br>') ?? ''
        }</td></tr>`,
    )
    .join('')}</tbody></table></html>`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      export: { type: 'string' },
      snapshot: { type: 'string' },
      out: { type: 'string' },
      recheck: { type: 'boolean', default: false },
      binary: { type: 'string' },
      net: { type: 'string' },
      'binary-sha256': { type: 'string' },
      'net-sha256': { type: 'string' },
    },
  });
  if (values.export) {
    console.log(JSON.stringify(await exportSnapshot(resolve(values.export))));
    return;
  }
  if (!values.snapshot || !values.out)
    throw new Error('--snapshot PATH and --out DIRECTORY are required');
  const bytes = readFileSync(values.snapshot, 'utf8');
  const snapshot = JSON.parse(bytes);
  if (!Array.isArray(snapshot.rows)) throw new Error('snapshot must have rows');
  const directory = resolve(values.out);
  mkdirSync(directory, { recursive: true });
  if (values.recheck)
    await recheck(
      snapshot.rows.filter(
        (row) => assessStoredAudit(row).status !== 'not-flagged-by-stored-evidence',
      ),
      directory,
      values,
    );
  const report = {
    ...buildReport(snapshot, readCheckpoints(join(directory, 'fresh.jsonl'))),
    snapshotSha256: sha(bytes),
  };
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(directory, 'report.html'), reportHtml(report));
  console.log(
    JSON.stringify({
      total: report.total,
      stored: report.storedCounts,
      fresh: report.freshCounts,
      report: join(directory, 'report.html'),
    }),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Puzzle audit failed (${error.code ?? error.name}). No database writes were attempted.`,
    );
    process.exitCode = 1;
  });
}
