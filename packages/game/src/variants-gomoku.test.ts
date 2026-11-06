import assert from 'node:assert/strict';
import test from 'node:test';
import * as game from './index.js';

const files = 'abcdefghijklmno';
const squares = Array.from({ length: 225 }, (_, i) => `${files[i % 15]}${1 + Math.floor(i / 15)}`);

function move(square: string): game.GomokuMove {
  const parsed = game.parseGomokuMove(square);
  assert.ok(parsed, `invalid fixture coordinate: ${square}`);
  return parsed;
}

function opening(black: string[], white: string[], turn: game.GomokuColor = 'black') {
  return game.createInitialGomokuState({
    stones: [
      ...black.map((square) => ({ square: move(square).to, color: 'black' as const })),
      ...white.map((square) => ({ square: move(square).to, color: 'white' as const })),
    ],
    turn,
  });
}

function play(state: game.GomokuState, square: string): game.GomokuState {
  const next = game.applyGomokuMove(state, move(square));
  assert.notEqual(next, state, `${square} must be legal`);
  return next;
}

// Independent oracle: inspect every five-cell window, rather than count rays
// around the last move as the engine does. Also used by the random soak.
function winners(board: readonly (game.GomokuColor | null)[]): Set<game.GomokuColor> {
  const found = new Set<game.GomokuColor>();
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      const color = board[row * 15 + col];
      if (!color) continue;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 1],
      ]) {
        const endCol = col + 4 * dx;
        const endRow = row + 4 * dy;
        if (endCol < 0 || endCol >= 15 || endRow >= 15) continue;
        if ([1, 2, 3, 4].every((n) => board[(row + n * dy) * 15 + col + n * dx] === color)) {
          found.add(color);
        }
      }
    }
  }
  return found;
}

function oracleWins(state: game.GomokuState, color: game.GomokuColor): game.GomokuMove[] {
  return squares.flatMap((square, i) => {
    if (state.board[i] !== null) return [];
    const board = [...state.board];
    board[i] = color;
    return winners(board).has(color) ? [move(square)] : [];
  });
}

function drawStones(): game.GomokuStone[] {
  // Runs have length at most two horizontally, vertically and diagonally.
  // The 15x15 pattern has 113 black stones and 112 white stones.
  return squares.map((square, i) => ({
    square: move(square).to,
    color: ((i % 15) + 2 * Math.floor(i / 15)) % 4 < 2 ? 'black' : 'white',
  }));
}

test('Gomoku starts with an empty freestyle 15x15 board and Black to move', () => {
  const state = game.createInitialGomokuState();
  assert.equal(game.GOMOKU_BOARD_SIZE, 15);
  assert.equal(state.rule, 'freestyle');
  assert.equal(state.ply, 0);
  assert.deepEqual(state.status, { type: 'playing', turn: 'black' });
  assert.deepEqual(state.board, Array(225).fill(null));
  assert.deepEqual(game.getGomokuLegalMoves(state), squares.map(move));
  assert.deepEqual(game.winsInOne(state), []);
  assert.deepEqual(game.mustBlock(state), []);
});

