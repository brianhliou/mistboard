import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correspondenceTimeControl,
  createFFQBanqiDeal,
  FFQ_BANQI_FACE_UP_SQUARES,
  ffqBanqiStateToFen,
  type HiddenPieceRecord,
  parseHiddenPiecePgn,
  replayHiddenPieceRecord,
} from '@mistboard/game';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { resolveGameExport } from './game-export-tenant.js';
import type { RecentEveGameRecord } from './persistence.js';
import { variantTenantForRoomId } from './variant-tenant/registry.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';
import './ffq-banqi-registration.js';

const ROOM = 'ffq_export';
const deal = createFFQBanqiDeal(1162);
for (const [square, color, role] of [
  [6, 'red', 'cannon'],
  [4, 'black', 'general'],
] as const) {
  const source = deal.findIndex((p) => p.color === color && p.role === role);
  [deal[square], deal[source]] = [deal[source]!, deal[square]!];
}
const moves = [
  { from: 6, to: 4 },
  { from: 0, to: 0 },
  { from: 1, to: 1 },
];
function eventsFor(setup = deal, finished = true, correspondence = false): FFQBanqiEvent[] {
  return [
    {
      type: 'room-created',
      roomId: ROOM,
      at: 1,
      gameSpecId: 'ffq-banqi',
      setup: { deal: setup },
      ...(correspondence ? { timeControl: correspondenceTimeControl(3) } : {}),
    },
    ...moves.map(
      (move, i): FFQBanqiEvent => ({
        type: 'move-played',
        roomId: ROOM,
        at: i + 2,
        color: i % 2 === 0 ? 'red' : 'black',
        move,
        clock: {
          activeColor: i % 2 === 0 ? 'black' : 'red',
          initialMs: 300_000,
          incrementMs: 5_000,
          runningSince: i + 2,
          remainingMs: { red: 299_000 - i, black: 298_000 - i },
        },
      }),
    ),
    ...(finished ? [{ type: 'seat-resigned', roomId: ROOM, at: 10, color: 'black' } as const] : []),
  ];
}
const summary: RecentEveGameRecord = {
  roomId: ROOM,
  variant: 'ffq-banqi',
  mode: 'pvp',
  result: 'red-wins',
  termination: 'resignation',
  plyCount: moves.length,
  startedAt: new Date(1),
  endedAt: new Date(10),
  whiteName: 'Alice',
  blackName: 'Bob',
  corpusId: null,
  rated: false,
  visibility: 'public',
  participants: [],
  jobId: null,
  gameIndex: null,
  whiteEngineId: null,
  blackEngineId: null,
  timeControl: null,
  initialMs: 300_000,
  incrementMs: 5_000,
};
function exportBody(events: readonly unknown[], format: 'json' | 'pgn', record = summary): string {
  const result = resolveGameExport({ roomId: ROOM, format, summary: record, events });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.ok(result.status === 200);
  return result.body;
}
function checkPublic(a: string, b: string) {
  assert.equal(a, b, 'complete exports must be invariant to unobserved identities');
  assert.doesNotMatch(a, /deal_fen|DealFEN|"setup"|"deal"|"seed"/);
}

test('FFQ finished public JSON and PGN export through the real tenant hook', () => {
  const events = eventsFor();
  const final = replayTenantEvents(ffqBanqiTenant, events).state;
  assert.equal(final.status.type, 'finished');
  const json = JSON.parse(exportBody(events, 'json'));
  assert.equal(json.source.game_url, `https://mistboard.com/ffq-banqi/game/${ROOM}`);
  assert.equal(json.variant, 'ffq-banqi');
  assert.deepEqual(
    json.initial_revealed,
    FFQ_BANQI_FACE_UP_SQUARES.map((i) => deal[i]),
  );
  assert.equal(
    json.initial_fen,
    ffqBanqiStateToFen(replayTenantEvents(ffqBanqiTenant, events.slice(0, 1)).state),
  );
  assert.deepEqual(json.plies[0], {
    ply: 1,
    mover: 'red',
    uci: 'c1a1',
    san: null,
    captured_hidden: { color: 'black', role: 'general' },
    hp_after: { red: 60, black: 30 },
    damage: { red: 0, black: 30 },
    red_clock_ms_after: 299_000,
    black_clock_ms_after: 298_000,
  });
  assert.deepEqual(json.plies[1].revealed, deal[0]);
  assert.deepEqual(json.plies[2].revealed, deal[1]);
  assert.equal(json.plies[1].uci, '@a0');
  assert.equal(json.plies[2].uci, '@b0');
  assert.equal(json.first_mover_ink, undefined, 'FFQ seats have fixed ink');
  const replay = replayHiddenPieceRecord(json);
  assert.ok(replay.ok, JSON.stringify(replay));
  assert.equal(replay.finalFen, ffqBanqiStateToFen(final));
  const pgn = exportBody(events, 'pgn');
  assert.match(pgn, /\[Variant "Fanfanqi"\]/);
  assert.match(pgn, /\[Red "Alice"\]/);
  assert.match(pgn, /\[Result "1-0"\]/);
  const parsed = parseHiddenPiecePgn(pgn);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.deepEqual(replayHiddenPieceRecord(parsed.record), replay);
  assert.deepEqual(parsed.record.plies[0]?.captured_hidden, json.plies[0].captured_hidden);
});

