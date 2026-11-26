// The first-paint hide for the phone bar's pieces button
// (piece-set-first-paint.ts). The property: the inline script works out the
// same piece set readStoredXiangqiPieceSet() returns, cold and after the boot
// locale initializer, in every generated environment (preview param, stored
// pick and its version, retired and legacy ids, first and chosen locale, page
// path, browser languages, country cookie, unreadable storage), without writing
// storage; and it hides the baked icon only when that set differs from the
// baked one. Planted mutants of the script must fail the equality.
//
// Blind spots, knowingly not covered here:
// - storage that reads but refuses writes, with a stale piece-set version: the
//   reader's version write throws and it falls back to the inference, which a
//   read-only script cannot detect, so the script takes the stored pick. The
//   generator gives that storage mode only the current version. The worst case
//   is the old flash on that one path (or an extra hide until boot);
// - an account's piece set or locale applied after sign-in (it arrives after
//   boot, through the settings change event, not at first paint);
// - values outside the generator's pools;
// - the bake is simulated as a clean first visit at the page's path, which is
//   what prerender-page.mjs gives each page (landing.test.ts pins the homes);
// - real CSS cascade: hiding is checked with Element.matches against the
//   script's rule and site-shell.css's fallback selector, not with layout.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocaleFromCurrentUrl } from './i18n/locale.js';
import {
  PIECE_SET_FIRST_PAINT_SCRIPT,
  PIECE_SET_FIRST_PAINT_STYLE_ID,
  PIECE_SET_PENDING_ATTRIBUTE,
} from './piece-set-first-paint.js';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import {
  internationalCrossedSoldierHrefs,
  internationalStartingPieceHrefs,
  RETIRED_XIANGQI_PIECE_SETS,
  renderXiangqiPieceGlyphed,
  XIANGQI_PIECE_SETS,
} from './xiangqi-piece-sets.js';

type StorageMode = 'ok' | 'getter-throws' | 'getitem-throws' | 'setitem-throws';

type Env = {
  path: string;
  query: string;
  storage: Record<string, string>;
  storageMode: StorageMode;
  languages: readonly string[] | undefined;
  language: string;
  cookie: string;
};

const CLEAN: Env = {
  path: '/',
  query: '',
  storage: {},
  storageMode: 'ok',
  languages: ['en-US'],
  language: 'en-US',
  cookie: '',
};

const FALLBACK_SELECTOR = `html[${PIECE_SET_PENDING_ATTRIBUTE}=""] .site-nav-quick-piece`;
const SET_IDS: readonly string[] = XIANGQI_PIECE_SETS.map((set) => set.id);

/** Installs the environment; the returned list records every storage write. */
function install(env: Env): string[] {
  window.history.replaceState(null, '', `${env.path}${env.query}`);
  const writes: string[] = [];
  const values = new Map(Object.entries(env.storage));
  const denied = () => {
    if (env.storageMode === 'getitem-throws') throw new Error('denied');
  };
  const storage: Storage = {
    get length() {
      denied();
      return values.size;
    },
    clear: () => {
      denied();
      writes.push('clear');
      values.clear();
    },
    getItem: (key: string) => {
      denied();
      return values.get(key) ?? null;
    },
    key: (index: number) => {
      denied();
      return [...values.keys()][index] ?? null;
    },
    removeItem: (key: string) => {
      denied();
      writes.push(`remove ${key}`);
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      denied();
      writes.push(`set ${key}`);
      if (env.storageMode === 'setitem-throws') throw new Error('quota');
      values.set(key, String(value));
    },
  };
  Object.defineProperty(
    window,
    'localStorage',
    env.storageMode === 'getter-throws'
      ? {
          configurable: true,
          get: () => {
            throw new Error('denied');
          },
        }
      : { configurable: true, value: storage },
  );
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => env.languages });
  Object.defineProperty(navigator, 'language', { configurable: true, get: () => env.language });
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => env.cookie,
    set: () => {},
  });
  return writes;
}

function clearMark(): void {
  document.documentElement.removeAttribute(PIECE_SET_PENDING_ATTRIBUTE);
  document.getElementById(PIECE_SET_FIRST_PAINT_STYLE_ID)?.remove();
  for (const link of document.head.querySelectorAll('link[rel="preload"]')) link.remove();
}

const compile = (source: string) => new Function(source) as () => void;

/** Runs the script in the environment: the mark it sets and its storage writes. */
function runScript(script: () => void, env: Env): { mark: string | null; writes: string[] } {
  clearMark();
  const writes = install(env);
  script();
  return { mark: document.documentElement.getAttribute(PIECE_SET_PENDING_ATTRIBUTE), writes };
}

