import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysisVariantFromPath } from './analysis-catalog.js';
import { allAnnouncements } from './announcements.js';
import { editorVariantFromPath } from './editor/editor-catalog.js';
import { localizedHref, SUPPORTED_LOCALES } from './i18n/locale.js';
import type { NavItem } from './nav-items.js';

// Read the actual client table without booting main.ts (analytics, sockets and
// page mounts). Do not strip locale prefixes: only explicitly routed Chinese
// URLs work. A route-shape check complements announcement-links.test.ts, which
// verifies the existence and publication state of individual articles.
const source = readFileSync(resolve(__dirname, 'main.ts'), 'utf8');
// Top-level route declarations use `const name = expression;`. Like the
// server-policy parity test, fail loudly if main.ts adopts another shape.
const declarations = [...source.matchAll(/^const (\w+) =\s+([\s\S]*?);$/gm)].map((match) => ({
  name: match[1]!,
  expression: match[2]!,
}));
const routeExpressions = declarations
  .filter(({ name }) => name.startsWith('wants'))
  // These pages require an explicit dev/build gate and have no public nav.
  .filter(({ expression }) => !/import\.meta\.env\.DEV|coordinateTrainerEnabled/.test(expression))
  .map(({ expression }) => expression);
const literals = new Set(
  routeExpressions.flatMap((expression) =>
    [...expression.matchAll(/path === '(\/[^']*)'/g)].map((match) => match[1]!),
  ),
);
// The final homepage branch is not a wants* declaration.
for (const match of source.matchAll(/else if \((path === '[^\n]+)\) \{/g)) {
  for (const literal of match[1]!.matchAll(/path === '(\/[^']*)'/g)) literals.add(literal[1]!);
}
const inlinePatterns = declarations.flatMap(({ expression }) =>
  [
    ...expression.matchAll(/\/(\^.*?)\/\.exec\(path\)/g),
    ...expression.matchAll(/path\.match\(\/(.*?)\/\)/g),
  ].map((match) => new RegExp(match[1]!)),
);
const prefixes = declarations.flatMap(({ expression }) =>
  [...expression.matchAll(/path\.startsWith\('(\/[^']*)'\)/g)].map((match) => match[1]!),
);

// main.ts keeps these parsers local. Compile their real bodies, and require a
// table binding AND a dispatch branch so an orphaned helper cannot bless a URL.
const parserNames = [
  ['articleSlugFromPath', 'articleSlug'],
  ['articleIndexViewFromPath', 'wantsArticlesIndex'],
  ['puzzleIdFromPath', 'wantsPuzzles'],
  ['xiangqiBroadcastTourSlugFromPath', 'xiangqiBroadcastTourSlug'],
];
const parsers = parserNames.map(([name, dispatch]) => {
  const binding = declarations.find(({ expression }) => expression === `${name}(path)`);
  expect(binding, `${name} must be bound in main.ts`).toBeDefined();
  expect(source).toContain(`else if (${dispatch})`);
  const fn = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm').exec(source)?.[0];
  expect(fn, `${name} must exist in main.ts`).toBeDefined();
  const js = stripTypeScriptTypes(fn!);
  return new Function(`${js}; return ${name};`)() as (path: string) => unknown;
});
for (const name of ['analysisVariantFromPath', 'editorVariantFromPath']) {
  expect(declarations.some(({ expression }) => expression === `${name}(path)`)).toBe(true);
}

function isCanonicalDestination(href: string): boolean {
  const url = new URL(href, 'https://mistboard.com');
  if (url.origin !== 'https://mistboard.com') return false;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  // Accepted for old bookmarks, but new links must use the destination itself.
  if (
    /^\/(?:zh-hans\/|zh-hant\/)?(?:play|leaderboard|news|challenges)$/.test(path) ||
    /^\/historical-xiangqi(?:\/games)?$/.test(path) ||
    path === '/players/teams/chinese-taipei' ||
    url.searchParams.has('page')
  )
    return false;
  return (
    literals.has(path) ||
    inlinePatterns.some((pattern) => pattern.test(path)) ||
    prefixes.some((prefix) => path.startsWith(prefix) && path.length > prefix.length) ||
    parsers.some((parse) => parse(path) !== null) ||
    analysisVariantFromPath(path) !== null ||
    editorVariantFromPath(path) !== null
  );
}

afterEach(() => {
  vi.doUnmock('./streamers-data.js');
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('navigation and news route conformance', () => {
  it.each([false, true])(
    'routes every nav list, with optional links enabled=%s',
    async (enabled) => {
      vi.resetModules();
      vi.stubEnv('VITE_SHOW_ENGINE_LAB_NAV', enabled ? 'true' : 'false');
      vi.stubEnv('VITE_CORRESPONDENCE_ENABLED', 'true');
      vi.doMock('./streamers-data.js', () => ({
        STREAMERS: enabled ? [{ name: 'Streamer' }] : [],
      }));
      const nav = await import('./nav-items.js');
      // Discover every list/single-item export, including future lists. Constants
      // (e.g. the unused Discord invite) are not rendered nav destinations.
      const items = Object.values(nav)
        .filter((value) => typeof value === 'function')
        .flatMap((build) => {
          const result = build({ admin: true });
          const entries = Array.isArray(result) ? result : [result];
          return entries.flatMap((entry) =>
            'items' in entry ? entry.items : [entry],
          ) as NavItem[];
        });
      expect(items.length).toBeGreaterThan(50);
      expect(items.some((item) => item.href === '/streamer')).toBe(enabled);
      expect(items.some((item) => item.href === '/accounts')).toBe(true);
      const invalid = items
        .filter((item) => !item.external)
        .flatMap((item) =>
          SUPPORTED_LOCALES.map((locale) => localizedHref(item.href, locale)).filter(
            (href) => !isCanonicalDestination(href),
          ),
        );
      expect([...new Set(invalid)]).toEqual([]);
    },
  );

  it('routes every news destination in every supported locale, including scheduled entries', () => {
    const invalid = allAnnouncements().flatMap((entry) =>
      entry.href
        ? SUPPORTED_LOCALES.map((locale) => localizedHref(entry.href!, locale))
            .filter((href) => !isCanonicalDestination(href))
            .map((href) => `${entry.date}: ${href}`)
        : [],
    );
    expect(invalid).toEqual([]);
  });

  it.each([
    '/play',
    '/leaderboard?variant=xiangqi',
    '/news',
    '/zh-hans/challenges',
    '/historical-xiangqi/games',
    '/learn',
    '/lab',
    '/missing',
    '/zh-hans/missing',
    '/zh-hans/player',
    '/zh-hant/puzzles',
    '/analysis/unknown',
    '/editor/unknown',
    '/?page=play',
  ])('rejects redirect aliases and missing routes: %s', (href) => {
    expect(isCanonicalDestination(href)).toBe(false);
  });

  it.each([
    '/?play=computer&gameSpecId=jieqi',
    '/puzzles?mode=streak',
    '/zh-hans',
    '/zh-hant/rules/xiangqi',
    '/zh-hans/blog/pikafish',
    '/zh-hant/study/Ab12cd',
    '/player',
    '/player/rating-stats',
    '/learn/xiangqi',
    '/broadcast/xiangqi/2026-league-qualifier',
  ])('accepts canonical localized and query destinations: %s', (href) => {
    expect(isCanonicalDestination(href)).toBe(true);
  });
});
