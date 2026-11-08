#!/usr/bin/env node
// Serial, offline Rapfi self-play and a recorded Black-POV analysis sweep.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { loadRapfi, playGame, seededRandom } from './gomoku-level-ladder.mjs';

const { RAPFI_LEVELS, rapfiCommands } = await tsImport(
  '../apps/web/src/engine/rapfi.ts',
  import.meta.url,
);
const { GOMOKU_DEALT_OPENINGS, createInitialGomokuState, applyGomokuMove } = await tsImport(
  '../packages/game/src/variants-gomoku.ts',
  import.meta.url,
);
const { parseRapfiOutput } = await tsImport(
  '../packages/game/src/rapfi-candidates.ts',
  import.meta.url,
);

const positionOf = (state) => ({
  turn: state.status.turn === 'white' ? 2 : 1,
  stones: state.board.flatMap((color, i) =>
    color ? [{ x: i % 15, y: Math.floor(i / 15), player: color === 'black' ? 1 : 2 }] : [],
  ),
});
const square = ({ x, y }) => `${String.fromCharCode(97 + x)}${y + 1}`;

async function main() {
  const [output, seedArg = '20261101', gamesArg = '400'] = process.argv.slice(2);
  const seed = Number(seedArg);
  const games = Number(gamesArg);
  if (!output || !Number.isSafeInteger(seed) || !Number.isSafeInteger(games) || games < 1)
    throw new Error('Usage: node scripts/gomoku-analysis-fixture.mjs <output.json> [seed] [games]');
  const random = seededRandom(seed);
  const blackEngine = await loadRapfi();
  const whiteEngine = await loadRapfi();
  const attempts = [];
  try {
    for (let index = 0; index < games; index += 1) {
      // First try strong best-move policies. The measured ladder's lower
      // pair is the fallback for long, contested games, never a no-five filter.
      const levels = index < 40 ? [5, 6] : [3, 4];
      if (index % 2) levels.reverse();
      const opening = GOMOKU_DEALT_OPENINGS[Math.floor(random() * GOMOKU_DEALT_OPENINGS.length)];
      const gameSeed = Math.floor(random() * 0x1_0000_0000);
      await blackEngine.reset();
      await whiteEngine.reset();
      const black = blackEngine.player(RAPFI_LEVELS[levels[0] - 1]);
      const white = whiteEngine.player(RAPFI_LEVELS[levels[1] - 1]);
      const game = await playGame({
        opening,
        black: black.choose,
        white: white.choose,
        seed: gameSeed,
      });
      attempts.push({ levels, seed: gameSeed, plies: game.moves.length });
      console.log(`game ${index + 1}: L${levels.join('/L')} ${game.moves.length} plies`);
      if (game.moves.length < 80) continue;
      // A board-full draw sits at 0 for its second half; a review needs a game decided by a five.
      let end = createInitialGomokuState(opening);
      for (const to of game.moves) end = applyGomokuMove(end, { to });
      if (end.status.type !== 'finished' || end.status.winner === null) continue;

      await blackEngine.reset();
      let state = createInitialGomokuState(opening);
      const plies = [];
      const transcripts = [];
      for (let ply = 0; ply <= game.moves.length; ply += 1) {
        if (state.status.type === 'finished') {
          plies.push({
            ply,
            cp: state.status.winner === null ? 0 : state.status.winner === 'black' ? 30000 : -30000,
            mate: null,
            best: null,
          });
        } else {
          const { lines } = await blackEngine.request(
            {
              type: 'commands',
              commands: rapfiCommands(positionOf(state), {
                nodes: 100_000,
                timeMs: 5000,
                candidateCount: 1,
              }).lines,
            },
            5250,
          );
          transcripts.push({ ply, lines });
          const candidate = parseRapfiOutput(lines)[0];
          const sign = state.status.turn === 'black' ? 1 : -1;
          const forced = candidate?.forcedFive;
          plies.push({
            ply,
            cp: !candidate || forced ? null : sign * candidate.eval,
            mate: forced
              ? sign * (candidate.eval >= 0 ? 1 : -1) * Math.max(1, Math.ceil(forced.plies / 2))
              : null,
            best: candidate ? square(candidate.pv[0]) : null,
            ...(candidate ? { pv: candidate.pv.map(square) } : {}),
          });
        }
        if (ply < game.moves.length) state = applyGomokuMove(state, { to: game.moves[ply] });
      }
      const signs = new Set(plies.map((p) => Math.sign(p.mate ?? p.cp ?? 0)).filter(Boolean));
      if (signs.size < 2) continue;
      const record = {
        _header: {
          purpose: 's-da96 long-game review acceptance',
          command: `node scripts/gomoku-analysis-fixture.mjs ${output} ${seed} ${games}`,
          method:
            'Unmodified ladder policies; first naturally finished 80+ ply game won by a five whose independent 100k-node sweep crosses sides. No placement rejected to prolong play.',
          seed,
          gameSeed,
          levels,
          attempts,
          engine: blackEngine.pin,
          sweep: { nodes: 100000, timeMs: 5000, pov: 'black', transcripts },
        },
        schema_version: '1.1',
        game_id: 'gmk_long_review',
        variant: 'gomoku',
        mode: 'eve',
        rated: false,
        source: {
          name: 'Mistboard offline Rapfi self-play',
          url: 'https://mistboard.com',
          game_url: 'https://mistboard.com/gomoku/game/gmk_long_review',
        },
        time_control: { initial_ms: null, increment_ms: null, label: 'Unlimited' },
        players: { black: { handle: null }, white: { handle: null } },
        started_at: '2026-11-01T00:00:00.000Z',
        ended_at: '2026-11-01T00:00:00.000Z',
        result: state.status.winner ?? 'draw',
        termination: state.status.reason,
        ply_count: game.moves.length,
        license: 'CC BY 4.0',
        opening,
        plies: game.moves.map((uci, i) => ({
          ply: i + 1,
          mover: (i % 2 === 0) === (opening.turn === 'black') ? 'black' : 'white',
          uci,
          san: uci,
          black_clock_ms_after: null,
          white_clock_ms_after: null,
        })),
        analysis: {
          engineId: 'rapfi-gomoku-fixture+1387d11312+wasm+n100000+t5000+pv1',
          depth: 0,
          plies,
        },
      };
      writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
      console.log(`Accepted ${game.moves.length} plies; saved ${output}`);
      return;
    }
    throw new Error(
      `No qualifying game in ${games} attempts; longest ${Math.max(...attempts.map((a) => a.plies))}`,
    );
  } finally {
    await blackEngine.stop();
    await whiteEngine.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
