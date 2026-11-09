import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ALL_BANQI_SQUARES,
  applyBanqiMove,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSetup,
  createBanqiStateFromSetup,
  getBanqiForbiddenChaseMoves,
  getBanqiLegalMoves,
  STANDARD_BANQI_DEAL,
} from '@mistboard/game';
import {
  analyzeBanqiDecisions,
  BANQI_ANALYSIS_ENGINE_ID,
  BANQI_DECISIONS_ENGINE_ID,
  banqiAnalysisRepetitionWindow,
  evaluateBanqiPosition,
} from './banqi-analysis.js';
import { banqiEngineTierFor, evaluateBanqiFenNodes } from './banqi-engine.js';
import { banqiMoveToEngineUci, banqiStateToEngineFen } from './banqi-fen.js';
import { UciEnginePool } from './uci-engine-harness.js';

// Extracted from the finished game's public payload. Never-revealed identities are
// assigned deterministically from the public pool; no player ids or private deal.
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/banqi-review-bq_24e67740.json', import.meta.url), 'utf8'),
) as {
  setup: BanqiSetup;
  moves: BanqiMove[];
  positions: { ply: number; fen: string }[];
};

async function withGradingEngine(
  run: (engine: { net: string; commands: () => string[] }) => Promise<void>,
  options = ['NoProgressLimit', 'EvalFile'],
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'banqi-grading-'));
  const bin = join(dir, 'engine.cjs');
  const log = join(dir, 'commands.txt');
  const net = join(dir, 'net.bqnn');
  writeFileSync(net, 'stub net');
  writeFileSync(log, '');
  writeFileSync(
    bin,
    `#!${process.execPath}
const fs = require('node:fs');
require('node:readline').createInterface({input: process.stdin}).on('line', line => {
  fs.appendFileSync(${JSON.stringify(log)}, line + '\\n');
  if (line === 'uci') {
    for (const name of ${JSON.stringify(options)}) console.log('option name ' + name + ' type string default 0');
    console.log('uciok');
  }
  if (line === 'isready') console.log('readyok');
  if (line.startsWith('go ')) {
    console.log('info depth 12 score cp 123 nodes 2000000 time 10');
    console.log('bestmove a0a0');
  }
});
`,
    { mode: 0o755 },
  );
  const previousBin = process.env.MISTBOARD_BANQI_ENGINE_PATH;
  const previousNet = process.env.MISTBOARD_BANQI_NET;
  process.env.MISTBOARD_BANQI_ENGINE_PATH = bin;
  process.env.MISTBOARD_BANQI_NET = net;
  try {
    await run({ net, commands: () => readFileSync(log, 'utf8').trim().split('\n') });
  } finally {
    if (previousBin === undefined) delete process.env.MISTBOARD_BANQI_ENGINE_PATH;
    else process.env.MISTBOARD_BANQI_ENGINE_PATH = previousBin;
    if (previousNet === undefined) delete process.env.MISTBOARD_BANQI_NET;
    else process.env.MISTBOARD_BANQI_NET = previousNet;
  }
}

test('bq_24e67740 plies 84–92 request L8 NNUE, full budget and public repetition history', async () => {
  let state = createBanqiStateFromSetup('regression', fixture.setup);
  const states = [state];
  for (const move of fixture.moves) {
    const post = applyBanqiMove(state, move);
    assert.equal(post.ply, state.ply + 1, 'every fixture move replays legally');
    states.push(post);
    state = post;
  }
  const tier = banqiEngineTierFor('misty-banqi-level-8')!;
  await withGradingEngine(async (engine) => {
    for (const position of fixture.positions) {
      const current = states[position.ply]!;
      assert.equal(current.status.type, 'playing');
      assert.equal(banqiStateToEngineFen(current), position.fen);
      const window = banqiAnalysisRepetitionWindow(states, fixture.moves, position.ply);
      assert.equal(window.moves.length, current.noProgressClock);
      const start = engine.commands().length;
      const result = await evaluateBanqiPosition(current, window);
      assert.equal(
        result.cp,
        current.status.type === 'playing' && current.status.turn === 'red' ? 123 : -123,
      );
      const commands = engine.commands().slice(start === 1 ? 0 : start);
      assert.ok(commands.includes(`setoption name EvalFile value ${engine.net}`));
      assert.ok(commands.includes('setoption name NoProgressLimit value 60'));
      assert.ok(
        commands.includes(
          `position fen ${window.fen}${window.moves.length ? ` moves ${window.moves.join(' ')}` : ''}`,
        ),
      );
      assert.ok(commands.some((line) => line.startsWith(`go nodes ${tier.nodes} movetime `)));
      const cap = Number(commands.find((line) => line.startsWith('go '))!.split(' ')[4]);
      assert.ok(
        cap > tier.movetimeCapMs,
        'offline grading leaves headroom to finish the node budget',
      );
    }
  });
});

test.todo(
  'bq_24e67740 winning plies must not score -100: separate mistboard-engine first-repeat issue (site #999 scope cut)',
);

