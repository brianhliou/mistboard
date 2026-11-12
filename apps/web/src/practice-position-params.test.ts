import { PRACTICE_WIN_CP } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  backPath,
  PRACTICE_POSITION_DRAW_MOVES,
  parsePracticePositionParams,
  practicePositionHref,
} from './practice-position-params.js';

// Chariot and horse against a bare general: a live position, red to move.
const LIVE = '4k4/9/9/9/9/9/9/9/4N4/R3K4 w - - 0 1';
// Black is mated: the d9 chariot is guarded and the flying general covers e10.
const MATED = '3k5/3R5/3R5/9/9/9/9/9/9/4K4 b - - 0 1';

function parse(query: Record<string, string>) {
  return parsePracticePositionParams(new URLSearchParams(query));
}

describe('parsePracticePositionParams', () => {
  it('accepts a mate exercise for red', () => {
    const request = parse({ fen: LIVE, goal: 'mate', side: 'red' });
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.goalKind).toBe('mate');
    expect(request.goal.kind).toBe('mate');
    expect(request.side).toBe('red');
    expect(request.state.status.type).toBe('playing');
  });

  it('accepts a draw exercise for black, held for the fixed move count', () => {
    const request = parse({ fen: LIVE, goal: 'draw', side: 'black' });
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.goalKind).toBe('draw');
    expect(request.goal).toMatchObject({ kind: 'draw', moves: PRACTICE_POSITION_DRAW_MOVES });
    expect(request.side).toBe('black');
  });

  it('accepts a win exercise, unbounded, at the standard win threshold', () => {
    const request = parse({ fen: LIVE, goal: 'win', side: 'red' });
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.goalKind).toBe('win');
    expect(request.goal).toEqual({ kind: 'win', centipawns: PRACTICE_WIN_CP });
  });

  it.each([
    ['missing side', { fen: LIVE, goal: 'mate' }, 'side'],
    ['unknown side', { fen: LIVE, goal: 'mate', side: 'white' }, 'side'],
    ['missing goal', { fen: LIVE, side: 'red' }, 'goal'],
    ['unknown goal', { fen: LIVE, goal: 'survive', side: 'red' }, 'goal'],
    ['missing fen', { goal: 'mate', side: 'red' }, 'fen'],
    ['blank fen', { fen: '   ', goal: 'mate', side: 'red' }, 'fen'],
    ['garbage fen', { fen: 'not a fen', goal: 'mate', side: 'red' }, 'fen'],
    ['nine ranks', { fen: '4k4/9/9/9/9/9/9/9/R3K4 w', goal: 'mate', side: 'red' }, 'fen'],
    ['finished position', { fen: MATED, goal: 'mate', side: 'red' }, 'finished'],
  ] as const)('rejects %s', (_label, query, reason) => {
    expect(parse(query)).toEqual({ ok: false, reason });
  });

  it('round-trips the href it builds', () => {
    const href = practicePositionHref(LIVE, 'draw', 'black');
    expect(href.startsWith('/practice/position?')).toBe(true);
    const request = parsePracticePositionParams(new URL(href, 'https://x.test').searchParams);
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    expect(request.goalKind).toBe('draw');
    expect(request.side).toBe('black');
    // The canonical spelling ('r' for red to move) is stable under a second trip.
    expect(request.fen).toBe('4k4/9/9/9/9/9/9/9/4N4/R3K4 r - - 0 1');
    const again = practicePositionHref(request.fen, request.goalKind, request.side);
    const second = parsePracticePositionParams(new URL(again, 'https://x.test').searchParams);
    expect(second.ok && second.fen).toBe(request.fen);
  });
});

describe('backPath', () => {
  const read = (from: string): string | null => backPath(new URLSearchParams({ from }));
  it('links back to a site article, in any served language', () => {
    expect(read('/blog/meng-fanrui')).toBe('/blog/meng-fanrui');
    expect(read('/zh-hant/blog/meng-fanrui')).toBe('/zh-hant/blog/meng-fanrui');
  });
  it('keeps a #fragment so the way back lands on the game the reader left', () => {
    expect(read('/blog/meng-fanrui#ju-longfei-game')).toBe('/blog/meng-fanrui#ju-longfei-game');
    expect(read('/blog/meng-fanrui#')).toBeNull();
    expect(read('/blog/meng-fanrui#x"onmouseover=1')).toBeNull();
    expect(read('/blog/meng-fanrui#a#b')).toBeNull();
  });
  it('refuses anything that is not an article path', () => {
    expect(read('https://evil.example/blog/x')).toBeNull();
    expect(read('//evil.example/blog/x')).toBeNull();
    expect(read('/blog/x?next=//evil.example')).toBeNull();
    expect(read('javascript:alert(1)')).toBeNull();
    expect(backPath(new URLSearchParams())).toBeNull();
  });
});
