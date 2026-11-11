import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMove as applyXiangqiMove,
  createInitialXiangqiState,
  getLegalMoves as getXiangqiLegalMoves,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiSquare,
  coordOf as xiangqiCoordOf,
} from '@mistboard/game';
import type { DarkXiangqiEvent } from '../dark-xiangqi-runtime.js';
import { getDarkXiangqiClientView } from '../dark-xiangqi-tenant.js';
import { buildXiangqiEngineTurnRequest, buildXiangqiObservationForPly } from './build-xiangqi.js';

test('DXQ request: geometry, color mapping, and variant tag', () => {
  const state = createInitialXiangqiState('dxq-geo');
  const req = buildXiangqiEngineTurnRequest({
    gameId: 'dxq-geo',
    engineId: 'python-fdx-v1.0',
    engineSecret: 'test-secret',
    engineColor: 'red',
    state,
    events: [],
    ply: 0,
    clockRemainingMs: 60_000,
    incrementMs: 1_000,
  });

  assert.equal(req.gameSpecId, 'dark-xiangqi');
  assert.equal(req.protocolVersion, '1');
  assert.equal(req.color, 'white');
  for (const obs of req.observationTranscript ?? []) {
    for (const [idx] of obs.visible_pieces)
      assert.ok(idx >= 0 && idx <= 89, `idx ${idx} out of 9x10`);
  }
  const expected = new Set(getXiangqiLegalMoves(state).map((m) => `${m.from}${m.to}`));
  assert.equal(req.legalMoves.length, expected.size);
  for (const m of req.legalMoves) assert.ok(expected.has(`${m.from}${m.to}`));
});

test('DXQ observation uses 9-wide indexing through i10 and a 90-bit mask', () => {
  const state: XiangqiGameState = {
    ...createInitialXiangqiState('dxq-i10'),
    board: {
      i1: { color: 'red', role: 'chariot' },
      i10: { color: 'black', role: 'chariot' },
      a10: { color: 'black', role: 'general' },
    },
    status: { type: 'playing', turn: 'red' },
  };
  const obs = buildXiangqiObservationForPly({
    prevState: null,
    nextState: state,
    move: null,
    perspective: 'red',
    ply: 0,
  });

  const visible = new Set(obs.visible_pieces.map(([idx]) => idx));
  assert.ok(visible.has(8), 'i1 should be idx 8');
  assert.ok(visible.has(89), 'i10 should be idx 89');
  assert.equal(visible.has(81), false, 'a10 should stay hidden off the i-file');
  const mask = BigInt(obs.visibility_mask);
  assert.equal((mask & (1n << 89n)) !== 0n, true);
  assert.equal((mask & (1n << 81n)) !== 0n, false);
});

test('DXQ shrouds cannon-screen identity to color-only by default; =0 restores the legacy request', () => {
  const state: XiangqiGameState = {
    ...createInitialXiangqiState('dxq-shroud'),
    board: {
      e1: { color: 'red', role: 'cannon' }, // red cannon eyes up the e-file
      e5: { color: 'black', role: 'horse' }, // the SCREEN (idx 40)
      e8: { color: 'black', role: 'chariot' }, // the TARGET beyond it (idx 67)
    },
    status: { type: 'playing', turn: 'red' },
  };
  const build = () =>
    buildXiangqiObservationForPly({
      prevState: null,
      nextState: state,
      move: null,
      perspective: 'red',
      ply: 0,
    });

  // Default: the screen (e5) is color-only shrouded; the target (e8) stays revealed.
  delete process.env.MISTBOARD_XIANGQI_SHROUD_BLOCKERS;
  const on = build();
  const shrouded = new Map((on.shrouded ?? []).map(([i, c]) => [i, c]));
  assert.equal(shrouded.get(40), 'black', 'e5 screen shrouded color-only');
  assert.equal(
    on.visible_pieces.some(([i]) => i === 40),
    false,
    'e5 screen not fully identified',
  );
  assert.equal(
    on.visible_pieces.find(([i]) => i === 67)?.[1].type,
    'R',
    'e8 target still revealed',
  );

  // Rollback lever: the legacy request names the screen (horse), nothing shrouded.
  process.env.MISTBOARD_XIANGQI_SHROUD_BLOCKERS = '0';
  try {
    const off = build();
    assert.equal(off.shrouded, undefined);
    assert.equal(
      off.visible_pieces.find(([i]) => i === 40)?.[1].type,
      'N',
      'screen fully identified on rollback',
    );
  } finally {
    delete process.env.MISTBOARD_XIANGQI_SHROUD_BLOCKERS;
  }
});

