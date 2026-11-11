import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyBanqiMove,
  type BanqiGameState,
  banqiMoveToEngineUci,
  createInitialBanqiState,
  getBanqiForbiddenChaseMoves,
  getBanqiLegalMoves,
} from '@mistboard/game';
import {
  BanqiProviderError,
  buildBanqiProviderRequest,
  parseBanqiProviderRequest,
  parseBanqiProviderResponse,
  providerRequestState,
  providerResponse,
} from './banqi-provider-protocol.js';

export function requestFor(
  state = createInitialBanqiState('provider-test', undefined, {
    noProgressLimit: 60,
    chaseRule: 'repetition',
  }),
) {
  return buildBanqiProviderRequest({
    state,
    requestId: 'turn-1',
    engineId: 'test-engine',
    nowMs: Date.now(),
    budgetMs: 1000,
    remainingMs: 300_000,
    incrementMs: 5000,
    nodes: 64,
  });
}

function swapped(state: BanqiGameState): BanqiGameState {
  const copy = structuredClone(state);
  const hidden = Object.entries(copy.board).filter(([, piece]) => piece?.faceDown);
  const first = hidden[0];
  const second = hidden.find(
    ([, piece]) => piece!.role !== first?.[1]?.role || piece!.color !== first?.[1]?.color,
  );
  if (first && second)
    [
      copy.board[first[0] as keyof typeof copy.board],
      copy.board[second[0] as keyof typeof copy.board],
    ] = [second[1], first[1]];
  return copy;
}

test('whole Banqi provider request is invariant under covered-piece permutations through reveals and captures', () => {
  let state = createInitialBanqiState('public-game', undefined, {
    noProgressLimit: 60,
    chaseRule: 'repetition',
  });
  let sawReveal = false;
  let sawCapture = false;
  let seed = 73;
  for (let ply = 0; ply < 300 && state.status.type === 'playing'; ply += 1) {
    const input = {
      requestId: 'public-turn',
      engineId: 'test-engine',
      nowMs: 10,
      budgetMs: 1000,
      remainingMs: 300_000,
      incrementMs: 5000,
    };
    const before = buildBanqiProviderRequest({ ...input, state });
    const after = buildBanqiProviderRequest({ ...input, state: swapped(state) });
    assert.equal(JSON.stringify(before), JSON.stringify(after), `whole request at ply ${ply}`);
    assert.equal(before.position.fen.split(' ').length, 5);
    assert.deepEqual(
      Object.keys(before).sort(),
      [
        'clock',
        'engineId',
        'gameId',
        'ink',
        'legalMoves',
        'limits',
        'ply',
        'position',
        'protocol',
        'repetition',
        'requestId',
        'rules',
        'seat',
      ].sort(),
    );
    const legal = getBanqiLegalMoves(state);
    const captures = legal.filter((move) => move.from !== move.to && state.board[move.to]);
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const move = captures[0] ?? legal[seed % legal.length]!;
    sawReveal ||= move.from === move.to;
    sawCapture ||= move.from !== move.to && !!state.board[move.to];
    state = applyBanqiMove(state, move);
  }
  assert.ok(sawReveal && sawCapture, 'exercise opening, reveals, and captures');
});

test('binding, zero-indexed coordinates and historical rules survive a stateless request', () => {
  const initial = createInitialBanqiState('legacy-game', undefined, {
    noProgressLimit: 40,
    chaseRule: null,
  });
  const opening = requestFor(initial);
  assert.equal(opening.seat, 'first');
  assert.equal(opening.ink, null);
  assert.ok(opening.legalMoves.includes('a0a0'));
  const next = applyBanqiMove(initial, { from: 'a1', to: 'a1' });
  const request = requestFor(next);
  assert.equal(request.seat, 'second');
  assert.equal(request.ink, 'black');
  assert.deepEqual(request.rules, { noProgressPlies: 40, chase: null, repetitionCount: 3 });
  assert.deepEqual(getBanqiLegalMoves(providerRequestState(request)), getBanqiLegalMoves(next));
  assert.deepEqual(requestFor().rules, {
    noProgressPlies: 60,
    chase: 'repetition',
    repetitionCount: 3,
  });
});