test('the Rapfi pool contains at least 200 distinct, legal, nonterminal near-even openings', async () => {
  const { positionKey } = await import(
    new URL('../../../scripts/screen-gomoku-openings.mjs', import.meta.url).href
  );
  assert.ok(game.GOMOKU_OPENINGS.length >= 200);
  assert.equal(game.GOMOKU_OPENING_SCREEN.accepted, game.GOMOKU_OPENINGS.length);
  assert.equal(game.GOMOKU_OPENING_SCREEN.nodes, 1_000_000);
  const keys = new Set<string>();
  for (const entry of game.GOMOKU_OPENINGS) {
    const initial = game.createInitialGomokuState(entry);
    assert.ok([3, 4, 5].includes(initial.ply));
    assert.deepEqual(initial.status, { type: 'playing', turn: entry.turn });
    assert.equal(winners(initial.board).size, 0, entry.id);
    const { score, finalScore, winrate, nodes, forcedWin, depth } = entry.screening;
    assert.ok(Math.abs(score) <= 40 && Math.abs(finalScore) <= 40, entry.id);
    const mined = entry.source === 'mined-2B3W-7x7';
    assert.ok(winrate >= (mined ? 0.48 : 0.45) && winrate <= (mined ? 0.52 : 0.55), entry.id);
    if (mined) assert.equal(entry.classicId, undefined);
    else assert.equal(typeof entry.classicId, 'string');
    assert.ok(nodes >= 1_000_000 && depth > 0, entry.id);
    assert.equal(forcedWin, false);
    assert.ok(!keys.has(positionKey(entry)), 'symmetries must not inflate the pool');
    keys.add(positionKey(entry));
    const room = game.createGomokuRoomState('pool-test', entry);
    assert.deepEqual(room.board, initial.board);
    assert.equal(room.moveNumber, 1);
    const next = game.applyGomokuRoomMove(room, game.getGomokuLegalMoves(initial)[0]!);
    assert.deepEqual(next.opening, room.opening);
    assert.equal(next.ply, initial.ply + 1);
  }
});

test('mined importer rejects score 41, forced wins and reflected pool duplicates', async () => {
  const { importMinedOpenings } = await import(
    new URL('../../../scripts/import-gomoku-mined-openings.mjs', import.meta.url).href
  );
  const classic = game.GOMOKU_OPENINGS[0]!;
  const pool = { screening: { accepted: 1 }, openings: [classic] };
  const deep = {
    score: 0,
    winrate: 0.5,
    finalScore: 0,
    nodes: 1_000_000,
    depth: 20,
    forcedWin: false,
  };
  const candidate = {
    turn: 'black',
    stones: [
      { square: 'e5', color: 'black' },
      { square: 'k11', color: 'black' },
      { square: 'h8', color: 'white' },
      { square: 'f9', color: 'white' },
      { square: 'j7', color: 'white' },
    ],
  };
  const fixture = {
    config: { nb: 2, nw: 3, H: 3 },
    band: [0.48, 0.52],
    rows: [
      { candidate, deep: { ...deep, score: 41 } },
      { candidate, deep: { ...deep, forcedWin: true } },
      {
        candidate: {
          turn: classic.turn,
          stones: classic.stones.map((stone) => ({
            ...stone,
            square: `${String.fromCharCode(97 + 14 - (stone.square.charCodeAt(0) - 97))}${stone.square.slice(1)}`,
          })),
        },
        deep,
      },
      { candidate, deep },
    ],
  };
  const { pool: merged, report } = importMinedOpenings(pool, fixture);
  assert.equal(report.imported, 1);
  assert.equal(report.rejected, 3);
  assert.equal(report.rejectedByFilter.score, 1);
  assert.equal(report.rejectedByFilter.forcedWin, 1);
  assert.equal(report.rejectedByFilter.duplicateExisting, 1);
  assert.deepEqual(merged.openings, [
    classic,
    { id: 'gmk-002', source: 'mined-2B3W-7x7', ...candidate, screening: deep },
  ]);
  assert.equal(merged.screening.accepted, 2);
  assert.deepEqual(pool, { screening: { accepted: 1 }, openings: [classic] });

  for (const patch of [
    { score: -41 },
    { finalScore: 41 },
    { finalScore: -41 },
    { winrate: 0.47999 },
    { winrate: 0.52001 },
    { nodes: 999_999 },
    { score: Number.NaN },
    { depth: 0 },
    { forcedWin: undefined },
  ]) {
    const result = importMinedOpenings(pool, {
      ...fixture,
      rows: [{ candidate, deep: { ...deep, ...patch } }],
    });
    assert.equal(result.report.imported, 0, JSON.stringify(patch));
  }
  for (const winrate of [0.48, 0.52]) {
    const result = importMinedOpenings(pool, {
      ...fixture,
      rows: [{ candidate, deep: { ...deep, score: 40, finalScore: -40, winrate } }],
    });
    assert.equal(result.report.imported, 1, 'acceptance bounds are inclusive');
  }
  const duplicated = { ...fixture, rows: [...fixture.rows, { candidate, deep }] };
  const result = importMinedOpenings(pool, duplicated);
  assert.equal(result.report.rejectedByFilter.duplicateMined, 1);
  assert.deepEqual(result.pool.openings, merged.openings);
  assert.deepEqual(
    importMinedOpenings(pool, { ...duplicated, rows: [...duplicated.rows].reverse() }).pool,
    result.pool,
  );
  const rerun = importMinedOpenings(merged, fixture);
  assert.equal(rerun.report.imported, 0);
  assert.deepEqual(rerun.pool, merged, 'reimport preserves IDs and provenance');
});

