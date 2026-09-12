import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  exportFormatsForVariant,
  type GameExportFormat,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  STANDARD_BANQI_DEAL,
  STANDARD_JIEQI_DEAL,
  STANDARD_JUNGLE_FLIP_DEAL,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { banqiTenant } from './banqi-tenant.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import {
  buildTenantGamePgn,
  buildTenantGamePublicationJson,
  flipOrBoardMoveUci,
  fortressXiangqiExportUci,
  type GameExportResponse,
  resolveGameExport,
  tenantExportBinding,
} from './game-export-tenant.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import type { GameParticipant, RecentEveGameRecord } from './persistence.js';
import type { VariantTenantExport, VariantTenantRegistration } from './variant-tenant/registry.js';
import {
  xiangqiExportUci,
  xiangqiPgnStyle,
  xiangqiPgnWriter,
  xiangqiWxfLabels,
} from './xiangqi-game-export.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

// The bindings under test are built here exactly as the registrations build
// them, so a registration-level typo would still be caught by the conformance
// test at the bottom (which loads the real registry).
const xiangqiExport = tenantExportBinding(xiangqiTenant, {
  gameRouteBase: '/xiangqi/game',
  uci: xiangqiExportUci,
  san: xiangqiWxfLabels,
  writePgn: (moves) => xiangqiPgnWriter(moves, xiangqiPgnStyle(moves)),
});
const darkXiangqiExport = tenantExportBinding(darkXiangqiTenant, {
  gameRouteBase: '/dark-xiangqi/game',
  uci: xiangqiExportUci,
  writePgn: (moves) => xiangqiPgnWriter(moves, 'iccs'),
});
const jieqiExport = tenantExportBinding(jieqiTenant, {
  gameRouteBase: '/jieqi/game',
  uci: xiangqiExportUci,
});
const banqiExport = tenantExportBinding(banqiTenant, {
  gameRouteBase: '/banqi/game',
  uci: flipOrBoardMoveUci,
  firstMoverInk: (state) => state.firstColor,
});
const jungleFlipExport = tenantExportBinding(jungleFlipTenant, {
  gameRouteBase: '/jungle-flip/game',
  uci: flipOrBoardMoveUci,
  firstMoverInk: (state) => state.firstColor,
});

function participant(
  color: GameParticipant['color'],
  displayName: string,
  visibility: GameParticipant['visibility'] = 'public',
): GameParticipant {
  return { color, displayName, subjectType: 'user', subjectId: displayName, visibility };
}

function gameRecord(overrides: Partial<RecentEveGameRecord>): RecentEveGameRecord {
  return {
    roomId: 'room',
    variant: XIANGQI_SPEC_ID,
    mode: 'pvp',
    result: 'red-wins',
    termination: 'resignation',
    plyCount: 0,
    startedAt: new Date('2026-05-22T14:30:00Z'),
    endedAt: new Date('2026-05-22T14:38:42Z'),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: [participant('red', 'alice'), participant('black', 'bob', 'private')],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: 60000,
    incrementMs: 1000,
    ...overrides,
  };
}

function registration(
  gameSpecId: string,
  tenantExport: VariantTenantExport | null,
): VariantTenantRegistration {
  return { gameSpecId, export: tenantExport } as unknown as VariantTenantRegistration;
}

function preamble(roomId: string, gameSpecId: string, setup?: unknown): unknown[] {
  return [
    { type: 'room-created', at: 1, roomId, gameSpecId, ...(setup ? { setup } : {}) },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];
}

// ── standard xiangqi ─────────────────────────────────────────────────────────

const XQ_ROOM = 'xq_export';
const xiangqiClock = {
  activeColor: 'black',
  incrementMs: 1000,
  initialMs: 60000,
  remainingMs: { red: 59000, black: 60000 },
  runningSince: 10,
};

function finishedXiangqiEvents(): unknown[] {
  return [
    ...preamble(XQ_ROOM, XIANGQI_SPEC_ID),
    {
      type: 'move-played',
      at: 10,
      roomId: XQ_ROOM,
      color: 'red',
      move: { from: 'h3', to: 'e3' },
      clock: xiangqiClock,
    },
    {
      type: 'move-played',
      at: 11,
      roomId: XQ_ROOM,
      color: 'black',
      move: { from: 'h10', to: 'g8' },
    },
    { type: 'move-played', at: 12, roomId: XQ_ROOM, color: 'red', move: { from: 'b1', to: 'c3' } },
    { type: 'seat-resigned', at: 13, roomId: XQ_ROOM, color: 'black' },
  ];
}

