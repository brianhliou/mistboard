import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  historicalXiangqiGameApiUrl,
  loadHistoricalXiangqiGame,
  mountHistoricalXiangqiPostgame,
} from './historical-xiangqi-postgame.js';
import { pinXiangqiNotation } from './xiangqi-notation.js';

// These tests locate cells by from-to text; pin coordinate labels so the
// reader's notation default (algebraic) does not become the subject.
beforeEach(() => pinXiangqiNotation('coordinate'));
afterEach(() => pinXiangqiNotation(null));

describe('historical xiangqi review page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the archive detail endpoint', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ game: historicalGameFixture() }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(historicalXiangqiGameApiUrl('hxq game')).toBe(
      '/api/historical-xiangqi/games/hxq%20game',
    );

    const result = await loadHistoricalXiangqiGame('hxq_1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/historical-xiangqi/games/hxq_1', {
      headers: { accept: 'application/json' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.game.redNameRaw).toBe('Hu Ronghua');
  });

  it('renders a historical game through the shared xiangqi review shell', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/chat/game/')) return jsonResponse(chatFixture());
      return jsonResponse({ game: historicalGameFixture() });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountHistoricalXiangqiPostgame(root, 'hxq_1');
    await flushPromises();

    expect(root.querySelector('.xiangqi-live-board')).not.toBeNull();
    expect(root.querySelector('.engine-panel')).not.toBeNull();
    // Persistent per-game comments (same panel as the room review), keyed by game id.
    expect(root.querySelector('.review-spectator-chat__input')).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith('/api/chat/game/hxq_1');
    expect(root.textContent).toContain('Historical game');
    expect(root.textContent).toContain('Hu Ronghua');
    expect(root.textContent).toContain('Liu Dahua');
    expect(root.textContent).toContain('Draw');
    expect(root.textContent).not.toContain('Draw wins');
    expect(root.textContent).toContain('h3-e3');
    // Consolidation: no bespoke left-rail nav buttons (clean shared column).
    expect(root.textContent).not.toContain('Search games');
    // Whole-game analysis rides the shared client ceval sweep (parity with the
    // analysis board), not the server "Request computer analysis" path.
    expect(root.textContent).toContain('Computer analysis');
    expect(root.textContent).toContain('Analyse the whole game');
    expect(root.textContent).not.toContain('Request computer analysis');

    // Provenance rides a "Game info" underboard tab on the shared shell (not a
    // bespoke left-rail panel), with players wired for the crosstable.
    expect(root.querySelector('.review-provenance')).not.toBeNull();
    expect(root.textContent).toContain('Game info');
    expect(root.textContent).toContain('Wuyang Cup');
    expect(root.textContent).toContain('Guangzhou');
    // Archive seats are imported names with no identity, so there is no head-to-head
    // record to show: the Crosstable tab is deliberately absent here.
    expect(root.textContent).not.toContain('Crosstable');
    // The raw acquisition move-encoding ("wxf") is internal jargon, not surfaced.
    expect(root.textContent).not.toContain('wxf');
  });
});

function historicalGameFixture() {
  return {
    id: 'hxq_1',
    sourceId: 'hxqs_xqbase',
    sourceGameId: '123',
    sourceUrl: 'https://example.test/game/123',
    eventName: 'Wuyang Cup',
    site: 'Guangzhou',
    round: '1',
    board: null,
    playedOn: '1982-01-04',
    redNameRaw: 'Hu Ronghua',
    blackNameRaw: 'Liu Dahua',
    result: '1/2-1/2',
    termination: null,
    plyCount: 3,
    moveFormat: 'wxf',
    moves: [
      { from: 'h3', to: 'e3' },
      { from: 'h8', to: 'e8' },
      { from: 'h1', to: 'g3' },
    ],
    tags: {},
    qualityFlags: [],
    visibility: 'public',
  };
}

function chatFixture() {
  return {
    lines: [
      {
        id: 'chln_hist_1',
        handle: 'viewer',
        text: 'great game',
        createdAt: '2026-07-01T12:06:00.000Z',
      },
    ],
    canPost: true,
    canReport: false,
    viewerHandle: 'viewer',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