test('opening screening generates all 26 classics and rejects missing, mate and under-budget telemetry', async () => {
  const script = await import(
    new URL('../../../scripts/screen-gomoku-openings.mjs', import.meta.url).href
  );
  const classics = script.classicOpenings();
  assert.equal(classics.length, 26);
  assert.equal(
    new Set(classics.map((entry: game.GomokuOpening) => script.positionKey(entry))).size,
    26,
  );
  const all = [...script.candidates()] as game.GomokuOpening[];
  for (const entry of all)
    assert.equal(game.createInitialGomokuState(entry).status.type, 'playing');
  assert.deepEqual([...new Set(all.map((entry) => entry.stones.length))].sort(), [3, 4, 5]);
  const lines = [
    'INFO PV 0',
    'INFO DEPTH 20',
    'INFO EVAL 0',
    'INFO WINRATE 0.5',
    'INFO TOTALNODES 1000000',
    'INFO PV DONE',
    'MESSAGE Speed 200K | Depth 20-30 | Eval 0 | Node 1000K | Time 5000ms',
  ];
  assert.ok(script.passesScreen(script.parseScreen(lines, 1_000_000)));
  for (const bad of [
    [],
    lines.filter((line) => !line.startsWith('INFO WINRATE')),
    lines.map((line) => line.replace('Eval 0 | Node', 'Eval +M9 | Node')),
    lines.map((line) => line.replace('Node 1000K', 'Node 10K')),
    lines.map((line) => line.replace('Node 1000K', 'Node 999K')),
    lines.map((line) => line.replace('WINRATE 0.5', 'WINRATE NaN')),
  ])
    assert.equal(script.parseScreen(bad, 1_000_000), null);
  for (const [from, to] of [
    ['WINRATE 0.5', 'WINRATE 0.8'],
    ['EVAL 0', 'EVAL 200'],
    ['Eval 0 |', 'Eval -200 |'],
  ])
    assert.equal(
      script.passesScreen(
        script.parseScreen(
          lines.map((line) => line.replace(from!, to!)),
          1_000_000,
        ),
      ),
      false,
    );
});

test('Gomoku notation round-trips all a1-o15 points and rejects noncanonical coordinates', () => {
  for (const square of squares) assert.equal(game.formatGomokuMove(move(square)), square);
  for (const invalid of ['', 'a0', 'a16', 'p1', 'a01', 'A1', ' a1', 'a1 ', 'a1b2', 'a1\n']) {
    assert.equal(game.parseGomokuMove(invalid), null, invalid);
    assert.throws(() => game.formatGomokuMove({ to: invalid as game.GomokuSquare }));
  }
});

