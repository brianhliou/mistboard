import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The phone review info sheet (#655) is CSS-gated: the ☰ row and the sheet only
// show at 600px and under, where the rail cards leave the page. Wider screens
// must keep the rail exactly as it was.

const css = readFileSync(resolve(__dirname, 'review-info-sheet.css'), 'utf-8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function block(media: string): string {
  const at = css.indexOf(`@media ${media}`);
  expect(at).toBeGreaterThanOrEqual(0);
  let depth = 0;
  const start = css.indexOf('{', at);
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(start + 1, i);
  }
  return '';
}

function rule(scope: string, selector: string): string {
  const at = scope.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const body = scope.slice(scope.indexOf('{', at) + 1);
  return body.slice(0, body.indexOf('}'));
}

describe('review info sheet css', () => {
  it('hides the sheet and its menu row above 600px', () => {
    expect(rule(css, '.review-info-sheet')).toContain('display: none;');
    expect(rule(block('(min-width: 601px)'), '.move-nav-menu__item[data-review-info]')).toContain(
      'display: none;',
    );
  });

  it('takes the game card and chat off the phone page and shows the sheet over it', () => {
    const phone = block('(max-width: 600px)');
    expect(rule(phone, '.has-review-info-sheet .review-rail-group')).toContain('display: none;');
    const sheet = rule(phone, '.review-info-sheet');
    expect(sheet).toContain('position: fixed;');
    expect(sheet).toContain('display: block;');
    expect(rule(phone, '.review-info-sheet__panel')).toContain('overflow-y: auto;');
    expect(rule(phone, '.review-info-sheet__close')).toContain('min-height: 44px;');
  });
});
