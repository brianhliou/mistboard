import { afterEach, describe, expect, it, vi } from 'vitest';
import { darkXiangqiEnabled } from './feature-flags.js';

describe('client feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
