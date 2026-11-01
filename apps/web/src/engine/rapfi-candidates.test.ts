// @vitest-environment node
import * as shared from '@mistboard/game';
import { describe, expect, it, vi } from 'vitest';
import type { RapfiPosition } from './rapfi.js';
import * as rapfi from './rapfi.js';
import * as compatibility from './rapfi-candidates.js';

// Structured transcripts in the supplied 1387d11 searchoutput.cpp format.
// MESSAGE is deliberately misleading: it must never supply evaluation or PV.
const single = `MESSAGE +999 | 1-1 | A1
INFO PV 0
INFO NUMPV 1
INFO DEPTH 8
INFO SELDEPTH 12
INFO NODES 1000
INFO TOTALNODES 1200
INFO TOTALTIME 31
INFO SPEED 38709
INFO EVAL -142
INFO WINRATE 0.42
INFO BESTLINE 7,8 6,9 8,10
INFO PV DONE
7,8`;

const multi = `INFO PV 0
INFO NUMPV 2
INFO DEPTH 5
INFO SELDEPTH 8
INFO NODES 500
INFO TOTALNODES 500
INFO TOTALTIME 10
INFO SPEED 50000
INFO EVAL 180
INFO WINRATE 0.60
INFO BESTLINE 7,8 6,9
INFO PV DONE
MESSAGE (2) -999 | 5-8 | A1
INFO PV 1
INFO NUMPV 2
INFO DEPTH 5
INFO SELDEPTH 7
INFO NODES 300
INFO TOTALNODES 800
INFO TOTALTIME 16
INFO SPEED 50000
INFO EVAL 120
INFO WINRATE 0.55
INFO BESTLINE 8,7 9,6
INFO PV DONE
INFO PV 0
INFO NUMPV 2
INFO DEPTH 6
INFO SELDEPTH 10
INFO NODES 800
INFO TOTALNODES 1600
INFO TOTALTIME 32
INFO SPEED 50000
INFO EVAL 210
INFO WINRATE 0.62
INFO BESTLINE 6,8 9,9 10,10
INFO PV DONE
INFO PV 1
INFO NUMPV 2
INFO DEPTH 6
INFO EVAL 999
INFO BESTLINE 0,0
6,8`;

// Recorded locally from the pinned WASM on 2026-11-01, 5,000 nodes, 2 s cap.
// Black: H8 I9 G9; White: H9 I8 G8 (raw coordinates in RapfiPosition).
// These are the final complete blocks; the full transcripts are in scratch.
const recordedSingle = `INFO PV 0
INFO NUMPV 1
INFO DEPTH 11
INFO SELDEPTH 10
INFO NODES 2470
INFO TOTALNODES 4370
INFO TOTALTIME 48
INFO SPEED 91041
INFO EVAL 414
INFO WINRATE 0.887953
INFO BESTLINE 5,6 5,9 6,9 6,6 6,5 4,7 9,5 4,8 7,5
INFO PV DONE
MESSAGE Depth 11-13 | Eval 446 | Time 54ms | F9
MESSAGE Speed 92777 | Depth 11-13 | Eval 446 | Node 5010 | Time 54ms
5,6`;