test('Gomoku placements alternate turns, preserve prior states and reject illegal moves', () => {
  const initial = game.createInitialGomokuState();
  const black = play(initial, 'h8');
  assert.equal(black.board[112], 'black');
  assert.equal(initial.board[112], null);
  assert.equal(black.ply, 1);
  assert.deepEqual(black.lastMove, move('h8'));
  assert.deepEqual(black.status, { type: 'playing', turn: 'white' });
  assert.equal(game.getGomokuLegalMoves(black).length, 224);
  assert.equal(game.applyGomokuMove(black, move('h8')), black);
  for (const invalid of ['p1', 'a0', 'a01']) {
    assert.equal(game.applyGomokuMove(black, { to: invalid as game.GomokuSquare }), black);
  }
  const white = play(black, 'o15');
  assert.equal(white.board[224], 'white');
  assert.equal(white.ply, 2);
  assert.deepEqual(white.status, { type: 'playing', turn: 'black' });
});

for (const [name, black, last] of [
  ['horizontal at the bottom edge', ['a1', 'b1', 'c1', 'd1'], 'e1'],
  ['vertical at the right edge', ['o11', 'o12', 'o13', 'o14'], 'o15'],
  ['rising diagonal', ['k11', 'l12', 'm13', 'n14'], 'o15'],
  ['falling diagonal', ['a15', 'b14', 'c13', 'd12'], 'e11'],
  ['overline bridged in the middle', ['a1', 'b1', 'd1', 'e1', 'f1'], 'c1'],
] as const) {
  test(`Gomoku wins with ${name}`, () => {
    const fillers = ['a7', 'c7', 'e7', 'g7', 'i7'].slice(0, black.length);
    const state = opening([...black], fillers);
    assert.ok(game.winsInOne(state).some((candidate) => candidate.to === last));
    const won = play(state, last);
    assert.deepEqual(won.status, { type: 'finished', winner: 'black', reason: 'five' });
    assert.deepEqual([...winners(won.board)], ['black']);
    assert.deepEqual(game.getGomokuLegalMoves(won), []);
    assert.deepEqual(game.winsInOne(won), []);
    assert.deepEqual(game.mustBlock(won), []);
    assert.equal(game.applyGomokuMove(won, move('j10')), won);
  });
}

test('Gomoku White can win, and a blocked four or wrapped row cannot win', () => {
  const state = opening(['a1', 'c1', 'e1', 'g1', 'i1'], ['a15', 'b15', 'd15', 'e15'], 'white');
  assert.deepEqual(game.winsInOne(state), [move('c15')]);
  assert.deepEqual(play(state, 'c15').status, {
    type: 'finished',
    winner: 'white',
    reason: 'five',
  });
  const blocked = opening(['b1', 'c1', 'd1', 'e1'], ['a1', 'f1', 'a4', 'c4']);
  assert.deepEqual(game.winsInOne(blocked), []);
  const wrapped = opening(['m1', 'n1', 'o1', 'a2'], ['a7', 'c7', 'e7', 'g7']);
  assert.equal(play(wrapped, 'b2').status.type, 'playing');
  assert.equal(
    game.winsInOne(wrapped).some((candidate) => candidate.to === 'b2'),
    false,
  );
});

test('Gomoku dealt openings validate counts, retain no caller-owned objects and continue play', () => {
  const stones: game.GomokuStone[] = [{ square: 'h8', color: 'black' }];
  const state = game.createInitialGomokuState({ stones, turn: 'white', rule: 'freestyle' });
  stones[0].color = 'white';
  stones.push({ square: 'i8', color: 'white' });
  assert.equal(state.board[112], 'black');
  assert.equal(state.board[113], null);
  assert.equal(state.ply, 1);
  assert.deepEqual(play(state, 'i8').status, { type: 'playing', turn: 'black' });
  assert.deepEqual(opening(['h8'], ['i8']).status, { type: 'playing', turn: 'black' });
  const mined = opening(['e5', 'k11'], ['h8', 'f9', 'j7'], 'black');
  assert.equal(mined.ply, 5);
  assert.deepEqual(play(mined, 'a1').status, { type: 'playing', turn: 'white' });
});

