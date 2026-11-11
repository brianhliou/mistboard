#!/usr/bin/env node
// node scripts/import-gomoku-mined-openings.mjs <mined.json> [pool.json]
// Only accepted positions and screening provenance leave the private input.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { positionKey } from './screen-gomoku-openings.mjs';

const SOURCE = 'mined-2B3W-7x7';
const LIMITS = Object.freeze({
  nodes: 1_000_000,
  maxAbsScore: 40,
  minWinrate: 0.48,
  maxWinrate: 0.52,
});
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function importMinedOpenings(pool, mined) {
  // Filter counts are independent: a row can fail more than one bound.
  // Symmetry duplicates are counted only after passing every telemetry bound.
  const rejectedByFilter = {
    missingDeep: 0,
    invalidTelemetry: 0,
    winrate: 0,
    score: 0,
    finalScore: 0,
    forcedWin: 0,
    nodes: 0,
    duplicateExisting: 0,
    duplicateMined: 0,
  };
  const accepted = [];
  for (const { candidate, deep } of mined.rows) {
    if (!deep) {
      rejectedByFilter.missingDeep++;
      continue;
    }
    const { score, winrate, finalScore, nodes, depth, forcedWin } = deep;
    const failures = {
      invalidTelemetry:
        ![score, winrate, finalScore, nodes, depth].every(Number.isFinite) || depth <= 0,
      winrate: winrate < LIMITS.minWinrate || winrate > LIMITS.maxWinrate,
      score: Math.abs(score) > LIMITS.maxAbsScore,
      finalScore: Math.abs(finalScore) > LIMITS.maxAbsScore,
      forcedWin: forcedWin !== false,
      nodes: nodes < LIMITS.nodes,
    };
    for (const [filter, failed] of Object.entries(failures)) if (failed) rejectedByFilter[filter]++;
    if (Object.values(failures).some(Boolean)) continue;
    accepted.push({
      key: positionKey(candidate),
      // A deterministic tie-break also selects the same representative if
      // equivalent input rows arrive in a different order.
      tie: JSON.stringify({ candidate, deep }),
      candidate,
      screening: { score, winrate, finalScore, nodes, depth, forcedWin },
    });
  }
  accepted.sort((a, b) => compare(a.key, b.key) || compare(a.tie, b.tie));
  const existing = new Set(pool.openings.map(positionKey));
  const seen = new Set();
  const openings = [...pool.openings];
  let nextId = Math.max(0, ...openings.map((entry) => Number(entry.id.replace(/^gmk-/, ''))));
  for (const { key, candidate, screening } of accepted) {
    if (existing.has(key)) {
      rejectedByFilter.duplicateExisting++;
      continue;
    }
    if (seen.has(key)) {
      rejectedByFilter.duplicateMined++;
      continue;
    }
    seen.add(key);
    openings.push({
      id: `gmk-${String(++nextId).padStart(3, '0')}`,
      source: SOURCE,
      stones: candidate.stones,
      turn: candidate.turn,
      screening,
    });
  }
  const { sources = {}, ...classicScreening } = pool.screening;
  const engine = mined.engine ?? mined.pin ?? {};
  const commits = {};
  for (const field of ['engineCommit', 'networksCommit', 'dataSha256']) {
    const value = mined[field] ?? engine[field];
    if (value !== undefined) commits[field] = value;
  }
  const imported = openings.length - pool.openings.length;
  return {
    pool: {
      ...pool,
      screening: {
        ...pool.screening,
        accepted: openings.length,
        sources: {
          ...sources,
          classic: sources.classic ?? classicScreening,
          [SOURCE]: {
            config: mined.config,
            band: mined.band,
            ...LIMITS,
            ...commits,
            screened: mined.rows.length,
            deepScreened: mined.rows.filter((row) => row.deep).length,
            accepted: openings.filter((entry) => entry.source === SOURCE).length,
          },
        },
      },
      openings,
    },
    report: {
      rows: mined.rows.length,
      imported,
      rejected: mined.rows.length - imported,
      rejectedByFilter,
      total: openings.length,
    },
  };
}

function main() {
  const [
    input,
    output = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../packages/game/src/gomoku-openings.json',
    ),
  ] = process.argv.slice(2);
  if (!input) throw new Error('Usage: import-gomoku-mined-openings.mjs <mined.json> [pool.json]');
  const mined = JSON.parse(readFileSync(input, 'utf8'));
  const pool = JSON.parse(readFileSync(output, 'utf8'));
  const result = importMinedOpenings(pool, mined);
  writeFileSync(output, `${JSON.stringify(result.pool, null, 2)}\n`);
  console.log(JSON.stringify(result.report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