const recordedMulti = `INFO PV 0
INFO NUMPV 3
INFO DEPTH 9
INFO SELDEPTH 12
INFO NODES 413
INFO TOTALNODES 3925
INFO TOTALTIME 30
INFO SPEED 130833
INFO EVAL 482
INFO WINRATE 0.917587
INFO BESTLINE 5,6 7,6 9,6 8,5 9,4 6,5 9,8
INFO PV DONE
MESSAGE (1) 482 | 9-12 | F9 H9 J9 I10 J11 G10 J7
INFO PV 1
INFO NUMPV 3
INFO DEPTH 9
INFO SELDEPTH 10
INFO NODES 624
INFO TOTALNODES 3994
INFO TOTALTIME 30
INFO SPEED 133133
INFO EVAL 271
INFO WINRATE 0.794946
INFO BESTLINE 6,6 9,9 9,6 8,6 5,6 5,5 8,5 7,4 5,9
INFO PV DONE
MESSAGE (2) 271 | 9-10 | G9 J6 J9 I9 F9 F10 I10 H11 F6
INFO PV 2
INFO NUMPV 3
INFO DEPTH 9
INFO SELDEPTH 11
INFO NODES 709
INFO TOTALNODES 4224
INFO TOTALTIME 32
INFO SPEED 132000
INFO EVAL 544
INFO WINRATE 0.938196
INFO BESTLINE 7,9 8,9 5,6 6,9 9,6 5,8 5,7 8,10
INFO PV DONE
MESSAGE (3) 544 | 9-11 | H6 I6 F9 G6 J9 F7 F8 I5
MESSAGE Depth 9-11 | Eval 544 | Time 32ms | H6 I6 F9 G6 J9 F7 F8 I5
INFO PV 0
INFO NUMPV 3
INFO DEPTH 10
INFO SELDEPTH 11
INFO NODES 738
INFO TOTALNODES 4338
INFO TOTALTIME 32
INFO SPEED 135562
INFO EVAL 544
INFO WINRATE 0.938196
INFO BESTLINE 7,9 8,9 5,6 6,9 9,6 5,8 5,7 8,10
INFO PV DONE
MESSAGE (1) 544 | 10-11 | H6 I6 F9 G6 J9 F7 F8 I5
MESSAGE Depth 9-11 | Eval 544 | Time 39ms | H6 I6 F9 G6 J9 F7 F8 I5
MESSAGE Speed 128K | Depth 9-11 | Eval 544 | Node 5028 | Time 39ms
7,9`;

function candidate(x: number, y: number, ev: number, pvIndex = 0) {
  return {
    ...rapfi.parseRapfiOutput(single)[0],
    pvIndex,
    move: { x, y },
    eval: ev,
    pv: [{ x, y }],
  };
}

const empty: RapfiPosition = { turn: 1, stones: [] };
// L5 uses best-move search in both the existing and eight-level ladders.
const bestMoveLevel = 5;
const options = { candidateCount: 3, evalMargin: 100, seed: 42 };
const choices = () => [candidate(6, 8, 100), candidate(7, 8, 80, 1), candidate(8, 8, 40, 2)];

