// Build-time guard for prerendered pages: every stylesheet rule that would
// style the baked markup must arrive with the HTML.
//
// Vite splits each chunk's CSS out with the chunk, so a page whose layout lives
// in a lazily imported chunk (the articles chunk behind pages-static.ts, a
// widget module behind a route) paints its baked markup unstyled and snaps into
// place when that chunk lands. The asset links the prerender bakes come from a
// manifest walk that cannot see which dynamic import renders a page, so this
// checks the result instead of the walk: for each baked page, any rule in a
// built stylesheet the page does NOT link whose selector could match the page
// (every class it names is in the baked markup) is reported with the file it
// lives in. A rule scoped by a class the page never uses (`.current-games
// .fxq-piece`) cannot match and is ignored.
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';

/** Classes (`.x`) and ids (`#x`) a selector list requires, one array per
 *  comma-separated selector. Pseudo-class arguments (`:not(.x)`, `:is(.a, .b)`)
 *  are dropped: a negated or alternative class is not a requirement. */
export function selectorClassSets(selectorList) {
  const out = [];
  for (const raw of splitTopLevel(selectorList)) {
    const sel = stripPseudoArguments(raw.trim());
    if (!sel) continue;
    out.push([...sel.matchAll(/([.#])(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] + m[2]));
  }
  return out;
}

function splitTopLevel(list) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts;
}

function stripPseudoArguments(sel) {
  let out = '';
  let depth = 0;
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (depth === 0) out += ch;
    if (ch === ')') depth--;
  }
  // Attribute selectors can hold dots in their values (`[href$=".pdf"]`).
  return out.replace(/\[[^\]]*\]/g, '');
}

/** Every selector in a stylesheet that names a class or id, with what it needs.
 *  At-rule preludes (`@media …`, `@keyframes x`) are skipped; the rules nested
 *  in them are read like top-level ones. Keyframe steps carry no class. */
export function stylesheetSelectors(css) {
  const out = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/([^{};]+)\{/g)) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;
    for (const classes of selectorClassSets(prelude)) {
      if (classes.length) out.push({ selector: prelude, classes });
    }
  }
  return out;
}

/** Classes (`.x`) and ids (`#x`) an HTML fragment's elements carry. */
export function markupClasses(html) {
  const used = new Set();
  for (const m of html.matchAll(/\bclass="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) used.add(`.${c}`);
  }
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) used.add(`#${m[1]}`);
  return used;
}

/** Stylesheet hrefs a page links, relative to the site root. */
export function linkedStylesheets(html) {
  return [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)]
    .map((m) => m[0].match(/\bhref="\/?([^"]+)"/)?.[1])
    .filter((href) => href?.endsWith('.css'));
}

/**
 * Rules from stylesheets a page does not link that would style its markup.
 * `stylesheets` maps a root-relative href (`assets/x-123.css`) to its selectors
 * (from stylesheetSelectors). Returns one entry per unlinked stylesheet, with up
 * to `limit` of the selectors that match.
 */
export function unlinkedMatchingRules(pageHtml, stylesheets, { limit = 3 } = {}) {
  const linked = new Set(linkedStylesheets(pageHtml));
  const app = pageHtml.match(/<div id="app"[\s\S]*$/)?.[0] ?? pageHtml;
  const used = markupClasses(app);
  const misses = [];
  for (const [href, selectors] of stylesheets) {
    if (linked.has(href)) continue;
    const matching = [];
    for (const { selector, classes } of selectors) {
      if (classes.every((c) => used.has(c))) {
        if (!matching.includes(selector)) matching.push(selector);
        if (matching.length >= limit) break;
      }
    }
    if (matching.length) misses.push({ stylesheet: href, selectors: matching });
  }
  return misses;
}

/**
 * Runs the check over every baked page under `distDir` (any HTML whose #app is
 * not the empty shell). Returns one line per page and unlinked stylesheet.
 */
export async function prerenderedCssMisses(distDir) {
  const stylesheets = new Map();
  for (const file of await fs.readdir(join(distDir, 'assets'))) {
    if (!file.endsWith('.css')) continue;
    const css = await fs.readFile(join(distDir, 'assets', file), 'utf-8');
    stylesheets.set(`assets/${file}`, stylesheetSelectors(css));
  }
  const pages = [];
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'assets' && !entry.name.startsWith('.')) await walk(path);
      } else if (entry.name.endsWith('.html')) {
        pages.push(path);
      }
    }
  };
  await walk(distDir);
  const lines = [];
  let checked = 0;
  for (const page of pages.sort()) {
    const html = await fs.readFile(page, 'utf-8');
    if (!/<div id="app"[^>]*>(?!<\/div>)/.test(html)) continue;
    checked++;
    for (const miss of unlinkedMatchingRules(html, stylesheets)) {
      lines.push(`${relative(distDir, page)}: /${miss.stylesheet} (${miss.selectors.join(' | ')})`);
    }
  }
  return { pages: checked, lines };
}
