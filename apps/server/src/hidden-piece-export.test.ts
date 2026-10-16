// The hidden-piece export end to end (#484), through the REAL registrations:
// a site game of each variant (dealt at creation, as every site game is) is
// played out as a tenant event log, exported through resolveGameExport as JSON
// and as PGN, and rebuilt by the reference replayer in @mistboard/game from the
// download alone, with and without its deal. The deal and the movetext must
// agree at every reveal and capture, and both must land on the server's own
// final position. An unfinished game must export nothing, so no deal (and no
// reveal) can leave the server while the game is live.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyBanqiMove,
  applyJieqiMove,
  applyJungleFlipMove,
  type BanqiGameState,
  banqiStateToDealtFen,
  banqiStateToEngineFen,
  createBanqiDeal,
  createInitialBanqiState,
  createInitialJieqiState,
  createInitialJungleFlipState,
  createJieqiDeal,
  createJungleFlipDeal,
  getBanqiLegalMoves,
  getJieqiLegalMoves,
  getJungleFlipLegalMoves,
  type HiddenPieceVariant,
  type JieqiGameState,
  type JungleFlipGameState,
  jieqiStateToDealtFen,
  jieqiStateToPikafishFen,
  jungleFlipStateToDealtFen,
  jungleFlipStateToEngineFen,
  parseHiddenPiecePgn,
  replayHiddenPieceRecord,
} from '@mistboard/game';
import { banqiTenant } from './banqi-tenant.js';
import { resolveGameExport } from './game-export-tenant.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import type { RecentEveGameRecord } from './persistence.js';
import './variant-tenant/register-tenants.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Move = { from: string; to: string };

type Played = {
  roomId: string;
  variant: HiddenPieceVariant;
  events: unknown[];
  dealFen: string;
  finalFen: string;
  finished: boolean;
};

// One kernel per variant, as the tenant plays it: a deal, legal moves, apply,
// and the two FEN writers.
type Kernel<S> = {
  variant: HiddenPieceVariant;
  prefix: string;
  deal(rng: () => number): unknown;
  start(deal: unknown): S;
  moves(state: S): Move[];
  apply(state: S, move: Move): S;
  playing(state: S): boolean;
  fen(state: S): string;
  dealtFen(state: S): string;
};

const KERNELS = {
  jieqi: {
    variant: 'jieqi',
    prefix: jieqiTenant.roomIdPrefix,
    deal: createJieqiDeal,
    start: (deal) => createInitialJieqiState('x', deal as ReturnType<typeof createJieqiDeal>),
    moves: getJieqiLegalMoves,
    apply: (state, move) => applyJieqiMove(state, move as Parameters<typeof applyJieqiMove>[1]),
    playing: (state) => state.status.type === 'playing',
    fen: jieqiStateToPikafishFen,
    dealtFen: jieqiStateToDealtFen,
  } satisfies Kernel<JieqiGameState>,
  banqi: {
    variant: 'banqi',
    prefix: banqiTenant.roomIdPrefix,
    deal: createBanqiDeal,
    start: (deal) => createInitialBanqiState('x', deal as ReturnType<typeof createBanqiDeal>),
    moves: getBanqiLegalMoves,
    apply: (state, move) => applyBanqiMove(state, move as Parameters<typeof applyBanqiMove>[1]),
    playing: (state) => state.status.type === 'playing',
    fen: banqiStateToEngineFen,
    dealtFen: banqiStateToDealtFen,
  } satisfies Kernel<BanqiGameState>,
  'jungle-flip': {
    variant: 'jungle-flip',
    prefix: jungleFlipTenant.roomIdPrefix,
    deal: createJungleFlipDeal,
    start: (deal) =>
      createInitialJungleFlipState('x', deal as ReturnType<typeof createJungleFlipDeal>),
    moves: getJungleFlipLegalMoves,
    apply: (state, move) =>
      applyJungleFlipMove(state, move as Parameters<typeof applyJungleFlipMove>[1]),
    playing: (state) => state.status.type === 'playing',
    fen: jungleFlipStateToEngineFen,
    dealtFen: jungleFlipStateToDealtFen,
  } satisfies Kernel<JungleFlipGameState>,
} as const;

function play<S>(kernel: Kernel<S>, seed: number, maxPlies: number, finish: boolean): Played {
  const rng = mulberry32(seed);
  const roomId = `${kernel.prefix}hp${seed}`;
  const deal = kernel.deal(rng);
  let state = kernel.start(deal);
  const dealFen = kernel.dealtFen(state);
  const events: unknown[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: kernel.variant, setup: deal },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];
  let ply = 0;
  while (kernel.playing(state) && ply < maxPlies) {
    const moves = kernel.moves(state);
    const move = moves[Math.floor(rng() * moves.length)]!;
    const color = ply % 2 === 0 ? 'red' : 'black';
    events.push({ type: 'move-played', at: 10 + ply, roomId, color, move });
    state = kernel.apply(state, move);
    ply += 1;
  }
  if (finish && kernel.playing(state)) {
    events.push({ type: 'seat-resigned', at: 10 + ply, roomId, color: 'black' });
  }
  return {
    roomId,
    variant: kernel.variant,
    events,
    dealFen,
    finalFen: kernel.fen(state),
    finished: finish || !kernel.playing(state),
  };
}

