import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  JIEQI_SPEC_ID,
  parseHiddenPiecePgn,
  replayHiddenPieceRecord,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { banqiTenant } from './banqi-tenant.js';
import {
  buildImportedJieqiGame,
  type EngineMatchManifest,
  type EnrichedMatchGame,
  engineMatchRoomId,
  engineMatchTiming,
  type ImportedEngineMatchGame,
  parseEnrichedMatchJsonl,
} from './engine-match-import.js';
import { buildTenantGamePgn, buildTenantGamePublicationJson } from './game-export-tenant.js';
import type { JieqiEvent } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import type { RecentEveGameRecord } from './persistence.js';
import { jieqiPostgameForApi } from './routes/jieqi-games.js';
import './variant-tenant/register-tenants.js';
import { variantTenantForRoomId } from './variant-tenant/registry.js';
import { isTenantEvent, replayTenantEvents } from './variant-tenant/runtime.js';
import { isTenantGameOrigin } from './variant-tenant/tenant.js';

// Three games cut from the AB-JChess vs PikaJieQi run7 match, enriched by
// mistboard-engine lab/jieqi-abjchess-2026-09-29/enrich_match.py:
//   366: AB-JChess (red) mates PikaJieQi in 23 plies  (no-move-B)
//    45: PikaJieQi (red) mates AB-JChess in 23 plies  (no-move-A)
//    63: threefold repetition draw at ply 44          (repetition)
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'src', 'fixtures', 'engine-match', 'run7-sample.enriched.jsonl');
const games = parseEnrichedMatchJsonl(readFileSync(FIXTURE, 'utf8'));
const byNumber = (n: number): EnrichedMatchGame => {
  const game = games.find((g) => g.game === n);
  assert.ok(game, `fixture game ${n}`);
  return structuredClone(game);
};

const MANIFEST = JSON.parse(
  readFileSync(
    join(HERE, '..', 'src', 'fixtures', 'engine-match', 'run7-sample.match.json'),
    'utf8',
  ),
) as EngineMatchManifest;

const TOTAL = 400;

function build(game: EnrichedMatchGame) {
  return buildImportedJieqiGame(MANIFEST, game, TOTAL);
}

test('engine match: room ids are stable and predictable from slug + game number', () => {
  assert.equal(engineMatchRoomId(MANIFEST.slug, 7), 'jq_ab-jchess-vs-pikajieqi-4s-2026-09-007');
  const result = build(byNumber(366));
  assert.ok(result.ok);
  assert.equal(result.value.roomId, 'jq_ab-jchess-vs-pikajieqi-4s-2026-09-366');
  // Same input, same output: re-running an import addresses the same rows.
  assert.deepEqual(build(byNumber(366)), result);
});

test('engine match: decisive games end by the kernel, with the engines as the seats', () => {
  const aWin = build(byNumber(366));
  assert.ok(aWin.ok, aWin.ok ? '' : aWin.error);
  const { summary, events } = aWin.value;
  assert.equal(summary.mode, 'imported');
  assert.equal(summary.corpusId, MANIFEST.slug);
  assert.equal(summary.rated, false);
  assert.equal(summary.visibility, 'public');
  assert.equal(summary.result, 'red-wins');
  assert.equal(summary.termination, 'checkmate');
  assert.equal(summary.plyCount, 23);
  assert.equal(summary.whiteName, 'AB-JChess'); // red seat
  assert.equal(summary.blackName, 'PikaJieQi');
  assert.deepEqual(
    summary.participants?.map((p) => [p.color, p.displayName, p.subjectType, p.subjectId]),
    [
      ['red', 'AB-JChess', 'imported', null],
      ['black', 'PikaJieQi', 'imported', null],
    ],
  );
  // No seat events, no adjudication: the last move ends the game.
  assert.deepEqual([...new Set(events.map((e) => e.type))], ['room-created', 'move-played']);
  const projection = replayTenantEvents(jieqiTenant, events);
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'red',
    reason: 'checkmate',
  });

  const bWin = build(byNumber(45));
  assert.ok(bWin.ok, bWin.ok ? '' : bWin.error);
  assert.equal(bWin.value.summary.result, 'red-wins');
  assert.equal(bWin.value.summary.whiteName, 'PikaJieQi');
  assert.equal(bWin.value.summary.blackName, 'AB-JChess');
});