test('analysis fails visibly without a net and rejects binaries without EvalFile', async () => {
  await withGradingEngine(async (engine) => {
    for (const path of [undefined, `${engine.net}.missing`]) {
      if (path === undefined) delete process.env.MISTBOARD_BANQI_NET;
      else process.env.MISTBOARD_BANQI_NET = path;
      await assert.rejects(
        evaluateBanqiFenNodes('unused', {
          nodes: 2_000_000,
          movetimeCapMs: 30_000,
          noProgressLimit: 60,
        }),
        /net.*not available/i,
      );
    }
    assert.deepEqual(engine.commands(), [''], 'no classical fallback process starts');
  });
  await withGradingEngine(async () => {
    await assert.rejects(
      evaluateBanqiFenNodes('unused', {
        nodes: 2_000_000,
        movetimeCapMs: 30_000,
        noProgressLimit: 60,
      }),
      /does not advertise.*EvalFile/,
    );
  }, ['NoProgressLimit']);
});

test('analysis rechecks the net after waiting for its dedicated pool slot', async (t) => {
  await withGradingEngine(async (engine) => {
    let admit!: (release: () => void) => void;
    let released = false;
    const acquire = UciEnginePool.prototype.acquire;
    t.mock.method(UciEnginePool.prototype, 'acquire', function (this: UciEnginePool) {
      return this.stats().name === 'banqi-analysis'
        ? new Promise<() => void>((resolve) => {
            admit = resolve;
          })
        : acquire.call(this);
    });
    const pending = evaluateBanqiFenNodes('unused', {
      nodes: 1,
      movetimeCapMs: 200,
      noProgressLimit: 60,
    });
    writeFileSync(engine.net, '');
    admit(() => {
      released = true;
    });
    await assert.rejects(pending, /net.*not available/i);
    assert.equal(released, true);
    assert.deepEqual(engine.commands(), ['']);
  });
});

test('grading excludes a forbidden third chase from root searchmoves', async () => {
  let state: BanqiGameState = {
    id: 'chase',
    board: {
      c3: { color: 'red', role: 'advisor', faceDown: false },
      d2: { color: 'black', role: 'chariot', faceDown: false },
      h1: { color: 'red', role: 'soldier', faceDown: false },
      a4: { color: 'black', role: 'soldier', faceDown: false },
      f4: { color: 'black', role: 'horse', faceDown: true },
    },
    status: { type: 'playing', turn: 'red' },
    ply: 10,
    firstColor: 'red',
    moveNumber: 6,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
  };
  const moves: BanqiMove[] = Array.from(
    { length: 2 },
    () =>
      [
        { from: 'c3', to: 'c2' },
        { from: 'd2', to: 'd3' },
        { from: 'c2', to: 'c3' },
        { from: 'd3', to: 'd2' },
      ] as BanqiMove[],
  ).flat();
  const states = [state];
  for (const move of moves) {
    state = applyBanqiMove(state, move);
    states.push(state);
  }
  assert.ok(getBanqiForbiddenChaseMoves(state).length > 0);
  await withGradingEngine(async (engine) => {
    await evaluateBanqiPosition(state, banqiAnalysisRepetitionWindow(states, moves, moves.length));
    const go = engine.commands().find((line) => line.startsWith('go '))!;
    assert.deepEqual(
      go.split(' searchmoves ')[1]?.split(' '),
      getBanqiLegalMoves(state).map(banqiMoveToEngineUci),
    );
    for (const move of getBanqiForbiddenChaseMoves(state))
      assert.ok(!go.includes(banqiMoveToEngineUci(move)));
  });
});

test('flip grading divides 2M nodes by distinct pool identities, with a 200K floor', async () => {
  const setup: BanqiSetup = {
    deal: STANDARD_BANQI_DEAL,
    chaseRule: 'repetition',
    noProgressLimit: 60,
  };
  const distinctCounts: number[] = [];
  for (const prefixLength of [0, 26, 31]) {
    let state = createBanqiStateFromSetup('budget', setup);
    const prefix: BanqiMove[] = [];
    for (let i = 0; i < prefixLength; i++) {
      const flip = getBanqiLegalMoves(state).find((move) => move.from === move.to)!;
      prefix.push(flip);
      state = applyBanqiMove(state, flip);
    }
    const n = new Set(
      Object.values(state.board)
        .filter((piece) => piece?.faceDown)
        .map((piece) => `${piece!.color}-${piece!.role}`),
    ).size;
    distinctCounts.push(n);
    const darkCount = Object.values(state.board).filter((piece) => piece?.faceDown).length;
    const played = getBanqiLegalMoves(state).find((move) => move.from === move.to)!;
    const seenNodes: number[] = [];
    const quietNodes: number[] = [];
    await analyzeBanqiDecisions(
      [...prefix, played],
      setup,
      {
        evalPosition: async (fen, _history, context) => {
          const isFlip = fen.split(' ')[0]!.split('X').length - 1 === darkCount - 1;
          (isFlip ? seenNodes : quietNodes).push(context?.nodes ?? 0);
          return { cp: 100, mate: null };
        },
      },
      { load: async () => ({ nextIndex: prefixLength, items: [] }), save: async () => {} },
    );
    assert.ok(seenNodes.length > 0);
    assert.ok(
      seenNodes.every((nodes) => nodes === Math.max(200_000, Math.floor(2_000_000 / n))),
      `N=${n}, got ${seenNodes}`,
    );
    assert.ok(quietNodes.every((nodes) => nodes === 2_000_000));
  }
  assert.deepEqual(distinctCounts, [14, 2, 1]);
});

