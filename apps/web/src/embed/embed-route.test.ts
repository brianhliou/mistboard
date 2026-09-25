import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  embedAnalysisRouteFromPath,
  embedChannelFromSearch,
  embedColorFromSearch,
  embedLineFromSearch,
  embedLineRouteFromPath,
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

  it('frame a bare line for the variants with a board on the card, and refuse the rest', () => {
    expect(embedLineRouteFromPath('/embed/line/jungle')).toEqual({ variant: 'jungle' });
    expect(embedLineRouteFromPath('/embed/line/banqi/')).toEqual({ variant: 'banqi' });
    // fortress has no replay board on the card; refused at the route, not drawn as xiangqi
    expect(embedLineRouteFromPath('/embed/line/fortress-xiangqi')).toBeNull();
    expect(embedLineRouteFromPath('/embed/line')).toBeNull();
    expect(embedRouteFromPath('/embed/line/xiangqi')?.kind).toBe('line');
    expect(embedRouteFromPath('/embed/broadcast/xiangqi/board/2026-wuyang-cup-r01-b1')).toEqual({
      kind: 'broadcast',
      route: { boardId: '2026-wuyang-cup-r01-b1' },
    });
    expect(embedRouteFromPath('/embed/broadcast/xiangqi/board/')).toBeNull();
  });

  it('reads the line out of the query string, shape-checked, capped, nothing decoded twice', () => {
    const line = embedLineFromSearch(
      '?fen=t5l/1c3d1/e1w1p1r/7/7/7/R1P1W1E/1D3C1/L5T_r_0_1&moves=a1b1,a9a8 b1a1&red=KataGo&black=Misty&event=Game%2067&result=0-1',
    );
    expect(line.fen).toBe('t5l/1c3d1/e1w1p1r/7/7/7/R1P1W1E/1D3C1/L5T r 0 1');
    expect(line.moves).toEqual(['a1b1', 'a9a8', 'b1a1']);
    expect(line.red).toBe('KataGo');
    expect(line.event).toBe('Game 67');
    expect(line.result).toBe('0-1');
    // a token that is not move-shaped is dropped rather than passed to a kernel
    expect(embedLineFromSearch('?moves=a1b1,<script>,b1a1').moves).toEqual(['a1b1', 'b1a1']);
    expect(embedLineFromSearch('').moves).toEqual([]);
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
    '/embed/line/jungle',
    '/embed/line/Jungle',
    '/embed/broadcast/xiangqi/board/2026-wuyang-cup-r01-b1',
    '/embed/broadcast/xiangqi/board/a/b',
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
