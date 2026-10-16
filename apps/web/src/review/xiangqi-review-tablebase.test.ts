import { describe, expect, it } from 'vitest';
import { xiangqiTablebaseEnabled } from './xiangqi-review.js';

describe('xiangqi review tablebase default', () => {
  it('is on for game review, broadcast and study surfaces, not only analysis', () => {
    expect(xiangqiTablebaseEnabled({})).toBe(true);
  });

  it('still lets a caller opt out', () => {
    expect(xiangqiTablebaseEnabled({ tablebasePanel: false })).toBe(false);
  });
});
