import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialXiangqiState,
  JIEQI_SPEC_ID,
  STANDARD_JIEQI_DEAL,
  standardXiangqiFen,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { tenantCardBinding } from './game-card-tenant.js';
import {
  CARD_PLY_MIN_SWING,
  cardPly,
  outcomeLine,
  renderTenantGameCard,
  TENANT_GAME_OG_IMAGE_VERSION,
  type TenantGameCardStore,
  tenantGameCard,
  tenantGamePageMeta,
} from './og-game-tenant.js';
import { isPositionOgVariant, publicPositionFen } from './og-position.js';
import type { GameParticipant, GameRecord } from './persistence.js';
import type { StoredPlyEval } from './persistence-game-analysis.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

// ── fixtures (the shapes game-export-tenant.test.ts uses) ────────────────────

function participant(
  color: GameParticipant['color'],
  displayName: string,
  visibility: GameParticipant['visibility'] = 'public',
): GameParticipant {
  return { color, displayName, subjectType: 'user', subjectId: displayName, visibility };
}

function gameRecord(overrides: Partial<GameRecord>): GameRecord {
  return {
    roomId: 'xq_card',
    variant: XIANGQI_SPEC_ID,
    mode: 'pvp',
    result: 'red-wins',
    termination: 'resignation',
    plyCount: 3,
    startedAt: new Date('2026-09-12T14:30:00Z'),
    endedAt: new Date('2026-09-12T14:38:42Z'),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: [participant('red', 'alice'), participant('black', 'bob')],
    ...overrides,
  };
}

function preamble(roomId: string, gameSpecId: string, setup?: unknown): unknown[] {
  return [
    { type: 'room-created', at: 1, roomId, gameSpecId, ...(setup ? { setup } : {}) },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];
}

const XQ_ROOM = 'xq_card';
function xiangqiMoves(roomId: string): unknown[] {
  return [
    { type: 'move-played', at: 10, roomId, color: 'red', move: { from: 'h3', to: 'e3' } },
    { type: 'move-played', at: 11, roomId, color: 'black', move: { from: 'h10', to: 'g8' } },
    { type: 'move-played', at: 12, roomId, color: 'red', move: { from: 'b1', to: 'c3' } },
  ];
}
function finishedXiangqiEvents(roomId = XQ_ROOM): unknown[] {
  return [
    ...preamble(roomId, XIANGQI_SPEC_ID),
    ...xiangqiMoves(roomId),
    { type: 'seat-resigned', at: 13, roomId, color: 'black' },
  ];
}

const JQ_ROOM = 'jq_card';
function finishedJieqiEvents(): unknown[] {
  return [
    ...preamble(JQ_ROOM, JIEQI_SPEC_ID, STANDARD_JIEQI_DEAL),
    { type: 'move-played', at: 4, roomId: JQ_ROOM, color: 'red', move: { from: 'b3', to: 'b10' } },
    { type: 'seat-resigned', at: 5, roomId: JQ_ROOM, color: 'black' },
  ];
}

const xiangqiCard = tenantCardBinding(xiangqiTenant, {
  variant: 'xiangqi',
  analysis: { engineId: 'test-engine', depth: 1 },
  fen: standardXiangqiFen,
});

function store(overrides: Partial<TenantGameCardStore>): TenantGameCardStore {
  return {
    summary: async () => null,
    events: async () => null,
    analysis: async () => null,
    ...overrides,
  };
}

async function loadRegistry(): Promise<void> {
  await import('./variant-tenant/register-tenants.js');
}

// ── fenAtPly ────────────────────────────────────────────────────────────────