/** What the reader returns, '' when it throws (the script's fallback mark).
 *  With `boot`, the boot locale initializer runs first, as in main.ts; null when
 *  that throws, since then the app never reaches syncNavQuickPieces (its
 *  uncaught error drops the mark, which the error-listener test covers). */
function readerSet(env: Env, boot: true): string | null;
function readerSet(env: Env, boot: false): string;
function readerSet(env: Env, boot: boolean): string | null {
  install(env);
  if (boot) {
    try {
      initializeLocaleFromCurrentUrl();
    } catch {
      return null;
    }
  }
  try {
    return readStoredXiangqiPieceSet();
  } catch {
    return '';
  }
}

/** Would a slot baked with this set be hidden under the current mark? */
function hidesBakedSlot(baked: string): boolean {
  const slot = document.createElement('span');
  slot.className = 'site-nav-quick-piece';
  slot.dataset.pieceSet = baked;
  document.body.append(slot);
  const rule = document.getElementById(PIECE_SET_FIRST_PAINT_STYLE_ID)?.textContent ?? '';
  const selector = rule.split('{')[0]?.trim();
  const hidden = slot.matches(FALLBACK_SELECTOR) || (selector ? slot.matches(selector) : false);
  slot.remove();
  return hidden;
}

/** What the build bakes at this path: a first visit with nothing remembered. */
function bakedSet(path: string): string {
  return readerSet({ ...CLEAN, path }, false);
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOLS = {
  paths: [
    '/',
    '/zh-hans',
    '/zh-hant',
    '/ZH-HANT/rules/xiangqi',
    '/zh-hans/blog/some-post',
    '/zh-hansx',
    '/blog/some-post',
    '/vi/blog/some-post',
    '/puzzles',
    '/rules/xiangqi',
  ],
  queries: [
    '',
    '',
    '',
    '?xqPieces=wood',
    '?xqPieces=traditional',
    '?xqPieces=international',
    '?xqPieces=nope',
    '?xqPieces=western',
    '?xqPieces=animal',
    '?a=1&xqPieces=lacquer',
    '?xqPieces=',
    '?lang=zh-hans',
    '?lang=zh-hant&xqPieces=book',
  ],
  stored: [
    null,
    null,
    ...SET_IDS,
    ...RETIRED_XIANGQI_PIECE_SETS,
    'animal',
    'animal-seal',
    'animal-origami',
    'garbage',
    '',
    'constructor',
    '__proto__',
    'Wood',
  ],
  versions: [null, null, '3', '4', '4', '5'],
  firstLocales: [null, null, 'en', 'zh-Hans', 'zh-Hant', 'zh-hans', 'vi'],
  locales: [null, null, 'en', 'zh-Hans', 'zh-Hant', 'vi'],
  languages: [
    [['en-US'], 'en-US'],
    [['en-US'], 'en-US'],
    [['zh-CN'], 'zh-CN'],
    [['en-GB', 'zh-TW'], 'en-GB'],
    [['yue'], 'yue'],
    [['yue-CN'], 'yue-CN'],
    [[], 'zh-HK'],
    [[], ''],
    [['zh-Hant-HK'], 'zh-Hant-HK'],
    [['zh-chs'], 'zh-chs'],
    [['fr-FR', 'en'], 'fr-FR'],
    [['vi-VN'], 'vi-VN'],
    [['toString', 'zh'], 'toString'],
    [undefined, 'en-US'],
  ] as Array<[readonly string[] | undefined, string]>,
  cookies: [
    '',
    'mb_cc=US',
    'mb_cc=US',
    'theme=x; mb_cc=TW',
    'mb_cc=tw',
    'mb_cc=VN; mb_cc=US',
    'mb_cc=XX; mb_cc=SG',
    'mb_cc=',
    'xmb_cc=CN',
    'mb_cc=CN=1',
    ' mb_cc = HK',
  ],
  modes: [
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'getter-throws',
    'getitem-throws',
    'setitem-throws',
  ] as StorageMode[],
};

function* environments(count: number, seed = 20261123): Generator<Env> {
  const rand = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  for (let i = 0; i < count; i += 1) {
    const storageMode = pick(POOLS.modes);
    const storage: Record<string, string> = {};
    const set = pick(POOLS.stored);
    // A write-refusing store only with the current version: the stale case is
    // the named blind spot above.
    const version = storageMode === 'setitem-throws' ? '4' : pick(POOLS.versions);
    const first = pick(POOLS.firstLocales);
    const locale = pick(POOLS.locales);
    if (set !== null) storage['mistboard.xiangqiPieceSet'] = set;
    if (version !== null) storage['mistboard.xiangqiPieceSetVersion'] = version;
    if (first !== null) storage['mistboard.firstLocale'] = first;
    if (locale !== null) storage['mistboard.locale'] = locale;
    const [languages, language] = pick(POOLS.languages);
    yield {
      path: pick(POOLS.paths),
      query: pick(POOLS.queries),
      storage,
      storageMode,
      languages,
      language,
      cookie: pick(POOLS.cookies),
    };
  }
}

type Mismatch = {
  env: Env;
  script: string | null;
  cold: string;
  boot: string | null;
  writes: string[];
};

const CASES = 6000;

/** Generated environments where the script's mark is not the reader's set, or
 *  where the script wrote storage. Stops at `limit`. */
function mismatches(
  source: string,
  limit = Number.POSITIVE_INFINITY,
  seen?: Map<string, number>,
): Mismatch[] {
  const script = compile(source);
  const found: Mismatch[] = [];
  for (const env of environments(CASES)) {
    const { mark, writes } = runScript(script, env);
    const cold = readerSet(env, false);
    const boot = readerSet(env, true);
    seen?.set(cold, (seen.get(cold) ?? 0) + 1);
    if (mark !== cold || (boot !== null && mark !== boot) || writes.length > 0) {
      found.push({ env, script: mark, cold, boot, writes });
      if (found.length >= limit) break;
    }
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
    clearMark();
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

  it('hides every slot from the stylesheet when the script could not work the set out', () => {
    const css = collapse(readFileSync('src/site-shell.css', 'utf8'));
    expect(css).toContain(`${FALLBACK_SELECTOR} { visibility: hidden; }`);
  });

  it('marks the set the reader returns, in every generated environment, without writing storage', () => {
    const seen = new Map<string, number>();
    expect(mismatches(PIECE_SET_FIRST_PAINT_SCRIPT, 5, seen)).toEqual([]);
    // The generator has to reach every set and the throwing reader, or the
    // equality proves little.
    for (const id of [...SET_IDS, '']) expect(seen.get(id) ?? 0, id).toBeGreaterThan(20);
  });

  it.each([
    ['ignores the piece-set version', /if \(version !== "\d+" && /, 'if (false && '],
    ['ignores the country cookie', 'document.cookie.split', '"".split'],
    ['ignores legacy ids', 'Object.prototype.hasOwnProperty.call(LEGACY, raw)', 'false'],
    [
      'reads the current locale for the first',
      'const locale = firstLocale();',
      'const locale = currentLocale();',
    ],
  ] as const)('catches a planted script that %s', (_name, from, to) => {
    const planted = PIECE_SET_FIRST_PAINT_SCRIPT.replace(from, to);
    expect(planted).not.toBe(PIECE_SET_FIRST_PAINT_SCRIPT);
    expect(mismatches(planted, 1).length).toBe(1);
  });

  it('keeps the baked icon for a default English visitor with a country cookie', () => {
    expect(bakedSet('/')).toBe('international');
    const { mark } = runScript(compile(PIECE_SET_FIRST_PAINT_SCRIPT), {
      ...CLEAN,
      cookie: 'mb_cc=US',
      storage: { 'mistboard.firstLocale': 'en', 'mistboard.xiangqiPieceSetVersion': '4' },
    });
    expect(mark).toBe('international');
    expect(hidesBakedSlot('international')).toBe(false);
  });

  it('keeps the baked icon for a default reader of a zh page', () => {
    expect(bakedSet('/zh-hans')).toBe('traditional');
    runScript(compile(PIECE_SET_FIRST_PAINT_SCRIPT), {
      ...CLEAN,
      path: '/zh-hans',
      cookie: 'mb_cc=CN',
      languages: ['zh-CN'],
    });
    expect(hidesBakedSlot('traditional')).toBe(false);
  });

  it('hides the baked icon for a reader who picked another set', () => {
    const { mark } = runScript(compile(PIECE_SET_FIRST_PAINT_SCRIPT), {
      ...CLEAN,
      cookie: 'mb_cc=US',
      storage: {
        'mistboard.xiangqiPieceSet': 'wood',
        'mistboard.xiangqiPieceSetVersion': '4',
      },
    });
    expect(mark).toBe('wood');
    expect(hidesBakedSlot('international')).toBe(true);
    expect(hidesBakedSlot('wood')).toBe(false);
  });

  it('works the set out when storage cannot be read', () => {
    const { mark } = runScript(compile(PIECE_SET_FIRST_PAINT_SCRIPT), {
      ...CLEAN,
      storageMode: 'getter-throws',
    });
    expect(mark).toBe('international');
    expect(hidesBakedSlot('international')).toBe(false);
  });

  it('hides every slot when the set cannot be worked out', () => {
    const { mark } = runScript(compile(PIECE_SET_FIRST_PAINT_SCRIPT), {
      ...CLEAN,
      languages: undefined,
    });
    expect(mark).toBe('');
    expect(document.getElementById(PIECE_SET_FIRST_PAINT_STYLE_ID)).toBeNull();
    expect(hidesBakedSlot('international')).toBe(true);
  });

  // 2026-11-25: the board's piece PNGs were fetched at low priority once the
  // board mounted, and on Slow 4G the last glyph landed 39s after the board.
  describe('piece preloads', () => {
    const preloads = () =>
      [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')].map(
        (link) => [link.getAttribute('href'), link.getAttribute('fetchpriority')],
      );

    const STARTING = internationalStartingPieceHrefs();
    const HOME = [...STARTING, ...internationalCrossedSoldierHrefs()];

    it('preloads every piece the home boards draw at high priority, at the URLs they draw', () => {
      runScript(compile(PIECE_SET_FIRST_PAINT_SCRIPT), CLEAN);
      expect(preloads()).toEqual(HOME.map((href) => [href, 'high']));
      expect(STARTING).toHaveLength(14);
      expect(STARTING).toContain('/piece-sets/xiangqi/international/black-soldier.png?v=18');
      // The board's own <image> asks for the same URL, so it reuses the preload.
      const href = (color: string, role: string, crossed = false) =>
        renderXiangqiPieceGlyphed(
          { color, role } as Parameters<typeof renderXiangqiPieceGlyphed>[0],
          'international',
          { crossed },
        ).match(/<image href="([^"]+)"/)?.[1];
      const drawn = ['red', 'black'].flatMap((color) =>
        ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier'].map((role) =>
          href(color, role),
        ),
      );
      expect(drawn).toEqual(STARTING);
      expect([href('red', 'soldier', true), href('black', 'soldier', true)]).toEqual(
        internationalCrossedSoldierHrefs(),
      );
    });

    it.each([
      ['/', HOME],
      ['/zh-hant', HOME],
      ['/zh-hans/', HOME],
      ['/analysis/xiangqi', STARTING],
      ['/zh-hant/analysis/xiangqi', STARTING],
    ])('preloads the pieces %s opens on', (path, expected) => {
      runScript(compile(PIECE_SET_FIRST_PAINT_SCRIPT), {
        ...CLEAN,
        path,
        storage: {
          'mistboard.xiangqiPieceSet': 'international',
          'mistboard.xiangqiPieceSetVersion': '4',
        },
      });
      expect(preloads().map(([url]) => url)).toEqual(expected);
    });

    it.each([
      ['a page with no board', { ...CLEAN, path: '/blog' }],
      ['a path named like an object key', { ...CLEAN, path: '/toString' }],
      [
        'another set',
        {
          ...CLEAN,
          storage: { 'mistboard.xiangqiPieceSet': 'wood', 'mistboard.xiangqiPieceSetVersion': '4' },
        },
      ],
      ['a set it could not work out', { ...CLEAN, languages: undefined }],
    ] as const)('preloads nothing for %s', (_name, env) => {
      runScript(compile(PIECE_SET_FIRST_PAINT_SCRIPT), env);
      expect(preloads()).toEqual([]);
    });
  });

  it('shows the baked icon again when the app script fails to load or throws', () => {
    vi.restoreAllMocks();
    const listeners: Array<(event: Event) => void> = [];
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'error' && typeof listener === 'function') listeners.push(listener);
    });
    runScript(compile(PIECE_SET_FIRST_PAINT_SCRIPT), {
      ...CLEAN,
      storage: {
        'mistboard.xiangqiPieceSet': 'wood',
        'mistboard.xiangqiPieceSetVersion': '4',
      },
    });
    expect(hidesBakedSlot('international')).toBe(true);
    const fire = (target: EventTarget) => {
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: target });
      for (const listener of listeners) listener(event);
    };
    fire(document.createElement('img'));
    expect(hidesBakedSlot('international')).toBe(true);
    fire(document.createElement('script'));
    expect(hidesBakedSlot('international')).toBe(false);
    document.documentElement.setAttribute(PIECE_SET_PENDING_ATTRIBUTE, '');
    expect(hidesBakedSlot('international')).toBe(true);
    fire(window);
    expect(hidesBakedSlot('international')).toBe(false);
  });
});
