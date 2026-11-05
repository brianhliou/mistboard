import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import { type GomokuOpening, type GomokuSquare, maybeGameSpecForId } from '@mistboard/game';
import './gomoku-registration.js';
import type { GomokuEvent } from './gomoku-tenant.js';
import {
  renderTenantGameCard,
  serveTenantGameOgImage,
  TENANT_GAME_OG_IMAGE_VERSION,
  type TenantGameCardStore,
  tenantGameCard,
  tenantGamePageMeta,
} from './og-game-tenant.js';
import { OG_HEIGHT, OG_WIDTH } from './og-primitives.js';
import { OG_CARD_ZOOM, pngSize } from './og-raster.js';
import type { GameRecord } from './persistence.js';
import { variantTenantForRoomId } from './variant-tenant/registry.js';

const originalFlag = process.env.MISTBOARD_GOMOKU_ENABLED;
before(() => {
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
});
after(() => {
  if (originalFlag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
  else process.env.MISTBOARD_GOMOKU_ENABLED = originalFlag;
});

function winningEvents(roomId: string, setup?: GomokuOpening) {
  const events: GomokuEvent[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: 'gomoku', ...(setup ? { setup } : {}) },
    { type: 'seat-assigned', at: 2, roomId, seat: 'black', clientId: 'alice' },
    { type: 'seat-assigned', at: 3, roomId, seat: 'white', clientId: 'bob' },
  ];
  const black: GomokuSquare[] = ['a1', 'b1', 'c1', 'd1', 'e1'];
  const white: GomokuSquare[] = ['a15', 'c15', 'e15', 'g15', 'i15'];
  let turn = setup?.turn ?? 'black';
  while (black.length) {
    const color = turn;
    events.push({
      type: 'move-played',
      at: events.length + 1,
      roomId,
      color,
      move: { to: (color === 'black' ? black : white).shift()! },
    });
    turn = color === 'black' ? 'white' : 'black';
  }
  return events;
}

function storeFor(
  roomId: string,
  events: readonly { type: string; roomId: string }[] | null = winningEvents(roomId),
  overrides: Partial<GameRecord> = {},
): TenantGameCardStore {
  const game: GameRecord = {
    roomId,
    variant: 'gomoku',
    mode: 'pvp',
    result: 'black-wins',
    termination: 'race',
    plyCount: events?.filter((event) => event.type === 'move-played').length ?? 9,
    startedAt: new Date('2026-10-31T18:00:00Z'),
    endedAt: new Date('2026-10-31T18:10:00Z'),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: (['black', 'white'] as const).map((color, index) => ({
      color,
      displayName: index === 0 ? 'alice' : 'bob',
      subjectType: 'user',
      subjectId: index === 0 ? 'alice' : 'bob',
      visibility: 'public',
    })),
    ...overrides,
  };
  return {
    summary: async () => game,
    events: async () => events,
    analysis: async () => assert.fail('Gomoku has no stored analysis'),
  };
}

function responseProbe() {
  const result: { status: number; headers: Record<string, string>; body: Buffer } = {
    status: 0,
    headers: {},
    body: Buffer.alloc(0),
  };
  const response = {
    writeHead(status: number, headers: Record<string, string>) {
      result.status = status;
      result.headers = headers;
    },
    end(body?: Buffer) {
      result.body = body ?? Buffer.alloc(0);
    },
  } as unknown as ServerResponse;
  return { result, response };
}