test('xiangqi JSON publication is keyed red/black with ICCS uci and WXF san', () => {
  const summary = gameRecord({ roomId: XQ_ROOM });
  const game = xiangqiExport.finishedGame(finishedXiangqiEvents(), XQ_ROOM);
  assert.ok(game, 'a finished log exports');
  const payload = buildTenantGamePublicationJson(summary, game, xiangqiExport.gameRouteBase);

  assert.equal(payload.schema_version, '1.0');
  assert.equal(payload.game_id, XQ_ROOM);
  assert.equal(payload.source.game_url, 'https://mistboard.com/xiangqi/game/xq_export');
  assert.equal(payload.variant, 'xiangqi');
  assert.equal(payload.result, 'red');
  assert.equal(payload.termination, 'resignation');
  assert.equal(payload.license, 'CC BY 4.0');
  assert.equal(payload.time_control.label, '60+1');
  assert.deepEqual(Object.keys(payload.players), ['red', 'black']);
  assert.equal(payload.players.red?.handle, 'alice');
  // A private seat never exports its handle.
  assert.equal(payload.players.black?.handle, 'Anonymous');
  assert.equal(payload.ply_count, 3);
  assert.equal('first_mover_ink' in payload, false);
  assert.deepEqual(payload.plies[0], {
    ply: 1,
    mover: 'red',
    uci: 'h2e2',
    san: 'C2.5',
    red_clock_ms_after: 59000,
    black_clock_ms_after: 60000,
  });
  assert.equal(payload.plies[1]?.san, 'H8+7');
  assert.equal(payload.plies[1]?.red_clock_ms_after, null);
  assert.equal(payload.plies[2]?.uci, 'b0c2');
  assert.equal(payload.plies[2]?.san, 'H8+7');
});

test('xiangqi PGN carries Red/Black tags, the review URL, and WXF movetext', () => {
  const summary = gameRecord({ roomId: XQ_ROOM });
  const game = xiangqiExport.finishedGame(finishedXiangqiEvents(), XQ_ROOM);
  assert.ok(game);
  const pgn = buildTenantGamePgn(summary, game, xiangqiExport.gameRouteBase);
  assert.ok(pgn);

  assert.ok(pgn.includes('[Event "Mistboard Casual"]'));
  assert.ok(pgn.includes('[Site "https://mistboard.com/xiangqi/game/xq_export"]'));
  assert.ok(pgn.includes('[Date "2026.05.22"]'));
  assert.ok(pgn.includes('[Round "-"]'));
  assert.ok(pgn.includes('[Red "alice"]'));
  assert.ok(pgn.includes('[Black "Anonymous"]'));
  assert.equal(pgn.includes('[White '), false, 'xiangqi PGN never names a White seat');
  assert.ok(pgn.includes('[Result "1-0"]'));
  assert.ok(pgn.includes('[Variant "Xiangqi"]'));
  assert.ok(pgn.includes('[MistboardVariant "xiangqi"]'));
  assert.ok(pgn.includes('[TimeControl "60+1"]'));
  assert.ok(pgn.includes('[Termination "normal"]'));
  assert.ok(pgn.includes('[MistboardTermination "resignation"]'));
  assert.ok(pgn.includes('[License "CC BY 4.0"]'));
  assert.ok(pgn.includes('[MistboardSchema "1.0"]'));
  assert.ok(pgn.endsWith('\n\n1. C2.5 H8+7 2. H8+7 1-0\n'), pgn);
});

// ── fog xiangqi ──────────────────────────────────────────────────────────────

const DXQ_ROOM = 'dxq_export';

// Red opens the e-file (the sideways soldier step at ply 5 exposes the generals,
// legal under fog, illegal under standard rules) and Black takes the general
// with the flying-general capture. Both fog-only moves must survive export.
const FOG_MOVES: Array<[string, { from: string; to: string }]> = [
  ['red', { from: 'e4', to: 'e5' }],
  ['black', { from: 'e7', to: 'e6' }],
  ['red', { from: 'e5', to: 'e6' }],
  ['black', { from: 'h10', to: 'g8' }],
  ['red', { from: 'e6', to: 'd6' }],
  ['black', { from: 'e10', to: 'e1' }],
];

