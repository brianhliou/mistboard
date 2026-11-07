import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setStoredLocale } from '../i18n/locale.js';
import { fetchXiangqiGameSource, parseXiangqiGameSource } from './xiangqi-game-source.js';

// Node's native localStorage can shadow happy-dom's storage in the test worker.
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      clear: () => values.clear(),
    },
  });
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('parseXiangqiGameSource', () => {
  test('reads each of the three game surfaces from a full URL', () => {
    expect(parseXiangqiGameSource('https://mistboard.com/xiangqi/game/xq_abc')).toEqual({
      kind: 'mistboard',
      id: 'xq_abc',
    });
    expect(parseXiangqiGameSource('https://mistboard.com/historical-xiangqi/game/hxq_123')).toEqual(
      { kind: 'historical', id: 'hxq_123' },
    );
    expect(
      parseXiangqiGameSource('https://mistboard.com/broadcast/xiangqi/board/b-7?ply=12'),
    ).toEqual({ kind: 'broadcast', id: 'b-7' });
  });

  test('accepts a bare path and a bare id', () => {
    expect(parseXiangqiGameSource('/xiangqi/game/xq_abc')?.kind).toBe('mistboard');
    expect(parseXiangqiGameSource('xq_abc')).toEqual({ kind: 'mistboard', id: 'xq_abc' });
    expect(parseXiangqiGameSource('hxq_123')).toEqual({ kind: 'historical', id: 'hxq_123' });
  });

  test('refuses anything it cannot route rather than guessing', () => {
    // A wrong guess imports the wrong game, which is worse than refusing.
    expect(parseXiangqiGameSource('https://lichess.org/abcd1234')).toBeNull();
    expect(parseXiangqiGameSource('https://mistboard.com/jungle/game/jg_1')).toBeNull();
    expect(parseXiangqiGameSource('some notes about a game')).toBeNull();
    expect(parseXiangqiGameSource('   ')).toBeNull();
  });

  test('a query string or trailing segment does not leak into the id', () => {
    expect(parseXiangqiGameSource('/xiangqi/game/xq_abc?tab=moves')?.id).toBe('xq_abc');
    expect(parseXiangqiGameSource('/xiangqi/game/xq_abc#ply3')?.id).toBe('xq_abc');
  });
});

const MOVES = [{ from: 'h3', to: 'e3' }];
const LOCALES = [
  {
    locale: 'en',
    load: 'That game could not be loaded.',
    missing: 'No game found at that link.',
    private: 'That game is not public.',
    played: 'That game has no moves yet.',
    archive: 'That game has no moves.',
    board: 'That board has no moves yet.',
    fallback: 'Xiangqi game',
    pair: 'Original Red vs Original Black',
    broadcast: 'Red Romanized vs Black Romanized',
  },
  {
    locale: 'zh-Hans',
    load: '无法加载该对局。',
    missing: '该链接未找到对局。',
    private: '该对局未公开。',
    played: '该对局尚无着法。',
    archive: '该对局没有着法。',
    board: '该棋盘尚无着法。',
    fallback: '象棋对局',
    pair: 'Original Red 对 Original Black',
    broadcast: '红方原名 对 黑方原名',
  },
  {
    locale: 'zh-Hant',
    load: '無法載入該對局。',
    missing: '該連結未找到對局。',
    private: '該對局未公開。',
    played: '該對局尚無著法。',
    archive: '該對局沒有著法。',
    board: '該棋盤尚無著法。',
    fallback: '象棋對局',
    pair: 'Original Red 對 Original Black',
    broadcast: '红方原名 對 黑方原名',
  },
] as const;

for (const copy of LOCALES) {
  describe(`${copy.locale} game sources`, () => {
    test('localizes inaccessible links and network failures on every source', async () => {
      setStoredLocale(copy.locale);
      for (const kind of ['mistboard', 'historical', 'broadcast'] as const) {
        for (const [status, error] of [
          [404, copy.missing],
          [401, copy.private],
          [403, copy.private],
          [500, copy.load],
        ] as const) {
          vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
          expect(await fetchXiangqiGameSource({ kind, id: 'test' })).toEqual({ ok: false, error });
        }
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        expect(await fetchXiangqiGameSource({ kind, id: 'test' })).toEqual({
          ok: false,
          error: copy.load,
        });
      }
    });

    test('localizes empty sources and generated names, preserving recorded names and moves', async () => {
      setStoredLocale(copy.locale);
      const respond = (body: object) =>
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
      for (const [kind, error] of [
        ['mistboard', copy.played],
        ['historical', copy.archive],
        ['broadcast', copy.board],
      ] as const) {
        respond({});
        expect(await fetchXiangqiGameSource({ kind, id: 'test' })).toEqual({ ok: false, error });
      }
      const timeline = MOVES.map((move) => ({ type: 'move-played', move }));
      respond({ timeline });
      expect(await fetchXiangqiGameSource({ kind: 'mistboard', id: 'xq_1' })).toEqual({
        ok: true,
        game: { name: copy.fallback, moves: MOVES },
      });
      respond({
        game: {
          players: [
            { color: 'red', name: 'Original Red' },
            { color: 'black', name: 'Original Black' },
          ],
        },
        timeline,
      });
      expect(await fetchXiangqiGameSource({ kind: 'mistboard', id: 'xq_1' })).toEqual({
        ok: true,
        game: { name: copy.pair, moves: MOVES },
      });
      respond({ game: { moves: MOVES } });
      expect(await fetchXiangqiGameSource({ kind: 'historical', id: 'hxq_1' })).toEqual({
        ok: true,
        game: { name: copy.fallback, moves: MOVES },
      });
      respond({ game: { moves: MOVES, eventName: 'Recorded Event' } });
      expect(await fetchXiangqiGameSource({ kind: 'historical', id: 'hxq_1' })).toEqual({
        ok: true,
        game: { name: 'Recorded Event', moves: MOVES },
      });
      respond({
        game: {
          moves: MOVES,
          eventName: 'Recorded Event',
          redNameRaw: 'Original Red',
          blackNameRaw: 'Original Black',
        },
      });
      expect(await fetchXiangqiGameSource({ kind: 'historical', id: 'hxq_1' })).toEqual({
        ok: true,
        game: { name: `${copy.pair} (Recorded Event)`, moves: MOVES },
      });
      respond({
        board: {
          moves: MOVES,
          red: { name: '红方原名', nameEn: 'Red Romanized' },
          black: { name: '黑方原名', nameEn: 'Black Romanized' },
        },
      });
      expect(await fetchXiangqiGameSource({ kind: 'broadcast', id: 'b-1' })).toEqual({
        ok: true,
        game: { name: copy.broadcast, moves: MOVES },
      });
      respond({ board: { moves: MOVES } });
      expect(await fetchXiangqiGameSource({ kind: 'broadcast', id: 'b-1' })).toEqual({
        ok: true,
        game: { name: copy.fallback, moves: MOVES },
      });
    });
  });
}
