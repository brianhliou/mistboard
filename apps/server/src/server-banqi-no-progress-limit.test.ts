/**
 * Banqi PvE and the no-progress draw limit: the bot is told the limit its game is
 * played under. A room created from 2026-10-17 draws at 60 plies without a capture
 * or flip; an older room at 40. MistyBanqi defaults to 40, so a 60-ply game that
 * sent nothing would have its bot score plies 40-60 as already drawn.
 */

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  type BanqiStoredSetup,
  createBanqiSetup,
  createBanqiStateFromSetup,
  getBanqiLegalMoves,
  STANDARD_BANQI_DEAL,
} from '@mistboard/game';
import {
  banqiEngineSearch,
  buildBanqiOptionCommands,
  evaluateBanqiFenNodes,
} from './banqi-engine.js';
import { banqiMoveToEngineUci, banqiStateToEngineFen } from './banqi-fen.js';
import { type BanqiEngineMoveProvider, playBanqiEngineMoveIfReady } from './server-banqi-engine.js';

const ENGINE_ID = 'misty-banqi';

/** The limit the live driver hands the engine for a room created from `setup`. */
async function limitSentFor(setup: BanqiStoredSetup): Promise<number | undefined> {
  const state = createBanqiStateFromSetup('banqi_limit', setup);
  const room = {
    id: 'banqi_limit',
    events: [],
    projection: { state, seats: { red: ENGINE_ID, black: 'human-client' }, clock: null },
  };
  const ctx = {
    appendEvent: async () => 1,
    broadcastEventAppended: () => {},
  };
  const seen: Array<number | undefined> = [];
  const first = banqiMoveToEngineUci(getBanqiLegalMoves(state)[0]!);
  const provider: BanqiEngineMoveProvider = async (_id, _fen, opts) => {
    seen.push(opts.noProgressLimit);
    return { best: first, cp: 0, mate: null, depth: 1, nodes: 1, timeMs: 1, pv: [first] };
  };
  await playBanqiEngineMoveIfReady(ctx as never, room as never, provider);
  assert.equal(seen.length, 1, 'the engine was asked once');
  return seen[0];
}

test('a new banqi room sends the 60-ply limit to the bot', async () => {
  assert.equal(await limitSentFor(createBanqiSetup(() => 0.5)), 60);
});

test('a room created before 2026-10-17 sends the 40-ply limit to the bot', async () => {
  // Pre-chase-rule rooms stored a bare deal; rooms between the chase rule and the
  // 60-ply limit stored { deal, chaseRule } with no limit. Both played to 40.
  assert.equal(await limitSentFor([...STANDARD_BANQI_DEAL]), 40);
  const betweenRules = { deal: [...STANDARD_BANQI_DEAL], chaseRule: 'repetition' };
  assert.equal(await limitSentFor(betweenRules as unknown as BanqiStoredSetup), 40);
});

test('the option line is the UCI setoption MistyBanqi 0.2.7 reads', () => {
  assert.deepEqual(buildBanqiOptionCommands(60, '0.2.7'), [
    'setoption name NoProgressLimit value 60',
  ]);
  assert.deepEqual(buildBanqiOptionCommands(40, '0.2.7'), [
    'setoption name NoProgressLimit value 40',
  ]);
  assert.deepEqual(buildBanqiOptionCommands(undefined, '0.3.0'), [
    'setoption name NoProgressLimit value 60',
  ]);
});

test('an engine older than 0.2.7 gets no option line (the harness would refuse the search)', () => {
  // validateConfiguredUciOptions throws on a setoption the engine does not advertise,
  // so sending it to 0.2.6 would fail every bot move; it plays to its built-in 40.
  assert.deepEqual(buildBanqiOptionCommands(60, '0.2.6'), []);
  assert.deepEqual(buildBanqiOptionCommands(60, '0.1.9'), []);
});

// A stand-in engine that logs every line it is sent, so the test reads the real
// command sequence the move and eval paths write to the process.
function withFakeEngine(run: (log: () => string[]) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'banqi-limit-'));
    const logPath = join(dir, 'stdin.log');
    const bin = join(dir, 'fake-banqi-engine');
    writeFileSync(
      bin,
      [
        '#!/bin/sh',
        'while IFS= read -r line; do',
        `  printf '%s\\n' "$line" >> '${logPath}'`,
        '  case "$line" in',
        '    uci) echo "id name MistyBanqi fake"; echo "option name NoProgressLimit type spin default 40 min 1 max 1000"; echo uciok ;;',
        '    isready) echo readyok ;;',
        '    go*) echo "info depth 1 score cp 0 nodes 1"; echo "bestmove a0a0" ;;',
        '  esac',
        'done',
        '',
      ].join('\n'),
    );
    chmodSync(bin, 0o755);
    const previous = process.env.MISTBOARD_BANQI_ENGINE_PATH;
    process.env.MISTBOARD_BANQI_ENGINE_PATH = bin;
    try {
      await run(() => readFileSync(logPath, 'utf8').trim().split('\n'));
    } finally {
      if (previous === undefined) delete process.env.MISTBOARD_BANQI_ENGINE_PATH;
      else process.env.MISTBOARD_BANQI_ENGINE_PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const FEN = banqiStateToEngineFen(
  createBanqiStateFromSetup(
    'banqi_limit',
    createBanqiSetup(() => 0.5),
  ),
);

test(
  'the move search sends the limit right after uci, before the position',
  withFakeEngine(async (log) => {
    const result = await banqiEngineSearch(FEN, {
      nodes: 10,
      movetimeCapMs: 200,
      noProgressLimit: 60,
    });
    assert.equal(result.best, 'a0a0');
    // Under the pinned engine version: the option line (from 0.2.7), then the game.
    const options = buildBanqiOptionCommands(60);
    assert.deepEqual(log().slice(0, options.length + 2), ['uci', ...options, 'ucinewgame']);
  }),
);

test(
  'the analysis eval sends the game limit too',
  withFakeEngine(async (log) => {
    await evaluateBanqiFenNodes(FEN, { nodes: 10, movetimeCapMs: 200, noProgressLimit: 40 });
    const options = buildBanqiOptionCommands(40);
    assert.deepEqual(log().slice(0, options.length + 2), ['uci', ...options, 'ucinewgame']);
  }),
);