function fogEvents(plies: number): unknown[] {
  return [
    ...preamble(DXQ_ROOM, DARK_XIANGQI_SPEC_ID),
    ...FOG_MOVES.slice(0, plies).map(([color, move], index) => ({
      type: 'move-played',
      at: 10 + index,
      roomId: DXQ_ROOM,
      color,
      move,
    })),
  ];
}

test('fog xiangqi exports every ply as ICCS coordinates with no WXF san', () => {
  const summary = gameRecord({
    roomId: DXQ_ROOM,
    variant: DARK_XIANGQI_SPEC_ID,
    result: 'black-wins',
    termination: 'general-captured',
  });
  const game = darkXiangqiExport.finishedGame(fogEvents(6), DXQ_ROOM);
  assert.ok(game, 'the general capture finishes the game');
  const payload = buildTenantGamePublicationJson(summary, game, darkXiangqiExport.gameRouteBase);
  assert.equal(payload.result, 'black');
  assert.deepEqual(
    payload.plies.map((ply) => ply.uci),
    ['e3e4', 'e6e5', 'e4e5', 'h9g7', 'e5d5', 'e9e0'],
  );
  assert.ok(payload.plies.every((ply) => ply.san === null));

  const pgn = buildTenantGamePgn(summary, game, darkXiangqiExport.gameRouteBase);
  assert.ok(pgn);
  assert.ok(pgn.includes('[Variant "Fog Xiangqi"]'));
  assert.ok(pgn.includes('[Result "0-1"]'));
  assert.ok(pgn.includes('[Termination "normal"]'));
  assert.ok(pgn.includes('[MistboardTermination "general-captured"]'));
  assert.ok(pgn.endsWith('\n\n1. e3e4 e6e5 2. e4e5 h9g7 3. e5d5 e9e0 0-1\n'), pgn);
});

test('a standard-illegal line in the xiangqi tenant falls back to ICCS rather than stale WXF', () => {
  // The fog fixture replayed through the STANDARD tenant's binding: the writer
  // would otherwise label ply 6 against a board it never advanced.
  const events = fogEvents(6).map((event) =>
    (event as { type: string }).type === 'room-created'
      ? { ...(event as object), gameSpecId: XIANGQI_SPEC_ID }
      : event,
  );
  const game = xiangqiExport.finishedGame(events, DXQ_ROOM);
  // Standard xiangqi rules reject the fog-only moves, so the replay never finishes.
  assert.equal(game, null);
  // The labeler itself is the honesty gate: an unreplayable line has no WXF.
  const moves = FOG_MOVES.map(([, move]) => move) as Parameters<typeof xiangqiWxfLabels>[0];
  assert.ok(xiangqiWxfLabels(moves).every((label) => label === null));
  assert.equal(xiangqiPgnStyle(moves), 'iccs');
});

// ── hidden-info regression ───────────────────────────────────────────────────

test('an in-progress fog xiangqi game exports nothing: 403 on both formats, no plies', () => {
  const summary = gameRecord({
    roomId: DXQ_ROOM,
    variant: DARK_XIANGQI_SPEC_ID,
    result: 'in-progress',
    termination: 'in-progress',
  });
  const inProgress = fogEvents(5);
  assert.equal(darkXiangqiExport.finishedGame(inProgress, DXQ_ROOM), null);

  for (const format of ['pgn', 'json'] as const) {
    const resolved = resolveGameExport({
      roomId: DXQ_ROOM,
      format,
      summary,
      events: inProgress,
      tenantForRoomId: () => registration(DARK_XIANGQI_SPEC_ID, darkXiangqiExport),
    });
    assert.equal(resolved.status, 403);
    assert.deepEqual(resolved.body, { error: 'game_not_public' });
    assert.equal(JSON.stringify(resolved).includes('e3e4'), false, 'no move leaks');
    assert.equal(JSON.stringify(resolved).includes('plies'), false);
  }
});

test('an in-progress fog chess log still answers 403 (legacy path unchanged)', () => {
  const roomId = 'chess-room';
  const events: unknown[] = [
    { type: 'room-created', at: 0, roomId, variant: DARK_CHESS_SPEC_ID, offer: [] },
    { type: 'seat-assigned', at: 1, roomId, clientId: 'w', seat: 'white' },
    { type: 'seat-assigned', at: 1, roomId, clientId: 'b', seat: 'black' },
    { type: 'move-played', at: 2, roomId, color: 'white', move: { from: 'e2', to: 'e4' } },
  ];
  const resolved = resolveGameExport({
    roomId,
    format: 'json',
    summary: gameRecord({ roomId, variant: DARK_CHESS_SPEC_ID }),
    events,
    tenantForRoomId: () => null,
  });
  assert.equal(resolved.status, 403);
  assert.deepEqual(resolved.body, { error: 'game_not_public' });
});