test('fenAtPly walks a finished log to the asked ply, and only a finished log', () => {
  const events = finishedXiangqiEvents();
  const start = standardXiangqiFen(createInitialXiangqiState('fixture'));
  assert.equal(xiangqiCard.fenAtPly(events, XQ_ROOM, 0), start);
  const afterOne = xiangqiCard.fenAtPly(events, XQ_ROOM, 1);
  assert.ok(afterOne && afterOne !== start, 'ply 1 is a different position');
  const final = xiangqiCard.fenAtPly(events, XQ_ROOM, 3);
  assert.ok(final && final !== afterOne);
  assert.equal(xiangqiCard.fenAtPly(events, XQ_ROOM, 4), null, 'past the end');
  assert.equal(xiangqiCard.fenAtPly(events, XQ_ROOM, -1), null);
  // Same moves, no resignation: the game is live, so no ply is drawn — not
  // even the start position.
  const live = [...preamble(XQ_ROOM, XIANGQI_SPEC_ID), ...xiangqiMoves(XQ_ROOM)];
  assert.equal(xiangqiCard.fenAtPly(live, XQ_ROOM, 0), null);
  assert.equal(xiangqiCard.fenAtPly(live, XQ_ROOM, 2), null);
  // Another room's log is refused.
  assert.equal(xiangqiCard.fenAtPly(finishedXiangqiEvents('xq_other'), XQ_ROOM, 1), null);
});

test('a jieqi card FEN is the public spelling: no deal field, face-down pieces stay face-down', async () => {
  await loadRegistry();
  const { variantTenantForRoomId } = await import('./variant-tenant/registry.js');
  const card = variantTenantForRoomId(JQ_ROOM)?.card;
  assert.ok(card, 'jieqi registers a card');
  const events = finishedJieqiEvents();
  for (const ply of [0, 1]) {
    const fen = card.fenAtPly(events, JQ_ROOM, ply);
    assert.ok(fen, `ply ${ply}`);
    // The card's own public projection of the FEN is the FEN: nothing hidden
    // rode along to be stripped.
    assert.equal(publicPositionFen('jieqi', fen), fen);
    assert.equal(fen.trim().split(/\s+/).length, 5, 'five-field engine FEN, no sixth deal field');
  }
  // (That the public FEN renders byte-identically across deals is pinned in
  // og-position.test.ts; the card only has to hand over the public spelling.)
});

// ── cardPly ─────────────────────────────────────────────────────────────────

function evals(cps: Array<number | null>): StoredPlyEval[] {
  return cps.map((cp, ply) => ({ ply, cp, mate: null, best: 'x' }));
}

test('cardPly picks the position before the largest swing, else the final position', () => {
  // Red POV: flat, then Black blunders at ply 2 (+300), then Red blunders
  // harder at ply 3 (-900). The card shows the position BEFORE ply 3.
  assert.equal(cardPly(evals([0, 10, 300, -900]), 3), 2);
  // Nothing clears the floor: final position.
  assert.equal(cardPly(evals([0, 20, 40, 30]), 3), 3);
  assert.equal(cardPly([], 3), 3);
  // A missing eval on either side of a pair skips that pair, not the game.
  assert.equal(cardPly(evals([0, null, 900, 950]), 3), 3);
  assert.equal(cardPly(evals([0, 900, null, 950]), 3), 0);
  // An unstable ply is never trusted on either side.
  const unstable = evals([0, 900, 950]);
  unstable[1] = { ...unstable[1]!, unstable: true };
  assert.equal(cardPly(unstable, 2), 2);
  // Mate distances still register as swings.
  assert.equal(cardPly([...evals([0, 5]), { ply: 2, cp: null, mate: 3, best: 'x' }], 2), 1);
  assert.ok(CARD_PLY_MIN_SWING >= 5, 'at least lichess inaccuracy');
});

// ── outcome line ────────────────────────────────────────────────────────────

test('outcomeLine names the winner, not the ink, and refuses undecided games', () => {
  assert.equal(outcomeLine(gameRecord({})), 'alice won by resignation');
  assert.equal(
    outcomeLine(gameRecord({ result: 'black-wins', termination: 'checkmate' })),
    'bob won by checkmate',
  );
  assert.equal(
    outcomeLine(gameRecord({ result: 'draw', termination: 'repetition' })),
    'Drawn by repetition',
  );
  assert.equal(outcomeLine(gameRecord({ result: 'draw', termination: 'weird' })), 'Drawn');
  // A private seat is 'Anonymous' on the card, as on the review page.
  assert.equal(
    outcomeLine(gameRecord({ participants: [participant('red', 'alice', 'private')] })),
    'Anonymous won by resignation',
  );
  assert.equal(outcomeLine(gameRecord({ result: '' })), null);
  assert.equal(outcomeLine(gameRecord({ result: 'east-wins', participants: [] })), null);
});