test('Gomoku rejects illegal openings: counts, turn, duplicates, bounds, colors and rules', () => {
  for (const [black, white, turn] of [
    [[], [], 'white'],
    [['a1'], [], 'black'],
    [[], ['a1'], 'black'],
    [['a1', 'b1'], [], 'white'],
    [['a1'], ['b1'], 'white'],
    [['e5', 'k11'], ['h8', 'f9', 'j7'], 'white'],
    [['a1'], ['a1'], 'black'],
    [['a1', 'a1'], ['b1'], 'white'],
  ] as const) {
    assert.throws(() => opening([...black], [...white], turn));
  }
  for (const square of ['p1', 'a0', 'a16', 'a01']) {
    assert.throws(
      () =>
        game.createInitialGomokuState({
          stones: [{ square: square as game.GomokuSquare, color: 'black' }],
          turn: 'white',
        }),
      /coordinate/i,
    );
  }
  assert.throws(() =>
    game.createInitialGomokuState({ stones: [], turn: 'red' as game.GomokuColor }),
  );
  assert.throws(() =>
    game.createInitialGomokuState({
      stones: [{ square: 'a1', color: 'red' as game.GomokuColor }],
      turn: 'white',
    }),
  );
  assert.throws(() =>
    game.createInitialGomokuState({
      stones: [],
      turn: 'black',
      rule: 'renju' as 'freestyle',
    }),
  );
});

test('Gomoku rejects either color already having five or an overline in an opening', () => {
  const filler = ['a7', 'c7', 'e7', 'g7', 'i7', 'k7'];
  for (const line of [
    ['a1', 'b1', 'c1', 'd1', 'e1'],
    ['o11', 'o12', 'o13', 'o14', 'o15'],
    ['a1', 'b2', 'c3', 'd4', 'e5'],
    ['a15', 'b14', 'c13', 'd12', 'e11'],
    ['a1', 'b1', 'c1', 'd1', 'e1', 'f1'],
  ]) {
    assert.throws(() => opening(line, filler.slice(0, line.length)), /five/i);
    assert.throws(() => opening(filler.slice(0, line.length), line), /five/i);
  }
});

test('Gomoku draws on a full board, including an imported full board', () => {
  const stones = drawStones();
  const state = game.createInitialGomokuState({
    stones: stones.filter((stone) => stone.square !== 'a1'),
    turn: 'black',
  });
  assert.equal(winners(state.board).size, 0);
  assert.deepEqual(game.getGomokuLegalMoves(state), [move('a1')]);
  const full = play(state, 'a1');
  assert.equal(full.ply, 225);
  assert.equal(winners(full.board).size, 0);
  assert.deepEqual(full.status, { type: 'finished', winner: null, reason: 'board-full' });
  assert.deepEqual(game.getGomokuLegalMoves(full), []);
  assert.deepEqual(game.winsInOne(full), []);
  assert.deepEqual(game.mustBlock(full), []);
  assert.equal(game.applyGomokuMove(full, move('a1')), full);
  assert.deepEqual(game.createInitialGomokuState({ stones, turn: 'white' }).status, full.status);
});

test('Gomoku a winning last empty point takes precedence over a full-board draw', () => {
  const stones = drawStones();
  for (const square of ['c1', 'd1'])
    stones.find((stone) => stone.square === square)!.color = 'black';
  for (const square of ['a3', 'e3'])
    stones.find((stone) => stone.square === square)!.color = 'white';
  const state = game.createInitialGomokuState({
    stones: stones.filter((stone) => stone.square !== 'c1'),
    turn: 'black',
  });
  assert.deepEqual(play(state, 'c1').status, { type: 'finished', winner: 'black', reason: 'five' });
});

