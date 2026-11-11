#!/usr/bin/env node
// Study tag translations and checked person overlays (decision: 2026-11-06).
// Dry run by default; importing this module performs no requests.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve as stubCss } from './lib/stub-css-hooks.mjs';
import { repairStudyNameOverlays, studyPersonTag } from './lib/study-name-scripts.mjs';

registerHooks({ resolve: stubCss });
globalThis.window ??= {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
  location: { pathname: '/', search: '', origin: 'https://mistboard.com' },
};
globalThis.localStorage ??= globalThis.window.localStorage;
globalThis.document ??= {
  documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: {} },
  createElement: () => ({
    style: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    append() {},
  }),
  addEventListener() {},
};

const args = process.argv.slice(2);
const argOf = (k, d = '') => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : (args[i + 1] ?? d);
};
const BASE = argOf('base', 'http://127.0.0.1:3011');
const STUDY = argOf('study');
const WRITE = args.includes('--write');
const LANGS = ['zh-Hans', 'zh-Hant'];
/** Only the tags that carry language. A date is a date; a result is 1-0. */
const TRANSLATABLE = ['red', 'black', 'event'];

const stable = (v) =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v ?? null);

async function main() {
  if (!STUDY) throw new Error('need --study <id>');
  const { hasTranslation, translateArticleText } = await import('../apps/web/src/article-i18n.ts');
  const response = await fetch(`${BASE}/api/studies/${STUDY}`);
  if (!response.ok) throw new Error(`study read returned ${response.status}`);
  const study = await response.json();
  if (!study?.chapters) throw new Error('study has no chapters');
  let changed = 0;
  for (const chapter of study.chapters) {
    if (chapter.variant !== 'xiangqi') continue;
    const i18n = JSON.parse(JSON.stringify(chapter.i18n ?? {}));
    for (const locale of LANGS) {
      for (const key of TRANSLATABLE) {
        const source = chapter.tags?.[key];
        if (!source) continue;
        const translated = hasTranslation(locale, source)
          ? translateArticleText(locale, source)
          : undefined;
        const value =
          key === 'event'
            ? translated
            : studyPersonTag(source, translated ?? i18n[locale]?.tags?.[key], locale);
        if (!value || (value === source && !translated && !i18n[locale]?.tags?.[key])) continue;
        i18n[locale] ??= {};
        i18n[locale].tags = { ...i18n[locale].tags, [key]: value };
      }
    }
    const { next } = repairStudyNameOverlays({ ...chapter, i18n });
    const overlayChanged = stable(next.i18n) !== stable(chapter.i18n ?? {});
    const rootChanged = stable(next.root) !== stable(chapter.root);
    if (!overlayChanged && !rootChanged) continue;
    changed += 1;
    console.log(
      `~ ${chapter.id}: Chinese person overlays${rootChanged ? ' and comment translations' : ''}`,
    );
    if (!WRITE) continue;
    const cookie = readFileSync(
      argOf('cookie', join(homedir(), '.mistboard-cookie')),
      'utf8',
    ).trim();
    const patch = {
      ...(overlayChanged ? { name: chapter.name, i18n: next.i18n } : {}),
      ...(rootChanged ? { root: next.root, baseVersion: chapter.version } : {}),
    };
    const res = await fetch(`${BASE}/api/studies/${STUDY}/chapters/${chapter.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`PATCH ${chapter.id} returned ${res.status}`);
    const verifiedResponse = await fetch(`${BASE}/api/studies/${STUDY}`);
    if (!verifiedResponse.ok) throw new Error('study verification read failed');
    const verified = (await verifiedResponse.json()).chapters?.find(
      (item) => item.id === chapter.id,
    );
    if (
      !verified ||
      (overlayChanged && stable(verified.i18n) !== stable(next.i18n)) ||
      (rootChanged && stable(verified.root) !== stable(next.root))
    ) {
      throw new Error(`chapter ${chapter.id} did not retain the requested overlays`);
    }
  }
  console.log(`${changed} chapters ${WRITE ? 'updated' : 'would change'}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
