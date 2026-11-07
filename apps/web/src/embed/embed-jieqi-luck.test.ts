import { applyJieqiMove, createInitialJieqiState, type JieqiMove } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { JIEQI_PLATFORM_GAME } from '../jieqi-platform-game.js';
import type { AnalysisMark } from '../review/analysis-marks.js';
import { jieqiEmbedLuck } from './embed-jieqi-luck.js';

function line() {
  const state = createInitialJieqiState('public-luck', JIEQI_PLATFORM_GAME.deal);
  const tokens = JIEQI_PLATFORM_GAME.moves.split(/\s+/).slice(0, 4);
  const played = tokens.map((token) => {
    const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token)!;
    return { from: m[1], to: m[2] } as JieqiMove;
  });
  const states = [state];
  for (const move of played) states.push(applyJieqiMove(states.at(-1)!, move));
  return { states, played };
}
const mark = (ply: number, luck: number): AnalysisMark => ({ ply, luck, better: null });
describe('public Jieqi embed luck', () => {
  it('grades actual reveals using their public pool and leaves the record unchanged', () => {
    const record = line();
    const before = JSON.stringify(record);
    const result = jieqiEmbedLuck(record, new Map([[1, mark(1, 12)]]));
    expect(result.get(1)).toMatchObject({
      square: record.played[0].to,
      luck: 12,
      kind: 'reveal',
      capture: null,
    });
    expect(result.get(1)?.odds?.total).toBe(15);
    expect(JSON.stringify(record)).toBe(before);
  });
  it('does not turn unknown identities or a stale capture grade into reveal annotations', () => {
    const record = line();
    const source = record.states[0].board[record.played[0].from]!;
    source.unknown = true;
    expect(JSON.stringify([...jieqiEmbedLuck(record, new Map([[1, mark(1, 100)]]))])).toBe('[]');
    delete source.unknown;
    source.faceDown = false;
    expect(JSON.stringify([...jieqiEmbedLuck(record, new Map([[1, mark(1, 100)]]))])).toBe('[]');
  });
  it('does not use the placeholder identity of a piece captured face-down', () => {
    const record = line();
    const mover = record.states[0].board[record.played[0].from]!.color;
    record.states[0].captures.push({
      owner: mover,
      role: 'chariot',
      revealedAtCapture: false,
      unknown: true,
    });
    const marks = new Map([[1, mark(1, 12)]]);
    const before = JSON.stringify([...jieqiEmbedLuck(record, marks)]);
    record.states[0].captures[0].role = 'horse';
    expect(JSON.stringify([...jieqiEmbedLuck(record, marks)])).toBe(before);
  });
});
