import assert from 'node:assert/strict';
import test from 'node:test';
import { JIEQI_SPEC_ID, type JieqiPlayerView, STANDARD_JIEQI_DEAL } from '@mistboard/game';
import type { JieqiEvent } from '../jieqi-runtime.js';
import { jieqiTenant } from '../jieqi-tenant.js';
import type { RecentEveGameRecord } from '../persistence.js';
import { replayTenantEvents } from '../variant-tenant/runtime.js';
import {
  type JieqiPostgamePersistence,
  jieqiLiveWatchPayloadFor,
  jieqiPostgameForApi,
  jieqiWatchPostgameForApi,
} from './jieqi-games.js';

const ROOM_ID = 'jq_postgame';

// Red cannon b3 captures Black's face-down piece on b10 (over the b8 screen),
// then Black resigns. After the capture Red's cannon is revealed; every other
// non-general piece is still dealt face-down. This gives us a captured DARK
// black piece — the hidden-info masking surface for the per-color views.
function finishedCaptureEvents(): JieqiEvent[] {
  return [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM_ID,
      gameSpecId: JIEQI_SPEC_ID,
      setup: STANDARD_JIEQI_DEAL,
    },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'b', seat: 'black' },
    { type: 'move-played', at: 4, roomId: ROOM_ID, color: 'red', move: { from: 'b3', to: 'b10' } },
    { type: 'seat-resigned', at: 5, roomId: ROOM_ID, color: 'black' },
  ];
}

function gameRecord(overrides: Partial<RecentEveGameRecord> = {}): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: JIEQI_SPEC_ID,
    mode: 'pvp',
    result: 'red-wins',
    termination: 'resignation',
    plyCount: 1,
    startedAt: new Date(1),
    endedAt: new Date(5),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'private',
    participants: [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: null,
    incrementMs: null,
    ...overrides,
  };
}

function deps(
  record: RecentEveGameRecord | null,
  events: JieqiEvent[] | null,
): JieqiPostgamePersistence {
  return {
    getGameSummary: async () => record,
    loadRoomEvents: async () => events,
  };
}

test('Jieqi postgame returns a full-truth view revealing every identity', async () => {
  const payload = await jieqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedCaptureEvents()));
  assert.ok(payload);

  assert.equal(payload.game.variant, JIEQI_SPEC_ID);
  assert.equal(payload.game.result, 'red-wins');
  assert.equal(payload.game.termination, 'resignation');
  assert.deepEqual(payload.state.status, {
    type: 'finished',
    winner: 'red',
    reason: 'resignation',
  });

  // Truth view: every occupied square is revealed (faceDown:false), including
  // both sides' dealt pieces and the captured black piece's full role.
  for (const [square, entry] of Object.entries(payload.view.board)) {
    assert.equal(entry?.faceDown, false, `truth square ${square} must be revealed`);
  }
  // The black piece on h8 (dealt as a cannon) is revealed in the truth view.
  assert.deepEqual(payload.view.board.h8, { color: 'black', role: 'cannon', faceDown: false });
  // Red's revealed cannon sits on b10 after the capture.
  assert.deepEqual(payload.view.board.b10, { color: 'red', role: 'cannon', faceDown: false });
  // The captured (still-dark-at-capture) black piece carries its full role.
  assert.deepEqual(payload.view.captured, [{ owner: 'black', role: 'horse' }]);
});

// ── The hidden-info regression assertion ────────────────────────────────────
test('Jieqi postgame per-color views MASK the opponent dark pieces and captures', async () => {
  const payload = await jieqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedCaptureEvents()));
  assert.ok(payload);

  const red = payload.views.red;
  const black = payload.views.black;
  assert.ok(red);
  assert.ok(black);
  assert.equal(red.perspective, 'red');
  assert.equal(black.perspective, 'black');

  // Red's view must NEVER expose Black's still-face-down piece as an identified
  // piece: h8 (a black cannon in truth) is faceDown with no role for Red.
  const redH8 = red.board.h8;
  assert.ok(redH8);
  assert.equal(redH8.faceDown, true);
  assert.equal('role' in redH8, false);

  // Captured-pool reveal is capturer-only. Red captured the black dark piece, so
  // Red learns its identity (role: 'horse')...
  assert.deepEqual(red.captured, [{ owner: 'black', role: 'horse' }]);
  // ...but Black (the former owner of the still-dark piece) learns nothing: the
  // captured entry is masked with role:null.
  assert.deepEqual(black.captured, [{ owner: 'black', role: null }]);

  // Sanity: no per-color board entry leaks the opponent's hidden role. Black
  // never moved here, so the ONLY legitimately revealed black piece is the
  // always-face-up general; any other revealed black identity would be a leak.
  for (const [square, entry] of Object.entries(red.board)) {
    if (entry && entry.faceDown === false && entry.color === 'black' && entry.role !== 'general') {
      assert.fail(`Red view leaks a revealed black identity on ${square}`);
    }
  }
});

