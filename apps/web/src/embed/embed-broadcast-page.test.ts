import { describe, expect, it } from 'vitest';
import { studyChapterToReplaySpec } from '../study-chapter-spec.js';
import { broadcastChapter, broadcastLine } from './embed-broadcast-page.js';

describe('broadcast embed', () => {
  it("carries the game's moves, English names, event and round to the card", () => {
    const line = broadcastLine(
      {
        board: {
          id: 'w-r01-b1',
          tourSlug: 'w',
          roundId: 'w-r01',
          red: { name: '曹岩磊', nameEn: 'Cao Yanlei' },
          black: { name: '赖理兄', nameEn: 'Lai Lixiong' },
          result: '1-0',
          status: 'complete',
        },
        timeline: [
          { ply: 2, move: { from: 'h10', to: 'g8' } },
          { ply: 1, move: { from: 'h3', to: 'e3' } },
        ],
      },
      {
        tour: { name: '五羊杯', nameEn: 'Five Rams Cup' },
        rounds: [{ id: 'w-r01', name: '第01轮', nameEn: 'Round 1' }],
      },
    );
    expect(line.moves).toEqual(['h3e3', 'h10g8']);
    expect(line.red).toBe('Cao Yanlei');
    expect(line.black).toBe('Lai Lixiong');
    expect(line.event).toBe('Five Rams Cup · Round 1');
    expect(line.result).toBe('1-0');
  });

  it('leaves the result off a game still in play', () => {
    const line = broadcastLine(
      {
        board: {
          id: 'b',
          tourSlug: 't',
          roundId: 'r',
          red: { name: 'A' },
          black: { name: 'B' },
          result: '*',
          status: 'live',
        },
        timeline: [],
      },
      null,
    );
    expect(line.result).toBeNull();
    expect(line.event).toBeNull();
  });

  it("marks the engine's judged moves and hangs its line beside them", () => {
    const line = {
      fen: null,
      moves: ['h3e3', 'h10g8', 'h1g3', 'i10h10'],
      red: 'A',
      black: 'B',
      event: null,
      result: '1-0',
    };
    const analysis = {
      moves: [
        { ply: 1, mover: 'red' as const, judgment: null, accuracy: 100 },
        // Black's second move was a mistake; the engine wanted the cannon.
        { ply: 4, mover: 'black' as const, judgment: 'mistake' as const, accuracy: 60 },
      ],
      evals: [{ ply: 3, cp: 80, mate: null, best: 'b8e8', pv: ['b8e8', 'b1c3'] }],
    } as unknown as Parameters<typeof broadcastChapter>[1];
    const spec = studyChapterToReplaySpec(broadcastChapter(line, analysis));
    const note = spec?.annotations?.byPly[4];
    expect(note?.glyph).toBe('?');
    // The side line, in the board's ICCS spelling (ranks from 0).
    expect(note?.line).toBe('b7e7 b0c2');
    // Where the line lands: Red slightly better at +0.8 (the site's scale).
    expect(note?.lineEval).toBe('⩲');
    expect(spec?.annotations?.byPly[1]).toBeUndefined();
  });

  it('draws a game the server has not analysed as its bare move list', () => {
    const line = {
      fen: null,
      moves: ['h3e3'],
      red: 'A',
      black: 'B',
      event: null,
      result: null,
    };
    const spec = studyChapterToReplaySpec(broadcastChapter(line, null));
    expect(spec?.iccs).toBe('h2e2');
    expect(Object.keys(spec?.annotations?.byPly ?? {})).toHaveLength(0);
  });
});
