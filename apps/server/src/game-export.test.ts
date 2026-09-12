import assert from 'node:assert/strict';
import test from 'node:test';
import { createClock, type GameEvent } from '@mistboard/game';
import { buildGamePgn, buildGamePublicationJson } from './game-export.js';
import type { RecentEveGameRecord } from './persistence.js';

function fixtureGame(): { summary: RecentEveGameRecord; events: GameEvent[] } {
  const startedAt = new Date('2026-05-22T14:30:00Z');
  const endedAt = new Date('2026-05-22T14:38:42Z');
  const initialClock = createClock(0, 60000, 1000);

  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 0,
      roomId: 'fixture-room',
      variant: 'dark-chess',
      timeControl: { initialMs: 60000, incrementMs: 1000 },
    },
    {
      type: 'seat-assigned',
      at: 1,
      roomId: 'fixture-room',
      clientId: 'white-client',
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: 1,
      roomId: 'fixture-room',
      clientId: 'black-client',
      seat: 'black',
    },
    {
      type: 'move-played',
      at: 2,
      roomId: 'fixture-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
      clock: { ...initialClock, remainingMs: { white: 59823, black: 60000 } },
    },
    {
      type: 'move-played',
      at: 3,
      roomId: 'fixture-room',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
      clock: { ...initialClock, remainingMs: { white: 59823, black: 59500 } },
    },
    {
      type: 'move-played',
      at: 4,
      roomId: 'fixture-room',
      color: 'white',
      move: { from: 'g1', to: 'f3' },
      clock: { ...initialClock, remainingMs: { white: 58700, black: 59500 } },
    },
  ];

  const summary: RecentEveGameRecord = {
    roomId: 'fixture-room',
    variant: 'dark-chess',
    mode: 'pvp',
    result: 'white-wins',
    termination: 'king-captured',
    plyCount: 3,
    startedAt,
    endedAt,
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
    timeControl: { initialMs: 60000, incrementMs: 1000 },
    initialMs: 60000,
    incrementMs: 1000,
  };

  return { summary, events };
}

test('JSON publication has expected shape and v1.0 schema', () => {
  const { summary, events } = fixtureGame();
  const payload = buildGamePublicationJson(summary, events);

  assert.equal(payload.schema_version, '1.0');
  assert.equal(payload.game_id, 'fixture-room');
  assert.equal(payload.source.name, 'Mistboard');
  assert.equal(payload.source.url, 'https://mistboard.com');
  assert.equal(payload.source.game_url, 'https://mistboard.com/game/fixture-room');
  assert.equal(payload.variant, 'dark-chess');
  assert.equal(payload.mode, 'pvp');
  assert.equal(payload.result, 'white');
  assert.equal(payload.termination, 'king-captured');
  assert.equal(payload.license, 'CC BY 4.0');
  assert.equal(payload.players.white.handle, 'alice');
  assert.equal(payload.players.black.handle, 'bob');
  assert.equal(payload.time_control.initial_ms, 60000);
  assert.equal(payload.time_control.increment_ms, 1000);
  assert.equal(payload.time_control.label, '60+1');
  assert.equal(payload.started_at, '2026-05-22T14:30:00.000Z');
  assert.equal(payload.ended_at, '2026-05-22T14:38:42.000Z');

  assert.equal(payload.plies.length, 3);
  assert.deepEqual(payload.plies[0], {
    ply: 1,
    mover: 'white',
    uci: 'e2e4',
    san: 'e4',
    white_clock_ms_after: 59823,
    black_clock_ms_after: 60000,
  });
  assert.equal(payload.plies[1]?.mover, 'black');
  assert.equal(payload.plies[1]?.san, 'e5');
  assert.equal(payload.plies[2]?.uci, 'g1f3');
  assert.equal(payload.plies[2]?.san, 'Nf3');
});

test('PGN includes full STR plus extensions and numbered moves', () => {
  const { summary, events } = fixtureGame();
  const pgn = buildGamePgn(summary, events);

  assert.ok(pgn.includes('[Event "Mistboard Casual"]'));
  assert.ok(pgn.includes('[Site "https://mistboard.com/game/fixture-room"]'));
  assert.ok(pgn.includes('[Date "2026.05.22"]'));
  assert.ok(pgn.includes('[Round "-"]'), 'Round STR tag must be present');
  assert.ok(pgn.includes('[White "alice"]'));
  assert.ok(pgn.includes('[Black "bob"]'));
  assert.ok(pgn.includes('[Result "1-0"]'));
  assert.ok(pgn.includes('[Variant "Fog Chess"]'));
  assert.ok(pgn.includes('[MistboardVariant "dark-chess"]'));
  assert.ok(pgn.includes('[TimeControl "60+1"]'));
  // Standard PGN termination value
  assert.ok(pgn.includes('[Termination "normal"]'), 'king-captured should map to "normal"');
  // Internal termination preserved in custom tag
  assert.ok(pgn.includes('[MistboardTermination "king-captured"]'));
  assert.ok(pgn.includes('[License "CC BY 4.0"]'));
  assert.ok(pgn.includes('[MistboardSchema "1.0"]'));

  assert.ok(pgn.includes('1. e4 e5 2. Nf3 1-0'));
});