test('finished public FFQ correspondence uses the same masked JSON and PGN exporter', () => {
  const events = eventsFor(deal, true, true);
  const record = { ...summary, timeControl: correspondenceTimeControl(3) };
  const final = replayTenantEvents(ffqBanqiTenant, events).state;
  for (const format of ['json', 'pgn'] as const) {
    const body = exportBody(events, format, record);
    let game: HiddenPieceRecord;
    if (format === 'json') game = JSON.parse(body);
    else {
      const parsed = parseHiddenPiecePgn(body);
      assert.ok(parsed.ok, JSON.stringify(parsed));
      game = parsed.record;
    }
    const replay = replayHiddenPieceRecord(game);
    assert.ok(replay.ok, JSON.stringify(replay));
    assert.equal(replay.finalFen, ffqBanqiStateToFen(final));
    assert.deepEqual(game.plies[0]?.captured_hidden, { color: 'black', role: 'general' });
    assert.doesNotMatch(body, /deal_fen|DealFEN|"setup"|"deal"|"seed"/);
    for (const [refusedSummary, refusedEvents] of [
      [record, eventsFor(deal, false, true)],
      [{ ...record, visibility: 'private' }, events],
      [record, events.map((e, i) => (i === 0 ? { ...e, internalEngineTest: {} } : e))],
    ] as const) {
      assert.equal(
        resolveGameExport({ roomId: ROOM, format, summary: refusedSummary, events: refusedEvents })
          .status,
        403,
      );
    }
  }
});

test('complete serialized FFQ exports omit every unobserved identity; planted leaks fail', () => {
  const other = [...deal];
  const i = 30;
  const j = other.findIndex(
    (p, n) =>
      n > 2 &&
      n !== 4 &&
      n !== 5 &&
      n !== i &&
      !(FFQ_BANQI_FACE_UP_SQUARES as readonly number[]).includes(n) &&
      JSON.stringify(p) !== JSON.stringify(deal[i]),
  );
  assert.ok(j >= 0);
  [other[i], other[j]] = [other[j]!, other[i]!];
  assert.notDeepEqual(eventsFor(), eventsFor(other));
  for (const correspondence of [false, true])
    for (const format of ['json', 'pgn'] as const) {
      const a = exportBody(eventsFor(deal, true, correspondence), format);
      const b = exportBody(eventsFor(other, true, correspondence), format);
      checkPublic(a, b);
      const leak = (body: string, setup: typeof deal) =>
        format === 'json'
          ? JSON.stringify({ ...JSON.parse(body), deal_fen: JSON.stringify(setup) })
          : `[DealFEN "${JSON.stringify(setup)}"]\n${body}`;
      assert.throws(() => checkPublic(leak(a, deal), leak(b, other)), /unobserved identities/);
      assert.throws(() => checkPublic(leak(a, deal), leak(a, deal)), /deal_fen|DealFEN/);
    }
});

test('FFQ exports reject live, aborted, private, internal and mismatched games', () => {
  const binding = variantTenantForRoomId(ROOM)?.export;
  assert.ok(binding, 'the production registration must bind the exporter');
  assert.equal(binding.finishedGame(eventsFor(deal, false), ROOM), null);
  assert.equal(
    binding.finishedGame(
      [
        ...eventsFor(deal, false),
        {
          type: 'game-aborted',
          roomId: ROOM,
          at: 10,
          reason: 'user-abort',
        },
      ],
      ROOM,
    ),
    null,
  );
  assert.equal(binding.finishedGame(eventsFor(), 'ffq_other'), null);
  const internal = eventsFor().map((e, i) => (i === 0 ? { ...e, internalEngineTest: {} } : e));
  assert.equal(binding.finishedGame(internal, ROOM), null);
  for (const format of ['json', 'pgn'] as const) {
    for (const [record, events] of [
      [summary, eventsFor(deal, false)],
      [{ ...summary, visibility: 'private' }, eventsFor()],
      [summary, internal],
    ] as const) {
      assert.equal(
        resolveGameExport({ roomId: ROOM, format, summary: record, events }).status,
        403,
      );
    }
  }
});
