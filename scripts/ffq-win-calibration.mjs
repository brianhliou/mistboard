// Decided 2026-11-13: fit the level-7 public score scale on local self-play.
// Run with node --import tsx scripts/ffq-win-calibration.mjs [games=300].
import { readFileSync, writeFileSync } from 'node:fs';
import { ffqBanqiLiveEngineMove, ffqBanqiMoveToUci } from '../apps/server/src/ffq-banqi-engine.ts';
import { ffqBanqiEveAdapter } from '../apps/server/src/ffq-banqi-eve-adapter.ts';
import { ffqBanqiTenant } from '../apps/server/src/ffq-banqi-tenant.ts';
import { ffqBanqiTierRequestFor } from '../apps/server/src/server-ffq-banqi-engine.ts';
import { playVariantEngineGame } from '../apps/server/src/variant-eve.ts';
import { replayTenantEvents } from '../apps/server/src/variant-tenant/runtime.ts';

const path = 'docs/ffq-win-calibration-2026-11-13.json';
let games;
try {
  games = JSON.parse(readFileSync(path, 'utf8')).games;
} catch {
  games = [];
}
const tier = 'misty-ffq-banqi-level-7';
const target = Number(process.argv[2] ?? 300);
function fit() {
  const samples = games.flatMap((g) =>
    g.scores.map((cp) => ({ cp, y: g.result, w: 1 / g.scores.length })),
  );
  let lo = 0,
    hi = 0.1;
  for (let i = 0; i < 80; i++) {
    const k = (lo + hi) / 2;
    const derivative = samples.reduce(
      (s, p) => s + p.w * p.cp * (1 / (1 + Math.exp(-k * p.cp)) - p.y),
      0,
    );
    if (derivative > 0) hi = k;
    else lo = k;
  }
  return {
    k: (lo + hi) / 2,
    positions: samples.length,
    method:
      'Zero-intercept logistic cross-entropy, draws=0.5, equal total weight per completed game; bisection on derivative; public Red-POV cp at plies 8,16,...,120, |cp|<=1000, no mates; truncated games excluded',
  };
}
for (let n = games.length; n < target; n++) {
  const scores = [];
  const result = await playVariantEngineGame(ffqBanqiEveAdapter, {
    firstEngineId: tier,
    secondEngineId: tier,
    roomId: `ffq-calibration-${n}`,
    seed: String(1092000 + n),
    startedAt: 0,
    maxPlies: 600,
    moveProvider: async (request) => {
      const state = replayTenantEvents(ffqBanqiTenant, request.events).state;
      const response = await ffqBanqiLiveEngineMove(ffqBanqiTierRequestFor(state, tier, 3000));
      if (
        state.ply >= 8 &&
        state.ply <= 120 &&
        state.ply % 8 === 0 &&
        response.cp != null &&
        response.mate == null &&
        Math.abs(response.cp) <= 1000
      )
        scores.push(response.cp * (request.color === 'red' ? 1 : -1));
      return ffqBanqiMoveToUci(response.move);
    },
  });
  if (result.status !== 'completed' || result.termination === 'truncated')
    throw new Error(`Incomplete calibration game ${n}: ${result.termination}`);
  games.push({
    seed: String(1092000 + n),
    result: result.result === 'red-wins' ? 1 : result.result === 'black-wins' ? 0 : 0.5,
    plies: result.plyCount,
    scores,
  });
  writeFileSync(
    path,
    `${JSON.stringify({ date: '2026-11-13', engine: 'MistyFFQ 0.1.0', nodes: 25000, games, fit: fit() }, null, 2)}\n`,
  );
  if ((n + 1) % 10 === 0) console.log(JSON.stringify({ games: n + 1, ...fit() }));
}
