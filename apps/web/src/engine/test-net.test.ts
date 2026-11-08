// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { testNetAvailable } from './test-net.js';

const dir = mkdtempSync(join(tmpdir(), 'mistboard-test-net-'));
const missing = join(dir, 'missing.nnue');
afterAll(() => rmSync(dir, { recursive: true }));

describe('required test nets', () => {
  it.each([{ MISTBOARD_REQUIRE_NETS: '1' }, { CI: 'true' }, { CI: '1' }])(
    'fails for a missing net with %j',
    (env) => {
      expect(() => testNetAvailable(missing, env)).toThrow(missing);
      expect(() => testNetAvailable(missing, env)).toThrow('MISTBOARD_PRIVATE_ASSETS_TOKEN');
    },
  );

  it.each([{}, { MISTBOARD_REQUIRE_NETS: '0' }, { MISTBOARD_REQUIRE_NETS: 'true' }])(
    'preserves optional local nets with %j',
    (env) => {
      expect(testNetAvailable(missing, env)).toBe(false);
    },
  );

  it('accepts a present asset even when required', () => {
    expect(testNetAvailable(import.meta.filename, { MISTBOARD_REQUIRE_NETS: '1' })).toBe(true);
    expect(testNetAvailable(import.meta.filename, { CI: 'true' })).toBe(true);
  });
});
