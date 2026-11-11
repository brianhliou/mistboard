import { describe, expect, it } from 'vitest';
import {
  embedRendererKindForVariant,
  nextShowcaseIndex,
  specIdForShowcaseVariant,
} from './showcase-dispatch';

describe('specIdForShowcaseVariant', () => {
  it('maps the legacy dark-chess "fog" value to the dark-chess spec', () => {
    expect(specIdForShowcaseVariant('fog')).toBe('dark-chess');
  });

  it('passes through known spec ids unchanged', () => {
    expect(specIdForShowcaseVariant('dark-chess')).toBe('dark-chess');
    expect(specIdForShowcaseVariant('jieqi')).toBe('jieqi');
    expect(specIdForShowcaseVariant('banqi')).toBe('banqi');
    expect(specIdForShowcaseVariant('jungle')).toBe('jungle');
  });

  it('falls back to dark-chess for unknown variants', () => {
    expect(specIdForShowcaseVariant('totally-unknown')).toBe('dark-chess');
    expect(specIdForShowcaseVariant('')).toBe('dark-chess');
  });
});

describe('nextShowcaseIndex', () => {
  it('advances and wraps around the pool', () => {
    expect(nextShowcaseIndex(3, 0)).toBe(1);
    expect(nextShowcaseIndex(3, 1)).toBe(2);
    expect(nextShowcaseIndex(3, 2)).toBe(0);
  });

  it('restarts at the front when the current room was dropped (-1)', () => {
    expect(nextShowcaseIndex(3, -1)).toBe(0);
  });

  it('returns -1 for an empty pool', () => {
    expect(nextShowcaseIndex(0, -1)).toBe(-1);
  });
});

describe('embedRendererKindForVariant', () => {
  it('draws a tenant with a watch renderer on its own board', () => {
    expect(embedRendererKindForVariant('jieqi')).toBe('jieqi');
    expect(embedRendererKindForVariant('xiangqi')).toBe('xiangqi');
  });

  it('keeps the chessground board for the chess stack only', () => {
    expect(embedRendererKindForVariant('fog')).toBe('chess');
    expect(embedRendererKindForVariant('dark-chess')).toBe('chess');
  });

  it('fails closed for a tenant with no watch renderer and for unknown variants', () => {
    expect(embedRendererKindForVariant('xiangqi-mahjong')).toBeNull();
    expect(embedRendererKindForVariant('mahjong')).toBeNull();
    expect(embedRendererKindForVariant('totally-unknown')).toBeNull();
  });
});
