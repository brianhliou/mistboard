/**
 * Per-seat observed-captures wire contract for Dark Xiangqi (fog xiangqi).
 *
 * Hidden-info invariant: a seat's `captures` may only reveal enemy pieces THAT
 * SEAT captured (a capture's victim is always visible to the capturer under
 * fog) plus its own losses (always known). It must never surface an enemy
 * capture the seat did not make. Spectators (empty board policy) get empty
 * arrays. Postgame history at a mid-ply must exclude captures that happen later.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DARK_XIANGQI_SPEC_ID, type XiangqiCapture } from '@mistboard/game';
import type { DarkXiangqiEvent } from './dark-xiangqi-runtime.js';
import {
  buildDarkXiangqiGameSummary,
  darkXiangqiCaptureLedger,
  darkXiangqiObservedCaptures,
  darkXiangqiTenant,
} from './dark-xiangqi-tenant.js';
import { DARK_XIANGQI_DEFAULT_ENGINE_ID } from './engines/registry.js';
import { darkXiangqiPostgameForApi } from './routes/dark-xiangqi-games.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

// A real 4-capture game from the standard start (generated via the kernel),
// where each color makes exactly two kills:
//   b3xb10  red cannon   x black horse
//   h8xh1   black cannon x red horse
//   i1xh1   red chariot  x black cannon
//   a10xb10 black chariot x red cannon
const CAPTURE_MOVES = [
  { from: 'b3', to: 'b10' },
  { from: 'h8', to: 'h1' },
  { from: 'i1', to: 'h1' },
  { from: 'a10', to: 'b10' },
] as const;

function captureGameEvents(roomId: string, opts: { resign?: boolean } = {}): DarkXiangqiEvent[] {
  const events: DarkXiangqiEvent[] = [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: DARK_XIANGQI_SPEC_ID },
  ];
  CAPTURE_MOVES.forEach((move, index) => {
    events.push({
      type: 'move-played',
      at: 10_000 + index * 1_000,
      roomId,
      color: index % 2 === 0 ? 'red' : 'black',
      move,
    });
  });
  if (opts.resign) {
    events.push({ type: 'seat-resigned', at: 100_000, roomId, color: 'red' });
  }
  return events;
}

// ── Unit: captures are common knowledge between seats; only spectators redacted ─

test('observed captures: both seats and truth carry the full dead lists, in capture order', () => {
  const ledger: XiangqiCapture[] = [
    { victim: { color: 'black', role: 'horse' }, capturedBy: 'red', plyIndex: 0 },
    { victim: { color: 'red', role: 'soldier' }, capturedBy: 'black', plyIndex: 1 },
    { victim: { color: 'black', role: 'cannon' }, capturedBy: 'red', plyIndex: 2 },
  ];
  const full = { red: ['soldier'], black: ['horse', 'cannon'] };
  // Two-player fog: every capture is common knowledge, so seats == truth.
  assert.deepEqual(darkXiangqiObservedCaptures(ledger, 'red'), full);
  assert.deepEqual(darkXiangqiObservedCaptures(ledger, 'black'), full);
  assert.deepEqual(darkXiangqiObservedCaptures(ledger, 'truth'), full);
});

test('observed captures: spectators are redacted to empty arrays (material count is info)', () => {
  const ledger: XiangqiCapture[] = [
    { victim: { color: 'black', role: 'horse' }, capturedBy: 'red', plyIndex: 0 },
    { victim: { color: 'red', role: 'soldier' }, capturedBy: 'black', plyIndex: 1 },
  ];
  assert.deepEqual(darkXiangqiObservedCaptures(ledger, 'spectator'), { red: [], black: [] });
});

// ── Live wire snapshot ───────────────────────────────────────────────────────

test('live snapshot: both seats carry identical full captures, spectator empty', () => {
  const roomId = 'dxq_captures_live';
  const created = createTenantRuntimeRoomFromEvents(darkXiangqiTenant, captureGameEvents(roomId));
  if (!created.ok) throw new Error('capture game must hydrate');

  const snap = (seat: 'red' | 'black' | 'spectator') =>
    tenantSnapshotPayload(darkXiangqiTenant, created.room, { id: `c-${seat}`, seat, solo: false })
      .state.captures;

  const full = { red: ['horse', 'cannon'], black: ['horse', 'cannon'] };
  assert.deepEqual(snap('red'), full);
  assert.deepEqual(snap('black'), full, 'both seats share the same dead lists (common knowledge)');
  assert.deepEqual(snap('spectator'), { red: [], black: [] });

  // Cross-check: the seat lists equal the full ledger dead lists by color.
  const ledger = darkXiangqiCaptureLedger(created.room.events);
  assert.deepEqual(snap('red'), {
    red: ledger.filter((c) => c.victim.color === 'red').map((c) => c.victim.role),
    black: ledger.filter((c) => c.victim.color === 'black').map((c) => c.victim.role),
  });
});

// ── Participant naming ───────────────────────────────────────────────────────

test('game summary: anonymous seats are named "Guest", never a color word', () => {
  // Regression: the guest branch used `color === 'red' ? 'Red' : 'Black'`, so an
  // anonymous human surfaced as "Red"/"Black" on watch thumbnails and reviews —
  // reading as a side label, not a player, and (with a red seat) as the wrong
  // color. Every other persistence path names an anonymous seat "Guest".
  const roomId = 'dxq_guest_naming';
  const created = createTenantRuntimeRoomFromEvents(
    darkXiangqiTenant,
    captureGameEvents(roomId, { resign: true }),
  );
  if (!created.ok) throw new Error('capture game must hydrate');

  const summary = buildDarkXiangqiGameSummary(created.room);
  const names = Object.fromEntries(
    (summary.participants ?? []).map((p) => [p.color, p.displayName]),
  );
  assert.equal(names.red, 'Guest');
  assert.equal(names.black, 'Guest');
});

test('game summary: a PvE engine seat is attributed to the bot, not the engine version', () => {
  // Regression: Dark Xiangqi is the only tenant that overrides buildGameSummary,
  // and its private participant builder never read room.pveBotId — so every dxq
  // PvE game recorded subject_type 'engine-version'/'python-fdx-v1.1' where the
  // shared tenantParticipant records 'bot'/'misty'. The bot profile counts games
  // by (subject_type='bot', subject_id), so Misty's Fog Xiangqi tab read
  // "0 Games / No completed Fog Xiangqi games yet" while finished games existed.
  const roomId = 'dxq_pve_bot_attribution';
  const events = captureGameEvents(roomId, { resign: true });
  events[0] = { ...events[0]!, pveBotId: 'misty' } as DarkXiangqiEvent;
  events.splice(1, 0, {
    type: 'seat-assigned',
    at: 2_000,
    roomId,
    clientId: DARK_XIANGQI_DEFAULT_ENGINE_ID,
    seat: 'black',
  });

  const created = createTenantRuntimeRoomFromEvents(darkXiangqiTenant, events);
  if (!created.ok) throw new Error('pve game must hydrate');

  const summary = buildDarkXiangqiGameSummary(created.room);
  const black = (summary.participants ?? []).find((p) => p.color === 'black');
  assert.equal(black?.subjectType, 'bot');
  assert.equal(black?.subjectId, 'misty');
  assert.equal(black?.displayName, 'Misty');

  // The human seat is unaffected.
  const red = (summary.participants ?? []).find((p) => p.color === 'red');
  assert.equal(red?.subjectType, 'guest');
});

test('game summary: an engine seat with no pveBotId still resolves its first-party bot', () => {
  // Legacy rooms created before pveBotId was recorded fall back to
  // firstPartyBotForEngine(engineId), so a backfill is not needed for naming.
  const roomId = 'dxq_pve_legacy_attribution';
  const events = captureGameEvents(roomId, { resign: true });
  events.splice(1, 0, {
    type: 'seat-assigned',
    at: 2_000,
    roomId,
    clientId: DARK_XIANGQI_DEFAULT_ENGINE_ID,
    seat: 'black',
  });

  const created = createTenantRuntimeRoomFromEvents(darkXiangqiTenant, events);
  if (!created.ok) throw new Error('legacy pve game must hydrate');

  const summary = buildDarkXiangqiGameSummary(created.room);
  const black = (summary.participants ?? []).find((p) => p.color === 'black');
  assert.equal(black?.subjectType, 'bot');
  assert.equal(black?.subjectId, 'misty');
});

test('game summary: records the room time control, so the finished game is not untimed', () => {
  // Regression: this builder omitted initialMs/incrementMs, so every finished
  // Fog Xiangqi row stored a NULL clock and the review header read "Untimed"
  // for 5+5 games.
  const roomId = 'dxq_summary_clock';
  const events = captureGameEvents(roomId, { resign: true });
  events[0] = {
    ...events[0]!,
    timeControl: { initialMs: 300_000, incrementMs: 5_000 },
  } as DarkXiangqiEvent;

  const created = createTenantRuntimeRoomFromEvents(darkXiangqiTenant, events);
  if (!created.ok) throw new Error('clocked game must hydrate');

  const summary = buildDarkXiangqiGameSummary(created.room);
  assert.equal(summary.initialMs, 300_000);
  assert.equal(summary.incrementMs, 5_000);
});

// ── Postgame history truncation ──────────────────────────────────────────────

test('postgame history: captures accumulate ply-by-ply, later captures excluded mid-game', async () => {
  const roomId = 'dxq_captures_postgame';
  const events = captureGameEvents(roomId, { resign: true });
  const created = createTenantRuntimeRoomFromEvents(darkXiangqiTenant, events);
  if (!created.ok) throw new Error('capture game must hydrate');

  const payload = await darkXiangqiPostgameForApi(roomId, {
    getLiveRoom: (id) => (id === roomId ? created.room : null),
    getGameSummary: async () => {
      throw new Error('persistence should not be queried');
    },
    isPersistenceEnabled: () => false,
    loadRoomEvents: async () => {
      throw new Error('persistence should not be queried');
    },
  });
  assert.ok(payload);

  const redHistory = payload.history.red;
  assert.ok(redHistory && redHistory.length === 5, 'history has ply 0..4 entries');

  // Ply 0: nothing captured yet.
  assert.deepEqual(redHistory[0]!.view.captures, { red: [], black: [] });
  // Ply 1: red captured the black horse; red has lost nothing. Later captures
  // (red's own horse/cannon losses, the black cannon) must NOT appear yet.
  assert.deepEqual(redHistory[1]!.view.captures, { red: [], black: ['horse'] });
  // Ply 2: black has now captured red's horse.
  assert.deepEqual(redHistory[2]!.view.captures, { red: ['horse'], black: ['horse'] });
  // Ply 4: full tally.
  assert.deepEqual(redHistory[4]!.view.captures, {
    red: ['horse', 'cannon'],
    black: ['horse', 'cannon'],
  });

  // Truth history truncates identically.
  const truthHistory = payload.history.truth;
  assert.ok(truthHistory);
  assert.deepEqual(truthHistory[1]!.view.captures, { red: [], black: ['horse'] });

  // Final POV views agree with the last history frame.
  assert.deepEqual(payload.views.red?.captures, {
    red: ['horse', 'cannon'],
    black: ['horse', 'cannon'],
  });
  assert.deepEqual(payload.view.captures, {
    red: ['horse', 'cannon'],
    black: ['horse', 'cannon'],
  });
});