test('Jieqi postgame exposes players sourced from persisted participants', async () => {
  const record = gameRecord({
    participants: [
      {
        color: 'red',
        displayName: '周孟芳',
        subjectType: 'user',
        subjectId: 'acct-1',
        visibility: 'public',
        ratingAfter: 2412,
        ratingBefore: 2400,
      },
      {
        color: 'black',
        displayName: 'Misty',
        subjectType: 'engine-version',
        subjectId: 'python-v2-v1.0',
        visibility: 'public',
      },
    ],
  });
  const payload = await jieqiPostgameForApi(ROOM_ID, deps(record, finishedCaptureEvents()));
  assert.ok(payload);
  assert.deepEqual(payload.game.players, [
    // `handle` is null even though the seat is a user with a subjectId: the
    // participant carries no handle here, and subjectId is an internal user id
    // that /@/:handle cannot address. Linking off it would 404.
    { color: 'red', name: '周孟芳', rating: 2412, kind: 'account', handle: null, botId: null },
    // A raw engine-version subject has no /bot page, so it stays unlinkable.
    { color: 'black', name: 'Misty', rating: null, kind: 'engine', handle: null, botId: null },
  ]);
});

test('Jieqi postgame carries a linkable handle for a user seat and a bot id for a bot seat', async () => {
  const record = gameRecord({
    participants: [
      {
        color: 'red',
        displayName: 'Zhou',
        subjectType: 'user',
        subjectId: 'acct-1',
        handle: 'zhou',
        visibility: 'public',
      },
      {
        color: 'black',
        displayName: 'Misty',
        subjectType: 'bot',
        subjectId: 'misty',
        visibility: 'public',
      },
    ],
  });
  const payload = await jieqiPostgameForApi(ROOM_ID, deps(record, finishedCaptureEvents()));
  assert.ok(payload);
  assert.deepEqual(payload.game.players, [
    { color: 'red', name: 'Zhou', rating: null, kind: 'account', handle: 'zhou', botId: null },
    // Both seats read 'account'; only botId/handle say which page each one has.
    { color: 'black', name: 'Misty', rating: null, kind: 'account', handle: null, botId: 'misty' },
  ]);
});

test('Jieqi postgame redacts a private participant to Anonymous but keeps kind', async () => {
  const record = gameRecord({
    participants: [
      {
        color: 'red',
        displayName: 'Alice',
        subjectType: 'user',
        subjectId: 'acct-9',
        // A linkable handle IS present; the redaction has to drop it anyway,
        // otherwise the row shows 'Anonymous' and links straight to the name.
        handle: 'alice',
        visibility: 'private',
        ratingBefore: 1500,
      },
      {
        color: 'black',
        displayName: 'guest-xyz',
        subjectType: 'guest',
        subjectId: null,
        visibility: 'public',
      },
    ],
  });
  const payload = await jieqiPostgameForApi(ROOM_ID, deps(record, finishedCaptureEvents()));
  assert.ok(payload);
  assert.deepEqual(payload.game.players, [
    // A redacted seat must not carry a link that names the account behind the
    // 'Anonymous' it shows, so handle is null regardless of the participant.
    { color: 'red', name: 'Anonymous', rating: 1500, kind: 'account', handle: null, botId: null },
    { color: 'black', name: 'guest-xyz', rating: null, kind: 'guest', handle: null, botId: null },
  ]);
});

test('Jieqi postgame returns an empty players array when no participants are recorded', async () => {
  const payload = await jieqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedCaptureEvents()));
  assert.ok(payload);
  assert.deepEqual(payload.game.players, []);
});

test('Jieqi postgame history snapshots every perspective per ply', async () => {
  const payload = await jieqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedCaptureEvents()));
  assert.ok(payload);

  // Initial position (ply 0) + one snapshot for the single move played.
  assert.deepEqual(
    payload.history.truth?.map((snapshot) => snapshot.ply),
    [0, 1],
  );
  assert.equal(payload.history.red?.length, 2);
  assert.equal(payload.history.black?.length, 2);
});

