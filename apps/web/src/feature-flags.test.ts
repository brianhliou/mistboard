import { afterEach, describe, expect, it, vi } from 'vitest';
import { darkXiangqiEnabled, kriegspielEnabled, luzhanqiEnabled } from './feature-flags.js';

describe('client feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['Kriegspiel', 'VITE_KRIEGSPIEL_ENABLED', kriegspielEnabled],
    ['Luzhanqi', 'VITE_LUZHANQI_ENABLED', luzhanqiEnabled],
  ])('keeps %s disabled in dev unless explicitly opted in', (_name, envName, enabled) => {
    expect(enabled()).toBe(false);

    vi.stubEnv(envName, 'true');
    expect(enabled()).toBe(true);
  });

  it('enables parked surfaces together in the lab profile', () => {
    vi.stubEnv('VITE_MISTBOARD_LAB_ENABLED', 'true');
    expect(luzhanqiEnabled()).toBe(true);
    expect(kriegspielEnabled()).toBe(true);
  });

  it.each([['Dark Xiangqi', 'VITE_DARK_XIANGQI_ENABLED', darkXiangqiEnabled]])(
    'enables %s in dev while keeping production opt-in',
    (_name, envName, enabled) => {
      expect(enabled()).toBe(true);

      vi.stubEnv('DEV', false);
      expect(enabled()).toBe(false);

      vi.stubEnv(envName, 'true');
      expect(enabled()).toBe(true);
    },
  );
});