test('chase positions carry only public history and exclude the forbidden root move', () => {
  let state: BanqiGameState = {
    id: 'chase-test',
    board: {
      c3: { color: 'red', role: 'advisor', faceDown: false },
      d2: { color: 'black', role: 'chariot', faceDown: false },
      h1: { color: 'red', role: 'soldier', faceDown: false },
      a4: { color: 'black', role: 'soldier', faceDown: false },
      f4: { color: 'black', role: 'horse', faceDown: true },
      g4: { color: 'red', role: 'elephant', faceDown: true },
    },
    status: { type: 'playing', turn: 'red' },
    ply: 10,
    firstColor: 'red',
    moveNumber: 6,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
    lastMove: { from: 'e2', to: 'd2' },
    noProgressLimit: 60,
    chaseRule: 'repetition',
  };
  for (let loop = 0; loop < 2; loop += 1) {
    for (const move of [
      { from: 'c3', to: 'c2' },
      { from: 'd2', to: 'd3' },
      { from: 'c2', to: 'c3' },
      { from: 'd3', to: 'd2' },
    ] as const)
      state = applyBanqiMove(state, move);
  }
  const forbidden = getBanqiForbiddenChaseMoves(state).map(banqiMoveToEngineUci);
  assert.ok(forbidden.length);
  const request = requestFor(state);
  assert.ok(Object.keys(request.repetition.positions).length);
  assert.ok(forbidden.every((move) => !request.legalMoves.includes(move)));
  const hiddenSwap = requestFor(swapped(state));
  assert.equal(JSON.stringify(request), JSON.stringify({ ...hiddenSwap, limits: request.limits }));
  assert.throws(
    () => providerResponse(request, forbidden[0]!),
    (error) => error instanceof BanqiProviderError && error.code === 'illegal-move',
  );
});

test('request refuses hidden sixth FEN fields, extra metadata and illegal root tokens', () => {
  const request = requestFor();
  for (const malformed of [
    { ...request, hiddenDeal: ['red-general'] },
    { ...request, position: { ...request.position, fen: `${request.position.fen} secret` } },
    { ...request, repetition: { ...request.repetition, fen: `${request.repetition.fen} secret` } },
    { ...request, legalMoves: ['a0a0\nquit'] },
    { ...request, legalMoves: ['a0b0'] },
    { ...request, seat: 'second' },
  ])
    assert.throws(() => parseBanqiProviderRequest(malformed), BanqiProviderError);
});

test('responses bind game/request/ply, and move-only providers have no invented evaluation', () => {
  const request = requestFor();
  const response = providerResponse(request, request.legalMoves[0]!);
  assert.equal('analysis' in response, false);
  for (const changed of [
    { requestId: 'other' },
    { gameId: 'other' },
    { ply: 1 },
    { protocol: 'other' },
  ]) {
    assert.throws(
      () => parseBanqiProviderResponse({ ...response, ...changed }, request),
      BanqiProviderError,
    );
  }
  assert.throws(
    () => parseBanqiProviderResponse({ ...response, move: 'a0b0' }, request),
    BanqiProviderError,
  );
});

test('probabilities and normalized WDL keep their own units and stated perspective', () => {
  const request = requestFor();
  const base = providerResponse(request, request.legalMoves[0]!);
  for (const score of [
    { type: 'win-probability', value: 0.7, pov: 'side-to-move' },
    { type: 'wdl', win: 0.3, draw: 0.5, loss: 0.2, pov: 'side-to-move' },
  ])
    assert.deepEqual(
      parseBanqiProviderResponse({ ...base, analysis: { score } }, request).analysis?.score,
      score,
    );
  for (const score of [
    { type: 'win-probability', value: 1.1, pov: 'side-to-move' },
    { type: 'wdl', win: 0.5, draw: 0.5, loss: 0.5, pov: 'side-to-move' },
    { type: 'cp', value: NaN, pov: 'side-to-move' },
    { type: 'win-probability', value: 0.2, pov: 'red' },
  ])
    assert.throws(
      () => parseBanqiProviderResponse({ ...base, analysis: { score } }, request),
      BanqiProviderError,
    );
});

test('the contributor sample exchange is built and validated by this exact protocol', () => {
  const sample = JSON.parse(
    readFileSync(
      new URL('../../../docs/examples/banqi-provider-request.json', import.meta.url),
      'utf8',
    ),
  );
  const built = buildBanqiProviderRequest({
    state: createInitialBanqiState('example-game', undefined, {
      noProgressLimit: 60,
      chaseRule: 'repetition',
    }),
    requestId: 'example-turn',
    engineId: 'example-engine',
    nowMs: 0,
    budgetMs: 1000,
    remainingMs: 300000,
    incrementMs: 5000,
    nodes: 64,
  });
  assert.deepEqual(sample, built);
  const response = JSON.parse(
    readFileSync(
      new URL('../../../docs/examples/banqi-provider-response.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(parseBanqiProviderResponse(response, built), providerResponse(built, 'a0a0'));
});