test('Jieqi watch postgame emits capture-free truth AND as-played masked history', async () => {
  const payload = await jieqiWatchPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedCaptureEvents()),
  );
  assert.ok(payload);

  assert.equal('views' in payload, false);
  // Two tracks since 2026-08-27. 'masked' is what TV shows by default; 'truth' is
  // what the Reveal control swaps in. Shipping only 'truth' is what made /watch and
  // the homepage viewer replay a finished game with every identity already face-up.
  assert.deepEqual(Object.keys(payload.history), ['truth', 'masked']);
  assert.deepEqual(
    payload.history.truth.map((snapshot) => snapshot.ply),
    [0, 1],
  );
  assert.deepEqual(
    payload.history.masked.map((snapshot) => snapshot.ply),
    [0, 1],
  );

  for (const snapshot of payload.history.truth) {
    assert.deepEqual(snapshot.view.legalMoves, []);
    assert.deepEqual(snapshot.view.captured, []);
    for (const [square, entry] of Object.entries(snapshot.view.board)) {
      assert.equal(entry?.faceDown, false, `watch truth square ${square} must be revealed`);
    }
  }
  assert.deepEqual(payload.view.captured, []);
  assert.deepEqual(payload.view.legalMoves, []);
});

// ── The as-played regression assertion ──────────────────────────────────────
test('Jieqi watch masked history keeps a never-moved piece face-down', async () => {
  const payload = await jieqiWatchPostgameForApi(
    ROOM_ID,
    deps(gameRecord(), finishedCaptureEvents()),
  );
  assert.ok(payload);

  const masked = payload.history.masked.at(-1)?.view;
  const truth = payload.history.truth.at(-1)?.view;
  assert.ok(masked && truth);

  // Same pieces on the same squares in both tracks: the mask is a redaction of
  // identity, never of position. Jieqi hides WHAT a piece is, not WHERE it is.
  assert.deepEqual(Object.keys(masked.board).sort(), Object.keys(truth.board).sort());
  assert.deepEqual(masked.legalMoves, []);
  assert.deepEqual(masked.captured, []);
  assert.deepEqual(masked.lastMove, truth.lastMove);

  // Black never moved in this line, so every black piece but the general is still
  // face-down — the exact case the old truth-only payload spoiled.
  const blackH8 = masked.board.h8;
  assert.ok(blackH8);
  assert.equal(blackH8.faceDown, true);
  assert.equal('role' in blackH8, false);
  assert.deepEqual(truth.board.h8, { color: 'black', role: 'cannon', faceDown: false });

  // Red's cannon moved and captured, so IT is face-up in the masked track too:
  // the mask replays the reveals that actually happened.
  assert.deepEqual(masked.board.b10, { color: 'red', role: 'cannon', faceDown: false });

  const hidden = Object.entries(masked.board).filter(([, entry]) => entry?.faceDown === true);
  assert.ok(hidden.length > 20, `one ply leaves most of the deal dark, got ${hidden.length}`);
  for (const [square, entry] of hidden) {
    assert.ok(entry && !('role' in entry), `masked ${square} carries no role`);
  }
});

test('Jieqi postgame builds a move-and-terminal timeline', async () => {
  const payload = await jieqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedCaptureEvents()));
  assert.ok(payload);

  assert.deepEqual(
    payload.timeline.map((entry) => entry.type),
    ['move-played', 'seat-resigned'],
  );
  const terminal = payload.timeline.at(-1);
  assert.equal(terminal?.type, 'seat-resigned');
  assert.equal(terminal && 'winner' in terminal ? terminal.winner : null, 'red');
});

test('Jieqi postgame returns null for an unfinished game', async () => {
  const events = finishedCaptureEvents().slice(0, -1); // drop the resignation
  const payload = await jieqiPostgameForApi(ROOM_ID, deps(gameRecord(), events));
  assert.equal(payload, null);
});

test('Jieqi watch postgame never releases truth for an unfinished game', async () => {
  const events = finishedCaptureEvents().slice(0, -1);
  const payload = await jieqiWatchPostgameForApi(ROOM_ID, deps(gameRecord(), events));
  // Neither track from the FINISHED route: a live game reaches TV only through
  // jieqiLiveWatchPayloadFor, which builds the masked track alone.
  assert.equal(payload, null);
});

