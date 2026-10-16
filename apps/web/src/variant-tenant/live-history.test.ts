import { describe, expect, it } from 'vitest';
import { adoptLiveHistory } from './live-history.js';

type View = { status: { type: string }; board?: unknown; perspective: string };

const playing = (): View => ({ status: { type: 'playing' }, board: {}, perspective: 'east' });
const table = (): View => ({ status: { type: 'playing' }, perspective: 'east' });
const finished = (): View => ({ status: { type: 'finished' }, perspective: 'east' });
const history = (views: View[]) => views.map((view, ply) => ({ ply, view }));

describe('adoptLiveHistory', () => {
  it('installs a live room history that runs 0..live ply', () => {
    const views = [playing(), playing(), playing()];
    expect(adoptLiveHistory(history(views), playing(), 2)?.map((s) => s.ply)).toEqual([0, 1, 2]);
  });

  it('keeps a finished room on the captured history unless the tenant opts in', () => {
    const views = [table(), finished()];
    expect(adoptLiveHistory(history(views), finished(), 1)).toBeNull();
    const adopted = adoptLiveHistory(history(views), finished(), 1, {
      finished: true,
      boardless: true,
    });
    expect(adopted?.map((s) => s.view.status.type)).toEqual(['playing', 'finished']);
  });

  it('drops a list with a gap, another perspective, or a stale last ply', () => {
    const options = { finished: true, boardless: true } as const;
    const gap = [
      { ply: 0, view: playing() },
      { ply: 2, view: playing() },
    ];
    expect(adoptLiveHistory(gap, playing(), 2, options)).toBeNull();
    const west = [playing(), { ...playing(), perspective: 'west' }];
    expect(adoptLiveHistory(history(west), playing(), 1, options)).toBeNull();
    expect(adoptLiveHistory(history([playing(), playing()]), playing(), 3, options)).toBeNull();
  });

  it('still asks a board of every ply unless the tenant has none', () => {
    const views = [table(), table()];
    expect(adoptLiveHistory(history(views), table(), 1)).toBeNull();
    expect(adoptLiveHistory(history(views), table(), 1, { boardless: true })).toHaveLength(2);
  });
});