// ── flip + drop encodings ────────────────────────────────────────────────────

const BQ_ROOM = 'bq_export';

test('banqi JSON encodes the opening flip as "@a1" and reports the first seat ink', () => {
  const events: unknown[] = [
    ...preamble(BQ_ROOM, BANQI_SPEC_ID, STANDARD_BANQI_DEAL),
    { type: 'move-played', at: 4, roomId: BQ_ROOM, color: 'red', move: { from: 'a1', to: 'a1' } },
    { type: 'seat-resigned', at: 5, roomId: BQ_ROOM, color: 'black' },
  ];
  const summary = gameRecord({ roomId: BQ_ROOM, variant: BANQI_SPEC_ID });
  const game = banqiExport.finishedGame(events, BQ_ROOM);
  assert.ok(game);
  const payload = buildTenantGamePublicationJson(summary, game, banqiExport.gameRouteBase);
  assert.equal(payload.source.game_url, 'https://mistboard.com/banqi/game/bq_export');
  assert.deepEqual(Object.keys(payload.players), ['red', 'black']);
  // a1 is dealt the red general in the standard deal, so the red SEAT plays red ink.
  assert.equal(payload.first_mover_ink, 'red');
  assert.deepEqual(payload.plies[0], {
    ply: 1,
    mover: 'red',
    uci: '@a1',
    san: null,
    red_clock_ms_after: null,
    black_clock_ms_after: null,
  });
});

test('flip jungle JSON encodes the flip and the first seat ink the same way', () => {
  const roomId = 'jgf_export';
  const events: unknown[] = [
    ...preamble(roomId, JUNGLE_FLIP_SPEC_ID, STANDARD_JUNGLE_FLIP_DEAL),
    { type: 'move-played', at: 4, roomId, color: 'red', move: { from: 'a1', to: 'a1' } },
    { type: 'seat-resigned', at: 5, roomId, color: 'black' },
  ];
  const summary = gameRecord({ roomId, variant: JUNGLE_FLIP_SPEC_ID });
  const game = jungleFlipExport.finishedGame(events, roomId);
  assert.ok(game);
  const payload = buildTenantGamePublicationJson(summary, game, jungleFlipExport.gameRouteBase);
  assert.equal(payload.source.game_url, 'https://mistboard.com/jungle-flip/game/jgf_export');
  assert.equal(payload.first_mover_ink, 'red');
  assert.equal(payload.plies[0]?.uci, '@a1');
  assert.equal(payload.plies[0]?.san, null);
});

test('fortress drops encode as ROLE@square; board moves and flips share one scheme', () => {
  assert.equal(fortressXiangqiExportUci({ drop: 'chariot', to: 'd4' }), 'R@d4');
  assert.equal(fortressXiangqiExportUci({ from: 'a1', to: 'a2' }), 'a1a2');
  assert.equal(flipOrBoardMoveUci({ from: 'c2', to: 'c2' }), '@c2');
  assert.equal(flipOrBoardMoveUci({ from: 'c2', to: 'c3' }), 'c2c3');
});

// ── jieqi + format gate ──────────────────────────────────────────────────────

const JQ_ROOM = 'jq_export';

function finishedJieqiEvents(): unknown[] {
  return [
    ...preamble(JQ_ROOM, JIEQI_SPEC_ID, STANDARD_JIEQI_DEAL),
    { type: 'move-played', at: 4, roomId: JQ_ROOM, color: 'red', move: { from: 'b3', to: 'b10' } },
    { type: 'seat-resigned', at: 5, roomId: JQ_ROOM, color: 'black' },
  ];
}

