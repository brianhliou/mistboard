// Regression: the finished-game envelope served to a postgame page MUST carry the
// shaped seat roster (`players`).
//
// The web review loader (apps/web/src/review.ts loadGameForReview) PREFERS
// /api/games/:id/review and only falls back to /api/games/:id. The review handler
// used to return the raw persisted record, whose whiteName/blackName are null for
// every PvE and casual-PvP game — seat identity lives in `participants`, and the
// postgame left rail (review/game-review-meta.ts buildReviewMeta) reads
// `game.players`, not the raw columns. Result: the flagship Fog Chess postgame
// rendered with zero player rows, so neither the names nor the seat colors showed,
// for every game. The summary endpoint shaped `players`; the review endpoint did
// not, and only the summary was covered.
//
// Both endpoints are asserted here because either one alone can regress: they are
// separate handlers, and the one the client actually reaches is the review.

import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createClock, expireClock, type GameEvent } from '@mistboard/game';
import type * as persistence from './persistence.js';
import { tryHandle } from './routes/games.js';
import type { HttpApiContext } from './routes/lib.js';

const ROOM_ID = 'review-players-room';

// A PvE seat pair as it is actually persisted: the human is a `guest` (no
// account, so whiteName stays null) and Misty is a `bot`. This is exactly the
// shape that rendered blank.
const PARTICIPANTS: persistence.GameParticipant[] = [
  {
    color: 'white',
    displayName: 'Guest',
    subjectType: 'guest',
    subjectId: null,
    visibility: 'public',
  },
  {
    color: 'black',
    displayName: 'Misty',
    subjectType: 'bot',
    subjectId: 'misty',
    visibility: 'public',
  },
];

function gameRecord(): persistence.RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: 'dark-chess',
    mode: 'pve',
    result: 'white-wins',
    termination: 'king-captured',
    plyCount: 2,
    startedAt: new Date('2026-07-29T15:04:13.000Z'),
    endedAt: new Date('2026-07-29T15:11:31.000Z'),
    // Null on the record, as they are for every PvE game — the names live only
    // in `participants`, which is the entire point of the shaping step.
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: PARTICIPANTS,
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: 180_000,
    incrementMs: 2_000,
  };
}

// Shortest event log that replays to `finished`, which is what gates the review
// and summary endpoints on exposing a full replay (server-policy.ts).
function finishedEvents(): GameEvent[] {
  const clock = expireClock(createClock(1, 1, 0), 2, 'white');
  assert.ok(clock);
  return [
    { type: 'room-created', at: 1, roomId: ROOM_ID, variant: 'dark-chess' },
    { type: 'clock-expired', at: 2, roomId: ROOM_ID, color: 'white', clock },
  ];
}

type ResponseCapture = { body: string; headers: Record<string, string>; status: number | null };

test('the review endpoint carries the shaped seat roster, not just raw whiteName/blackName', async () => {
  const response = await call(`/api/games/${ROOM_ID}/review`);
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body) as {
    game: { players?: Array<{ color: string; name: string; kind: string }> };
  };

  // The raw columns are null, so a payload without `players` renders a postgame
  // with no seat rows at all.
  assert.deepEqual(payload.game.players, [
    { color: 'white', name: 'Guest', rating: null, kind: 'guest', handle: null, botId: null },
    // 'account', not 'engine': a first-party bot has a profile page, so
    // postgameParticipantKind groups it with users. 'engine' is reserved for raw
    // engine-version subjects (EvE games). `botId` is what actually addresses
    // that page: `kind` cannot, since it merges bots and users into one value.
    { color: 'black', name: 'Misty', rating: null, kind: 'account', handle: null, botId: 'misty' },
  ]);
});

test('the summary endpoint carries the same shaped seat roster', async () => {
  const response = await call(`/api/games/${ROOM_ID}`);
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body) as {
    game: { players?: Array<{ color: string; name: string; kind: string }> };
  };
  assert.deepEqual(payload.game.players, [
    { color: 'white', name: 'Guest', rating: null, kind: 'guest', handle: null, botId: null },
    // 'account', not 'engine': a first-party bot has a profile page, so
    // postgameParticipantKind groups it with users. 'engine' is reserved for raw
    // engine-version subjects (EvE games). `botId` is what actually addresses
    // that page: `kind` cannot, since it merges bots and users into one value.
    { color: 'black', name: 'Misty', rating: null, kind: 'account', handle: null, botId: 'misty' },
  ]);
});

// Both handlers read the same in-memory fallbacks (no Postgres needed): the
// summary comes from ctx.inMemoryGameSummary and the events from ctx.rooms.
async function call(url: string): Promise<ResponseCapture> {
  const request = Readable.from([]) as unknown as IncomingMessage;
  request.method = 'GET';
  request.url = url;
  request.headers = {};
  Object.defineProperty(request, 'socket', { value: { remoteAddress: '127.0.0.1' } });
  const response = captureResponse();
  const parsed = new URL(url, 'http://localhost');
  const ctx = {
    rooms: new Map([[ROOM_ID, { events: finishedEvents() }]]),
    inMemoryGameSummary: (roomId: string) => (roomId === ROOM_ID ? gameRecord() : null),
  } as unknown as HttpApiContext;
  const handled = await tryHandle(
    ctx,
    request,
    response as unknown as ServerResponse,
    parsed.pathname,
    parsed,
  );
  assert.equal(handled, true);
  return response;
}

function captureResponse(): ResponseCapture & ServerResponse {
  const capture = {
    body: '',
    headers: {} as Record<string, string>,
    status: null as number | null,
    setHeader(name: string, value: string) {
      capture.headers[name] = value;
      return capture;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = { ...capture.headers, ...(headers ?? {}) };
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ResponseCapture & ServerResponse;
}
