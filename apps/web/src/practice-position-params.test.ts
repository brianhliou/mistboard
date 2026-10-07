import { describe, expect, it } from 'vitest';
import {
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

  it.each([
    ['missing side', { fen: LIVE, goal: 'mate' }, 'side'],
    ['unknown side', { fen: LIVE, goal: 'mate', side: 'white' }, 'side'],
    ['missing goal', { fen: LIVE, side: 'red' }, 'goal'],
    ['unknown goal', { fen: LIVE, goal: 'win', side: 'red' }, 'goal'],
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