test('Gomoku threat helpers find single blocks, open fours and crossing threats without mutation', () => {
  const state = opening(['a1', 'c1', 'e1', 'g1'], ['a15', 'b15', 'c15', 'd15']);
  const snapshot = JSON.stringify(state);
  assert.deepEqual(game.mustBlock(state), [move('e15')]);
  assert.deepEqual(game.mustBlock(play(state, 'e15')), []);
  assert.equal(JSON.stringify(state), snapshot);
  const two = opening(['a1', 'c1', 'e1', 'g1'], ['b15', 'c15', 'd15', 'e15']);
  assert.deepEqual(game.mustBlock(two), [move('a15'), move('f15')]);
  const crossing = opening(
    ['f8', 'g8', 'i8', 'j8', 'h6', 'h7', 'h9', 'h10'],
    ['a1', 'c1', 'e1', 'g1', 'i1', 'k1', 'm1', 'o1'],
  );
  assert.deepEqual(game.winsInOne(crossing), [move('h8')]);
  const both = opening(['a1', 'b1', 'c1', 'd1'], ['a15', 'b15', 'c15', 'd15']);
  assert.deepEqual(game.winsInOne(both), [move('e1')]);
  assert.deepEqual(game.mustBlock(both), [move('e15')]);
});

test('Gomoku freestyle allows a Black double-three with no forbidden moves', () => {
  const state = opening(['g8', 'i8', 'h7', 'h9'], ['a1', 'c1', 'e1', 'g1']);
  assert.ok(game.getGomokuLegalMoves(state).some((candidate) => candidate.to === 'h8'));
  assert.deepEqual(play(state, 'h8').status, { type: 'playing', turn: 'white' });
});

test('Gomoku helpers match an independent oracle for both turns across seeded positions', () => {
  const random = rng(761);
  let state = game.createInitialGomokuState();
  for (let ply = 0; ply < 100 && state.status.type === 'playing'; ply += 1) {
    const legal = game.getGomokuLegalMoves(state);
    state = game.applyGomokuMove(state, legal[Math.floor(random() * legal.length)]);
    if (ply % 10 > 1 || state.status.type !== 'playing') continue;
    const turn = state.status.turn;
    assert.deepEqual(game.winsInOne(state), oracleWins(state, turn));
    assert.deepEqual(
      game.mustBlock(state),
      oracleWins(state, turn === 'black' ? 'white' : 'black'),
    );
  }
});

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

test('Gomoku 10,000 seeded random games terminate legally and agree with an independent oracle', () => {
  const results = new Set<string>();
  for (let seed = 1; seed <= 10_000; seed += 1) {
    const random = rng(seed);
    const order = squares.map(move);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let state = game.createInitialGomokuState();
    let previous = state;
    for (let ply = 0; ply < 225 && state.status.type === 'playing'; ply += 1) {
      assert.equal(state.status.turn, ply % 2 === 0 ? 'black' : 'white');
      previous = state;
      state = game.applyGomokuMove(state, order[ply]);
      assert.notEqual(state, previous, `seed ${seed}, ply ${ply}`);
      assert.notEqual(state.board, previous.board);
      assert.equal(state.ply, ply + 1);
    }
    assert.equal(state.status.type, 'finished', `seed ${seed} failed to terminate`);
    if (state.status.type !== 'finished') continue;
    assert.equal(winners(previous.board).size, 0, `seed ${seed} missed an earlier win`);
    assert.equal(state.board.filter((color) => color === 'black').length, Math.ceil(state.ply / 2));
    assert.equal(
      state.board.filter((color) => color === 'white').length,
      Math.floor(state.ply / 2),
    );
    const won = winners(state.board);
    if (state.status.reason === 'five') {
      assert.deepEqual([...won], [state.status.winner], `seed ${seed} false win`);
      assert.equal(state.status.winner, state.ply % 2 === 1 ? 'black' : 'white');
      results.add(state.status.winner!);
    } else {
      assert.equal(state.ply, 225);
      assert.equal(won.size, 0);
      assert.equal(state.status.winner, null);
    }
    assert.deepEqual(game.getGomokuLegalMoves(state), []);
    assert.equal(game.applyGomokuMove(state, order[0]), state);
  }
  assert.deepEqual([...results].sort(), ['black', 'white']);
});