describe('Rapfi structured output', () => {
  it('keeps every browser compatibility export bound to the shared implementation', () => {
    expect({ ...compatibility }).toEqual({
      parseRapfiOutput: shared.parseRapfiOutput,
      rapfiPositionState: shared.rapfiPositionState,
      selectRapfiMove: shared.selectRapfiMove,
      validateRapfiCandidateCount: shared.validateRapfiCandidateCount,
      validateRapfiChoiceOptions: shared.validateRapfiChoiceOptions,
    });
  });

  it('parses recorded single/multi-PV, including re-ranked and repeated root moves', () => {
    expect(rapfi.parseRapfiOutput(recordedSingle)[0]).toMatchObject({
      eval: 414,
      depth: 11,
      move: { x: 5, y: 6 },
      forcedFive: null,
    });
    const candidates = rapfi.parseRapfiOutput(recordedMulti);
    expect(
      candidates.map(({ pvIndex, depth, eval: ev, move }) => ({ pvIndex, depth, ev, move })),
    ).toEqual([
      { pvIndex: 0, depth: 10, ev: 544, move: { x: 7, y: 9 } },
      { pvIndex: 1, depth: 9, ev: 271, move: { x: 6, y: 6 } },
      { pvIndex: 2, depth: 9, ev: 544, move: { x: 7, y: 9 } },
    ]);
    // Re-ranked PVs can repeat a root move across depths. Count unique moves.
    const selected = new Set(
      Array.from({ length: 50 }, (_, seed) =>
        JSON.stringify(
          rapfi.selectRapfiMove(empty, candidates, { seed, candidateCount: 2, evalMargin: 300 }),
        ),
      ),
    );
    expect(selected.size).toBe(2);
  });

  it('parses a single PV with side-to-move score and raw coordinate orientation', () => {
    expect(rapfi.parseRapfiOutput(single)).toEqual([
      {
        pvIndex: 0,
        numPv: 1,
        depth: 8,
        seldepth: 12,
        nodes: 1000,
        totalNodes: 1200,
        timeMs: 31,
        speed: 38709,
        eval: -142,
        winrate: 0.42,
        move: { x: 7, y: 8 },
        pv: [
          { x: 7, y: 8 },
          { x: 6, y: 9 },
          { x: 8, y: 10 },
        ],
        forcedFive: null,
      },
    ]);
  });

  it('keeps the last complete block per zero-based PV index', () => {
    const parsed = rapfi.parseRapfiOutput(multi.split('\n'));
    expect(
      parsed.map(({ pvIndex, depth, eval: ev, move }) => ({ pvIndex, depth, ev, move })),
    ).toEqual([
      { pvIndex: 0, depth: 6, ev: 210, move: { x: 6, y: 8 } },
      { pvIndex: 1, depth: 5, ev: 120, move: { x: 8, y: 7 } },
    ]);
    expect(rapfi.parseRapfiOutput('MESSAGE (1) +M3 | 8-12 | H8 I9\n7,7')).toEqual([]);
  });

  it.each([
    [29999, { result: 'win', plies: 1 }],
    [-29997, { result: 'loss', plies: 3 }],
    [29775, { result: 'win', plies: 225 }],
    [-29775, { result: 'loss', plies: 225 }],
    [30000, { result: 'win', plies: 0 }],
    [29774, null],
    [-29774, null],
  ])('interprets forced-five score %s as signed distance in plies', (ev, forcedFive) => {
    expect(rapfi.parseRapfiOutput(single.replace('EVAL -142', `EVAL ${ev}`))[0].forcedFive).toEqual(
      forcedFive,
    );
  });

  // Rapfi prints mates as text (core/iohelper.cpp: "+M" << VALUE_MATE - value),
  // never as the raw 30000-based number; database mates ("+M*") carry no distance.
  it.each([
    ['+M1', { result: 'win', plies: 1 }],
    ['+M3', { result: 'win', plies: 3 }],
    ['-M4', { result: 'loss', plies: 4 }],
    ['-M225', { result: 'loss', plies: 225 }],
  ])('reads the printed mate score %s', (text, forcedFive) => {
    const [parsed] = rapfi.parseRapfiOutput(single.replace('EVAL -142', `EVAL ${text}`));
    expect(parsed?.forcedFive).toEqual(forcedFive);
  });

  it.each(['+M*', '-M*', 'VAL_INF', '+M', 'M3', '+M226', '-M226'])(
    'drops the unusable score %s',
    (text) => {
      expect(rapfi.parseRapfiOutput(single.replace('EVAL -142', `EVAL ${text}`))).toEqual([]);
    },
  );

  it('reads a forced win from real native Rapfi output', () => {
    // Captured 2026-11-01 from the pinned native build, position after 6 plies.
    const real = [
      'MESSAGE OptiTime 3727ms | MaxTime 4970ms',
      'INFO PV 0',
      'INFO NUMPV 1',
      'INFO DEPTH 2',
      'INFO SELDEPTH 2',
      'INFO NODES 1',
      'INFO TOTALNODES 2',
      'INFO TOTALTIME 0',
      'INFO SPEED 2000',
      'INFO EVAL +M3',
      'INFO WINRATE 1',
      'INFO BESTLINE 9,8',
      'INFO PV DONE',
      'MESSAGE Depth 2-2 | Eval +M3 | Time 0ms | J7',
      '9,8',
    ];
    expect(rapfi.parseRapfiOutput(real)).toMatchObject([
      { move: { x: 9, y: 8 }, eval: 29997, forcedFive: { result: 'win', plies: 3 } },
    ]);
  });

  it.each([
    ['EVAL -142', 'EVAL NaN'],
    ['EVAL -142', 'EVAL 30001'],
    ['BESTLINE 7,8 6,9 8,10', 'BESTLINE 15,8'],
    ['BESTLINE 7,8 6,9 8,10', 'BESTLINE 7,8 invalid'],
    ['BESTLINE 7,8 6,9 8,10', 'BESTLINE'],
    ['WINRATE 0.42', 'WINRATE 1.1'],
    ['DEPTH 8', 'DEPTH -1'],
    ['NUMPV 1', 'NUMPV 0'],
    ['PV 0', 'PV 1'],
    ['PV DONE', ''],
    ['INFO EVAL -142\n', ''],
  ])('drops malformed or incomplete blocks (%s)', (from, to) => {
    expect(rapfi.parseRapfiOutput(single.replace(from, to))).toEqual([]);
  });

  it('does not corrupt a complete block when a later block is invalid', () => {
    expect(rapfi.parseRapfiOutput(`${single}\n${single.replace('EVAL -142', 'EVAL bad')}`)).toEqual(
      rapfi.parseRapfiOutput(single),
    );
  });
});

