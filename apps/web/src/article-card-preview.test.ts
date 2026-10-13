import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { buildArticlesIndex } from './articles.js';

// `npm run articles:cards` runs this file with ARTICLE_CARDS_PREVIEW=1 and
// writes the blog index's real cards (date pill, star, art) to one page at the
// narrowest, a middle and the widest card size the index draws (211, 260 and
// 400px, measured 2026-10-10), so new card art is judged as a reader meets it.
// ARTICLE_CARDS=slug,slug narrows it to those cards. Skipped otherwise.

const SRC = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(SRC, '..', 'public');
const WIDTHS = [211, 260, 400];
const STYLES = ['app-base.css', 'styles.css', 'theme.css', 'articles.css'];

it.skipIf(process.env.ARTICLE_CARDS_PREVIEW !== '1')('writes the article card preview', () => {
  const only = new Set((process.env.ARTICLE_CARDS ?? '').split(',').filter(Boolean));
  const rows: string[] = [];
  for (const view of ['mistboard', 'community'] as const) {
    for (const item of buildArticlesIndex(undefined, view).querySelectorAll(
      '.articles-index-item',
    )) {
      const slug =
        (item.querySelector('a')?.getAttribute('href') ?? '').split('?')[0]!.split('/').pop() ?? '';
      if (only.size > 0 && !only.has(slug)) continue;
      const clash = item.querySelector('[data-tag-clash]')?.getAttribute('data-tag-clash');
      // Root-relative asset paths (piece sets, markers) point into public/.
      const html = item.outerHTML.replace(/(href|src)="\/(?!\/)/g, `$1="file://${PUBLIC}/`);
      const cells = WIDTHS.map(
        (w) => `<ul class="preview-cell" style="width:${w}px">${html}</ul>`,
      ).join('');
      rows.push(
        `<section><h2>${slug}${clash ? ` <em>tag clash: ${clash}</em>` : ''}</h2><div class="preview-row">${cells}</div></section>`,
      );
    }
  }
  const links = STYLES.map(
    (file) => `<link rel="stylesheet" href="file://${join(SRC, file)}">`,
  ).join('');
  const page = `<!doctype html><meta charset="utf-8"><title>Article cards</title>${links}<style>body{padding:16px;background:var(--bg, #f6f1e7)}h2{font:600 14px system-ui;margin:24px 0 8px}h2 em{color:#c0392b;font-style:normal}.preview-row{display:flex;gap:16px;align-items:flex-start}.preview-cell{list-style:none;margin:0;padding:0;flex:none}</style>${rows.join('')}`;
  const out = join(tmpdir(), 'mistboard-article-cards.html');
  writeFileSync(out, page);
  console.log(`article cards: ${rows.length} written to ${out}`);
});
