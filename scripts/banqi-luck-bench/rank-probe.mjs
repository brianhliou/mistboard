// Probe a larger ranking budget before paying for another full baseline run.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { applyBanqiMove, createBanqiStateFromSetup } from '@mistboard/game';
import {
  banqiAnalysisRepetitionWindow,
  rankBanqiDecisionMoves,
} from '../../apps/server/src/banqi-analysis.ts';
import {
  closeBanqiAnalysisQueries,
  openBanqiAnalysisQueries,
} from '../../apps/server/src/banqi-analysis-runner.ts';
import { evalDeps, fixtures, machine } from './bench.mjs';

const nodes = Number(process.argv[2] ?? 200_000);
assert.equal(nodes, 200_000, 'this probe measures the 200k follow-up');
const before = JSON.parse(await readFile(new URL('./before.json', import.meta.url)));
const report = {
  method:
    'Ranking only; no decision grades or baseline times. Cold query cache per game; two slots.',
  nodes,
  machine: await machine(),
  startedAt: new Date().toISOString(),
  games: [],
};
assert.equal(report.machine.engineSha256, before.machine.engineSha256);
assert.equal(report.machine.netSha256, before.machine.netSha256);
const save = () =>
  writeFile(
    new URL('./ranking-probe-200k.json', import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
  );
try {
  for (const [index, fixture] of (await fixtures()).entries()) {
    closeBanqiAnalysisQueries();
    openBanqiAnalysisQueries();
    let state = createBanqiStateFromSetup('rank-probe', fixture.setup);
    const states = [state];
    const base = evalDeps(fixture.setup);
    const game = { name: fixture.name, flips: [], wallMs: 0, evalCalls: 0 };
    report.games.push(game);
    const start = performance.now();
    for (const [i, move] of fixture.moves.entries()) {
      if (move.from === move.to) {
        const old = before.games[index].decisions[game.flips.length];
        assert.equal(old.ply, i + 1);
        const table = await rankBanqiDecisionMoves(
          state,
          state.status.turn,
          (fen, window, search) => {
            game.evalCalls++;
            return base.evalPosition(fen, window, { ...search, nodes });
          },
          banqiAnalysisRepetitionWindow(states, fixture.moves, i),
        );
        const rankedTopThree = table.slice(0, 3).map((row) => row.move);
        const oldBest = old.candidates[0].move;
        game.flips.push({
          ply: i + 1,
          oldBest,
          rankedTopThree,
          retained: rankedTopThree.includes(oldBest),
        });
      }
      state = applyBanqiMove(state, move);
      states.push(state);
    }
    game.wallMs = performance.now() - start;
    await save();
    console.log(
      `${fixture.name}: ${game.flips.filter((f) => f.retained).length}/32 in ${(game.wallMs / 1000).toFixed(1)}s (ranking only)`,
    );
  }
  const flips = report.games.flatMap((game) => game.flips);
  assert.equal(flips.length, 96);
  report.retained = flips.filter((flip) => flip.retained).length;
  report.agreementRate = report.retained / flips.length;
  const finalMachine = await machine();
  assert.equal(finalMachine.engineSha256, report.machine.engineSha256);
  assert.equal(finalMachine.netSha256, report.machine.netSha256);
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ retained: report.retained, agreementRate: report.agreementRate }));
} finally {
  closeBanqiAnalysisQueries();
}
