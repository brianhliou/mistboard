import { describe, expect, it } from 'vitest';
import { JUNGLE_LAST_MOVE } from './jungle-art.js';
import { animateJungleFlipBoardMove, renderJungleFlipBoardSvg } from './jungle-flip-render.js';
import { renderJungleBoardSvg } from './jungle-render.js';

describe('Jungle-family last-move indicators', () => {
  function lastMoveRects(svg: string) {
    return [
      ...svg.matchAll(
        /<rect class="(jungle-last-move-[a-z]+)" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="([^"]+)"/g,
      ),
    ].map((m) => ({
      cls: m[1],
      x: Number(m[2]),
      y: Number(m[3]),
      w: Number(m[4]),
      h: Number(m[5]),
      fill: m[6],
    }));
  }
  const inkOf = (svg: string) => lastMoveRects(svg).map((r) => r.fill);

  it('draws Jungle cell separators without a perimeter outline', () => {
    const svg = renderJungleBoardSvg({}, { shadow: false });
    const gridLines =
      svg.match(/<line [^>]*stroke="rgba\(91,74,50,0\.55\)"[^>]*stroke-width="1"[^>]*\/>/g) ?? [];

    expect(gridLines).toHaveLength(14);
    expect(gridLines).not.toContain(
      '<line x1="0" y1="0" x2="0" y2="432" stroke="rgba(91,74,50,0.55)" stroke-width="1" stroke-linecap="round"/>',
    );
    expect(gridLines).not.toContain(
      '<line x1="336" y1="0" x2="336" y2="432" stroke="rgba(91,74,50,0.55)" stroke-width="1" stroke-linecap="round"/>',
    );
    expect(gridLines).not.toContain(
      '<line x1="0" y1="0" x2="336" y2="0" stroke="rgba(91,74,50,0.55)" stroke-width="1" stroke-linecap="round"/>',
    );
    expect(gridLines).not.toContain(
      '<line x1="0" y1="432" x2="336" y2="432" stroke="rgba(91,74,50,0.55)" stroke-width="1" stroke-linecap="round"/>',
    );
  });

  it('tints the origin and destination cells for a Jungle move', () => {
    const svg = renderJungleBoardSvg(
      { a4: { color: 'red', role: 'rat' } },
      { lastMove: { from: 'a3', to: 'a4' }, shadow: false },
    );

    expect(lastMoveRects(svg).map((r) => r.cls)).toEqual([
      'jungle-last-move-from',
      'jungle-last-move-to',
    ]);
    // The circular grammar is gone, not renamed alongside.
    expect(svg).not.toContain('<circle class="jungle-last-move');
    expect(svg).not.toContain('jungle-last-move-reveal');
  });

  it('reads the Jungle mover ink off the piece that landed', () => {
    // Sound ONLY for plain Jungle: fixed sides, no flips, so whatever occupies
    // `to` after the move belongs to the mover.
    const red = renderJungleBoardSvg(
      { a4: { color: 'red', role: 'rat' } },
      { lastMove: { from: 'a3', to: 'a4' }, shadow: false },
    );
    const black = renderJungleBoardSvg(
      { a4: { color: 'black', role: 'rat' } },
      { lastMove: { from: 'a3', to: 'a4' }, shadow: false },
    );

    expect(inkOf(red)).toEqual([JUNGLE_LAST_MOVE.fill.red.from, JUNGLE_LAST_MOVE.fill.red.to]);
    expect(inkOf(black)).toEqual([
      JUNGLE_LAST_MOVE.fill.black.from,
      JUNGLE_LAST_MOVE.fill.black.to,
    ]);
  });

  it('keeps a one-step Jungle move\u2019s two tints from overlapping', () => {
    for (const move of [
      { from: 'a3', to: 'a4' } as const, // vertical step
      { from: 'a4', to: 'b4' } as const, // horizontal step
    ]) {
      const rects = lastMoveRects(
        renderJungleBoardSvg(
          { [move.to]: { color: 'red', role: 'rat' } },
          { lastMove: move, shadow: false },
        ),
      );
      expect(rects).toHaveLength(2);
      const [from, to] = rects;
      const overlapX = Math.min(from.x + from.w, to.x + to.w) - Math.max(from.x, to.x);
      const overlapY = Math.min(from.y + from.h, to.y + to.h) - Math.max(from.y, to.y);
      expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0);
    }
  });

  it('renders ranked Jungle engine arrows over the pieces and flips their geometry', () => {
    const arrow = {
      from: 'a1' as const,
      to: 'b2' as const,
      className: 'xq-arrow--pv1',
      opacity: 0.4,
      width: 14,
    };
    const red = renderJungleBoardSvg({}, { perspective: 'red', arrows: [arrow], shadow: false });
    const black = renderJungleBoardSvg(
      {},
      { perspective: 'black', arrows: [arrow], shadow: false },
    );

    expect(red).toContain('jungle-board-arrows xq-live-arrows');
    expect(red).toContain('xq-arrow xq-arrow--pv1');
    expect(red).toContain('stroke-width="9.3"');
    expect(red).not.toBe(black);
  });

  it('uses the same two-cell grammar for a Flip Jungle board move', () => {
    const svg = renderJungleFlipBoardSvg(
      { b1: { faceDown: false, color: 'red', role: 'rat' } },
      { lastMove: { from: 'a1', to: 'b1' }, lastMoveInk: 'black', shadow: false },
    );

    expect(lastMoveRects(svg).map((r) => r.cls)).toEqual([
      'jungle-last-move-from',
      'jungle-last-move-to',
    ]);
    expect(svg).not.toContain('<circle class="jungle-last-move');
  });

  it('inks a Flip Jungle mark by the mover, not by the tile a flip revealed', () => {
    // A RED rat sits on the flipped square, but BLACK did the flipping. A mark
    // read off the board would be wrong on roughly half of all flips, and a flip
    // is the one ply where the board offers no other clue.
    const svg = renderJungleFlipBoardSvg(
      { a1: { faceDown: false, color: 'red', role: 'rat' } },
      { lastMove: { from: 'a1', to: 'a1' }, lastMoveInk: 'black', shadow: false },
    );

    expect(inkOf(svg)).toEqual([JUNGLE_LAST_MOVE.fill.black.to]);
    expect(svg).not.toContain(JUNGLE_LAST_MOVE.fill.red.to);
  });

  it('falls back to the neutral tint when no ink is bound', () => {
    const svg = renderJungleFlipBoardSvg(
      { a1: { faceDown: false, color: 'red', role: 'rat' } },
      { lastMove: { from: 'a1', to: 'a1' }, shadow: false },
    );

    expect(inkOf(svg)).toEqual([JUNGLE_LAST_MOVE.fill.none.to]);
  });

  it('marks a Flip Jungle flip as a single bordered cell inside its own square', () => {
    const svg = renderJungleFlipBoardSvg(
      { a1: { faceDown: false, color: 'red', role: 'rat' } },
      { lastMove: { from: 'a1', to: 'a1' }, lastMoveInk: 'red', shadow: false },
    );
    const rects = lastMoveRects(svg);

    // A flip is a self-move: one cell, and never an origin tint beside it.
    expect(rects).toHaveLength(1);
    expect(rects[0]?.cls).toBe('jungle-last-move-flip');
    expect(svg).not.toContain('jungle-last-move-from');

    // The border straddles the rect edge, so the rect must sit inside the cell
    // or the outer half of the stroke lands in the neighbouring square.
    const [step] = lastMoveRects(
      renderJungleFlipBoardSvg(
        { b1: { faceDown: false, color: 'red', role: 'rat' } },
        { lastMove: { from: 'a1', to: 'b1' }, lastMoveInk: 'red', shadow: false },
      ),
    );
    expect(rects[0]?.w).toBeLessThan(step?.w ?? 0);
  });

  it('keeps both endpoint tints after mutual elimination', () => {
    // Equal ranks trade off, so neither endpoint holds a piece afterwards. The
    // marks still say where the move happened; only the ink source is gone.
    const svg = renderJungleFlipBoardSvg(
      { d4: { faceDown: true } },
      { lastMove: { from: 'c1', to: 'c2' }, lastMoveInk: 'red', shadow: false },
    );

    expect(lastMoveRects(svg).map((r) => r.cls)).toEqual([
      'jungle-last-move-from',
      'jungle-last-move-to',
    ]);
  });

  it('still marks a mutually-eliminated Jungle move, with no ink to read', () => {
    // Plain Jungle takes its ink from the piece on `to`, so an empty destination
    // has none. It must degrade to the neutral tint, never guess.
    const svg = renderJungleBoardSvg({}, { lastMove: { from: 'a3', to: 'a4' }, shadow: false });

    expect(lastMoveRects(svg)).toHaveLength(2);
    expect(inkOf(svg)).toEqual([JUNGLE_LAST_MOVE.fill.none.from, JUNGLE_LAST_MOVE.fill.none.to]);
  });

  it('gives every Flip Jungle tile a keyed slot, face-down included', () => {
    // animateJungleFlipBoardMove finds the arriving piece by
    // [data-piece-square] and returns SILENTLY when the slot is missing, so a
    // renderer that stops emitting these loses the glide with no error at all.
    // Face-down tiles need one too: a revealed piece can capture onto a square
    // whose occupant was face-down, and the glide has to find what settled.
    const svg = renderJungleFlipBoardSvg(
      {
        a1: { faceDown: false, color: 'red', role: 'rat' },
        b1: { faceDown: true },
      },
      { shadow: false },
    );

    const slots = [...svg.matchAll(/data-piece-square="([a-z]\d)"/g)].map((m) => m[1]);
    expect(slots.sort()).toEqual(['a1', 'b1']);
  });

  describe('animateJungleFlipBoardMove', () => {
    const board = {
      a1: { faceDown: false, color: 'red', role: 'rat' },
      b1: { faceDown: false, color: 'black', role: 'cat' },
    } as const;

    // happy-dom has no Element.animate; installing one captures every glide and
    // marker fade the call issues. Records the keyed square, or the class for
    // non-piece elements (the last-move tint has no data-piece-square).
    function recordAnimations(run: (host: HTMLElement) => void): Array<string | null> {
      const seen: Array<string | null> = [];
      const proto = Element.prototype as unknown as { animate?: unknown };
      const original = proto.animate;
      proto.animate = function (this: Element) {
        seen.push(this.getAttribute('data-piece-square') ?? this.getAttribute('class'));
        return { cancel: () => {} };
      };
      const host = document.createElement('div');
      host.innerHTML = renderJungleFlipBoardSvg(board, {
        lastMove: { from: 'a1', to: 'b1' },
        lastMoveInk: 'red',
        shadow: false,
      });
      try {
        run(host);
      } finally {
        if (original === undefined) delete proto.animate;
        else proto.animate = original;
      }
      return seen;
    }

    it('glides the arriving piece and fades the destination tint in', () => {
      const seen = recordAnimations((host) => {
        animateJungleFlipBoardMove(host, { from: 'a1', to: 'b1' });
      });

      expect(seen).toEqual(['b1', 'jungle-last-move-to']);
    });

    it('glides the piece back and does not fade a mark on a reverse step', () => {
      // A back step renders the PRIOR move's mark on a different cell, so fading
      // it would not track the reverse glide.
      const seen = recordAnimations((host) => {
        animateJungleFlipBoardMove(host, { from: 'a1', to: 'b1' }, { reverse: true });
      });

      expect(seen).toEqual(['a1']);
    });

    it('starts the glide from the square the piece left, on the unflipped board', () => {
      // a1 -> b1 travels one file right, so the piece starts to the LEFT of where
      // it lands. Until 2026-09-30 the glide took the viewer's seat and, for the
      // second mover, started on the right of a board that is never flipped.
      const frames: unknown[] = [];
      const proto = Element.prototype as unknown as { animate?: unknown };
      const original = proto.animate;
      proto.animate = function (this: Element, keyframes: unknown) {
        if (this.getAttribute('data-piece-square') === 'b1') frames.push(keyframes);
        return { cancel: () => {} };
      };
      try {
        const host = document.createElement('div');
        host.innerHTML = renderJungleFlipBoardSvg(board, { shadow: false });
        animateJungleFlipBoardMove(host, { from: 'a1', to: 'b1' });
      } finally {
        if (original === undefined) delete proto.animate;
        else proto.animate = original;
      }
      const first = JSON.stringify(frames[0]);
      const dx = Number(/translate\((-?[\d.]+)/.exec(first)?.[1]);
      expect(dx).toBeLessThan(0);
    });

    it('does nothing at all for a flip', () => {
      // A flip is the self-move from === to: nothing travelled, so there is no
      // glide and no arrival. Same contract as the banqi board.
      const seen = recordAnimations((host) => {
        animateJungleFlipBoardMove(host, { from: 'a1', to: 'a1' });
      });

      expect(seen).toEqual([]);
    });
  });
});
