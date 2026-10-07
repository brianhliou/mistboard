import { describe, expect, it } from 'vitest';
import { ANTI_GAME_SET_STRINGS } from './anti-xiangqi-article-diagrams.js';
import {
  type GameSetText,
  gameSetLine,
  gameSetText,
  type StepGameSet,
  splitGameSetMove,
} from './article-game-set.js';
import { HORDE_GAME_SET_STRINGS } from './horde-xiangqi-article-diagrams.js';

function keysOf(text: GameSetText): string[] {
  return [text.k, ...text.a.flatMap((a) => (Array.isArray(a) ? [a[1]] : []))];
}

function checkSet(set: StepGameSet, strings: Record<string, string>, count: number): void {
  expect(set.records).toHaveLength(count);
  expect(new Set(set.records.map((r) => r.id)).size).toBe(count);
  for (const record of set.records) {
    const keys = [
      ...[
        record.group,
        record.label,
        record.result,
        record.verdict,
        record.red,
        record.black,
      ].flatMap(keysOf),
      ...(record.extra ? [record.extra] : []),
    ];
    for (const key of keys) expect(strings[key], `${record.id}: template ${key}`).toBeDefined();
    // A nested ['k', key] argument is filled without arguments of its own,
    // so no rendered line may keep a hole.
    for (const text of [record.label, record.result, record.verdict, record.red, record.black])
      expect(gameSetText(text, strings), `${record.id}: ${text.k}`).not.toMatch(/%\d/);
    const { moves, boards } = gameSetLine(set, record);
    expect(moves.length).toBeGreaterThan(0);
    if (record.san) expect(record.san.split(' ')).toHaveLength(moves.length);
    // Every move picks up a piece of the side to move (Red first).
    moves.forEach((m, i) => {
      expect(boards[i]![m.from]?.color, `${record.id} ply ${i + 1}`).toBe(i % 2 ? 'black' : 'red');
    });
  }
  if (set.open) expect(set.records.some((r) => r.id === set.open)).toBe(true);
}

describe('article game set', () => {
  it('fills templates, nested keys and numbers', () => {
    const strings = { res: '%1 %2 after %3 plies.', 'red-wins': 'Red wins', by: 'by extinction' };
    expect(gameSetText({ k: 'res', a: [['k', 'red-wins'], ['k', 'by'], 39] }, strings)).toBe(
      'Red wins by extinction after 39 plies.',
    );
    expect(gameSetText({ k: 'missing', a: [] }, strings)).toBe('missing');
  });

  it('splits coordinate moves on either side of rank 10', () => {
    expect(splitGameSetMove('a1a10')).toEqual({ from: 'a1', to: 'a10' });
    expect(splitGameSetMove('b10b3')).toEqual({ from: 'b10', to: 'b3' });
    expect(() => splitGameSetMove('z1a1')).toThrow();
  });

  it('anti xiangqi: 169 games replay and every template resolves', async () => {
    const { GAME_SET } = await import('./anti-xiangqi-games.js');
    checkSet(GAME_SET, ANTI_GAME_SET_STRINGS, 169);
  });

  it('horde xiangqi: 58 games replay through the kernel and every template resolves', async () => {
    const { GAME_SET } = await import('./horde-xiangqi-games.js');
    checkSet(GAME_SET, HORDE_GAME_SET_STRINGS, 58);
    expect(GAME_SET.records.filter((r) => r.veteran)).toHaveLength(28);
    // About 10 s: every ply resolves against the kernel's legal moves.
  }, 60_000);
});