test('new grading identities invalidate classical sweeps, decisions and checkpoints', () => {
  assert.notEqual(BANQI_ANALYSIS_ENGINE_ID, 'misty-banqi-analysis@0.3.0+history1');
  assert.notEqual(BANQI_DECISIONS_ENGINE_ID, 'misty-banqi-decisions@0.3.0+d4');
});

test('live flip grading requests the same NNUE net, split budget and full budgets for quiet alternatives', async () => {
  const prefix = fixture.moves.slice(0, 90);
  let state = createBanqiStateFromSetup('decision-request', fixture.setup);
  for (const move of prefix) state = applyBanqiMove(state, move);
  const n = new Set(
    Object.values(state.board)
      .filter((piece) => piece?.faceDown)
      .map((piece) => `${piece!.color}-${piece!.role}`),
  ).size;
  await withGradingEngine(async (engine) => {
    await analyzeBanqiDecisions([...prefix, fixture.moves[90]!], fixture.setup, undefined, {
      load: async () => ({ nextIndex: 90, items: [] }),
      save: async () => {},
    });
    const commands = engine.commands();
    const go = commands.filter((line) => line.startsWith('go '));
    assert.ok(
      go.some((line) =>
        line.startsWith(`go nodes ${Math.max(200_000, Math.floor(2_000_000 / n))} `),
      ),
    );
    assert.ok(go.some((line) => line.startsWith('go nodes 2000000 ')));
    assert.equal(
      commands.filter((line) => line === `setoption name EvalFile value ${engine.net}`).length,
      go.length,
    );
    assert.ok(
      commands.some((line) => line.startsWith('position fen ') && line.includes(' moves ')),
      'quiet alternatives preserve history',
    );
  });
});

test('whole analysis requests remain identical when hidden identities are permuted', async (t) => {
  const moves = fixture.moves.slice(0, 84);
  function replay(setup: BanqiSetup): BanqiGameState[] {
    let state = createBanqiStateFromSetup('hidden-request', setup);
    const states = [state];
    for (const move of moves) {
      const next = applyBanqiMove(state, move);
      assert.equal(next.ply, state.ply + 1);
      states.push(next);
      state = next;
    }
    return states;
  }
  const states = replay(fixture.setup);
  const state = states[moves.length]!;
  const hidden = (Object.keys(state.board) as (keyof typeof state.board)[]).filter(
    (sq) => state.board[sq]?.faceDown,
  );
  const a = hidden[0]!;
  const b = hidden.find(
    (sq) =>
      state.board[sq]!.role !== state.board[a]!.role ||
      state.board[sq]!.color !== state.board[a]!.color,
  )!;
  assert.ok(b);
  // These tiles have never moved or flipped. Swap the original deal and replay
  // it independently so BOTH the current FEN and the history-root FEN see the swap.
  const setup = { ...fixture.setup, deal: [...fixture.setup.deal] };
  const ai = ALL_BANQI_SQUARES.indexOf(a);
  const bi = ALL_BANQI_SQUARES.indexOf(b);
  [setup.deal[ai], setup.deal[bi]] = [setup.deal[bi]!, setup.deal[ai]!];
  const swappedStates = replay(setup);
  const swapped = swappedStates[moves.length]!;
  assert.notDeepEqual(swapped.board, state.board, 'the hidden permutation must be real');
  assert.deepEqual(swapped.board[a], state.board[b]);
  assert.deepEqual(swapped.board[b], state.board[a]);
  const window = banqiAnalysisRepetitionWindow(states, moves, moves.length);
  const swappedWindow = banqiAnalysisRepetitionWindow(swappedStates, moves, moves.length);
  assert.ok(window.moves.length > 0, 'exercise a history-root FEN before the current ply');
  await withGradingEngine(async (engine) => {
    for (const history of [false, true]) {
      await t.test(history ? 'repetition history' : 'current position', async () => {
        const start = engine.commands().filter(Boolean).length;
        await evaluateBanqiPosition(state, history ? window : undefined);
        const first = engine.commands().slice(start);
        await evaluateBanqiPosition(swapped, history ? swappedWindow : undefined);
        assert.equal(
          JSON.stringify(engine.commands().slice(start + first.length)),
          JSON.stringify(first),
          history ? 'independently rebuilt repetition windows' : 'current-position FENs',
        );
      });
    }
  });
});