test('engine match: a lab repetition draw becomes a trailing game-adjudicated event', () => {
  const draw = build(byNumber(63));
  assert.ok(draw.ok, draw.ok ? '' : draw.error);
  const events = draw.value.events;
  const last = events.at(-1);
  assert.equal(last?.type, 'game-adjudicated');
  assert.equal(draw.value.summary.result, 'draw');
  assert.equal(draw.value.summary.termination, 'repetition');
  // Without the adjudication the kernel would still have the game running.
  assert.equal(replayTenantEvents(jieqiTenant, events.slice(0, -1)).state.status.type, 'playing');
  assert.deepEqual(replayTenantEvents(jieqiTenant, events).state.status, {
    type: 'finished',
    winner: null,
    reason: 'repetition',
  });
});

test('engine match: every reveal replays to the lab identity', () => {
  for (const n of [366, 45, 63]) {
    const game = byNumber(n);
    const result = build(game);
    assert.ok(result.ok, result.ok ? '' : result.error);
    const created = result.value.events[0];
    assert.equal(created?.type, 'room-created');
    // The deal is a full valid 15+15 permutation (createInitialState validates it).
    replayTenantEvents(jieqiTenant, [created!]);
    assert.ok(game.moves.some((m) => m.reveal !== null));
  }
});

test('engine match: the kernel rejects a game that does not replay', () => {
  const illegal = byNumber(366);
  illegal.moves[4]!.move = 'a0a9';
  const a = build(illegal);
  assert.equal(a.ok, false);
  assert.match(a.ok ? '' : a.error, /ply 5 .*(illegal|reveal|capture)/);

  const wrongReveal = byNumber(366);
  const reveal = wrongReveal.moves.find((m) => m.reveal !== null)!;
  reveal.reveal = reveal.reveal === 'soldier' ? 'cannon' : 'soldier';
  const b = build(wrongReveal);
  assert.equal(b.ok, false);
  assert.match(b.ok ? '' : b.error, /reveal/);

  const wrongEnding = byNumber(366);
  wrongEnding.reason = 'no-move-A';
  wrongEnding.winner = wrongEnding.a_color === 'red' ? 'black' : 'red';
  const c = build(wrongEnding);
  assert.equal(c.ok, false);
  assert.match(c.ok ? '' : c.error, /no-move-A/);

  const wrongFen = byNumber(45);
  wrongFen.final_fen = wrongFen.final_fen.replace(/ \d+ (\d+)$/, ' 99 $1');
  const d = build(wrongFen);
  assert.equal(d.ok, false);
  assert.match(d.ok ? '' : d.error, /final position/);

  const truncated = byNumber(45);
  truncated.moves.pop();
  const e = build(truncated);
  assert.equal(e.ok, false);
});

test('engine match: games sit inside the run window with their real length', () => {
  for (const order of [0, 1, 200, 399]) {
    const game = { ...byNumber(45), completion_order: order };
    const { startedAt, endedAt } = engineMatchTiming(MANIFEST, game, TOTAL);
    assert.ok(startedAt >= Date.parse(MANIFEST.runStartedAt));
    assert.ok(endedAt <= Date.parse(MANIFEST.runEndedAt));
    assert.equal(endedAt - startedAt, Math.round((game.secs ?? 0) * 1000));
  }
});

