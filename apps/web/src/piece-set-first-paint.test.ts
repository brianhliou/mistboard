// The first-paint hide for the phone bar's pieces button
// (piece-set-first-paint.ts). The property: whenever the set a reader resolves
// differs from the set the build baked into that page, the inline script has
// set the marker before first paint. Checked against the real inference
// (readStoredXiangqiPieceSet) over a grid of storage, path, language, cookie and
// query values, with a planted predicate that must fail it.
//
// Blind spots, knowingly not covered here:
// - an account's piece set or locale applied after sign-in (it arrives after
//   boot, through the settings change event, not at first paint);
// - values outside the grid (other language tags, other stored strings);
// - the bake is simulated as a clean first visit at the page's path, which is
//   what prerender-page.mjs gives each page; a bake that leaked state between
//   pages would make this simulation wrong (landing.test.ts pins the homes);
// - the CSS that hides the slot while the marker is set (no layout engine).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PIECE_SET_FIRST_PAINT_SCRIPT,
  PIECE_SET_PENDING_ATTRIBUTE,
} from './piece-set-first-paint.js';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';

type Env = {
  path: string;
  query: string;
  storage: Record<string, string>;
  languages: readonly string[];
  language: string;
  cookie: string;
};

const CLEAN: Env = {
  path: '/',
  query: '',
  storage: {},
  languages: ['en-US'],
  language: 'en-US',
  cookie: '',
};

function memoryStorage(initial: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function install(env: Env): void {
  window.history.replaceState(null, '', `${env.path}${env.query}`);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: memoryStorage(env.storage),
  });
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => env.languages });
  Object.defineProperty(navigator, 'language', { configurable: true, get: () => env.language });
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => env.cookie,
    set: () => {},
  });
}

function runScript(source: string): boolean {
  document.documentElement.removeAttribute(PIECE_SET_PENDING_ATTRIBUTE);
  new Function(source)();
  return document.documentElement.hasAttribute(PIECE_SET_PENDING_ATTRIBUTE);
}

/** What the build bakes at this path: a first visit with nothing remembered. */
function bakedSet(path: string): string {
  install({ ...CLEAN, path });
  return readStoredXiangqiPieceSet();
}

function* grid(): Generator<Env> {
  const paths = ['/', '/zh-hans', '/zh-hant', '/blog/some-post', '/zh-hant/rules/xiangqi'];
  const stored = [null, 'international', 'traditional', 'wood', 'western', 'animal', 'garbage'];
  const versions = [null, '4'];
  const firstLocales = [null, 'en', 'zh-Hans'];
  const locales = [null, 'en', 'zh-Hant'];
  const languages: Array<[readonly string[], string]> = [
    [['en-US'], 'en-US'],
    [['zh-CN'], 'zh-CN'],
    [['en-GB', 'zh-TW'], 'en-GB'],
    [['yue'], 'yue'],
    [[], 'zh-HK'],
  ];
  const cookies = ['', 'mb_cc=US', 'theme=x; mb_cc=TW'];
  const queries = ['', '?xqPieces=traditional', '?xqPieces=nope'];
  for (const path of paths)
    for (const set of stored)
      for (const version of versions)
        for (const first of firstLocales)
          for (const locale of locales)
            for (const [langs, language] of languages)
              for (const cookie of cookies)
                for (const query of queries) {
                  const storage: Record<string, string> = {};
                  if (set !== null) storage['mistboard.xiangqiPieceSet'] = set;
                  if (version !== null) storage['mistboard.xiangqiPieceSetVersion'] = version;
                  if (first !== null) storage['mistboard.firstLocale'] = first;
                  if (locale !== null) storage['mistboard.locale'] = locale;
                  yield { path, query, storage, languages: langs, language, cookie };
                }
}

/** Every grid case where the reader's set differs from the bake and the
 *  script left the marker unset. */