// ── page meta ───────────────────────────────────────────────────────────────

test('tenant game page meta: title, outcome, canonical review URL, versioned card', async () => {
  await loadRegistry();
  const summary = async (roomId: string) =>
    roomId === XQ_ROOM ? gameRecord({ roomId: XQ_ROOM, plyCount: 31 }) : null;
  const meta = await tenantGamePageMeta('/xiangqi/game/xq_card', store({ summary }));
  assert.ok(meta);
  assert.equal(meta.title, 'alice vs bob · Xiangqi | Mistboard');
  assert.equal(
    meta.description,
    'alice won by resignation after 16 moves. Replay this Xiangqi game move by move on Mistboard.',
  );
  assert.equal(meta.urlPath, '/xiangqi/game/xq_card');
  assert.equal(meta.imagePath, `/og/game/xq_card.png?v=${TENANT_GAME_OG_IMAGE_VERSION}`);
  // /room/:id is the URL in a player's address bar; it canonicalises to the review URL.
  const room = await tenantGamePageMeta('/room/xq_card', store({ summary }));
  assert.equal(room?.urlPath, '/xiangqi/game/xq_card');
});

test('tenant game page meta fails closed', async () => {
  await loadRegistry();
  let summaryCalls = 0;
  const summary = async (roomId: string) => {
    summaryCalls += 1;
    return roomId === XQ_ROOM ? gameRecord({ roomId: XQ_ROOM }) : null;
  };
  // A tenant room id under ANOTHER tenant's route base: no card.
  assert.equal(await tenantGamePageMeta('/jieqi/game/xq_card', store({ summary })), null);
  // The chess route base is not a tenant base either.
  assert.equal(await tenantGamePageMeta('/game/xq_card', store({ summary })), null);
  // Not a game page at all: no DB read.
  summaryCalls = 0;
  assert.equal(await tenantGamePageMeta('/xiangqi', store({ summary })), null);
  assert.equal(await tenantGamePageMeta('/rules/xiangqi', store({ summary })), null);
  assert.equal(summaryCalls, 0);
  // A chess room id (registry miss) is not a tenant card and never reads the DB.
  assert.equal(await tenantGamePageMeta('/room/abc123', store({ summary })), null);
  assert.equal(summaryCalls, 0);
  // Unfinished (no completed row): nothing.
  assert.equal(await tenantGamePageMeta('/xiangqi/game/xq_live', store({ summary })), null);
  // A record whose variant disagrees with the prefix: nothing.
  const wrongVariant = async () => gameRecord({ roomId: XQ_ROOM, variant: JIEQI_SPEC_ID });
  assert.equal(
    await tenantGamePageMeta('/xiangqi/game/xq_card', store({ summary: wrongVariant })),
    null,
  );
});

// ── the card ────────────────────────────────────────────────────────────────