test('DXQ shrouds a blocked horse leg and elephant eye to color-only', () => {
  delete process.env.MISTBOARD_XIANGQI_SHROUD_BLOCKERS;
  const state: XiangqiGameState = {
    ...createInitialXiangqiState('dxq-legs'),
    board: {
      e1: { color: 'red', role: 'general' },
      b3: { color: 'red', role: 'horse' },
      b4: { color: 'black', role: 'chariot' }, // blocks the horse's forward leg (idx 28)
      g1: { color: 'red', role: 'elephant' },
      f2: { color: 'black', role: 'soldier' }, // blocks the elephant's eye toward e3 (idx 14)
      e10: { color: 'black', role: 'general' },
    },
    status: { type: 'playing', turn: 'red' },
  };
  const obs = buildXiangqiObservationForPly({
    prevState: null,
    nextState: state,
    move: null,
    perspective: 'red',
    ply: 0,
  });
  const shrouded = new Map((obs.shrouded ?? []).map(([i, c]) => [i, c]));
  const identified = new Set(obs.visible_pieces.map(([i]) => i));
  for (const idx of [28, 14]) {
    assert.equal(shrouded.get(idx), 'black', `blocker ${idx} shrouded color-only`);
    assert.equal(identified.has(idx), false, `blocker ${idx} carries no identity`);
  }
});

function squareIndex(sq: XiangqiSquare): number {
  const { file, rank } = xiangqiCoordOf(sq);
  return (rank - 1) * 9 + file;
}

// #420 regression: the engine request for a seat carries exactly what that
// seat's human wire view carries. Seeded random games, both seats, every ply.
test('DXQ engine request equals the seat view at every ply (no identity for shrouded pieces)', () => {
  delete process.env.MISTBOARD_XIANGQI_SHROUD_BLOCKERS;
  let seed = 420;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let shroudedSeen = 0;
  for (let g = 0; g < 6; g++) {
    const gameId = `dxq-parity-${g}`;
    let state = createInitialXiangqiState(gameId);
    const events: DarkXiangqiEvent[] = [];
    const states: XiangqiGameState[] = [state];
    for (let ply = 0; ply < 60 && state.status.type === 'playing'; ply++) {
      const legal = getXiangqiLegalMoves(state);
      const move = legal[Math.floor(rnd() * legal.length)] as XiangqiMove;
      state = applyXiangqiMove(state, move);
      events.push({ type: 'move-played', move } as unknown as DarkXiangqiEvent);
      states.push(state);
    }
    for (const seat of ['red', 'black'] as const) {
      const req = buildXiangqiEngineTurnRequest({
        gameId,
        engineId: 'python-fdx-v1.2',
        engineSecret: 'test-secret',
        engineColor: seat,
        state,
        events,
        ply: events.length,
        clockRemainingMs: null,
        incrementMs: 0,
      });
      const transcript = req.observationTranscript ?? [];
      assert.equal(transcript.length, states.length);
      transcript.forEach((obs, ply) => {
        const view = getDarkXiangqiClientView(states[ply]!, { id: 'c', seat, solo: false });
        const wantMask = view.visibleSquares.reduce(
          (m, sq) => m | (1n << BigInt(squareIndex(sq))),
          0n,
        );
        const wantVisible: Array<[number, string, string]> = [];
        const wantShrouded: Array<[number, string]> = [];
        for (const [sq, entry] of Object.entries(view.board)) {
          if (!entry) continue;
          const idx = squareIndex(sq as XiangqiSquare);
          const protoColor = (c: string) => (c === 'red' ? 'white' : 'black');
          if (entry.shrouded) wantShrouded.push([idx, protoColor(entry.color)]);
          else wantVisible.push([idx, protoColor(entry.piece.color), entry.piece.role]);
        }
        const where = `game ${g} ${seat} ply ${ply}`;
        assert.equal(BigInt(obs.visibility_mask), wantMask, `${where}: mask`);
        assert.deepEqual(
          obs.shrouded ?? [],
          wantShrouded.sort((a, b) => a[0] - b[0]),
          `${where}: shrouded`,
        );
        const role = {
          K: 'general',
          A: 'advisor',
          B: 'elephant',
          N: 'horse',
          R: 'chariot',
          C: 'cannon',
          P: 'soldier',
        };
        assert.deepEqual(
          obs.visible_pieces.map(([i, p]) => [i, p.color, role[p.type as keyof typeof role]]),
          wantVisible.sort((a, b) => a[0] - b[0]),
          `${where}: identified pieces`,
        );
        shroudedSeen += wantShrouded.length;
      });
    }
  }
  assert.ok(shroudedSeen > 50, `fixture exercises shrouded squares (saw ${shroudedSeen})`);
});