describe('Rapfi candidate commands and selection', () => {
  it('loads the position without searching, then requests YXNBEST with structured detail', () => {
    const commands = rapfi.rapfiCommands(
      {
        turn: 2,
        stones: [
          { x: 3, y: 8, player: 1 },
          { x: 8, y: 3, player: 2 },
        ],
      },
      { nodes: 1000, timeMs: 1500, candidateCount: 3 },
    );
    expect(commands.lines).toEqual([
      'START 15',
      'INFO rule 0',
      'INFO max_node 1000',
      'INFO timeout_turn 1500',
      'INFO show_detail 2',
      'YXBOARD\n8,3,1\n3,8,2\nDONE',
      'YXNBEST 3',
    ]);
    expect(
      rapfi.rapfiCommands(empty, { nodes: 100, timeMs: 1000, candidateCount: 2 }).lines,
    ).toContain('YXNBEST 2');
    expect(commands.lines.some((line) => line === 'BEGIN' || line.startsWith('BOARD\n'))).toBe(
      false,
    );
  });

  it('uses plain search commands when no candidate policy is requested', () => {
    const tier = { nodes: 1000, timeMs: 1500 };
    expect(rapfi.rapfiCommands(empty, tier).lines).toEqual([
      'START 15',
      'INFO rule 0',
      'INFO max_node 1000',
      'INFO timeout_turn 1500',
      'BEGIN',
    ]);
    expect(
      rapfi.rapfiCommands({ turn: 2, stones: [{ x: 3, y: 8, player: 1 }] }, tier).lines,
    ).toEqual([
      'START 15',
      'INFO rule 0',
      'INFO max_node 1000',
      'INFO timeout_turn 1500',
      'BOARD\n3,8,2\nDONE',
    ]);
  });

  it.each([0, -1, 1.5, 226, NaN])('rejects invalid candidate count %s', (candidateCount) => {
    expect(() => rapfi.rapfiCommands(empty, { nodes: 100, timeMs: 1000, candidateCount })).toThrow(
      'candidate count',
    );
  });

  it('reproduces a seeded choice across calls and candidate ordering', () => {
    const candidates = choices();
    const first = rapfi.selectRapfiMove(empty, candidates, options);
    expect(first).toEqual({ x: 7, y: 8 });
    expect(rapfi.selectRapfiMove(empty, [...candidates].reverse(), options)).toEqual(first);
    for (let i = 0; i < 10; i++)
      expect(rapfi.selectRapfiMove(empty, candidates, options)).toEqual(first);
    expect(candidates).toEqual(choices());
  });

  it('varies across seeds and gives stronger evaluations more weight', () => {
    const counts = new Map<number, number>();
    for (let seed = 0; seed < 1000; seed++) {
      const move = rapfi.selectRapfiMove(empty, choices(), { ...options, seed });
      counts.set(move.x, (counts.get(move.x) ?? 0) + 1);
    }
    expect(counts.size).toBe(3);
    expect(counts.get(6)!).toBeGreaterThan(counts.get(7)!);
    expect(counts.get(7)!).toBeGreaterThan(counts.get(8)!);
  });

  it('enforces the candidate cap and inclusive eval margin relative to the best', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(
        rapfi.selectRapfiMove(empty, choices(), { ...options, seed, candidateCount: 1 }),
      ).toEqual({ x: 6, y: 8 });
      expect(rapfi.selectRapfiMove(empty, choices(), { ...options, seed, evalMargin: 19 })).toEqual(
        { x: 6, y: 8 },
      );
      expect(
        rapfi.selectRapfiMove(empty, choices(), { ...options, seed, evalMargin: 20 }).x,
      ).not.toBe(8);
    }
    const included = new Set(
      Array.from(
        { length: 50 },
        (_, seed) =>
          rapfi.selectRapfiMove(empty, choices(), { ...options, seed, evalMargin: 20 }).x,
      ),
    );
    expect([...included].sort()).toEqual([6, 7]);
    expect(rapfi.selectRapfiMove(empty, choices(), { ...options, evalMargin: 0 })).toEqual({
      x: 6,
      y: 8,
    });
  });

  it('uses side-to-move scores for White too, filters illegal moves and deduplicates', () => {
    const pos: RapfiPosition = { turn: 2, stones: [{ x: 6, y: 8, player: 1 }] };
    const candidates = [
      ...choices(),
      candidate(-1, 8, 200),
      candidate(15, 8, 200),
      candidate(0.5, 8, 200),
      candidate(7, 8, 80, 5),
      candidate(9, 8, NaN),
    ];
    for (let seed = 0; seed < 50; seed++) {
      expect(rapfi.selectRapfiMove(pos, candidates, { ...options, seed, evalMargin: 0 })).toEqual({
        x: 7,
        y: 8,
      });
    }
    expect(() => rapfi.selectRapfiMove(empty, [], options)).toThrow('no legal candidates');
    expect(
      rapfi.selectRapfiMove(empty, [candidate(1, 2, -120), candidate(3, 4, -80)], {
        ...options,
        evalMargin: 20,
      }),
    ).toEqual({ x: 3, y: 4 });
  });

  it.each([1, 2] as const)('always completes a five or blocks a four for side %s', (turn) => {
    const row = (player: 1 | 2, y: number) => [4, 5, 6, 7].map((x) => ({ x, y, player }));
    const other = turn === 1 ? 2 : 1;
    for (let seed = 0; seed < 50; seed++) {
      const opts = { candidateCount: 1, evalMargin: 0, seed };
      // Safe points deliberately absent from the candidate set and outside its margin.
      const win = rapfi.selectRapfiMove(
        { turn, stones: [...row(turn, 7), { x: 3, y: 7, player: other }, ...row(other, 9)] },
        [candidate(0, 0, 30000)],
        opts,
      );
      expect(win).toEqual({ x: 8, y: 7 });
      const block = rapfi.selectRapfiMove({ turn, stones: row(other, 7) }, choices(), opts);
      expect([
        { x: 3, y: 7 },
        { x: 8, y: 7 },
      ]).toContainEqual(block);
      const edge = rapfi.selectRapfiMove(
        { turn, stones: [0, 1, 2, 3].map((i) => ({ x: i, y: 14 - i, player: other })) },
        [],
        opts,
      );
      expect(edge).toEqual({ x: 4, y: 10 });
    }
  });

  it.each([
    [0, 1],
    [1, 1],
    [1, -1],
  ])('protects fours in direction %j', (dx, dy) => {
    const stones = [0, 1, 2, 3].map((i) => ({ x: 4 + dx * i, y: 7 + dy * i, player: 2 as const }));
    const block = rapfi.selectRapfiMove({ turn: 1, stones }, choices(), options);
    expect([
      { x: 4 - dx, y: 7 - dy },
      { x: 4 + dx * 4, y: 7 + dy * 4 },
    ]).toContainEqual(block);
    const win = rapfi.selectRapfiMove({ turn: 2, stones }, [], options);
    expect([
      { x: 4 - dx, y: 7 - dy },
      { x: 4 + dx * 4, y: 7 + dy * 4 },
    ]).toContainEqual(win);
  });

  it.each([
    { evalMargin: -1 },
    { evalMargin: Infinity },
    { seed: NaN },
    { seed: 1.5 },
    { candidateCount: 0 },
  ])('rejects invalid selection options %j', (override) => {
    expect(() => rapfi.selectRapfiMove(empty, choices(), { ...options, ...override })).toThrow();
  });
});

