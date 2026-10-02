import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CRAZYHOUSE_XIANGQI_ENGINE_DEFINITION } from './articles/content/crazyhouse-xiangqi.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The rules page prints the engine definition so another site or engine can
// adopt the rules. It has to be the one Mistboard's engine actually loads.
describe('crazyhouse xiangqi rules page', () => {
  it('prints the variant section of the engine ini verbatim', () => {
    const ini = readFileSync(resolve(repoRoot, 'apps/server/src/crazyhouse-xiangqi.ini'), 'utf8');
    const section = ini.slice(ini.indexOf('[crazyhousexiangqi:xiangqi]')).trim();
    expect(CRAZYHOUSE_XIANGQI_ENGINE_DEFINITION).toBe(section);
  });
});
