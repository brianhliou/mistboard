// Run from the repository root: node --import tsx scripts/banqi-luck-bench/bench.mjs before
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import {
  ALL_BANQI_SQUARES,
  applyBanqiMove,
  createBanqiStateFromSetup,
  LEGACY_BANQI_RULES,
  parseBanqiFen,
} from '@mistboard/game';
import * as currentAnalysis from '../../apps/server/src/banqi-analysis.ts';
import {
  analysisAsset,
  BanqiAnalysisQueryCache,
} from '../../apps/server/src/banqi-analysis-query-cache.ts';
import {
  closeBanqiAnalysisQueries,
  openBanqiAnalysisQueries,
} from '../../apps/server/src/banqi-analysis-runner.ts';
import { banqiEngineAvailable, evaluateBanqiFenNodes } from '../../apps/server/src/banqi-engine.ts';
import { aggregateEnginePoolStats } from '../../apps/server/src/uci-engine-harness.ts';

export async function fixtures() {
  const bytes = await readFile(new URL('../data/banqi-study.json', import.meta.url));
  const corpusSha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(
    corpusSha256,
    'c320045b8d625cca375ec2ed5a3f86ba28517036ae46761084d2e390e59a814e',
    'benchmark corpus changed',
  );
  const corpus = JSON.parse(bytes);
  return [0, 3, 18].map((index) => {
    const game = corpus.games[index];
    const parsed = parseBanqiFen(game.rootFen);
    assert.ok(parsed.ok);
    const setup = {
      deal: ALL_BANQI_SQUARES.map((sq) => {
        const { color, role } = parsed.state.board[sq];
        return { color, role };
      }),
      ...LEGACY_BANQI_RULES,
    };
    const moves = game.moves.map((m) => ({ from: m.slice(0, 2), to: m.slice(2) }));
    let state = createBanqiStateFromSetup('bench', setup);
    const flips = [];
    for (const [i, move] of moves.entries()) {
      const post = applyBanqiMove(state, move);
      assert.equal(post.ply, state.ply + 1, `${game.name}: illegal ply ${i + 1}`);
      if (move.from === move.to) flips.push(i + 1);
      state = post;
    }
    assert.equal(state.status.type, 'finished', `${game.name}: unfinished fixture`);
    return {
      name: game.name,
      index,
      seed: game.seed,
      setup,
      moves,
      flips,
      finalStatus: state.status,
      corpusSha256,
    };
  });
}

export async function machine() {
  return {
    cpu: cpus()[0].model,
    logicalCpus: cpus().length,
    platform: platform(),
    release: release(),
    node: process.version,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    engineSha256: (await analysisAsset(process.env.MISTBOARD_BANQI_ENGINE_PATH, true)).sha256,
    netSha256: (await analysisAsset(process.env.MISTBOARD_BANQI_NET)).sha256,
  };
}

export function evalDeps(setup) {
  return {
    evalPosition: async (fen, window, search) =>
      evaluateBanqiFenNodes(window?.fen ?? fen, {
        nodes: search.nodes,
        movetimeCapMs: 30_000,
        moves: window?.moves,
        searchMoves: search.searchMoves,
        noProgressLimit: setup.noProgressLimit,
      }),
  };
}

