#!/usr/bin/env node
// Descender clip check: crawls a running web pair and flags text whose glyph
// ink (descenders of g/j/p/q/y, or the tops of accents and CJK) falls outside
// the box of an ancestor that clips its overflow. The usual cause is a tight
// line-height (1.1-1.25) on an element with overflow: hidden for an ellipsis
// or a line clamp: the line box is shorter than the font's glyph box, so the
// clip cuts the bottom of the g. See apps/web/src/css-descender-clip.test.ts
// for the static guard over the stylesheets.
//
// The check is content-independent: it measures a probe string in each text
// run's font, so a clipped box is flagged even when today's text has no
// descender (the next string will).
//
//   MISTBOARD_WEB_URL=http://127.0.0.1:3380 node scripts/descender-clip-check.mjs
//     [--email qa@example.com]   sign in with a dev code first
//     [--state /tmp/s.json]      reuse a saved sign-in (written after --email)
//     [--max-pages 60]           per viewport
//     [--paths /,/play,/rules]   seed paths (default: the main templates)
//     [--verbose]                list the templates visited
//     [--engine webkit]          iPhone's engine; it snaps line metrics to
//                                whole pixels, so it clips where Chromium
//                                does not (default: chromium)
//
// On demand only; not part of CI. Exit 1 when anything clips.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { webkit } from '@playwright/test';

import { launchChromium } from './lib/launch-browser.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const baseUrl = (process.env.MISTBOARD_WEB_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const email = arg('email', null);
const statePath = arg('state', null);
const maxPages = Number(arg('max-pages', '60'));
const engine = arg('engine', 'chromium');
const seeds = arg(
  'paths',
  [
    '/',
    '/play',
    '/watch',
    '/broadcast',
    '/learn',
    '/rules',
    '/puzzles',
    '/study',
    '/correspondence',
    '/forum',
    '/players',
    '/leaderboard',
    '/news',
    '/bots',
    '/practice',
    '/games',
    '/champions',
    '/account',
    '/inbox',
    '/zh-hans/',
  ].join(','),
).split(',');

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 860 },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];

// A path's template: the first segment and the depth. Up to three pages per
// template are visited (a rules page, a player page, a study), which covers
// each layout without walking every slug.
const PAGES_PER_TEMPLATE = 3;
function templateOf(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  return `/${segs[0] ?? ''}#${Math.min(segs.length, 4)}`;
}

// Runs in the page (page.evaluate). Returns one finding per clipped text run.
export function findClippedText() {
  // Descenders of the Latin face, and the tallest glyphs the site sets on a
  // line: CJK (zh pages, Chinese names) and Vietnamese capitals with marks.
  const PROBES = ['gjpqy', 'dÉ中國'];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const metricCache = new Map();
  const metricsFor = (style) => {
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    let m = metricCache.get(font);
    if (!m) {
      ctx.font = font;
      const down = ctx.measureText(PROBES[0]);
      const up = ctx.measureText(PROBES[1]);
      m = {
        fontAscent: down.fontBoundingBoxAscent,
        fontDescent: down.fontBoundingBoxDescent,
        inkDescent: down.actualBoundingBoxDescent,
        inkAscent: up.actualBoundingBoxAscent,
      };
      metricCache.set(font, m);
    }
    return m;
  };
  const clipAncestor = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowY === 'hidden' || s.overflowY === 'clip') return a;
      // A scroller is meant to cut the text at its edge, so the walk stops
      // there; one that overflows by a few px is a clip in practice (or a
      // spurious scrollbar).
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
        const spill = a.scrollHeight - a.clientHeight;
        return spill > 0 && spill < 4 ? a : null;
      }
    }
    return null;
  };
  // Only a box whose line boxes fit but whose ink spills is this bug: a box
  // whose content overflows by more than a couple of px is a scroller, a
  // clamp or a crop, and text at its edge is cut on purpose.
  const linesFit = (clip) => {
    const style = getComputedStyle(clip);
    if (style.webkitLineClamp && style.webkitLineClamp !== 'none') return true;
    return clip.scrollHeight - clip.clientHeight <= 2;
  };
  const describe = (el) => {
    const cls =
      typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3) : [];
    return `${el.tagName.toLowerCase()}${cls.map((c) => `.${c}`).join('')}`;
  };
  const findings = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (el.closest('svg, canvas, [aria-hidden="true"], .sr-only, .visually-hidden')) continue;
    const clip = clipAncestor(el);
    if (!clip || !linesFit(clip)) continue;
    const box = clip.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue; // visually-hidden patterns
    const cs = getComputedStyle(clip);
    const clipTop = box.top + Number.parseFloat(cs.borderTopWidth);
    const clipBottom = box.bottom - Number.parseFloat(cs.borderBottomWidth);
    const m = metricsFor(style);
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const mid = (r.top + r.bottom) / 2;
      if (mid < clipTop || mid > clipBottom) continue; // line clamped away on purpose
      const baseline = r.bottom - m.fontDescent;
      const inkBottom = baseline + m.inkDescent;
      const inkTop = baseline - m.inkAscent;
      const cutBottom = inkBottom - clipBottom;
      const cutTop = clipTop - inkTop;
      const cut = Math.max(cutBottom, cutTop);
      if (cut > 0.25) {
        seen.add(el);
        findings.push({
          text: describe(el),
          clip: clip === el ? 'self' : describe(clip),
          sample: node.textContent.trim().slice(0, 40),
          edge: cutBottom >= cutTop ? 'bottom' : 'top',
          cutPx: Math.round(cut * 100) / 100,
          lineHeight: style.lineHeight,
          fontSize: style.fontSize,
        });
        break;
      }
    }
  }
  return findings;
}