function controlled() {
  let receive: (data: unknown) => void = () => {};
  const postMessage = vi.fn();
  const terminate = vi.fn();
  const create = vi.fn(() => ({
    listen(onMessage: typeof receive) {
      receive = onMessage;
    },
    postMessage,
    terminate,
  }));
  const engine = new rapfi.Rapfi(create);
  return {
    engine,
    create,
    postMessage,
    terminate,
    get receive() {
      return receive;
    },
    output(text: string) {
      for (const line of text.split('\n')) receive({ type: 'line', line });
      receive({ type: 'done', elapsedMs: 10 });
    },
  };
}

describe('Rapfi candidate lifecycle', () => {
  it('collects complete output, selects with a copied seed/options, and resets per request', async () => {
    const transport = controlled();
    try {
      const choice = { ...options };
      const pending = transport.engine.chooseMove(empty, 1, choice);
      choice.seed = 0;
      transport.receive({ type: 'ready' });
      expect(transport.postMessage.mock.lastCall?.[0].commands).toContain('YXNBEST 3');
      transport.output(multi);
      const candidates = rapfi.parseRapfiOutput(multi);
      await expect(pending).resolves.toEqual({
        move: rapfi.selectRapfiMove(empty, candidates, options),
        candidates,
        elapsedMs: 10,
      });
      const next = transport.engine.chooseMove(empty, 1, options);
      transport.output(single);
      await expect(next).resolves.toMatchObject({ candidates: rapfi.parseRapfiOutput(single) });
      const plain = transport.engine.chooseMove(empty, bestMoveLevel);
      expect(transport.postMessage.mock.lastCall?.[0].commands).toEqual(
        rapfi.rapfiCommands(empty, rapfi.RAPFI_LEVELS.find(({ level }) => level === bestMoveLevel)!)
          .lines,
      );
      transport.output('7,7');
      await expect(plain).resolves.toEqual({ move: { x: 7, y: 7 }, elapsedMs: 10 });
    } finally {
      transport.engine.stop();
    }
  });

  it('applies tactical protection in the adapter even with empty candidates', async () => {
    const transport = controlled();
    try {
      const pos: RapfiPosition = {
        turn: 2,
        stones: [4, 5, 6, 7].map((x) => ({ x, y: 7, player: 1 })),
      };
      const pending = transport.engine.chooseMove(pos, 1, options);
      transport.receive({ type: 'ready' });
      transport.output('0,0');
      const result = await pending;
      expect([
        { x: 3, y: 7 },
        { x: 8, y: 7 },
      ]).toContainEqual(result.move);
    } finally {
      transport.engine.stop();
    }
  });

  it('rejects missing detail without tactics and stops the worker', async () => {
    const transport = controlled();
    const pending = transport.engine.chooseMove(empty, 1, options);
    transport.receive({ type: 'ready' });
    transport.output('MESSAGE (1) 100 | 8-12 | H8\n7,7');
    await expect(pending).rejects.toThrow('no legal candidates');
    expect(transport.terminate).toHaveBeenCalledOnce();
  });

  it('rejects invalid options before starting a worker', async () => {
    const transport = controlled();
    await expect(transport.engine.chooseMove(empty, 1, { ...options, seed: -1 })).rejects.toThrow(
      'choice options',
    );
    expect(transport.create).not.toHaveBeenCalled();
  });

  it.each(['initializing', 'searching'])(
    'cancels while %s and ignores the old worker',
    async (phase) => {
      const transport = controlled();
      try {
        const pending = transport.engine.chooseMove(empty, 1, options);
        const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        const staleReceive = transport.receive;
        if (phase === 'searching') {
          transport.receive({ type: 'ready' });
          for (const line of multi.split('\n')) transport.receive({ type: 'line', line });
        }
        transport.engine.stop();
        await cancelled;
        expect(transport.terminate).toHaveBeenCalledOnce();

        const next = transport.engine.chooseMove(empty, 1, options);
        expect(transport.create).toHaveBeenCalledTimes(2);
        staleReceive({ type: 'ready' });
        for (const line of multi.split('\n')) staleReceive({ type: 'line', line });
        staleReceive({ type: 'done', elapsedMs: 10 });
        staleReceive({ type: 'error', error: 'late worker error' });
        expect(transport.postMessage.mock.lastCall?.[0]).toEqual({ type: 'init' });
        transport.receive({ type: 'ready' });
        transport.output(single);
        await expect(next).resolves.toEqual({
          move: { x: 7, y: 8 },
          candidates: rapfi.parseRapfiOutput(single),
          elapsedMs: 10,
        });
      } finally {
        transport.engine.stop();
      }
    },
  );
});