function misses(source: string, differing = { count: 0 }): Env[] {
  const baked = new Map<string, string>();
  const found: Env[] = [];
  for (const env of grid()) {
    if (!baked.has(env.path)) baked.set(env.path, bakedSet(env.path));
    install(env);
    const marked = runScript(source);
    install(env);
    const resolved = readStoredXiangqiPieceSet();
    if (resolved === baked.get(env.path)) continue;
    differing.count += 1;
    if (!marked) found.push(env);
  }
  return found;
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('piece-set first-paint script', () => {
  const realLanguages = Object.getOwnPropertyDescriptor(navigator, 'languages');
  const realLanguage = Object.getOwnPropertyDescriptor(navigator, 'language');
  const realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');

  beforeEach(() => {
    // Each run adds an error listener; keep them off the shared window.
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute(PIECE_SET_PENDING_ATTRIBUTE);
    Reflect.deleteProperty(document, 'cookie');
    for (const [target, key, real] of [
      [navigator, 'languages', realLanguages],
      [navigator, 'language', realLanguage],
      [window, 'localStorage', realStorage],
    ] as const) {
      if (real) Object.defineProperty(target, key, real);
      else Reflect.deleteProperty(target, key);
    }
    window.history.replaceState(null, '', '/');
  });

  it('is the script index.html runs in its head', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(collapse(html)).toContain(collapse(PIECE_SET_FIRST_PAINT_SCRIPT));
  });

  it('marks every reader whose set differs from the page it was baked into', () => {
    expect(bakedSet('/')).toBe('international');
    expect(bakedSet('/blog/some-post')).toBe('international');
    expect(bakedSet('/zh-hans')).toBe('traditional');
    expect(bakedSet('/zh-hant/rules/xiangqi')).toBe('traditional');
    const differing = { count: 0 };
    expect(misses(PIECE_SET_FIRST_PAINT_SCRIPT, differing)).toEqual([]);
    // The grid has to reach readers who differ, or the check proves nothing.
    expect(differing.count).toBeGreaterThan(1000);
  });

  it('catches a planted predicate that forgets the country cookie', () => {
    const planted = PIECE_SET_FIRST_PAINT_SCRIPT.replace(/\n.*mb_cc=.*\n/, '\n');
    expect(planted).not.toBe(PIECE_SET_FIRST_PAINT_SCRIPT);
    expect(misses(planted).length).toBeGreaterThan(0);
  });

  it('leaves a first English visit with nothing remembered unhidden', () => {
    install(CLEAN);
    expect(runScript(PIECE_SET_FIRST_PAINT_SCRIPT)).toBe(false);
  });

  it('hides when storage cannot be read', () => {
    install(CLEAN);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('denied');
      },
    });
    expect(runScript(PIECE_SET_FIRST_PAINT_SCRIPT)).toBe(true);
  });

  it('shows the baked icon again when the app script fails to load or throws', () => {
    vi.restoreAllMocks();
    const listeners: Array<(event: Event) => void> = [];
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'error' && typeof listener === 'function') listeners.push(listener);
    });
    install({ ...CLEAN, cookie: 'mb_cc=US' });
    expect(runScript(PIECE_SET_FIRST_PAINT_SCRIPT)).toBe(true);
    const fire = (target: EventTarget) => {
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: target });
      for (const listener of listeners) listener(event);
    };
    fire(document.createElement('img'));
    expect(document.documentElement.hasAttribute(PIECE_SET_PENDING_ATTRIBUTE)).toBe(true);
    fire(document.createElement('script'));
    expect(document.documentElement.hasAttribute(PIECE_SET_PENDING_ATTRIBUTE)).toBe(false);
    document.documentElement.setAttribute(PIECE_SET_PENDING_ATTRIBUTE, '');
    fire(window);
    expect(document.documentElement.hasAttribute(PIECE_SET_PENDING_ATTRIBUTE)).toBe(false);
  });
});
