import { boardFen, hiddenSquareClasses } from '@mistboard/board-render/interactive';
import type { Board, PlayerView, Square } from '@mistboard/game';
import { configure } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import { defaults } from 'chessground/state';
import { afterEach, describe, expect, it } from 'vitest';
import { boardHighlightClasses, boardResultClass, legalDests } from './live-board.js';
import { shouldAutoScrollMoveList, shouldMaskMoveList } from './live-move-list.js';
import {
  drawShapeGameOf,
  shouldEnablePremoves,
  shouldShowPostGameRoomActions,
} from './live-render.js';
import { liveState } from './live-state.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    id: 'test-room',
    variant: 'dark-chess',
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: { type: 'playing', turn: 'white' },
    perspective: 'white',
    moveNumber: 1,
    ...overrides,
  };
}

const initialBoard: Board = {
  a1: { color: 'white', role: 'rook' },
  b1: { color: 'white', role: 'knight' },
  c1: { color: 'white', role: 'bishop' },
  d1: { color: 'white', role: 'queen' },
  e1: { color: 'white', role: 'king' },
  f1: { color: 'white', role: 'bishop' },
  g1: { color: 'white', role: 'knight' },
  h1: { color: 'white', role: 'rook' },
  a2: { color: 'white', role: 'pawn' },
  b2: { color: 'white', role: 'pawn' },
  c2: { color: 'white', role: 'pawn' },
  d2: { color: 'white', role: 'pawn' },
  e2: { color: 'white', role: 'pawn' },
  f2: { color: 'white', role: 'pawn' },
  g2: { color: 'white', role: 'pawn' },
  h2: { color: 'white', role: 'pawn' },
  a7: { color: 'black', role: 'pawn' },
  b7: { color: 'black', role: 'pawn' },
  c7: { color: 'black', role: 'pawn' },
  d7: { color: 'black', role: 'pawn' },
  e7: { color: 'black', role: 'pawn' },
  f7: { color: 'black', role: 'pawn' },
  g7: { color: 'black', role: 'pawn' },
  h7: { color: 'black', role: 'pawn' },
  a8: { color: 'black', role: 'rook' },
  b8: { color: 'black', role: 'knight' },
  c8: { color: 'black', role: 'bishop' },
  d8: { color: 'black', role: 'queen' },
  e8: { color: 'black', role: 'king' },
  f8: { color: 'black', role: 'bishop' },
  g8: { color: 'black', role: 'knight' },
  h8: { color: 'black', role: 'rook' },
};

afterEach(() => {
  liveState.seat = 'spectator';
  liveState.state = null;
});

// ── boardFen ──────────────────────────────────────────────────────────────────