/** Rapfi's getPosition (command/gomocup.cpp) places the listed stones in order, alternating
 * sides with a pass between two of the same side, then searches for whoever comes after the
 * last one: field 1 alone does not make a side the one to move. */
const rapfiSearchesFieldOne = (lines: readonly string[]) => {
  const stones = lines.filter((line) => /^\d+,\d+,[12]$/.test(line));
  return stones.length === 0 || stones.at(-1)!.endsWith(',2');
};

describe('Rapfi board order', () => {
  // 11-01: board-index order put the side to move last whenever it held the highest square,
  // so Rapfi searched for the opponent on about half of all positions.
  const positions: [string, RapfiPosition][] = [
    [
      'Black to move, Black holds o15',
      {
        turn: 1,
        stones: [
          { x: 0, y: 0, player: 2 },
          { x: 14, y: 14, player: 1 },
        ],
      },
    ],
    [
      'White to move, White holds o15',
      {
        turn: 2,
        stones: [
          { x: 7, y: 7, player: 1 },
          { x: 8, y: 8, player: 1 },
          { x: 14, y: 14, player: 2 },
        ],
      },
    ],
    [
      'White to move, Black holds o15',
      {
        turn: 2,
        stones: [
          { x: 7, y: 7, player: 2 },
          { x: 8, y: 8, player: 1 },
          { x: 14, y: 14, player: 1 },
        ],
      },
    ],
  ];

  it.each(positions)('searches for the side to move: %s', (_name, position) => {
    for (const candidateCount of [undefined, 1]) {
      const { lines } = rapfi.rapfiCommands(position, { nodes: 1, timeMs: 1, candidateCount });
      const board = lines.flatMap((line) => line.split('\n'));
      expect(rapfiSearchesFieldOne(board)).toBe(true);
    }
  });

  it.each(positions)(
    'lists every stone once and alternates without passes: %s',
    (_name, position) => {
      const lines = shared.rapfiBoardLines(position);
      expect([...lines].sort()).toEqual(
        position.stones.map((s) => `${s.x},${s.y},${s.player === position.turn ? 1 : 2}`).sort(),
      );
      expect(lines.every((line, i) => i === 0 || line.at(-1) !== lines[i - 1]!.at(-1))).toBe(true);
    },
  );

  it('refuses a board where only the side to move has stones', () => {
    expect(() => shared.rapfiBoardLines({ turn: 1, stones: [{ x: 7, y: 7, player: 1 }] })).toThrow(
      /opponent/,
    );
  });
});
