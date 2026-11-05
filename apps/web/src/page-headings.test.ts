// @vitest-environment-options {"width":390}
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_VARIANTS } from './analysis-catalog.js';
import { mountAnalysisPage } from './analysis-page.js';
import { EDITOR_VARIANTS } from './editor/editor-catalog.js';
import { mountEditorPage } from './editor/editor-page.js';
import { mountForum } from './forum.js';
import { ensureLocaleCatalog } from './i18n/catalog.js';

type HappyWindow = { happyDOM: { setViewport(size: { width: number; height: number }): void } };

let root: HTMLElement;
let styles: HTMLStyleElement;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/forum/categories')) return Response.json({ categories: [] });
      if (url.startsWith('/api/forum/topics')) return Response.json({ topics: [] });
      if (url.startsWith('/api/auth/me')) return Response.json({ user: null });
      return new Response('{}', { status: 404 });
    }),
  );
  styles = document.createElement('style');
  styles.textContent = readFileSync('src/site-shell.css', 'utf8');
  document.head.append(styles);
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  styles.remove();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function expectHiddenHeading(text?: string): void {
  const headings = root.querySelectorAll('h1');
  expect(headings).toHaveLength(1);
  const heading = headings[0]!;
  expect(heading.textContent?.trim()).not.toBe('');
  if (text) expect(heading.textContent).toBe(text);
  // Read the real shared stylesheet: the heading remains accessible but
  // cannot take up a row or add spacing to either board tool's layout.
  expect(heading.hidden).toBe(false);
  const computed = getComputedStyle(heading);
  expect(computed.display).not.toBe('none');
  expect(computed.position).toBe('absolute');
  expect(computed.width).toBe('1px');
  expect(computed.height).toBe('1px');
  expect(computed.margin).toBe('0px');
  expect(computed.padding).toBe('0px');
  expect(computed.overflow).toBe('hidden');
  expect(computed.clipPath).toBe('inset(50%)');
}

describe('mounted page headings', () => {
  for (const variant of ANALYSIS_VARIANTS) {
    it(`gives ${variant.id} analysis exactly one hidden h1`, async () => {
      window.history.replaceState(null, '', `/analysis/${variant.id}`);
      await mountAnalysisPage(root, variant.id);
      expectHiddenHeading();
    });
  }

  for (const variant of EDITOR_VARIANTS) {
    it(`gives the ${variant.id} editor exactly one hidden h1`, () => {
      window.history.replaceState(null, '', `/editor/${variant.id}`);
      mountEditorPage(root, variant.id);
      expectHiddenHeading();
    });
  }

  it.each([
    ['en', '', 'Xiangqi analysis', 'Xiangqi board editor'],
    ['zh-Hans', '/zh-hans', '象棋分析', '象棋棋盘编辑器'],
    ['zh-Hant', '/zh-hant', '象棋分析', '象棋棋盤編輯器'],
  ] as const)(
    'localizes both xiangqi tool headings in %s',
    async (locale, prefix, analysis, editor) => {
      await ensureLocaleCatalog(locale);
      window.history.replaceState(null, '', `${prefix}/analysis/xiangqi`);
      await mountAnalysisPage(root, 'xiangqi');
      expectHiddenHeading(analysis);
      window.history.replaceState(null, '', `${prefix}/editor/xiangqi`);
      mountEditorPage(root, 'xiangqi');
      expectHiddenHeading(editor);
    },
  );

  // The two forum headers swap at 600px, so each width renders its own h1.
  it.each([
    [390, 'Forum'],
    [1280, 'Mistboard Forum'],
  ])('renders exactly one forum h1 at %ipx', async (width, text) => {
    styles.textContent += readFileSync('src/forum.css', 'utf8');
    (window as unknown as HappyWindow).happyDOM.setViewport({ width, height: 800 });
    window.history.replaceState(null, '', '/forum');
    await mountForum(root);
    const rendered = [...root.querySelectorAll('h1')].filter((heading) =>
      heading.closest('.forum-desktop-only, .forum-phone-only')
        ? getComputedStyle(heading.closest('.forum-desktop-only, .forum-phone-only')!).display !==
          'none'
        : true,
    );
    expect(rendered.map((heading) => heading.textContent)).toEqual([text]);
  });
});
