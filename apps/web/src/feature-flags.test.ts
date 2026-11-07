import { afterEach, describe, expect, it, vi } from 'vitest';
import { darkXiangqiEnabled, gomokuEnabled } from './feature-flags.js';

describe('client feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([true, false])('keeps Gomoku opt-in with DEV=%s', (dev) => {
    vi.stubEnv('DEV', dev);
    for (const value of [undefined, 'false', '1', 'TRUE', 'true']) {
      vi.stubEnv('VITE_GOMOKU_ENABLED', value);
      expect(gomokuEnabled()).toBe(value === 'true');
    }
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
