import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The phone review info sheet (#655) is CSS-gated: the ☰ row and the sheet only
// show at 600px and under, where the rail cards leave the page. Wider screens
// must keep the rail exactly as it was.

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(readFileSync(resolve(__dirname, 'review-info-sheet.css'), 'utf-8'));
const analysisCss = stripComments(
  readFileSync(resolve(__dirname, 'analysis-phone-bar.css'), 'utf-8'),
);

function block(media: string, source = css): string {
  const at = source.indexOf(`@media ${media}`);
  expect(at).toBeGreaterThanOrEqual(0);
  let depth = 0;
  const start = source.indexOf('{', at);
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start + 1, i);
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
    const wide = block('(min-width: 601px)').replace(/\s+/g, ' ');
    expect(
      rule(
        wide,
        '.move-nav-menu__item[data-review-info], .move-nav-menu__item[data-review-engine]',
      ),
    ).toContain('display: none;');
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

  // #619: one screen, no scroll. Only the copies on the page hide (scoped to
  // the shell), so the same blocks still show once lent to the sheet.
  // Round 3: the engine card never shows on the phone page, running or not;
  // the bar above the board carries its eval, line and depth, and a running
  // card under the move list scrolled the page.
  it('takes the chart, summary, explorer and engine card off the phone page', () => {
    const phone = block('(max-width: 600px)');
    const hidden = phone.slice(0, phone.indexOf('{', phone.indexOf('.review-underboard-panel')));
    for (const selector of [
      '.has-review-info-sheet .review-shell .review-underboard-panel',
      '.has-review-info-sheet .review-shell .review-analysis-summary-slot',
      '.has-review-info-sheet .review-shell [data-col1-area="extra"]',
      '.has-review-info-sheet .review-shell .review-rail-main > .engine-panel,',
    ]) {
      expect(hidden, selector).toContain(selector);
    }
    expect(hidden).not.toContain('engine-panel--on');
    const body = phone.slice(phone.indexOf('{', phone.indexOf('.review-underboard-panel')) + 1);
    expect(body.slice(0, body.indexOf('}'))).toContain('display: none;');
    expect(rule(phone, '.review-info-sheet__body > :empty')).toContain('display: none;');
  });

  it('turns the move list into the analysis board strip on the phone review', () => {
    // One space per gap, so the check survives Biome wrapping a long selector.
    const phone = block('(max-width: 600px)', analysisCss).replace(/\s+/g, ' ');
    const shared =
      ':is(.review-shell.review-shell--analysis, .has-review-info-sheet .review-shell)';
    const rowsAt = phone.indexOf(`${shared} .review-shell__cluster--col1-stack`);
    expect(rowsAt).toBeGreaterThanOrEqual(0);
    const rows = phone.slice(phone.indexOf('{', rowsAt) + 1);
    expect(rows.slice(0, rows.indexOf('}'))).toContain('flex-direction: row;');
    expect(rule(phone, `${shared} .review-rail-main .review-move-list__row`)).toContain(
      'display: contents;',
    );
  });

  // #619: the Engine analysis row and the Game info sheet's tab filter are
  // phone only; tablet and desktop keep the engine card's switch and every tab.
  // Round 3 moved the engine switch from a gauge in the arrow bar into ☰.
  it('shows the Engine analysis row and trims the Game info tabs at 600px and under only', () => {
    // The wide-screen hide is pinned in the first test of this file.
    expect(css).not.toContain('review-engine-button');
    expect(css).not.toContain('review-controls--engine');
    const phone = block('(max-width: 600px)').replace(/\s+/g, ' ');
    const tabs =
      '.review-info-sheet[data-review-info="game"] .review-underboard-tab:not([data-tab="times"], [data-tab="share"])';
    expect(rule(phone, tabs)).toContain('display: none;');
  });

  it('keeps the analysis strip off the page above 600px', () => {
    const strip = stripComments(
      readFileSync(resolve(__dirname, 'review-phone-analysis.css'), 'utf-8'),
    );
    expect(rule(strip.slice(0, strip.indexOf('@media')), '.review-phone-analysis')).toContain(
      'display: none;',
    );
    const phone = block('(max-width: 600px)', strip);
    expect(rule(phone, '.review-phone-analysis[hidden]')).toContain('display: none;');
    expect(rule(phone, '.review-phone-analysis .advantage-chart__svg')).toContain('height: 36px;');
  });

  it('keeps the engine bar clear of the top seat label on a game review', () => {
    // The top seat sits in the cluster's top padding (seat-labels.css); the bar
    // moves up into it and keeps the seat's room between itself and the board.
    const bar = stripComments(readFileSync(resolve(__dirname, 'engine-bar.css'), 'utf-8'));
    const phone = block('(max-width: 600px)', bar.slice(bar.lastIndexOf('@media')));
    expect(
      rule(phone, '.review-shell__cluster:has(.review-board-wrap--seated) .analysis-engine-bar'),
    ).toContain('margin: -26px 0 16px;');
    expect(
      rule(phone, '.review-shell__cluster:has(.review-board-wrap--captures) .analysis-engine-bar'),
    ).toContain('margin: -28px 0 18px;');
  });
  // Round 3 (Brian, 2026-10-28: "make it a little bit taller so there's more
  // space inside"): the Chat sheet is most of the screen, its messages fill it
  // and the input stays at its foot; Game info keeps the 85vh cap.
  it('opens the Chat sheet tall with the message list filling it', () => {
    const phone = block('(max-width: 600px)').replace(/\s+/g, ' ');
    const panel = rule(
      phone,
      '.review-info-sheet[data-review-info="chat"] .review-info-sheet__panel',
    );
    expect(panel).toContain('height: 88dvh;');
    expect(panel).toContain('max-height: none;');
    expect(panel).toContain('overflow: hidden;');
    expect(
      rule(phone, '.review-info-sheet[data-review-info="chat"] .review-info-sheet__body'),
    ).toContain('flex: 1 1 auto;');
    const list = rule(phone, '.review-info-sheet[data-review-info="chat"] .review-spectator-chat');
    expect(list).toContain('flex: 1 1 auto;');
    expect(list).toContain('min-height: 0;');
    expect(rule(phone, '.review-info-sheet__panel')).toContain('max-height: 85vh;');
  });

  it('shows the unread chat dot on ☰ and the Chat row at 600px and under only', () => {
    const phone = block('(max-width: 600px)').replace(/\s+/g, ' ');
    const dot = rule(
      phone,
      '.move-nav-bar[data-chat-unread] .move-nav-menu__item[data-review-info="chat"]::after',
    );
    expect(dot).toContain('border-radius: 50%;');
    expect(phone).toContain('.move-nav-bar[data-chat-unread] .move-nav-bar__menu-button::after');
    expect(css.slice(0, css.indexOf('@media (max-width: 600px)'))).not.toContain(
      'data-chat-unread',
    );
  });
});