describe('boardFen', () => {
  it('produces 8/8/8/8/8/8/8/8 for an empty board', () => {
    expect(boardFen({})).toBe('8/8/8/8/8/8/8/8');
  });

  it('places a white king on e1 correctly', () => {
    expect(boardFen({ e1: { color: 'white', role: 'king' } })).toBe('8/8/8/8/8/8/8/4K3');
  });

  it('produces the standard opening FEN for the initial board', () => {
    expect(boardFen(initialBoard)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  });

  it('uses uppercase for white pieces, lowercase for black', () => {
    const board: Board = {
      a8: { color: 'black', role: 'rook' },
      h1: { color: 'white', role: 'rook' },
    };
    const fen = boardFen(board);
    expect(fen.startsWith('r')).toBe(true); // rank 8: black rook on a8
    expect(fen.endsWith('R')).toBe(true); // rank 1: white rook on h1
  });
});

// ── hiddenSquareClasses ───────────────────────────────────────────────────────

describe('hiddenSquareClasses', () => {
  it('returns an empty map for a non-fog variant', () => {
    const view = makeView({ variant: 'draft960', visibleSquares: [] });
    expect(hiddenSquareClasses(view).size).toBe(0);
  });

  it('returns an empty map on finished status by default (reveal)', () => {
    const view = makeView({
      variant: 'dark-chess',
      visibleSquares: [],
      status: { type: 'finished', winner: 'white', reason: 'checkmate' },
    });
    expect(hiddenSquareClasses(view).size).toBe(0);
  });

  it('preserves fog on finished when preserveFogOnFinished is true', () => {
    const view = makeView({
      variant: 'dark-chess',
      visibleSquares: [],
      status: { type: 'finished', winner: 'white', reason: 'checkmate' },
    });
    const classes = hiddenSquareClasses(view, 'white', { preserveFogOnFinished: true });
    expect(classes.size).toBe(64);
  });

  it('marks all 64 squares as fog-hidden when nothing is visible', () => {
    const view = makeView({ variant: 'dark-chess', visibleSquares: [] });
    const classes = hiddenSquareClasses(view);
    expect(classes.size).toBe(64);
    // The class string also encodes side and visual file/rank for per-tile fog rendering.
    // e1 = file 4, rank 0; visual rank (white POV) = 7 - 0 = 7.
    expect(classes.get('e1')).toBe('fog-hidden black fog-tile-f4r7');
    // h8 = file 7, rank 7; visual rank (white POV) = 7 - 7 = 0.
    expect(classes.get('h8')).toBe('fog-hidden black fog-tile-f7r0');
  });

  it('does not mark visible squares as fog-hidden', () => {
    const visible: Square[] = ['e1', 'e2', 'd2'];
    const view = makeView({ variant: 'dark-chess', visibleSquares: visible });
    const classes = hiddenSquareClasses(view);
    expect(classes.has('e1')).toBe(false);
    expect(classes.has('e2')).toBe(false);
    expect(classes.has('d2')).toBe(false);
    // a1 = file 0, rank 0; visual rank (white POV) = 7 - 0 = 7.
    expect(classes.get('a1')).toBe('fog-hidden black fog-tile-f0r7');
    expect(classes.size).toBe(64 - visible.length);
  });

  it('encodes visual position from black POV (mirror)', () => {
    const view = makeView({ variant: 'dark-chess', visibleSquares: [] });
    const classes = hiddenSquareClasses(view, 'black');
    // a1 from black POV: visual file = 7 - 0 = 7, visual rank = 0.
    expect(classes.get('a1')).toBe('fog-hidden black fog-tile-f7r0');
    // h8 from black POV: visual file = 7 - 7 = 0, visual rank = 7.
    expect(classes.get('h8')).toBe('fog-hidden black fog-tile-f0r7');
  });
});

// ── boardResultClass ─────────────────────────────────────────────────────────

describe('boardResultClass', () => {
  it('marks the winner for spectators', () => {
    liveState.seat = 'spectator';
    const view = makeView({ status: { type: 'finished', winner: 'black', reason: 'resignation' } });
    expect(boardResultClass(view)).toBe('king-celebrating-black');
  });

  it('marks the seated player only when they won', () => {
    liveState.seat = 'white';
    const won = makeView({ status: { type: 'finished', winner: 'white', reason: 'checkmate' } });
    const lost = makeView({ status: { type: 'finished', winner: 'black', reason: 'checkmate' } });
    expect(boardResultClass(won)).toBe('king-celebrating-white');
    expect(boardResultClass(lost)).toBeNull();
  });

  it('does not mark draws or unfinished games', () => {
    liveState.seat = 'spectator';
    const draw = makeView({ status: { type: 'finished', winner: null, reason: 'draw' } });
    expect(boardResultClass(draw)).toBeNull();
    expect(boardResultClass(makeView())).toBeNull();
  });
});

// ── shouldShowPostGameRoomActions ────────────────────────────────────────────

describe('shouldShowPostGameRoomActions', () => {
  it('keeps post-game actions while replaying a historical playing position', () => {
    liveState.state = makeView({
      status: { type: 'finished', winner: 'white', reason: 'king-captured' },
    });

    expect(shouldShowPostGameRoomActions(makeView())).toBe(true);
  });

  it('does not show post-game actions before the live room has finished', () => {
    liveState.state = makeView();

    expect(shouldShowPostGameRoomActions(makeView())).toBe(false);
  });
});

describe('shouldEnablePremoves', () => {
  const eligible = {
    preferenceEnabled: true,
    canInteractWithOwnPieces: true,
    boardIsLive: false,
    hasSeat: true,
  };

  it('allows a seated player to queue a premove while waiting', () => {
    expect(shouldEnablePremoves(eligible)).toBe(true);
  });

  it('fails closed when the preference, seat, interaction, or turn gate is unavailable', () => {
    expect(shouldEnablePremoves({ ...eligible, preferenceEnabled: false })).toBe(false);
    expect(shouldEnablePremoves({ ...eligible, hasSeat: false })).toBe(false);
    expect(shouldEnablePremoves({ ...eligible, canInteractWithOwnPieces: false })).toBe(false);
    expect(shouldEnablePremoves({ ...eligible, boardIsLive: true })).toBe(false);
  });
});

describe('drawShapeGameOf', () => {
  it('owns annotations for the duration of one playing game', () => {
    // renderBoard keeps the shapes while this id is unchanged, so a turn change
    // (or a reconnect render, which is not a move at all) carries them over.
    expect(drawShapeGameOf(makeView({ id: 'game-1' }))).toBe('game-1');
    expect(drawShapeGameOf(makeView({ id: 'game-2' }))).toBe('game-2');
  });

  it('disowns them once the game is over or absent', () => {
    const finished = makeView({
      status: { type: 'finished', winner: 'white', reason: 'checkmate' },
    });
    expect(drawShapeGameOf(finished)).toBeNull();
    expect(drawShapeGameOf(null)).toBeNull();
  });
});

// Pins the chessground behavior the fix rests on: a set() carrying a fen clears
// state.drawable.shapes unless the same config hands them back. An upgrade that
// changes either half silently un-fixes annotation persistence.
describe('chessground drawable.shapes across a fen set', () => {
  const shapes: DrawShape[] = [{ orig: 'e4', brush: 'green' }];
  const emptyBoard = '8/8/8/8/8/8/8/8';

  it('wipes shapes when the config omits them', () => {
    const state = defaults();
    state.drawable.shapes = [...shapes];
    configure(state, { fen: emptyBoard });
    expect(state.drawable.shapes).toEqual([]);
  });

  it('keeps shapes when the config hands them back', () => {
    const state = defaults();
    state.drawable.shapes = [...shapes];
    configure(state, { fen: emptyBoard, drawable: { shapes: [...state.drawable.shapes] } });
    expect(state.drawable.shapes).toEqual(shapes);
  });
});

// ── shouldAutoScrollMoveList ─────────────────────────────────────────────────

describe('shouldAutoScrollMoveList', () => {
  it('follows the latest move on the first live render with moves', () => {
    expect(
      shouldAutoScrollMoveList({
        nextIsLive: true,
        nextPlyCount: 3,
        previousPlyCount: null,
        previousWasLive: null,
      }),
    ).toBe(true);
  });

  it('follows when a new ply arrives while already live', () => {
    expect(
      shouldAutoScrollMoveList({
        nextIsLive: true,
        nextPlyCount: 4,
        previousPlyCount: 3,
        previousWasLive: true,
      }),
    ).toBe(true);
  });

  it('does not pull the list while replaying an older position', () => {
    expect(
      shouldAutoScrollMoveList({
        nextIsLive: false,
        nextPlyCount: 4,
        previousPlyCount: 3,
        previousWasLive: true,
      }),
    ).toBe(false);
  });

  it('scrolls to the bottom when returning from replay to live', () => {
    expect(
      shouldAutoScrollMoveList({
        nextIsLive: true,
        nextPlyCount: 4,
        previousPlyCount: 4,
        previousWasLive: false,
      }),
    ).toBe(true);
  });
});

// ── boardHighlightClasses ────────────────────────────────────────────────────

describe('boardHighlightClasses', () => {
  it('marks the final destination square on king capture', () => {
    const view = makeView({
      lastMove: { from: 'e4', to: 'e8' },
      status: { type: 'finished', winner: 'white', reason: 'king-captured' },
      visibleSquares: ['e8'],
    });
    expect(boardHighlightClasses(view, 'white').get('e8')).toBe('game-finish-square');
  });

  it('composes the final destination class with fog classes', () => {
    const view = makeView({
      lastMove: { from: 'e4', to: 'e8' },
      status: { type: 'finished', winner: 'white', reason: 'king-captured' },
      visibleSquares: [],
    });
    expect(boardHighlightClasses(view, 'white').get('e8')).toBe(
      'fog-hidden white fog-tile-f4r0 game-finish-square',
    );
  });

  it('does not mark non-king-capture finishes', () => {
    const view = makeView({
      lastMove: { from: 'e2', to: 'e4' },
      status: { type: 'finished', winner: 'black', reason: 'resignation' },
      visibleSquares: ['e4'],
    });
    expect(boardHighlightClasses(view, 'white').get('e4')).toBeUndefined();
  });
});

// ── legalDests ────────────────────────────────────────────────────────────────

describe('legalDests', () => {
  it('returns an empty map when there are no legal moves', () => {
    const view = makeView({ legalMoves: [] });
    expect(legalDests(view).size).toBe(0);
  });

  it('maps each source square to its destination squares', () => {
    const view = makeView({
      legalMoves: [
        { from: 'e2', to: 'e4' },
        { from: 'e2', to: 'e3' },
        { from: 'd2', to: 'd4' },
      ],
    });
    const dests = legalDests(view);
    expect(dests.get('e2')?.sort()).toEqual(['e3', 'e4']);
    expect(dests.get('d2')).toEqual(['d4']);
    expect(dests.size).toBe(2);
  });

  it('deduplicates destinations for the same source', () => {
    const view = makeView({
      legalMoves: [
        { from: 'e2', to: 'e3' },
        { from: 'e2', to: 'e3' }, // duplicate
      ],
    });
    const dests = legalDests(view);
    // Both entries end up listed; castling alias check sees no king→rook moves, so no alias added
    expect(dests.get('e2')?.length).toBe(2);
  });
});

// ── shouldMaskMoveList ───────────────────────────────────────────────────────

describe('shouldMaskMoveList', () => {
  afterEach(() => {
    liveState.state = null;
    liveState.seat = 'spectator';
    liveState.roomMode = 'pvp';
  });

  it('masks a live fog game for a seated player', () => {
    liveState.state = makeView();
    liveState.seat = 'white';
    expect(shouldMaskMoveList()).toBe(true);
  });

  it('stops masking once the game is finished, for a player and for a spectator', () => {
    liveState.state = makeView({
      status: { type: 'finished', winner: 'white', reason: 'resignation' },
    });
    liveState.seat = 'white';
    expect(shouldMaskMoveList()).toBe(false);
    liveState.seat = 'spectator';
    expect(shouldMaskMoveList()).toBe(false);
  });

  it('never masks an engine-vs-engine room, which has no secret to keep', () => {
    liveState.state = makeView();
    liveState.roomMode = 'eve';
    liveState.seat = 'spectator';
    expect(shouldMaskMoveList()).toBe(false);
  });
});
