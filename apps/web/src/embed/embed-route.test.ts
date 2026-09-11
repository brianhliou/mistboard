import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  embedAnalysisRouteFromPath,
  embedChannelFromSearch,
  embedColorFromSearch,
  embedPovFromSearch,
  embedPuzzleRouteFromPath,
  embedRouteFromPath,
  isEmbedTvPath,
} from './embed-route.js';

describe('the TV, puzzle and analysis embed routes', () => {
  it('match their paths and nothing near them', () => {
    expect(isEmbedTvPath('/embed/tv')).toBe(true);
    expect(isEmbedTvPath('/embed/tv/')).toBe(true);
    expect(isEmbedTvPath('/embed/tv/xiangqi')).toBe(false);
    expect(embedPuzzleRouteFromPath('/embed/puzzle')).toEqual({ puzzleId: null });
    expect(embedPuzzleRouteFromPath('/embed/puzzle/abc_1-2')).toEqual({ puzzleId: 'abc_1-2' });
    expect(embedPuzzleRouteFromPath('/embed/puzzle/a/b')).toBeNull();
    expect(embedPuzzleRouteFromPath('/puzzles')).toBeNull();
    expect(embedAnalysisRouteFromPath('/embed/analysis')).toEqual({ variant: 'xiangqi' });
    expect(embedAnalysisRouteFromPath('/embed/analysis/xiangqi')).toEqual({ variant: 'xiangqi' });
    expect(embedAnalysisRouteFromPath('/embed/analysis/banqi')).toBeNull();
  });

  it('discriminate through embedRouteFromPath', () => {
    expect(embedRouteFromPath('/embed/tv')?.kind).toBe('tv');
    expect(embedRouteFromPath('/embed/puzzle')?.kind).toBe('puzzle');
    expect(embedRouteFromPath('/embed/analysis')?.kind).toBe('analysis');
    expect(embedRouteFromPath('/embed/study/a/b')?.kind).toBe('study');
    expect(embedRouteFromPath('/embed/game/a')?.kind).toBe('game');
  });
});

describe('embed query parameters', () => {
  it('reads a channel id and falls back to top for anything else', () => {
    expect(embedChannelFromSearch('?channel=xiangqi')).toBe('xiangqi');
    expect(embedChannelFromSearch('?channel=dark-chess')).toBe('dark-chess');
    expect(embedChannelFromSearch('')).toBe('top');
    expect(embedChannelFromSearch('?channel=../x')).toBe('top');
    expect(embedChannelFromSearch('?channel=Xiangqi')).toBe('top');
  });

  it('reads pov=white|black|truth and nothing else', () => {
    expect(embedPovFromSearch('?pov=black')).toBe('black');
    expect(embedPovFromSearch('?pov=white')).toBe('white');
    expect(embedPovFromSearch('?pov=truth')).toBe('truth');
    expect(embedPovFromSearch('?pov=red')).toBeNull();
    expect(embedPovFromSearch('')).toBeNull();
  });

  it('reads color=black and defaults to red', () => {
    expect(embedColorFromSearch('?color=black')).toBe('black');
    expect(embedColorFromSearch('?color=white')).toBe('red');
    expect(embedColorFromSearch('')).toBe('red');
  });
});

// The server decides what may be framed (isEmbedRoute) and the client decides
// what renders without chrome (embedRouteFromPath). They are in packages that
// cannot import each other, so this pins the agreement by running the same
// sample paths through the client matcher and the server's regexes as text.
const policyPath = ['../../apps/server/src/server-policy.ts', 'apps/server/src/server-policy.ts']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));

describe('the client and server embed lists agree', () => {
  const source = readFileSync(policyPath as string, 'utf8');
  const start = source.indexOf('export function isEmbedRoute');
  const body = source.slice(start, source.indexOf('\n}', start));
  const regexes = [...body.matchAll(/\/\^(.+?)\$\/\.test/g)].map((m) => new RegExp(`^${m[1]}$`));
  const literals = [...body.matchAll(/normalized === '([^']+)'/g)].map((m) => m[1] as string);
  const serverAccepts = (path: string): boolean =>
    literals.includes(path) || regexes.some((re) => re.test(path));

  it('found the server list', () => {
    expect(regexes.length + literals.length).toBeGreaterThan(3);
  });

  for (const path of [
    '/embed/study/a/b',
    '/embed/game/a',
    '/embed/tv',
    '/embed/puzzle',
    '/embed/puzzle/a',
    '/embed/analysis',
    '/embed/analysis/xiangqi',
    '/embed/tv/x',
    '/embed/analysis/banqi',
    '/embed/game/a/b',
    '/embed',
    '/watch',
  ]) {
    it(`agrees on ${path}`, () => {
      expect(serverAccepts(path)).toBe(embedRouteFromPath(path) !== null);
    });
  }
});
