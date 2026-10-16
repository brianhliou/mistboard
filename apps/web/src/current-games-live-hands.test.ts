// A live Crazyhouse Xiangqi board card (/games, the correspondence inbox)
// draws both hands. Both pages mount the compact showcase renderer with the
// live payload and `hideReserve: !liveCardShowsHands(spec)`; until 2026-10-02
// every card passed hideReserve, so a live Crazyhouse card showed a bare board
// while half the position (both sides start with advisors and elephants in
// hand) was missing.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiMove,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { liveCardShowsHands } from './current-games-model.js';
import { EMBED_HAND_BAND_RATIO, embedColumnAspect } from './embed/embed-card.js';
import { mountShowcaseBoard } from './showcase-board.js';

const ROOM_ID = 'chx_live_card';

// Cxh10 Rxh10: Red holds a horse, Black a cannon, on top of the starting hands.
const LINE: CrazyhouseXiangqiMove[] = [
  { from: 'h3', to: 'h10' },
  { from: 'i10', to: 'h10' },
];

// The server's live payload shape (crazyhouseXiangqiLiveWatchPayloadFor).
function livePayload(): Record<string, unknown> {
  let state = createInitialCrazyhouseXiangqiState(ROOM_ID);
  const truth = [{ ply: 0, view: getCrazyhouseXiangqiPlayerView(state, 'red') }];
  const timeline: Array<Record<string, unknown>> = [];
  LINE.forEach((move, index) => {
    const color = state.status.type === 'playing' ? state.status.turn : 'red';
    state = applyCrazyhouseXiangqiMove(state, move);
    timeline.push({ type: 'move-played', at: 10 + index, color, move, ply: index + 1 });
    truth.push({ ply: index + 1, view: getCrazyhouseXiangqiPlayerView(state, 'red') });
  });
  const view = getCrazyhouseXiangqiPlayerView(state, 'red');
  return {
    game: {
      roomId: ROOM_ID,
      variant: CRAZYHOUSE_XIANGQI_SPEC_ID,
      mode: 'pve',
      result: 'in-progress',
      termination: 'in-progress',
      plyCount: LINE.length,
      startedAt: '2026-10-02T12:00:00.000Z',
      endedAt: null,
      rated: false,
      visibility: 'public',
      initialMs: 300_000,
      incrementMs: 5_000,
    },
    state: {
      status: view.status,
      moveNumber: view.moveNumber,
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    },
    timeline,
    view,
    views: { truth: view },
    history: { truth },
  };
}

// The options /games (current-games.ts showBoard) and the inbox
// (correspondence.ts mountBoard) mount a live card with.
async function mountLiveCard(root: HTMLElement, specId: string) {
  const payload = livePayload();
  return mountShowcaseBoard(root, specId, ROOM_ID, {
    autoplay: false,
    hideReserve: !liveCardShowsHands(specId),
    live: true,
    loadPostgameOverride: async (roomId) =>
      roomId === ROOM_ID ? { ok: true, postgame: payload } : { ok: false },
    loaderForId: async () => [],
    metadataByRoomId: {},
    namesByRoomId: { [ROOM_ID]: { first: 'Red player', second: 'Black player' } },
    onLoadError: () => true,
    pov: 'white',
  });
}

function heldRoles(strip: Element | undefined): string[] {
  return [...(strip?.querySelectorAll<HTMLElement>('.drop-mini-reserve-piece') ?? [])]
    .filter((piece) => !piece.classList.contains('is-empty'))
    .map((piece) => piece.dataset.role ?? '')
    .sort();
}

describe('live Crazyhouse Xiangqi card', () => {
  it('keeps the hands only for Crazyhouse Xiangqi', () => {
    expect(liveCardShowsHands(CRAZYHOUSE_XIANGQI_SPEC_ID)).toBe(true);
    for (const spec of ['fortress-xiangqi', 'atomic-xiangqi', 'xiangqi', 'banqi']) {
      expect(liveCardShowsHands(spec), spec).toBe(false);
    }
  });

  it('draws the board with both hands from the live payload', async () => {
    const root = document.createElement('div');
    const handle = await mountLiveCard(root, CRAZYHOUSE_XIANGQI_SPEC_ID);
    handle.jumpToPly?.(handle.plyCount?.() ?? 0);

    expect(root.querySelector('.replay-board svg')).not.toBeNull();
    const strips = [...root.querySelectorAll('.showcase-board-row > .showcase-reserve')];
    expect(strips).toHaveLength(2);
    // Board oriented to Red: Black's hand above, Red's below.
    const [top, bottom] = strips as HTMLElement[];
    expect(top?.dataset.hand).toBe('black');
    expect(bottom?.dataset.hand).toBe('red');
    expect(heldRoles(bottom)).toEqual(['advisor', 'elephant', 'horse']);
    expect(heldRoles(top)).toEqual(['advisor', 'cannon', 'elephant']);
    // Two of each starting piece carry a count badge.
    expect(bottom?.querySelector('[data-role="advisor"] .captures-count-badge')?.textContent).toBe(
      '2',
    );
    handle.destroy();
  });

  it('sizes the card hands with the embed band numbers', () => {
    // current-games.css restates the embed's band (EMBED_HAND_BAND_RATIO) and
    // the column aspect it implies; a drift squeezes the board or overflows
    // the tile.
    const cssPath = ['src/current-games.css', 'apps/web/src/current-games.css']
      .map((candidate) => resolve(process.cwd(), candidate))
      .find((candidate) => existsSync(candidate));
    const css = readFileSync(cssPath as string, 'utf8');
    const band = EMBED_HAND_BAND_RATIO[CRAZYHOUSE_XIANGQI_SPEC_ID];
    expect(css).toMatch(
      new RegExp(
        `\\.showcase-board-row > \\.showcase-reserve\\.drop-mini-reserve-strip \\{[^}]*height: calc\\(100cqw \\* ${band}\\)`,
      ),
    );
    const aspect = css.match(/:has\(> \.showcase-reserve\) \{[^}]*aspect-ratio: ([\d.]+);/)?.[1];
    expect(Number(aspect)).toBeCloseTo(embedColumnAspect(CRAZYHOUSE_XIANGQI_SPEC_ID), 2);
  });
});
