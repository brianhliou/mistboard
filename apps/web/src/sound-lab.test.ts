import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playSound } from './live-sound.js';
import { mountSoundLab } from './sound-lab.js';

vi.mock('./live-sound.js', () => ({
  initLiveSound: vi.fn(),
  maybePlaySnapshotSound: vi.fn(),
  playSound: vi.fn(),
  resetLiveSoundState: vi.fn(),
}));

describe('sound lab lifecycle preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    vi.mocked(playSound).mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it.each([
    ['start', 'start', 'game-start'],
    ['win', 'finish-win', 'win'],
    ['loss', 'finish-loss', 'lose'],
    ['draw', 'finish-draw', 'draw'],
  ] as const)('previews %s with the production effect and sound', (button, effect, sound) => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSoundLab(root);

    root.querySelector<HTMLButtonElement>(`[data-lifecycle-preview="${button}"]`)?.click();

    const stage = root.querySelector<HTMLElement>('[data-lifecycle-preview-stage]');
    expect(stage?.dataset.liveLifecycleEffect).toBe(effect);
    expect(playSound).toHaveBeenCalledWith(sound);
  });

  it('previews the spectator-neutral finish without inventing a sound', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSoundLab(root);

    root.querySelector<HTMLButtonElement>('[data-lifecycle-preview="neutral"]')?.click();

    const stage = root.querySelector<HTMLElement>('[data-lifecycle-preview-stage]');
    expect(stage?.dataset.liveLifecycleEffect).toBe('finish');
    expect(playSound).not.toHaveBeenCalled();
  });

  it('can replay the same preview on every click', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSoundLab(root);
    const start = root.querySelector<HTMLButtonElement>('[data-lifecycle-preview="start"]');
    const stage = root.querySelector<HTMLElement>('[data-lifecycle-preview-stage]');

    start?.click();
    expect(stage?.dataset.liveLifecycleEffect).toBe('start');
    vi.advanceTimersByTime(650);
    expect(stage?.dataset.liveLifecycleEffect).toBeUndefined();
    start?.click();

    expect(stage?.dataset.liveLifecycleEffect).toBe('start');
    expect(playSound).toHaveBeenCalledTimes(2);
  });
});