function summary(played: Played): RecentEveGameRecord {
  return {
    roomId: played.roomId,
    variant: played.variant,
    mode: 'pvp',
    result: 'red-wins',
    termination: 'resignation',
    plyCount: 0,
    startedAt: new Date('2026-09-14T10:00:00Z'),
    endedAt: new Date('2026-09-14T10:20:00Z'),
    whiteName: 'alice',
    blackName: 'bob',
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: 300000,
    incrementMs: 3000,
  };
}

function exportBody(played: Played, format: 'json' | 'pgn') {
  return resolveGameExport({
    roomId: played.roomId,
    format,
    summary: summary(played),
    events: played.events,
  });
}

for (const kernel of Object.values(KERNELS) as Kernel<unknown>[]) {
  test(`${kernel.variant}: a finished site game's JSON and PGN replay alone and against the deal`, () => {
    let reveals = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const played = play(kernel, seed, 200, true);
      const json = exportBody(played, 'json');
      assert.equal(json.status, 200, `seed ${seed}`);
      if (json.status !== 200) return;
      const record = JSON.parse(json.body);
      assert.equal(record.schema_version, '1.1');
      assert.equal(record.deal_fen, played.dealFen, 'a site game carries its deal');
      reveals += record.plies.filter((p: { revealed?: unknown }) => p.revealed).length;

      // Against the deal: every reveal and capture must agree with it.
      const pinned = replayHiddenPieceRecord(record);
      assert.ok(pinned.ok, `seed ${seed}: ${JSON.stringify(pinned)}`);
      assert.equal(pinned.finalFen, played.finalFen, `seed ${seed}`);
      // From the moves alone.
      const alone = replayHiddenPieceRecord({ ...record, deal_fen: undefined });
      assert.ok(alone.ok, `seed ${seed}: ${JSON.stringify(alone)}`);
      assert.equal(alone.finalFen, played.finalFen, `seed ${seed}`);

      const pgn = exportBody(played, 'pgn');
      assert.equal(pgn.status, 200);
      if (pgn.status !== 200) return;
      const parsed = parseHiddenPiecePgn(pgn.body);
      assert.ok(parsed.ok, JSON.stringify(parsed));
      assert.equal(parsed.tags.DealFEN, played.dealFen);
      assert.equal(parsed.tags.SetUp, '1');
      assert.equal(parsed.tags.MistboardVariant, kernel.variant);
      assert.equal(parsed.record.plies.length, record.plies.length);
      const fromPgn = replayHiddenPieceRecord(parsed.record);
      assert.ok(fromPgn.ok, `seed ${seed}: ${JSON.stringify(fromPgn)}`);
      assert.equal(fromPgn.finalFen, played.finalFen);
      const pgnAlone = replayHiddenPieceRecord({ ...parsed.record, deal_fen: undefined });
      assert.ok(pgnAlone.ok);
      assert.equal(pgnAlone.finalFen, played.finalFen);
    }
    assert.ok(reveals > 0);
  });

  test(`${kernel.variant}: an unfinished game exports nothing, so its deal never leaves the server`, () => {
    const played = play(kernel, 5, 6, false);
    assert.equal(played.finished, false);
    for (const format of ['json', 'pgn'] as const) {
      const resolved = exportBody(played, format);
      assert.equal(resolved.status, 403, format);
      assert.deepEqual(resolved.body, { error: 'game_not_public' });
      assert.equal(JSON.stringify(resolved).includes(played.dealFen.split(' ')[5]!), false);
    }
  });
}

// The recorded postgame fixtures (real logs, one per variant) export and replay
// the same way: what a third party downloads for a game the site played.
const POSTGAME_FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/variant-postgame',
);

for (const variant of ['jieqi', 'banqi', 'jungle-flip'] as const) {
  test(`${variant}: the recorded postgame fixture replays from its JSON and its PGN`, () => {
    const events = readFileSync(`${POSTGAME_FIXTURES}/${variant}.jsonl`, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as { roomId: string; setup?: unknown });
    const roomId = events[0]!.roomId;
    assert.ok(events[0]!.setup, 'the fixture was dealt at creation');
    const played: Played = { roomId, variant, events, dealFen: '', finalFen: '', finished: true };
    const json = exportBody(played, 'json');
    assert.equal(json.status, 200);
    if (json.status !== 200) return;
    const record = JSON.parse(json.body);
    assert.ok(record.deal_fen);
    const pinned = replayHiddenPieceRecord(record);
    assert.ok(pinned.ok, JSON.stringify(pinned));
    const alone = replayHiddenPieceRecord({ ...record, deal_fen: undefined });
    assert.ok(alone.ok, JSON.stringify(alone));
    assert.equal(alone.finalFen, pinned.finalFen);
    const pgn = exportBody(played, 'pgn');
    assert.equal(pgn.status, 200);
    if (pgn.status !== 200) return;
    const parsed = parseHiddenPiecePgn(pgn.body);
    assert.ok(parsed.ok);
    const fromPgn = replayHiddenPieceRecord(parsed.record);
    assert.ok(fromPgn.ok);
    assert.equal(fromPgn.finalFen, pinned.finalFen);
  });
}
