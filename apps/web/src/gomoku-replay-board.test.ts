import { createGomokuRoomState, type GomokuOpening } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { mountGomokuReplayBoard, replayGomokuLine } from './gomoku-replay-board.js';

const OPENING: GomokuOpening = {
  stones: [
    { square: 'h8', color: 'black' },
    { square: 'i8', color: 'white' },
  ],
  turn: 'black',
};

function mount(notes: Parameters<typeof mountGomokuReplayBoard>[3] = {}) {
  const host = document.createElement('div');
  const line = replayGomokuLine(createGomokuRoomState('gmk_replay_test', OPENING), [
    'h9',
    'i9',
    'h10',
  ]);
  const plies: number[] = [];
  const handle = mountGomokuReplayBoard(
    host,
    line,
    { onPlyChange: (ply) => plies.push(ply) },
    notes,
  );
  const numbers = () =>
    Object.fromEntries(
      [...host.querySelectorAll('.gomoku-move-number')].map((label) => [
        label.closest('[data-square]')?.getAttribute('data-square'),
        label.textContent,
      ]),
    );
  return { host, handle, plies, numbers };
}

describe('Gomoku study replay board', () => {
  it('numbers every placed stone and leaves the dealt opening unnumbered', () => {
    const { handle, numbers } = mount();
    handle.jumpToPly(3);
    expect(numbers()).toEqual({ h9: '1', i9: '2', h10: '3' });
    handle.jumpToPly(1);
    expect(numbers()).toEqual({ h9: '1' });
  });

  it('draws a glyph on the stone its move placed, and lists it on the sheet', () => {
    const { host, handle } = mount({ glyphs: { 2: '??' }, notes: { 2: 'Loses the race.' } });
    handle.jumpToPly(2);
    const badge = host.querySelector('.gomoku-glyph');
    expect(badge?.getAttribute('data-square')).toBe('i9');
    expect(badge?.textContent).toContain('??');
    handle.jumpToPly(3);
    expect(host.querySelector('.gomoku-glyph')).toBeNull();
    expect(handle.moveEntries()[1]).toMatchObject({
      ply: 2,
      label: 'i9',
      suffix: '??',
      note: 'Loses the race.',
    });
  });

  it('rings a drawn shape on its point', () => {
    const { host, handle } = mount({ shapes: { 1: [{ orig: 'j10', brush: 'green' }] } });
    handle.jumpToPly(1);
    expect(host.querySelector('.gomoku-circle')?.getAttribute('data-square')).toBe('j10');
  });

  it('steps a sideline from the position its move was played in, numbering on from the game', () => {
    const { handle, numbers, plies } = mount({
      lines: { 2: { moves: ['g7', 'h11'], verdict: '+−', note: 'Rapfi blocks first.' } },
    });
    expect(handle.moveEntries()[1]?.line).toEqual({
      moves: ['g7', 'h11'],
      verdict: '+−',
      note: 'Rapfi blocks first.',
    });
    const seen = plies.length;
    handle.jumpToLine(2, 2);
    expect(numbers()).toEqual({ h9: '1', g7: '2', h11: '3' });
    expect(plies.length).toBe(seen);
    handle.jumpToPly(3);
    expect(numbers()).toEqual({ h9: '1', i9: '2', h10: '3' });
  });

  it('drops a sideline whose first move is not legal there', () => {
    const { handle } = mount({ lines: { 2: { moves: ['h9'] } } });
    expect(handle.moveEntries()[1]?.line).toBeUndefined();
  });
});
