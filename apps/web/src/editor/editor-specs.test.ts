import { normalizeStartFen } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { EDITOR_VARIANT_IDS } from './editor-catalog.js';
import { enPassantCandidates } from './editor-chess.js';
import {
  type EditorBoard,
  type EditorModel,
  type PlacementGrammar,
  readPlacement,
  writePlacement,
} from './editor-model.js';
import { EDITOR_SPECS, faceDownCounts, poolRows } from './editor-specs.js';

// The registry-driven conformance test for the editor: every EDITOR variant
// (the subset of the analysis catalog the editor covers, editor-catalog.ts) has
// a spec whose start position the variant's own parser accepts, spelled exactly
// the way the variant's writer spells it. The three dealt variants
// (banqi, jieqi, jungle-flip) also get structural pool checks, and their
// canonical spelling is the six-field DEALT fen (dealt-fen.ts): the editor's
// public five fields plus a sampled hidden field the editor ignores on read.

const DEALT = new Set(['banqi', 'jieqi', 'jungle-flip']);

function boardEntries(board: EditorBoard): [string, unknown][] {
  return [...board.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function fieldCount(fen: string): number {
  return fen.trim().split(/\s+/).length;
}

function poolTotal(model: EditorModel, spec: (typeof EDITOR_SPECS)[keyof typeof EDITOR_SPECS]) {
  return poolRows(model, spec).reduce((sum, row) => sum + row.pool, 0);
}

describe('editor specs', () => {
  for (const id of EDITOR_VARIANT_IDS) {
    const spec = EDITOR_SPECS[id];

    it(`${id}: the start position round-trips through fromFen/toFen`, () => {
      const start = spec.start();
      const fen = spec.toFen(start);
      const back = spec.fromFen(fen);
      expect(back, 'fromFen reads its own output').not.toBeNull();
      expect(boardEntries(back!.board)).toEqual(boardEntries(start.board));
      expect(back!.turn).toBe(start.turn);
      expect(spec.toFen(back!)).toBe(fen);
    });

    it(`${id}: an empty board still serialises`, () => {
      const model: EditorModel = {
        board: new Map(),
        turn: spec.colors[0],
        flipped: false,
        captured: new Map(),
      };
      const fen = spec.toFen(model);
      expect(fen.startsWith(String(spec.grammar.files))).toBe(true);
      expect(spec.fromFen(fen)?.board.size).toBe(0);
    });

    it(`${id}: fromFen rejects the wrong board shape`, () => {
      expect(spec.fromFen('')).toBeNull();
      expect(spec.fromFen('8/8/8 w - - 0 1')).toBeNull();
      expect(spec.fromFen('hello world')).toBeNull();
    });

    if (DEALT.has(id)) {
      it(`${id}: the start FEN has five fields and the pool matches the face-down tiles`, () => {
        const start = spec.start();
        const fen = spec.toFen(start);
        expect(fieldCount(fen)).toBe(5);
        // Jieqi keeps its two generals face-up; the banqi-style deals are all dark.
        const faceUp = [...start.board.values()].filter((piece) => !piece.faceDown).length;
        expect(faceUp).toBe(id === 'jieqi' ? 2 : 0);
        expect(faceDownCounts(start).total).toBe(start.board.size - faceUp);
        expect(poolTotal(start, spec)).toBe(faceDownCounts(start).total);
      });

      it(`${id}: a revealed piece leaves the pool, a captured one leaves it too`, () => {
        const start = spec.start();
        const before = poolTotal(start, spec);
        const [square] = [...start.board.keys()];
        const role = spec.dealt!.roles[0]!;
        start.board.set(square!, { faceDown: false, color: spec.colors[0], role });
        expect(poolTotal(start, spec)).toBe(before - 1);
        start.captured.set(`${spec.colors[1]}:${role}`, 1);
        expect(poolTotal(start, spec)).toBe(before - 2);
        // The pool field in the FEN reflects both, and reading it back recovers
        // the captured count (what is neither on the board nor in the pool).
        const back = spec.fromFen(spec.toFen(start));
        expect(back?.captured.get(`${spec.colors[1]}:${role}`)).toBe(1);
      });
    }

    it(`${id}: normalizeStartFen accepts the start and returns the same spelling`, () => {
      const start = spec.start();
      const fen = spec.toFen(start);
      const result = normalizeStartFen(id, fen);
      expect(result.ok, result.ok ? '' : result.error).toBe(true);
      if (!result.ok) return;
      if (DEALT.has(id)) {
        // Canonical = the editor's public fen + one sampled hidden field.
        expect(fieldCount(result.fen)).toBe(6);
        expect(result.fen.startsWith(`${fen} `)).toBe(true);
      } else {
        expect(result.fen).toBe(fen);
      }
      const back = spec.fromFen(result.fen);
      expect(back).not.toBeNull();
      expect(spec.toFen(back!)).toBe(fen);
    });
  }

  it('banqi: the opening writes turn "-" and the full pool', () => {
    const spec = EDITOR_SPECS.banqi;
    expect(spec.toFen(spec.start())).toBe(
      'XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1',
    );
  });

  it('jieqi: generals are face-up, every home square is dark, pool is written in full', () => {
    const spec = EDITOR_SPECS.jieqi;
    expect(spec.toFen(spec.start())).toBe(
      'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1',
    );
    expect(spec.placementProblem('e5', { faceDown: true, color: 'red' })).not.toBeNull();
    expect(spec.placementProblem('a1', { faceDown: true, color: 'red' })).toBeNull();
    expect(spec.placementProblem('a1', { faceDown: true, color: 'black' })).not.toBeNull();
    expect(
      spec.placementProblem('e5', { faceDown: false, color: 'red', role: 'soldier' }),
    ).toBeNull();
  });

  it('jungle-flip: the opening writes turn "-", one of each animal per ink, and ply 0', () => {
    const spec = EDITOR_SPECS['jungle-flip'];
    expect(spec.toFen(spec.start())).toBe(
      'XXXX/XXXX/XXXX/XXXX - R1C1D1W1P1T1L1E1r1c1d1w1p1t1l1e1 0 0',
    );
  });

  it('fortress-xiangqi: a pocket on the placement field is dropped, not rejected', () => {
    const spec = EDITOR_SPECS['fortress-xiangqi'];
    const withPocket = 'rnceakq/pp1p1pp/7/7/7/7/PP1P1PP/QKAECNR[Rr] w - - 0 1';
    const model = spec.fromFen(withPocket);
    expect(model).not.toBeNull();
    expect(spec.toFen(model!)).toBe('rnceakq/pp1p1pp/7/7/7/7/PP1P1PP/QKAECNR w - - 0 1');
  });

  it('dark-chess: the start is the standard chess start with all four castling rights', () => {
    const spec = EDITOR_SPECS['dark-chess'];
    expect(spec.toFen(spec.start())).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
    expect(spec.start().chess).toEqual({
      castling: { K: true, Q: true, k: true, q: true },
      epSquare: null,
    });
  });

  it('dark-chess: castling rights round-trip and chessops spells them the same way', () => {
    const spec = EDITOR_SPECS['dark-chess'];
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Qk - 0 1';
    const model = spec.fromFen(fen)!;
    expect(model.chess).toEqual({
      castling: { K: false, Q: true, k: true, q: false },
      epSquare: null,
    });
    expect(spec.toFen(model)).toBe(fen);
    const result = normalizeStartFen('dark-chess', fen);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (result.ok) expect(result.fen).toBe(fen);
  });

  it('dark-chess: a model without extras writes no rights, and malformed fields read as none', () => {
    const spec = EDITOR_SPECS['dark-chess'];
    const bare: EditorModel = {
      board: spec.start().board,
      turn: 'white',
      flipped: false,
      captured: new Map(),
    };
    expect(spec.toFen(bare).split(' ').slice(2, 4)).toEqual(['-', '-']);
    for (const text of [
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w HAha - 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq z9 0 1',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w',
    ]) {
      const model = spec.fromFen(text);
      expect(model, text).not.toBeNull();
      expect(model!.chess!.epSquare).toBeNull();
      expect(model!.chess!.castling.K).toBe(text.includes('KQkq'));
    }
  });

  it('dark-chess: a right the board cannot honour is dropped on read and on write', () => {
    const spec = EDITOR_SPECS['dark-chess'];
    // White king on e2: K and Q cannot stand, k and q can.
    const read = spec.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPKPPP/RNBQ1BNR b KQkq - 0 1')!;
    expect(read.chess!.castling).toEqual({ K: false, Q: false, k: true, q: true });
    expect(spec.toFen(read).split(' ')[2]).toBe('kq');
    // The same by moving the king after the fact: the FEN follows the board.
    const start = spec.start();
    start.board.delete('e1');
    start.board.set('e2', { faceDown: false, color: 'white', role: 'king' });
    expect(spec.toFen(start).split(' ')[2]).toBe('kq');
    // And a rook leaving its corner takes only its own side's right.
    const rook = spec.start();
    rook.board.delete('a8');
    expect(spec.toFen(rook).split(' ')[2]).toBe('KQk');
  });

  it('dark-chess: en passant candidates follow the side to move and round-trip', () => {
    const spec = EDITOR_SPECS['dark-chess'];
    // White pawn on e4 with e2 and e3 empty; black to move -> e3 is the one square.
    const model = spec.fromFen('4k3/8/8/8/4P3/8/8/4K3 b - - 0 1')!;
    expect(enPassantCandidates(model.board, 'black')).toEqual(['e3']);
    // The same board with white to move offers nothing (no black pawn on rank 5).
    expect(enPassantCandidates(model.board, 'white')).toEqual([]);
    model.chess!.epSquare = 'e3';
    const fen = spec.toFen(model);
    expect(fen).toBe('4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1');
    const result = normalizeStartFen('dark-chess', fen);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (result.ok) expect(result.fen).toBe(fen);
    expect(spec.fromFen(fen)!.chess!.epSquare).toBe('e3');
    // A blocked origin or landing square rules the file out.
    const blocked = spec.fromFen('4k3/8/8/8/3PP3/3P4/4N3/4K3 b - - 0 1')!;
    expect(enPassantCandidates(blocked.board, 'black')).toEqual([]);
    // Mirrored for black's double step with white to move.
    const black = spec.fromFen('4k3/8/8/2p5/8/8/8/4K3 w - - 0 1')!;
    expect(enPassantCandidates(black.board, 'white')).toEqual(['c6']);
    // A stale ep square (wrong side to move) is dropped on read.
    expect(spec.fromFen('4k3/8/8/8/4P3/8/8/4K3 w - e3 0 1')!.chess!.epSquare).toBeNull();
  });
});

describe('placement grammar', () => {
  const grammar: PlacementGrammar = {
    files: 3,
    ranks: 2,
    roleChar: { king: 'K', pawn: 'P' },
    upper: 'white',
    lower: 'black',
    faceDown: 'coloured',
    square: (file, rank) => `${'abc'[file]}${rank}`,
  };

  it('writes ranks top-down with run-length empties and reads them back', () => {
    const board: EditorBoard = new Map([
      ['a2', { faceDown: false, color: 'black', role: 'king' }],
      ['c1', { faceDown: false, color: 'white', role: 'pawn' }],
      ['b1', { faceDown: true, color: 'black' }],
    ]);
    const text = writePlacement(board, grammar);
    expect(text).toBe('k2/1xP');
    expect(boardEntries(readPlacement(text, grammar)!)).toEqual(boardEntries(board));
  });

  it('rejects ranks that run long or short and unknown letters', () => {
    expect(readPlacement('kkkk/3', grammar)).toBeNull();
    expect(readPlacement('k1/3', grammar)).toBeNull();
    expect(readPlacement('q2/3', grammar)).toBeNull();
    expect(readPlacement('3', grammar)).toBeNull();
  });

  it('never writes X for a grammar without face-down pieces', () => {
    const plain: PlacementGrammar = { ...grammar, faceDown: undefined };
    expect(readPlacement('x2/3', plain)).toBeNull();
  });
});