export async function baselineAnalysis(ref) {
  // Freeze the original module while sharing the same engine, cache and harness.
  const source = execFileSync('git', ['show', `${ref}:apps/server/src/banqi-analysis.ts`], {
    encoding: 'utf8',
  });
  const dir = await mkdtemp(new URL('./.baseline-', import.meta.url));
  try {
    const path = `${dir}/analysis.ts`;
    const rewritten = source.replace(
      /from '(\.\/[^']+)\.js'/g,
      (_all, relative) =>
        `from '${new URL(`../../apps/server/src/${relative}.ts`, import.meta.url).href}'`,
    );
    await writeFile(path, rewritten);
    return await import(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const label = process.argv[2];
  assert.ok(
    ['before', 'after', 'pass2-20k', 'pass2-50k', 'pass2-100k', 'pass2-200k'].includes(label),
    'expected before, after, or pass2-{20,50,100,200}k',
  );
  const rankingNodes = label.startsWith('pass2-') ? Number(label.slice(6, -1)) * 1000 : null;
  assert.ok(banqiEngineAvailable('misty-banqi-level-8'), 'Level 8 unavailable');
  const baselineRef = process.argv[3] ?? (label === 'before' ? 'a90cc8a20' : null);
  const analysis = baselineRef ? await baselineAnalysis(baselineRef) : currentAnalysis;
  const report = {
    label,
    startedAt: new Date().toISOString(),
    machine: await machine(),
    engineId: rankingNodes
      ? analysis.BANQI_DECISIONS_ENGINE_ID.replace(/\+rank\d+/, `+rank${rankingNodes}`)
      : analysis.BANQI_DECISIONS_ENGINE_ID,
    ...(rankingNodes ? { rankingNodes } : {}),
    implementationSha256: createHash('sha256')
      .update(
        baselineRef
          ? execFileSync('git', ['show', `${baselineRef}:apps/server/src/banqi-analysis.ts`])
          : await readFile(new URL('../../apps/server/src/banqi-analysis.ts', import.meta.url)),
      )
      .digest('hex'),
    ...(baselineRef ? { baselineRef } : {}),
    method:
      'Full finished games; cold exact-query cache per game, normal reuse within game; two analysis slots.',
    games: [],
  };
  const output = new URL(`./${label}.json`, import.meta.url);
  const save = () => writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  const original = BanqiAnalysisQueryCache.prototype.evaluate;
  let searches = 0,
    requestedNodes = 0,
    reportedNodes = 0,
    missingNodes = 0,
    capHits = 0;
  BanqiAnalysisQueryCache.prototype.evaluate = function (query, run) {
    return original.call(this, query, async () => {
      searches++;
      requestedNodes += query.nodes;
      const result = await run();
      reportedNodes += result.nodes ?? 0;
      if (result.nodes == null) missingNodes++;
      if (result.timeMs >= query.movetimeCapMs) capHits++;
      return result;
    });
  };
  try {
    for (const fixture of await fixtures()) {
      closeBanqiAnalysisQueries();
      openBanqiAnalysisQueries();
      searches = requestedNodes = reportedNodes = missingNodes = capHits = 0;
      const game = {
        name: fixture.name,
        seed: fixture.seed,
        corpusIndex: fixture.index,
        corpusSha256: fixture.corpusSha256,
        plies: fixture.moves.length,
        flips: fixture.flips,
        finalStatus: fixture.finalStatus,
        decisions: [],
      };
      report.games.push(game);
      let calls = 0,
        logicalNodes = 0;
      let rankingPhase = false,
        rankCalls = 0,
        baselineCalls = 0,
        rankWallMs = 0;
      const base = evalDeps(fixture.setup);
      const deps = {
        evalPosition: async (...args) => {
          calls++;
          if (rankingPhase) rankCalls++;
          else baselineCalls++;
          if (rankingPhase && rankingNodes) {
            args[2] = { ...args[2], nodes: rankingNodes };
          }
          logicalNodes += args[2].nodes;
          return base.evalPosition(...args);
        },
      };
      let ranking;
      if (analysis.rankBanqiDecisionMoves) {
        deps.rankMoves = async (...args) => {
          rankingPhase = true;
          const started = performance.now();
          try {
            const table = await analysis.rankBanqiDecisionMoves(...args);
            ranking = table.slice(0, 3).map((row) => row.move);
            return table;
          } finally {
            rankingPhase = false;
            rankWallMs += performance.now() - started;
          }
        };
      }
      const start = performance.now();
      let previous = start,
        previousCalls = 0,
        previousSearches = 0,
        previousNodes = 0;
      await analysis.analyzeBanqiDecisions(fixture.moves, fixture.setup, deps, {
        load: async () => null,
        save: async ({ items }) => {
          const now = performance.now();
          const decision = items.at(-1);
          game.decisions.push({
            ...decision,
            decisionLoss: decision.bestWin - decision.playedWin,
            luck: decision.realizedWin - decision.playedWin,
            wallMs: now - previous,
            evalCalls: calls - previousCalls,
            searches: searches - previousSearches,
            requestedNodes: requestedNodes - previousNodes,
            ...(ranking ? { rankedTopThree: ranking } : {}),
          });
          previous = now;
          previousCalls = calls;
          previousSearches = searches;
          previousNodes = requestedNodes;
          game.wallMs = now - start;
          game.evalCalls = calls;
          if (ranking) {
            game.rankEvalCalls = rankCalls;
            game.baselineEvalCalls = baselineCalls;
            game.rankWallMs = rankWallMs;
          }
          game.logicalRequestedNodes = logicalNodes;
          game.searches = searches;
          game.requestedNodes = requestedNodes;
          game.reportedNodes = reportedNodes;
          game.missingNodeReports = missingNodes;
          game.capHits = capHits;
          await save();
          console.log(
            `${label}: ${game.name}, flip ${items.length}/32, ply ${decision.ply}: ${((now - start) / 1000).toFixed(1)}s`,
          );
        },
      });
      game.wallMs = performance.now() - start;
      game.meanFlipMs = game.wallMs / game.decisions.length;
      game.poolStats = aggregateEnginePoolStats();
      game.complete = true;
      await save();
    }
    const finalMachine = await machine();
    assert.equal(
      finalMachine.engineSha256,
      report.machine.engineSha256,
      'engine changed during run',
    );
    assert.equal(finalMachine.netSha256, report.machine.netSha256, 'net changed during run');
    report.finishedAt = new Date().toISOString();
    await save();
  } finally {
    BanqiAnalysisQueryCache.prototype.evaluate = original;
    closeBanqiAnalysisQueries();
  }
}
if (process.argv[1]?.endsWith('/bench.mjs')) await main();