test('Gomoku finished-game card draws the final stones, winning line, names and scores', async () => {
  const roomId = 'gmk_card_win';
  const store = storeFor(roomId);
  const entry = await tenantGameCard(roomId, store);
  assert.ok(entry, 'Gomoku registers a finished-game card');
  assert.equal(entry.card.layout, 'gomoku');
  const svg = await renderTenantGameCard(entry, store);
  assert.match(svg, /fill="#dcb975"/);
  assert.equal((svg.match(/class="gomoku-stone /g) ?? []).length, 9);
  assert.equal((svg.match(/class="gomoku-winning"/g) ?? []).length, 5);
  assert.equal((svg.match(/class="gomoku-last"/g) ?? []).length, 1);
  assert.match(svg, /data-piece-square="e1"[^>]*gomoku-stone--black/);
  assert.match(svg, /gomoku-stone--white/);
  assert.match(svg, />alice<\/text>/);
  assert.match(svg, />bob<\/text>/);
  assert.match(svg, />1<\/text>/);
  assert.match(svg, />0<\/text>/);
  assert.match(svg, /Gomoku/);
  // 五子棋 is the name in both Simplified and Traditional Chinese.
  assert.match(svg, /五子棋/);
  assert.doesNotMatch(svg, /<path d="[^"]+" fill="#(?:b91c1c|1f2937)"/);
  const meta = await tenantGamePageMeta(`/room/${roomId}`, store);
  assert.equal(meta?.title, 'alice vs bob · Gomoku · 五子棋 | Mistboard');
  // The review page is the card's canonical page, from the room and from itself.
  assert.equal(meta?.urlPath, `/gomoku/game/${roomId}`);
  const reviewMeta = await tenantGamePageMeta(`/gomoku/game/${roomId}`, store);
  assert.equal(reviewMeta?.urlPath, `/gomoku/game/${roomId}`);
  assert.equal(reviewMeta?.title, meta?.title);
  assert.equal(meta?.imagePath, `/og/game/${roomId}.png?v=${TENANT_GAME_OG_IMAGE_VERSION}`);
  assert.match(meta?.description ?? '', /alice won/);
  assert.equal(await tenantGamePageMeta(`/xiangqi/game/${roomId}`, store), null);
  const { response, result } = responseProbe();
  await serveTenantGameOgImage(roomId, response, store);
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-type'], 'image/png');
  assert.deepEqual(pngSize(result.body), {
    width: OG_WIDTH * OG_CARD_ZOOM,
    height: OG_HEIGHT * OG_CARD_ZOOM,
  });
});

test('Gomoku card replays dealt 3/4/5-stone openings as well as human placements', async () => {
  for (const count of [3, 4, 5]) {
    const setup: GomokuOpening = {
      stones: (['h8', 'h9', 'i9', 'i8', 'g7'] as GomokuSquare[])
        .slice(0, count)
        .map((square, index) => ({ square, color: index % 2 ? 'white' : 'black' })),
      turn: count % 2 ? 'white' : 'black',
    };
    const roomId = `gmk_card_opening_${count}`;
    const events = winningEvents(roomId, setup);
    const store = storeFor(roomId, events);
    const entry = await tenantGameCard(roomId, store);
    assert.ok(entry, 'dealt game has a card');
    const svg = await renderTenantGameCard(entry, store);
    assert.equal(
      (svg.match(/class="gomoku-stone /g) ?? []).length,
      count + events.filter((event) => event.type === 'move-played').length,
    );
    assert.match(svg, /data-piece-square="h8"[^>]*gomoku-stone--black/);
    assert.match(svg, /data-piece-square="h9"[^>]*gomoku-stone--white/);
  }
});

test('Gomoku flag gates metadata and PNGs before store reads, including a warmed PNG cache', async () => {
  const roomId = 'gmk_card_flag';
  const store = storeFor(roomId);
  const warm = responseProbe();
  await serveTenantGameOgImage(roomId, warm.response, store);
  assert.equal(warm.result.status, 200, 'warm a real Gomoku PNG');
  const hit = responseProbe();
  await serveTenantGameOgImage(roomId, hit.response, store);
  assert.equal(hit.result.headers['x-og-cache'], 'HIT');
  const forbidden = async () => assert.fail('disabled card must not read persistence');
  const noReads: TenantGameCardStore = {
    summary: forbidden,
    events: forbidden,
    analysis: forbidden,
  };
  try {
    for (const flag of [undefined, 'false']) {
      if (flag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
      else process.env.MISTBOARD_GOMOKU_ENABLED = flag;
      assert.equal(await tenantGameCard(roomId, noReads), null);
      assert.equal(await tenantGamePageMeta(`/room/${roomId}`, noReads), null);
      const cold = responseProbe();
      await serveTenantGameOgImage('gmk_card_never_cached', cold.response, noReads);
      assert.equal(cold.result.status, 302);
      const cached = responseProbe();
      await serveTenantGameOgImage(roomId, cached.response, noReads);
      assert.equal(cached.result.status, 302);
      assert.equal(cached.result.headers.location, '/og-image.png');
      assert.equal(cached.result.body.length, 0);
    }
  } finally {
    process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  }
  assert.equal(maybeGameSpecForId('gomoku')?.publicSurface, 'hidden');
  const registration = variantTenantForRoomId(roomId);
  assert.equal(registration?.lobby?.supportsRated, false);
  assert.equal(registration?.export?.gameRouteBase, '/gomoku/game');
  assert.equal(registration?.watch?.channelId, 'gomoku');
});

test('Gomoku cards reject live, aborted, absent, wrong-room and mismatched-variant games', async () => {
  let index = 0;
  for (const kind of ['live', 'aborted', 'missing', 'wrong-room', 'wrong-variant', 'no-summary']) {
    const roomId = `gmk_card_invalid_${index++}`;
    const full = winningEvents(roomId);
    const events =
      kind === 'live'
        ? full.slice(0, -1)
        : kind === 'aborted'
          ? [full[0]!, { type: 'game-aborted', at: 2, roomId, reason: 'no-start' }]
          : kind === 'missing'
            ? null
            : kind === 'wrong-room'
              ? winningEvents('gmk_another_room')
              : full;
    const store = storeFor(roomId, events, kind === 'wrong-variant' ? { variant: 'xiangqi' } : {});
    if (kind === 'no-summary') store.summary = async () => null;
    assert.equal(await tenantGameCard(roomId, store), null, kind);
    assert.equal(await tenantGamePageMeta(`/room/${roomId}`, store), null, kind);
    const { response, result } = responseProbe();
    await serveTenantGameOgImage(roomId, response, store);
    assert.equal(result.status, 302, kind);
  }
});

test('Gomoku cards show White wins, draws and private names with escaped SVG text', async () => {
  for (const result of ['white-wins', 'draw'] as const) {
    const roomId = `gmk_card_${result}`;
    const events: GomokuEvent[] = [
      { type: 'room-created', at: 1, roomId, gameSpecId: 'gomoku' },
      { type: 'move-played', at: 2, roomId, color: 'black', move: { to: 'h8' } },
      { type: 'move-played', at: 3, roomId, color: 'white', move: { to: 'i8' } },
      ...(result === 'white-wins'
        ? [{ type: 'seat-resigned' as const, at: 4, roomId, color: 'black' as const }]
        : [
            { type: 'draw-offered' as const, at: 4, roomId, color: 'black' as const },
            { type: 'draw-agreed' as const, at: 5, roomId, color: 'white' as const },
          ]),
    ];
    const store = storeFor(roomId, events, {
      result,
      termination: result === 'draw' ? 'draw' : 'resignation',
      participants: [
        {
          color: 'black',
          displayName: '<Alice &>',
          subjectType: 'user',
          subjectId: 'a',
          visibility: 'public',
        },
        {
          color: 'white',
          displayName: 'secret-player',
          subjectType: 'user',
          subjectId: 'b',
          visibility: 'private',
        },
      ],
    });
    const entry = await tenantGameCard(roomId, store);
    assert.ok(entry);
    const svg = await renderTenantGameCard(entry, store);
    assert.match(svg, /&lt;Alice &amp;&gt;/);
    assert.match(svg, />Anonymous<\/text>/);
    assert.doesNotMatch(svg, /secret-player/);
    assert.equal((svg.match(/class="gomoku-stone /g) ?? []).length, 2);
    assert.equal((svg.match(/class="gomoku-winning"/g) ?? []).length, 0);
    assert.equal((svg.match(/>½<\/text>/g) ?? []).length, result === 'draw' ? 2 : 0);
    const meta = await tenantGamePageMeta(`/room/${roomId}`, store);
    assert.match(
      meta?.description ?? '',
      result === 'draw' ? /Drawn/ : /Anonymous won by resignation/,
    );
    assert.doesNotMatch(JSON.stringify(meta), /secret-player/);
  }
});

test('Gomoku card renders a legal full-board draw with 225 stones', async () => {
  const roomId = 'gmk_card_full_draw';
  const placements: Record<'black' | 'white', GomokuSquare[]> = { black: [], white: [] };
  for (let index = 0; index < 225; index += 1) {
    const color = ((index % 15) + 2 * Math.floor(index / 15)) % 4 < 2 ? 'black' : 'white';
    placements[color].push(
      `${'abcdefghijklmno'[index % 15]}${1 + Math.floor(index / 15)}` as GomokuSquare,
    );
  }
  const events: GomokuEvent[] = [{ type: 'room-created', at: 1, roomId, gameSpecId: 'gomoku' }];
  for (let index = 0; index < 225; index += 1) {
    const color = index % 2 ? 'white' : 'black';
    events.push({
      type: 'move-played',
      at: index + 2,
      roomId,
      color,
      move: { to: placements[color].shift()! },
    });
  }
  const store = storeFor(roomId, events, { result: 'draw', termination: 'draw' });
  const entry = await tenantGameCard(roomId, store);
  assert.ok(entry);
  const svg = await renderTenantGameCard(entry, store);
  assert.equal((svg.match(/class="gomoku-stone /g) ?? []).length, 225);
  assert.equal((svg.match(/class="gomoku-winning"/g) ?? []).length, 0);
  assert.equal((svg.match(/>½<\/text>/g) ?? []).length, 2);
});