test('jieqi exports JSON with ICCS uci and no san; PGN is 501 by the format table', () => {
  const summary = gameRecord({ roomId: JQ_ROOM, variant: JIEQI_SPEC_ID });
  const lookup = () => registration(JIEQI_SPEC_ID, jieqiExport);

  const json = resolveGameExport({
    roomId: JQ_ROOM,
    format: 'json',
    summary,
    events: finishedJieqiEvents(),
    tenantForRoomId: lookup,
  });
  assert.equal(json.status, 200);
  if (json.status !== 200) return;
  assert.equal(json.format, 'json');
  assert.equal(json.contentType, 'application/json; charset=utf-8');
  const payload = JSON.parse(json.body);
  assert.equal(payload.source.game_url, 'https://mistboard.com/jieqi/game/jq_export');
  assert.deepEqual(payload.plies, [
    {
      ply: 1,
      mover: 'red',
      uci: 'b2b9',
      san: null,
      red_clock_ms_after: null,
      black_clock_ms_after: null,
    },
  ]);

  const pgn = resolveGameExport({
    roomId: JQ_ROOM,
    format: 'pgn',
    summary,
    events: finishedJieqiEvents(),
    tenantForRoomId: lookup,
  });
  assert.equal(pgn.status, 501);
  assert.deepEqual(pgn.body, { error: 'export_not_supported_for_variant', variant: 'jieqi' });
});

test('xiangqi resolves through the dispatch with the PGN content type and filename extension', () => {
  const resolved = resolveGameExport({
    roomId: XQ_ROOM,
    format: 'pgn',
    summary: gameRecord({ roomId: XQ_ROOM }),
    events: finishedXiangqiEvents(),
    tenantForRoomId: () => registration(XIANGQI_SPEC_ID, xiangqiExport),
  });
  assert.equal(resolved.status, 200);
  if (resolved.status !== 200) return;
  assert.equal(resolved.format, 'pgn');
  assert.equal(resolved.contentType, 'application/x-chess-pgn; charset=utf-8');
  assert.ok(resolved.body.includes('[Red "alice"]'));
});

test('unknown variants and spec mismatches are 501, never another builder', () => {
  const cases: Array<[string, GameExportResponse]> = [
    [
      'no registration',
      resolveGameExport({
        roomId: 'zz_export',
        format: 'json',
        summary: gameRecord({ roomId: 'zz_export', variant: 'no-such-variant' }),
        events: preamble('zz_export', 'no-such-variant'),
        tenantForRoomId: () => null,
      }),
    ],
    [
      'registration without export',
      resolveGameExport({
        roomId: 'zz_export',
        format: 'json',
        summary: gameRecord({ roomId: 'zz_export', variant: 'no-such-variant' }),
        events: preamble('zz_export', 'no-such-variant'),
        tenantForRoomId: () => registration('no-such-variant', null),
      }),
    ],
    [
      'spec mismatch',
      resolveGameExport({
        roomId: JQ_ROOM,
        format: 'json',
        summary: gameRecord({ roomId: JQ_ROOM, variant: XIANGQI_SPEC_ID }),
        events: finishedJieqiEvents(),
        tenantForRoomId: () => registration(JIEQI_SPEC_ID, jieqiExport),
      }),
    ],
  ];
  for (const [label, resolved] of cases) {
    assert.equal(resolved.status, 501, label);
    assert.equal(resolved.body.error, 'export_not_supported_for_variant', label);
  }
  const missing = resolveGameExport({ roomId: 'x', format: 'json', summary: null, events: null });
  assert.equal(missing.status, 404);
});

// ── registry conformance ─────────────────────────────────────────────────────

test('every registered tenant binds an export exactly when the format table lists it', async () => {
  // Side-effect import: populates the registry with the real registrations.
  await import('./variant-tenant/register-tenants.js');
  const { registeredVariantTenants } = await import('./variant-tenant/registry.js');
  const seen = new Set<string>();
  for (const entry of registeredVariantTenants()) {
    seen.add(entry.gameSpecId);
    const formats: readonly GameExportFormat[] = exportFormatsForVariant(entry.gameSpecId);
    // Fog chess correspondence rides the legacy chess event log and exports
    // through the chess builders, so it is listed without a tenant binding.
    const expectsBinding = formats.length > 0 && entry.gameSpecId !== DARK_CHESS_SPEC_ID;
    assert.equal(
      Boolean(entry.export),
      expectsBinding,
      `${entry.kind}: export binding must match packages/game export-formats.ts`,
    );
    if (entry.export) {
      assert.equal(entry.export.gameRouteBase, `/${entry.gameSpecId}/game`, entry.kind);
    }
  }
  for (const spec of [XIANGQI_SPEC_ID, DARK_XIANGQI_SPEC_ID, JIEQI_SPEC_ID, BANQI_SPEC_ID]) {
    assert.ok(seen.has(spec), `${spec} is registered`);
  }
});
