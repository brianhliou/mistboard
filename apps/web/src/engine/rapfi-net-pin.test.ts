// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { requireTestEngineNet } from './test-net.js';

const web = resolve(__dirname, '../..');
const pin = JSON.parse(readFileSync(resolve(web, 'public/engine/rapfi/net.json'), 'utf8'));
const scripts = JSON.parse(readFileSync(resolve(web, 'package.json'), 'utf8')).scripts;
const fetcher = readFileSync(resolve(web, 'scripts/fetch-rapfi-net.mjs'), 'utf8');

beforeAll(() => requireTestEngineNet('rapfi'));

describe('Rapfi network pin', () => {
  it('names an immutable release asset for the pinned file', () => {
    expect(pin.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/v[^/]+\//);
    expect(pin.url.endsWith(`/${pin.file}`)).toBe(true);
  });

  it('is fetched by the production build, not only by predev', () => {
    expect(scripts.build).toContain('node scripts/fetch-rapfi-net.mjs');
  });

  it('downloads without a path on one machine', () => {
    expect(fetcher).not.toMatch(/\/Users\//);
  });
});