test('the card draws the analysed turning point, else the final position, else the pairing', async () => {
  await loadRegistry();
  const record = gameRecord({ roomId: XQ_ROOM, plyCount: 3 });
  const base = store({
    summary: async () => record,
    events: async () => finishedXiangqiEvents() as { type: string; roomId: string }[],
  });
  const entry = await tenantGameCard(XQ_ROOM, base);
  assert.ok(entry);
  assert.deepEqual(entry.players, ['alice', 'bob']);

  // Analysed: Red POV collapses at ply 2 -> the position after ply 1 is drawn.
  const asked: string[] = [];
  const analysed = {
    ...base,
    analysis: async (_room: string, engineId: string) => {
      asked.push(engineId);
      return evals([0, 20, -800, -790]);
    },
  };
  const turning = await renderTenantGameCard(entry, analysed);
  assert.deepEqual(asked, [entry.card.analysis?.engineId]);
  // The caption is the two seats and the variant, nothing else: the result and
  // the move count live in the og:description, not on the board's card. Black
  // (bob) sits at the top of the column, level with the top of the board; red
  // (alice) at the bottom.
  assert.match(turning, />alice<\/text>/);
  assert.match(turning, />bob<\/text>/);
  assert.ok(turning.indexOf('>bob</text>') < turning.indexOf('>alice</text>'), 'black above red');
  assert.match(turning, />Xiangqi<\/text>/);
  assert.match(turning, /mistboard\.com/);
  assert.doesNotMatch(turning, /won by|Move \d|moves/);
  // The board is the shared renderer's nested <svg>.
  assert.ok((turning.match(/<svg/g) ?? []).length >= 2, 'a board is drawn');
  // Red's horse is still on b1 in the position BEFORE ply 2 (b1-c3 is ply 3),
  // and the black horse has already left h10 (ply 2): the drawn position is
  // the analysed turning point, not the final one.
  const final = await renderTenantGameCard(entry, base);
  assert.notEqual(turning, final, 'the analysed pick differs from the final position');

  // No event log (or an unplayable one): the pairing carries a board-less card.
  const bare = await renderTenantGameCard(entry, { ...base, events: async () => null });
  assert.equal((bare.match(/<svg/g) ?? []).length, 1, 'no board');
  assert.match(bare, /alice vs bob/);
  assert.match(bare, /Xiangqi/);
});

test('a jieqi card never carries a glyph on a face-down piece', async () => {
  await loadRegistry();
  const record = gameRecord({
    roomId: JQ_ROOM,
    variant: JIEQI_SPEC_ID,
    plyCount: 1,
    participants: [participant('red', 'alice'), participant('black', 'bob')],
  });
  const entry = await tenantGameCard(
    JQ_ROOM,
    store({
      summary: async () => record,
      events: async () => finishedJieqiEvents() as { type: string; roomId: string }[],
    }),
  );
  assert.ok(entry);
  assert.equal(entry.card.analysis, null, 'jieqi picks no analysed ply');
  const svg = await renderTenantGameCard(
    entry,
    store({ events: async () => finishedJieqiEvents() as { type: string; roomId: string }[] }),
  );
  assert.match(svg, /Jieqi/);
  // After one move, one piece has revealed (b3 cannon to b10). Every other
  // piece off the back rank is face-down: the card draws them as discs, and
  // the deal's identities (32 glyphs) are NOT on it. The kings and the one
  // revealed piece are the only glyph paths.
  const glyphs = (svg.match(/<path /g) ?? []).length;
  assert.ok(
    glyphs > 0 && glyphs <= 3 * 2,
    `only the two generals and the revealed piece carry glyphs (${glyphs} paths)`,
  );
});

// ── registry conformance ────────────────────────────────────────────────────

test('every tenant with a review URL binds a card on a position-card variant', async () => {
  await loadRegistry();
  const { registeredVariantTenants } = await import('./variant-tenant/registry.js');
  let cards = 0;
  for (const entry of registeredVariantTenants()) {
    if (!entry.export) {
      assert.ok(!entry.card, `${entry.kind}: a card needs the export's review URL`);
      continue;
    }
    assert.ok(entry.card, `${entry.kind}: a review URL wants a share card (#368)`);
    assert.ok(
      isPositionOgVariant(entry.card.variant),
      `${entry.kind}: card variant '${entry.card.variant}' has a position renderer`,
    );
    assert.equal(entry.card.variant, entry.gameSpecId, entry.kind);
    // Fail closed on garbage, every tenant.
    assert.equal(entry.card.fenAtPly([], `${entry.roomIdPrefix}x`, 0), null);
    cards += 1;
  }
  assert.ok(cards >= 8, `expected the eight review tenants, saw ${cards}`);
});