test('Termination mapping covers expected internal values', () => {
  const { summary, events } = fixtureGame();
  const cases: Array<[string, string]> = [
    ['king-captured', 'normal'],
    ['checkmate', 'normal'],
    ['resignation', 'normal'],
    ['draw', 'normal'],
    ['no-legal-moves', 'normal'],
    ['timeout', 'time forfeit'],
    ['engine-failure', 'adjudication'],
    ['worker-aborted', 'abandoned'],
    ['server-restarted', 'abandoned'],
    ['abandoned', 'abandoned'],
    ['truncated', 'unterminated'],
  ];
  for (const [internal, standard] of cases) {
    const pgn = buildGamePgn({ ...summary, termination: internal }, events);
    assert.ok(pgn.includes(`[Termination "${standard}"]`), `${internal} → ${standard}`);
    assert.ok(pgn.includes(`[MistboardTermination "${internal}"]`), `preserve ${internal}`);
  }
});

test('PGN result mapping: black wins / draw / unfinished', () => {
  const { summary, events } = fixtureGame();

  const blackWin = buildGamePgn({ ...summary, result: 'black-wins' }, events);
  assert.ok(blackWin.includes('[Result "0-1"]'));
  assert.ok(blackWin.trim().endsWith('0-1'));

  const drawn = buildGamePgn({ ...summary, result: 'draw' }, events);
  assert.ok(drawn.includes('[Result "1/2-1/2"]'));
  assert.ok(drawn.trim().endsWith('1/2-1/2'));

  const ongoing = buildGamePgn({ ...summary, result: 'unknown' }, events);
  assert.ok(ongoing.includes('[Result "*"]'));
});

test('JSON handles missing clocks gracefully', () => {
  const { summary, events } = fixtureGame();
  const eventsNoClocks: GameEvent[] = events.map((event) => {
    if (event.type !== 'move-played') return event;
    const { clock: _clock, ...rest } = event;
    return rest;
  });

  const payload = buildGamePublicationJson(summary, eventsNoClocks);
  assert.equal(payload.plies[0]?.white_clock_ms_after, null);
  assert.equal(payload.plies[0]?.black_clock_ms_after, null);
});

test('JSON handles null player handles', () => {
  const { summary, events } = fixtureGame();
  const payload = buildGamePublicationJson(
    { ...summary, whiteName: null, blackName: null },
    events,
  );
  assert.equal(payload.players.white.handle, null);
  assert.equal(payload.players.black.handle, null);

  const pgn = buildGamePgn({ ...summary, whiteName: null, blackName: null }, events);
  assert.ok(pgn.includes('[White "?"]'));
  assert.ok(pgn.includes('[Black "?"]'));
});

test('time control label degrades when missing', () => {
  const { summary, events } = fixtureGame();
  const payload = buildGamePublicationJson(
    { ...summary, timeControl: null, initialMs: null, incrementMs: null },
    events,
  );
  assert.equal(payload.time_control.initial_ms, null);
  assert.equal(payload.time_control.increment_ms, null);
  assert.equal(payload.time_control.label, 'untimed');
});

// PvE games (and most PvP games) store time control on the games table itself,
// not in eve_games.time_control. Export must prefer the games-table values.
test('time control reads games.initial_ms / increment_ms when eve_games JSON is null', () => {
  const { summary, events } = fixtureGame();
  const pveSummary: RecentEveGameRecord = {
    ...summary,
    mode: 'pve',
    whiteName: null,
    blackName: null,
    timeControl: null,
    initialMs: 180000,
    incrementMs: 2000,
  };

  const json = buildGamePublicationJson(pveSummary, events);
  assert.equal(json.time_control.initial_ms, 180000);
  assert.equal(json.time_control.increment_ms, 2000);
  assert.equal(json.time_control.label, '180+2');

  const pgn = buildGamePgn(pveSummary, events);
  assert.ok(pgn.includes('[TimeControl "180+2"]'));
});

// games.white_name / black_name are null in production; the display name lives
// on game_participants. PGN/JSON must read from participants first.
test('player names come from participants when whiteName/blackName are null', () => {
  const { summary, events } = fixtureGame();
  const withParticipants: RecentEveGameRecord = {
    ...summary,
    whiteName: null,
    blackName: null,
    participants: [
      {
        color: 'white',
        displayName: '@alice-handle',
        subjectType: 'user',
        subjectId: 'user-1',
        visibility: 'public',
      },
      {
        color: 'black',
        displayName: 'Mistboard Engine v3.2',
        subjectType: 'engine-version',
        subjectId: 'engine-v3-2',
        visibility: 'public',
      },
    ],
  };

  const pgn = buildGamePgn(withParticipants, events);
  assert.ok(pgn.includes('[White "@alice-handle"]'));
  assert.ok(pgn.includes('[Black "Mistboard Engine v3.2"]'));

  const json = buildGamePublicationJson(withParticipants, events);
  assert.equal(json.players.white.handle, '@alice-handle');
  assert.equal(json.players.black.handle, 'Mistboard Engine v3.2');
});
