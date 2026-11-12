// The misty tile a hidden-information game shows on /games and /correspondence
// carries the variant's own marker, and nothing from the game: two different
// games of one variant must draw the same tile, byte for byte.
import { describe, expect, it, vi } from 'vitest';
import { buildInboxCard, type PageContext } from './correspondence.js';
import type { CorrespondenceGame } from './correspondence-model.js';
import { renderBoardPlaceholder } from './current-games.js';
import type { CurrentGame } from './current-games-model.js';
import { buildFogTile, fogTileMarkerId } from './fog-tile.js';

const mountShowcaseBoard = vi.hoisted(() => vi.fn(async () => ({ destroy: () => {} })));
vi.mock('./showcase-board.js', () => ({ mountShowcaseBoard }));

const HIDDEN = ['dark-xiangqi', 'dark-chess', 'banqi', 'three-kingdoms-banqi', 'jungle-flip'];

function markerOf(tile: HTMLElement): string | null {
  return (
    tile.querySelector<HTMLElement>('.current-game-fog-marker [data-variant-marker-id]')?.dataset
      .variantMarkerId ?? null
  );
}

describe('buildFogTile', () => {
  it('draws each hidden-information variant with its own marker, not the waves', () => {
    for (const id of HIDDEN) {
      const tile = buildFogTile(id, 'In the fog');
      expect(markerOf(tile), id).toBe(id);
      expect(tile.classList.contains('has-marker')).toBe(true);
      expect(tile.querySelector('.current-game-fog-waves')).toBeNull();
      // Marker first, then the name, then the note.
      expect([...tile.children].map((el) => el.className.split(' ')[0])).toEqual([
        'current-game-fog-marker',
        'current-game-fog-variant',
        'current-game-fog-note',
      ]);
      expect(tile.querySelector('.current-game-fog-marker')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
    }
  });

  it('reads a plain fog room as Fog Chess and keeps the waves for a variant with no art', () => {
    expect(fogTileMarkerId('fog')).toBe('dark-chess');
    const unknown = buildFogTile('no-such-variant', null);
    expect(markerOf(unknown)).toBeNull();
    expect(unknown.querySelector('.current-game-fog-waves svg')).not.toBeNull();
    expect(unknown.querySelector('.current-game-fog-note')).toBeNull();
  });
});

function inboxGame(overrides: Partial<CorrespondenceGame>): CorrespondenceGame {
  return {
    roomId: 'bq_1',
    url: '/room/bq_1',
    gameSpecId: 'banqi',
    mySeat: 'red',
    isYourMove: true,
    opponentName: 'Bob',
    opponentHandle: 'bob_h',
    dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    ...overrides,
  };
}

function fogHtml(root: HTMLElement): string {
  const fog = root.querySelector('.current-game-fog');
  if (!fog) throw new Error('no misty tile');
  return fog.outerHTML;
}

describe('the misty tile takes nothing from the game', () => {
  const ctx: PageContext = { signedIn: true, isConnected: () => true, handles: [], tickers: [] };

  it('two different /correspondence games of one variant draw the same tile', () => {
    for (const gameSpecId of HIDDEN) {
      const a = buildInboxCard(ctx, inboxGame({ gameSpecId }), undefined, true);
      const b = buildInboxCard(
        ctx,
        inboxGame({
          gameSpecId,
          roomId: 'other_77',
          url: '/room/other_77',
          mySeat: 'black',
          isYourMove: false,
          opponentName: 'Carol',
          opponentHandle: 'carol',
          dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
        undefined,
        false,
      );
      expect(markerOf(a.querySelector<HTMLElement>('.current-game-fog') as HTMLElement)).toBe(
        gameSpecId,
      );
      expect(fogHtml(b), gameSpecId).toBe(fogHtml(a));
    }
  });

  it('two different live /games games of one variant draw the same tile', () => {
    for (const gameSpecId of HIDDEN) {
      const base: CurrentGame = {
        roomId: 'room-a',
        gameSpecId,
        channelId: null,
        composition: 'pvp',
        observe: 'masked',
        players: [],
        ply: 4,
        rated: true,
        startedAt: 1_700_000_000_000,
        lastActivityAt: 1_700_000_100_000,
        timeControl: { initialMs: 300_000, incrementMs: 5_000 },
        timeClass: 'blitz',
        clock: null,
        deadline: null,
        url: '/room/room-a',
      };
      const a = document.createElement('div');
      const b = document.createElement('div');
      renderBoardPlaceholder(a, base);
      renderBoardPlaceholder(b, {
        ...base,
        roomId: 'room-b',
        observe: 'sealed',
        ply: 57,
        rated: false,
        startedAt: 1_710_000_000_000,
        timeControl: { initialMs: 60_000, incrementMs: 1_000 },
        timeClass: 'bullet',
        url: '/room/room-b',
        payload: { secret: 'never drawn' },
      });
      expect(markerOf(a), gameSpecId).toBe(gameSpecId);
      expect(fogHtml(b), gameSpecId).toBe(fogHtml(a));
    }
  });
});
