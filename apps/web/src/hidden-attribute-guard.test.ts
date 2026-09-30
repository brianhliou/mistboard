// The `hidden` attribute loses to any author rule that sets `display`, so a
// toggled element with `display: flex` on its class stays visible. That was
// learned at least five times, one component at a time (lessons 42955fa,
// c830618, a1139c0, d037291, ea15648). app-base.css now carries one site-wide
// `[hidden] { display: none !important }`; this test keeps the rule there and
// keeps the one page entry (index.html -> main.ts; every other page, embeds
// included, is a lazy module under it) loading the stylesheet that holds it.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(HERE, rel), 'utf8');

describe('hidden attribute guard', () => {
  it('app-base.css hides [hidden] with !important', () => {
    const css = read('app-base.css');
    const rule = /\[hidden\][^{]*\{([^}]*)\}/.exec(css);
    expect(rule, 'no site-wide [hidden] rule in app-base.css').not.toBeNull();
    expect(rule?.[1]).toMatch(/display:\s*none\s*!important/);
  });

  it('the page entry loads app-base.css', () => {
    expect(read('main.ts')).toMatch(/^import '\.\/app-base\.css';/m);
  });
});