// ---------------------------------------------------------------------------
// Mistboard TV live broadcast. Jieqi is ASYMMETRIC hidden-identity (the
// capturer alone learns a dark capture), so TV serves the public view: the
// shared masked board, no captures. The regression that matters is the FINISHED
// payload's two full-truth fields (`view` = truth, `history.truth`) never riding
// a live wire.
// ---------------------------------------------------------------------------

// Red's cannon has captured Black's dark b10 piece; game still in progress.
function liveCaptureEvents(): JieqiEvent[] {
  return finishedCaptureEvents().slice(0, -1); // drop the resignation
}

function liveRoom(events: JieqiEvent[] = liveCaptureEvents()) {
  return {
    id: ROOM_ID,
    events,
    projection: replayTenantEvents(jieqiTenant, events),
  };
}

type LivePayload = {
  game: { result: string; endedAt: string | null; plyCount: number; mode: string };
  view: JieqiPlayerView;
  history: { masked: Array<{ ply: number; view: JieqiPlayerView }>; truth?: unknown };
};

test('Jieqi live payload never ships a face-down identity or a capture', () => {
  const payload = jieqiLiveWatchPayloadFor(ROOM_ID, liveRoom()) as LivePayload | null;
  assert.ok(payload);

  // The spoiler track is the whole deal: it must not exist at all.
  assert.equal(payload.history.truth, undefined);
  assert.equal(payload.history.masked.length, 2, 'ply 0 and ply 1');

  const boards = [payload.view, ...payload.history.masked.map((entry) => entry.view)];
  for (const view of boards) {
    // No captures on the TV wire, in either direction of knowledge.
    assert.deepEqual(view.captured, []);
    assert.deepEqual(view.legalMoves, []);
    let hidden = 0;
    for (const [square, piece] of Object.entries(view.board)) {
      if (!piece?.faceDown) continue;
      hidden += 1;
      assert.ok(!('role' in piece), `${square} leaks a face-down identity`);
    }
    // Serving the truth view would turn every piece face-up and make the loop
    // above pass vacuously, so require that pieces are still hidden at all: 30
    // at ply 0 (only the generals are dealt face-up), 28 after the capture
    // (the cannon revealed itself by moving; its dark victim left the board).
    assert.ok(hidden >= 28, `live board must still be masked (only ${hidden} hidden)`);
  }
  // ...and the revealed cannon reads correctly, so this is not vacuous.
  assert.deepEqual(payload.view.board.b10, { color: 'red', role: 'cannon', faceDown: false });
});

test('Jieqi live payload is withheld for a room that is not in progress', () => {
  assert.equal(jieqiLiveWatchPayloadFor(ROOM_ID, liveRoom(finishedCaptureEvents())), null);
});

test('Jieqi live payload is withheld when the room id does not match', () => {
  assert.equal(jieqiLiveWatchPayloadFor('jq_other', liveRoom()), null);
});

test('Jieqi live payload reports the game as in-progress with no end time', () => {
  const payload = jieqiLiveWatchPayloadFor(ROOM_ID, liveRoom()) as LivePayload | null;
  assert.ok(payload);
  assert.equal(payload.game.result, 'in-progress');
  assert.equal(payload.game.endedAt, null);
  assert.equal(payload.game.plyCount, 1);
  assert.equal(payload.game.mode, 'pvp');
});

test('Jieqi postgame rejects a non-jieqi variant record', async () => {
  const payload = await jieqiPostgameForApi(
    ROOM_ID,
    deps(gameRecord({ variant: 'dark-xiangqi' }), finishedCaptureEvents()),
  );
  assert.equal(payload, null);
});

test('Jieqi postgame returns null when there is no game or event log', async () => {
  assert.equal(await jieqiPostgameForApi(ROOM_ID, deps(null, finishedCaptureEvents())), null);
  assert.equal(await jieqiPostgameForApi(ROOM_ID, deps(gameRecord(), null)), null);
});

test('Jieqi postgame does not require launch env flags', async () => {
  const previous = process.env.MISTBOARD_JIEQI_ENABLED;
  delete process.env.MISTBOARD_JIEQI_ENABLED;
  try {
    const payload = await jieqiPostgameForApi(ROOM_ID, deps(gameRecord(), finishedCaptureEvents()));
    assert.ok(payload);
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_JIEQI_ENABLED;
    else process.env.MISTBOARD_JIEQI_ENABLED = previous;
  }
});