test('engine match: only a tenant with rules.adjudicate accepts game-adjudicated', () => {
  const event = {
    type: 'game-adjudicated',
    at: 1,
    roomId: 'jq_x',
    winner: null,
    reason: 'repetition',
  };
  assert.equal(isTenantEvent(jieqiTenant, event, 'jq_x'), true);
  assert.equal(isTenantEvent(jieqiTenant, { ...event, winner: 'red' }, 'jq_x'), true);
  assert.equal(isTenantEvent(jieqiTenant, { ...event, winner: 'white' }, 'jq_x'), false);
  assert.equal(isTenantEvent(jieqiTenant, { ...event, reason: 'agreement' }, 'jq_x'), false);
  assert.equal(isTenantEvent(banqiTenant, { ...event, roomId: 'bq_x' }, 'bq_x'), false);

  // A finished game ignores it.
  const created: JieqiEvent = {
    type: 'room-created',
    at: 0,
    roomId: 'jq_x',
    gameSpecId: JIEQI_SPEC_ID,
    setup: STANDARD_JIEQI_DEAL,
  };
  const once = replayTenantEvents(jieqiTenant, [created, event as JieqiEvent]);
  const twice = replayTenantEvents(jieqiTenant, [
    created,
    event as JieqiEvent,
    { ...event, winner: 'red' } as JieqiEvent,
  ]);
  assert.deepEqual(twice.state.status, once.state.status);
});

test('engine match: the jieqi review endpoint serves an imported game to the end', async () => {
  for (const n of [366, 63]) {
    const built = build(byNumber(n));
    assert.ok(built.ok);
    const { roomId, events, summary } = built.value;
    const record: RecentEveGameRecord = {
      roomId,
      variant: summary.variant,
      mode: 'imported',
      result: summary.result,
      termination: summary.termination,
      plyCount: summary.plyCount,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      whiteName: summary.whiteName,
      blackName: summary.blackName,
      corpusId: summary.corpusId,
      rated: false,
      visibility: 'public',
      participants: summary.participants ?? [],
      jobId: null,
      gameIndex: null,
      whiteEngineId: null,
      blackEngineId: null,
      timeControl: null,
      initialMs: null,
      incrementMs: null,
    };
    const payload = await jieqiPostgameForApi(roomId, {
      getGameSummary: async () => record,
      loadRoomEvents: async () => events,
    });
    assert.ok(payload, `game ${n} payload`);
    assert.equal(payload.state.status.type, 'finished');
    const moves = payload.timeline.filter((entry) => entry.type === 'move-played');
    assert.equal(moves.length, summary.plyCount);
    assert.equal(payload.history.truth?.length, summary.plyCount + 1);
    assert.deepEqual(
      payload.game.players?.map((p) => p.name),
      [summary.whiteName, summary.blackName],
    );
    if (n === 63) {
      assert.deepEqual(payload.timeline.at(-1), {
        type: 'game-adjudicated',
        at: summary.endedAt.getTime(),
        winner: null,
        reason: 'repetition',
      });
    }
  }
});

