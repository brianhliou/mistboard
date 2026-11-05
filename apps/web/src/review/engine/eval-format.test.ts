import { describe, expect, it } from 'vitest';
import { advantageSymbol, formatGomokuEval, formatGomokuEvalCompact } from './eval-format.js';

describe('advantageSymbol', () => {
  it('reads a near-equal position as equal', () => {
    expect(advantageSymbol(0, null)).toBe('=');
    expect(advantageSymbol(40, null)).toBe('=');
    expect(advantageSymbol(-59, null)).toBe('=');
  });

  it('distinguishes slight, clear, and winning for red (positive cp)', () => {
    expect(advantageSymbol(90, null)).toBe('⩲');
    expect(advantageSymbol(250, null)).toBe('±');
    expect(advantageSymbol(600, null)).toBe('+−');
  });

  it('mirrors the bands for black (negative cp)', () => {
    expect(advantageSymbol(-90, null)).toBe('⩱');
    expect(advantageSymbol(-250, null)).toBe('∓');
    expect(advantageSymbol(-600, null)).toBe('−+');
  });

  it('treats a mate as decisive on the mating side', () => {
    expect(advantageSymbol(null, 3)).toBe('+−');
    expect(advantageSymbol(null, -2)).toBe('−+');
    // A checkmated position is encoded as a decisive ±30000cp, not a "+300".
    expect(advantageSymbol(30000, null)).toBe('+−');
    expect(advantageSymbol(-30000, null)).toBe('−+');
  });

  it('is empty when there is no score', () => {
    expect(advantageSymbol(null, null)).toBe('');
  });
});

describe('formatGomokuEval', () => {
  // Black moves first and is the plus side; the text names the side, never a sign.
  it('names the side ahead instead of signing the score', () => {
    expect(formatGomokuEval(210, null)).toBe('B+2.1');
    expect(formatGomokuEval(-900, null)).toBe('W+9.0');
    expect(formatGomokuEval(4, null)).toBe('0.0');
    expect(formatGomokuEval(null, null)).toBe('–');
  });

  it('writes a forced win in words, never as a checkmate', () => {
    expect(formatGomokuEval(null, -7)).toBe('White wins in 7');
    expect(formatGomokuEval(null, 3)).toBe('Black wins in 3');
    expect(formatGomokuEval(30000, null)).toBe('Black wins');
    expect(formatGomokuEval(-30000, null)).toBe('White wins');
    for (const text of [formatGomokuEval(null, -7), formatGomokuEval(-30000, null)]) {
      expect(text).not.toMatch(/[#-]/);
    }
  });

  it('has a narrow form for the move-list column', () => {
    expect(formatGomokuEvalCompact(-900, null)).toBe('W+9.0');
    expect(formatGomokuEvalCompact(null, -2)).toBe('W in 2');
    expect(formatGomokuEvalCompact(null, 3)).toBe('B in 3');
    expect(formatGomokuEvalCompact(-30000, null)).toBe('W wins');
  });
});
