// The figures state sample sizes in their own labels, so the checks here are
// that those labels still add up to the run the article quotes, and that the
// two exhibit boards really are the position before and after the capture.
import { describe, expect, it } from 'vitest';
import {
  BANQI_LEAD_SAFETY_GRID,
  BANQI_LEAD_SETTLE_CHART,
  BANQI_STATS_AFTER,
  BANQI_STATS_BEFORE,
  LEAD_SAFETY,
  LEAD_SETTLE,
} from './banqi-statistics-diagrams.js';
import { BANQI_STATS_GAME, BANQI_STATS_GAME_DECIDING_PLY } from './content/banqi-statistics-game.js';
import { banqiReplayViewAt } from './diagrams.js';

describe('banqi statistics figures', () => {
  it('the settle chart covers every decided game', () => {
    expect(LEAD_SETTLE.counts.reduce((a, b) => a + b, 0)).toBe(168);
    expect(LEAD_SETTLE.counts).toHaveLength(LEAD_SETTLE.labels.length);
  });

  it('every lead-safety cell reports a sample and a rate', () => {
    for (const row of LEAD_SAFETY.rows) {
      expect(row.cells).toHaveLength(LEAD_SAFETY.buckets.length);
      for (const cell of row.cells) {
        expect(cell.n).toBeGreaterThan(0);
        expect(cell.pct).toBeGreaterThanOrEqual(0);
        expect(cell.pct).toBeLessThanOrEqual(100);
      }
    }
  });

  it('renders both charts with their numbers in the markup', () => {
    const grid = BANQI_LEAD_SAFETY_GRID();
    expect(grid).toContain('52%');
    expect(grid).toContain('100%');
    const chart = BANQI_LEAD_SETTLE_CHART();
    expect(chart).toContain('move the lead last changed hands');
    expect(chart).toContain('>43<');
  });

  it('the exhibit boards bracket the capture that settles the lead', () => {
    const before = banqiReplayViewAt(
      BANQI_STATS_GAME.deal,
      BANQI_STATS_GAME.moves,
      BANQI_STATS_GAME_DECIDING_PLY - 1,
    );
    const after = banqiReplayViewAt(
      BANQI_STATS_GAME.deal,
      BANQI_STATS_GAME.moves,
      BANQI_STATS_GAME_DECIDING_PLY,
    );
    // c3 holds the revealed black general, then the red soldier that took it.
    expect(before.board.c3).toMatchObject({ color: 'black', role: 'general' });
    expect(after.board.c3).toMatchObject({ color: 'red', role: 'soldier' });
    const count = (v: typeof before) => Object.values(v.board).filter(Boolean).length;
    expect(count(after)).toBe(count(before) - 1);
    expect(BANQI_STATS_BEFORE()).not.toBe(BANQI_STATS_AFTER());
  });
});
