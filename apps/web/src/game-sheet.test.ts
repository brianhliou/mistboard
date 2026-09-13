import { describe, expect, it } from 'vitest';
import { gameSheetVariants, sheetReviewUrl } from './game-sheet.js';

describe('game sheet', () => {
  it('builds encoded native review URLs', () => {
    expect(sheetReviewUrl('/jungle/game', 'jgl room')).toBe('/jungle/game/jgl%20room');
    expect(sheetReviewUrl('/game', 'legacy_room')).toBe('/game/legacy_room');
  });

  it('includes the legacy dark-chess page and tenant-native postgame pages', () => {
    const variants = gameSheetVariants();

    expect(variants.some((variant) => variant.label === 'Fog Chess')).toBe(true);
    expect(
      variants.some(
        (variant) => variant.label === 'Jungle Chess' && variant.routeBase === '/jungle/game',
      ),
    ).toBe(true);
    expect(variants.every((variant) => variant.channel.length > 0)).toBe(true);
  });
});