function recordFor(built: ImportedEngineMatchGame): RecentEveGameRecord {
  const { roomId, summary } = built;
  return {
    roomId,
    variant: summary.variant,
    mode: 'imported',
    result: summary.result,
    termination: summary.termination,
    plyCount: summary.plyCount,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    whiteName: summary.whiteName,
    blackName: summary.blackName,
    corpusId: summary.corpusId,
    rated: false,
    visibility: 'public',
    participants: summary.participants ?? [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: null,
    incrementMs: null,
  };
}

// The pieces the lab never dealt (still face-down at the end) in site squares.
function neverDealt(game: EnrichedMatchGame): Record<'red' | 'black', string[]> {
  const site = (sq: string) => `${sq[0]}${Number(sq.slice(1)) + 1}`;
  return {
    red: game.deal.red.completed.map(site).sort(),
    black: game.deal.black.completed.map(site).sort(),
  };
}

test('engine match: the import records which squares the lab never decided, and its origin', () => {
  const game = byNumber(366);
  const built = build(game);
  assert.ok(built.ok);
  const created = built.value.events[0];
  assert.equal(created?.type, 'room-created');
  if (created?.type !== 'room-created') return;
  const setup = created.setup as { undetermined?: Record<string, string[]> };
  assert.deepEqual(setup.undetermined, neverDealt(game));
  assert.ok((setup.undetermined?.red.length ?? 0) + (setup.undetermined?.black.length ?? 0) > 0);
  assert.deepEqual(created.origin, {
    kind: 'imported',
    event: 'AB-JChess vs PikaJieQi · 4 s · 2026-09',
    credit: {
      work: 'AB-JChess',
      authors: ['Huorongrong', 'Laoxu (Kouza)'],
      url: 'https://github.com/lxsgx23/AB-JChess',
      permission: true,
    },
    // The lab's fixed think time (row `movetime`): the game has no clock.
    movetimeMs: 4000,
  });
});

test('engine match: movetime comes from the row, else the manifest, and must agree', () => {
  const fromManifest = byNumber(366);
  delete fromManifest.movetime;
  const declared = buildImportedJieqiGame({ ...MANIFEST, movetimeMs: 2000 }, fromManifest, TOTAL);
  assert.ok(declared.ok);
  const created = declared.value.events[0];
  assert.equal(created?.type === 'room-created' && created.origin?.movetimeMs, 2000);

  // Neither says: no movetime at all, never a guess.
  const unknown = build(fromManifest);
  assert.ok(unknown.ok);
  const bare = unknown.value.events[0];
  assert.equal(bare?.type === 'room-created' && 'movetimeMs' in (bare.origin ?? {}), false);

  const disagree = buildImportedJieqiGame({ ...MANIFEST, movetimeMs: 1000 }, byNumber(366), TOTAL);
  assert.equal(disagree.ok, false);
  assert.match(disagree.ok ? '' : disagree.error, /row movetime 4000 != manifest movetimeMs 1000/);

  const bad = byNumber(366);
  bad.movetime = -5;
  assert.equal(build(bad).ok, false);
});

test('engine match: an origin movetime must be a positive whole number of ms', () => {
  const origin = { kind: 'imported', event: 'x' };
  assert.equal(isTenantGameOrigin({ ...origin, movetimeMs: 4000 }), true);
  for (const movetimeMs of [0, -1, 1.5, '4000', null]) {
    assert.equal(isTenantGameOrigin({ ...origin, movetimeMs }), false, String(movetimeMs));
  }
});

test('engine match: the truth view never states an identity the lab never decided', async () => {
  const game = byNumber(366);
  const built = build(game);
  assert.ok(built.ok);
  const payload = await jieqiPostgameForApi(built.value.roomId, {
    getGameSummary: async () => recordFor(built.value),
    loadRoomEvents: async () => built.value.events,
  });
  assert.ok(payload);
  assert.equal(payload.game.origin?.event, MANIFEST.eventName);
  assert.equal(payload.game.origin?.movetimeMs, 4000);
  // Engine seats, not guests and not bots.
  assert.deepEqual(
    payload.game.players?.map((p) => [p.kind, p.botId]),
    [
      ['engine', null],
      ['engine', null],
    ],
  );
  const unknown = neverDealt(game);
  const unknownSquares = new Set([...unknown.red, ...unknown.black]);
  const truths = [
    payload.view,
    payload.views?.truth,
    ...(payload.history.truth ?? []).map((s) => s.view),
  ];
  for (const view of truths) {
    assert.ok(view);
    for (const square of unknownSquares) {
      // Every never-dealt piece sits on its home square for the whole game.
      assert.deepEqual(view.board[square as keyof typeof view.board], {
        color: unknown.red.includes(square) ? 'red' : 'black',
        faceDown: true,
        unknown: true,
      });
    }
    // Every other piece on the board is shown with its identity.
    for (const [square, entry] of Object.entries(view.board)) {
      if (!unknownSquares.has(square)) assert.equal(entry?.faceDown, false, square);
    }
  }
});

test('engine match: the export names the event, the credit, the unknown squares and the lab reveals', () => {
  const game = byNumber(366);
  const built = build(game);
  assert.ok(built.ok);
  const exporter = variantTenantForRoomId(built.value.roomId)?.export;
  assert.ok(exporter);
  const finished = exporter.finishedGame(built.value.events, built.value.roomId);
  assert.ok(finished);
  const json = buildTenantGamePublicationJson(recordFor(built.value), finished, '/jieqi/game');
  assert.equal(json.mode, 'imported');
  assert.equal(json.origin?.event, MANIFEST.eventName);
  assert.equal(json.origin?.credit?.url, 'https://github.com/lxsgx23/AB-JChess');
  assert.deepEqual(json.origin?.never_revealed, neverDealt(game));
  // No clock, but not untimed: one move in 4 seconds (PGN's moves/seconds form).
  assert.deepEqual(json.time_control, {
    initial_ms: null,
    increment_ms: null,
    movetime_ms: 4000,
    label: '1/4',
  });
  assert.deepEqual(json.players, {
    red: { handle: 'AB-JChess' },
    black: { handle: 'PikaJieQi' },
  });
  // No deal: the lab drew each identity at reveal time, so the stored deal's
  // never-revealed squares are a completion nobody played (#484).
  assert.equal(json.deal_fen, undefined);
  // Every identity the export states is one the lab decided while playing: a
  // ply's reveal, and a face-down piece it captured. Nothing else.
  assert.equal(json.plies.length, game.moves.length);
  game.moves.forEach((record, index) => {
    const ply = json.plies[index]!;
    assert.deepEqual(
      ply.revealed ?? null,
      record.reveal ? { color: record.color, role: record.reveal } : null,
      `ply ${record.ply} reveal`,
    );
    const hidden = record.capture?.wasFaceDown
      ? { color: record.capture.color, role: record.capture.role }
      : null;
    assert.deepEqual(ply.captured_hidden ?? null, hidden, `ply ${record.ply} capture`);
  });
  // And the PGN carries no DealFEN either.
  const pgn = buildTenantGamePgn(recordFor(built.value), finished, '/jieqi/game');
  assert.ok(pgn);
  assert.equal(pgn.includes('DealFEN'), false);
});

test('engine match: every fixture game replays from its export alone to the lab final position', () => {
  for (const game of games) {
    const built = build(structuredClone(game));
    assert.ok(built.ok, String(game.game));
    const exporter = variantTenantForRoomId(built.value.roomId)?.export;
    assert.ok(exporter);
    const finished = exporter.finishedGame(built.value.events, built.value.roomId);
    assert.ok(finished);
    const record = recordFor(built.value);
    const json = buildTenantGamePublicationJson(record, finished, '/jieqi/game');
    const fromJson = replayHiddenPieceRecord(json);
    assert.ok(fromJson.ok, `${game.game}: ${JSON.stringify(fromJson)}`);
    // Board, non-zero pool counts, clocks: the lab omits zero counts, and a
    // finished kernel state has no side to move.
    const comparable = (fen: string) => {
      const [board, , pool = '', clock, fullmove] = fen.split(' ');
      const counts = (pool.match(/[A-Za-z]\d+/g) ?? []).filter((c) => !/^[A-Za-z]0$/.test(c));
      return [board, counts.join(''), clock, fullmove].join(' ');
    };
    assert.equal(comparable(fromJson.finalFen), comparable(game.final_fen), String(game.game));
    const pgn = buildTenantGamePgn(record, finished, '/jieqi/game');
    assert.ok(pgn);
    const parsed = parseHiddenPiecePgn(pgn);
    assert.ok(parsed.ok);
    assert.equal(parsed.record.deal_fen, undefined);
    const fromPgn = replayHiddenPieceRecord(parsed.record);
    assert.ok(fromPgn.ok);
    assert.equal(fromPgn.finalFen, fromJson.finalFen, String(game.game));
  }
});