async function signIn(page) {
  await page.goto(`${baseUrl}/account?tab=login`, { waitUntil: 'networkidle' });
  await page.locator('input[name=email]').fill(email);
  await page.locator('form.account-form button[type=submit]').click();
  await page.locator('input[name=code]:visible').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('input[name=code]').press('Enter');
  await page.locator('.account-nav-trigger').waitFor({ state: 'attached', timeout: 8000 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const browser = engine === 'webkit' ? await webkit.launch() : await launchChromium();
  const all = new Map();
  let storageState = statePath && existsSync(statePath) ? statePath : undefined;
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile ?? false,
        hasTouch: vp.hasTouch ?? false,
        deviceScaleFactor: vp.deviceScaleFactor ?? 1,
        storageState,
      });
      const page = await context.newPage();
      if (email && !storageState) {
        await signIn(page);
        storageState = await context.storageState(statePath ? { path: statePath } : {});
      }
      const queue = [...seeds];
      const visited = new Set();
      const perTemplate = new Map();
      let pages = 0;
      while (queue.length > 0 && pages < maxPages) {
        const path = queue.shift();
        const { pathname } = new URL(path, baseUrl);
        const tpl = templateOf(pathname);
        if (visited.has(pathname) || (perTemplate.get(tpl) ?? 0) >= PAGES_PER_TEMPLATE) continue;
        visited.add(pathname);
        perTemplate.set(tpl, (perTemplate.get(tpl) ?? 0) + 1);
        pages += 1;
        try {
          await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle', timeout: 20000 });
        } catch {
          await page.waitForTimeout(1500);
        }
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        const findings = await page.evaluate(findClippedText);
        for (const f of findings) {
          const key = `${f.text} <- ${f.clip}`;
          const prev = all.get(key) ?? { ...f, where: new Set() };
          prev.where.add(`${vp.name} ${path}`);
          all.set(key, prev);
        }
        const links = await page.evaluate(
          (origin) =>
            [...document.querySelectorAll('a[href]')]
              .map((a) => new URL(a.getAttribute('href'), location.href))
              .filter((u) => u.origin === origin && !u.pathname.startsWith('/api'))
              .map((u) => u.pathname + u.search),
          new URL(baseUrl).origin,
        );
        for (const link of links) {
          const { pathname } = new URL(link, baseUrl);
          if (
            !visited.has(pathname) &&
            (perTemplate.get(templateOf(pathname)) ?? 0) < PAGES_PER_TEMPLATE
          )
            queue.push(link);
        }
      }
      console.error(`${vp.name}: ${pages} pages, ${perTemplate.size} templates`);
      if (argv.includes('--verbose')) console.error([...visited].join(' '));
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const rows = [...all.values()].sort((a, b) => b.cutPx - a.cutPx);
  for (const r of rows) {
    console.log(
      `${r.cutPx.toFixed(2)}px ${r.edge}  ${r.text}  (clip: ${r.clip}, lh ${r.lineHeight} / ${r.fontSize})  "${r.sample}"  @ ${[...r.where].slice(0, 3).join(', ')}`,
    );
  }
  console.error(`${rows.length} clipped text runs`);
  process.exit(rows.length > 0 ? 1 : 0);
}
