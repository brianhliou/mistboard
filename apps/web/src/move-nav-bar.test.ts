import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMoveNavBar,
  installMoveNavKeyboard,
  moveNavActionForKey,
  moveNavKeyAction,
  syncMoveNavMenu,
} from './move-nav-bar.js';

afterEach(() => {
  document.body.replaceChildren();
});

function key(init: KeyboardEventInit & { key: string }, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('move-nav bar', () => {
  it('draws five equal columns: first, prev, next, last, menu', () => {
    const bar = createMoveNavBar({ menuItems: [{ label: 'Flip board', icon: '<svg></svg>' }] });
    const columns = [...bar.el.querySelectorAll<HTMLButtonElement>(':scope > button')];
    expect(columns.map((b) => b.dataset.replay ?? 'menu')).toEqual([
      'first',
      'prev',
      'next',
      'latest',
      'menu',
    ]);
    expect(columns.map((b) => b.getAttribute('aria-label'))).toEqual([
      'First move',
      'Previous move',
      'Next move',
      'Last move',
      'Menu',
    ]);
  });

  it('marks only live bars for the glow', () => {
    expect(createMoveNavBar().el.hasAttribute('data-live-glow')).toBe(false);
    expect(createMoveNavBar({ liveGlow: true }).el.hasAttribute('data-live-glow')).toBe(true);
  });

  it('setBounds disables the ends it has reached', () => {
    const bar = createMoveNavBar();
    bar.setBounds({ atStart: true, atEnd: false });
    expect(bar.buttons.first.disabled).toBe(true);
    expect(bar.buttons.prev.disabled).toBe(true);
    expect(bar.buttons.next.disabled).toBe(false);
    expect(bar.buttons.latest.disabled).toBe(false);
    bar.setBounds({ atStart: false, atEnd: true });
    expect(bar.buttons.prev.disabled).toBe(false);
    expect(bar.buttons.latest.disabled).toBe(true);
  });

  it('runs the step handlers', () => {
    const onPrev = vi.fn();
    const onLast = vi.fn();
    const bar = createMoveNavBar({ onPrev, onLast });
    bar.buttons.prev.click();
    bar.buttons.latest.click();
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onLast).toHaveBeenCalledTimes(1);
  });

  it('opens and closes the menu; a row runs and closes it; Escape and an outside click close it', () => {
    const onClick = vi.fn();
    const bar = createMoveNavBar({
      menuItems: [{ label: 'Flip board', icon: '<svg></svg>', onClick }],
    });
    document.body.append(bar.el);
    bar.menuButton?.click();
    expect(bar.isMenuOpen()).toBe(true);
    expect(bar.menuButton?.getAttribute('aria-expanded')).toBe('true');
    bar.menu?.querySelector<HTMLButtonElement>('.move-nav-menu__item')?.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(bar.isMenuOpen()).toBe(false);

    bar.openMenu();
    key({ key: 'Escape' });
    expect(bar.isMenuOpen()).toBe(false);

    bar.openMenu();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(bar.isMenuOpen()).toBe(false);
  });

  it('shows a toggle row pressed, and re-reads labels on open', () => {
    let on = true;
    const bar = createMoveNavBar({
      menuItems: [
        {
          label: () => (on ? 'Hide' : 'Show'),
          icon: '<svg></svg>',
          pressed: () => on,
          onClick: () => {
            on = !on;
          },
        },
      ],
    });
    const row = bar.menu?.querySelector<HTMLButtonElement>('.move-nav-menu__item');
    bar.openMenu();
    expect(row?.getAttribute('aria-pressed')).toBe('true');
    expect(row?.textContent).toBe('Hide');
    row?.click();
    bar.openMenu();
    expect(row?.getAttribute('aria-pressed')).toBe('false');
    expect(row?.textContent).toBe('Show');
  });

  it('disables the menu button while every row is hidden, and re-enables on sync', () => {
    const bar = createMoveNavBar({
      menuItems: [
        {
          label: 'Analyse',
          icon: '<svg></svg>',
          href: '',
          dataset: { replayAnalysis: '' },
          hidden: true,
        },
      ],
    });
    document.body.append(bar.el);
    expect(bar.menuButton?.disabled).toBe(true);
    const link = bar.el.querySelector<HTMLAnchorElement>('a[data-replay-analysis]');
    expect(link).not.toBeNull();
    if (link) link.hidden = false;
    syncMoveNavMenu(link);
    expect(bar.menuButton?.disabled).toBe(false);
  });

  it('drops the menu column when asked (TV)', () => {
    const bar = createMoveNavBar({ menu: false });
    expect(bar.menuButton).toBeNull();
    expect(bar.el.querySelectorAll(':scope > button')).toHaveLength(4);
    expect(bar.el.classList.contains('move-nav-bar--no-menu')).toBe(true);
  });
});

describe('move-nav keyboard map', () => {
  it('maps arrows plus Home and End', () => {
    expect(moveNavActionForKey('ArrowLeft')).toBe('prev');
    expect(moveNavActionForKey('ArrowRight')).toBe('next');
    expect(moveNavActionForKey('ArrowUp')).toBe('first');
    expect(moveNavActionForKey('Home')).toBe('first');
    expect(moveNavActionForKey('ArrowDown')).toBe('latest');
    expect(moveNavActionForKey('End')).toBe('latest');
    expect(moveNavActionForKey('x')).toBeNull();
  });

  it('stands down for modifiers, typing targets and a handled key', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const actions: Array<string | null> = [];
    const controller = new AbortController();
    document.addEventListener('keydown', (event) => actions.push(moveNavKeyAction(event)), {
      signal: controller.signal,
    });
    key({ key: 'ArrowLeft' });
    key({ key: 'ArrowLeft', shiftKey: true });
    key({ key: 'ArrowLeft', metaKey: true });
    key({ key: 'ArrowLeft' }, input);
    expect(actions).toEqual(['prev', null, null, null]);
    controller.abort();
  });

  it('never double-steps when two steppers share a page', () => {
    const controller = new AbortController();
    const first = { stepBack: vi.fn(), stepForward: vi.fn(), toStart: vi.fn(), toEnd: vi.fn() };
    const second = { stepBack: vi.fn(), stepForward: vi.fn(), toStart: vi.fn(), toEnd: vi.fn() };
    installMoveNavKeyboard(first, controller.signal);
    installMoveNavKeyboard(second, controller.signal);
    key({ key: 'ArrowRight' });
    key({ key: 'End' });
    expect(first.stepForward).toHaveBeenCalledTimes(1);
    expect(first.toEnd).toHaveBeenCalledTimes(1);
    expect(second.stepForward).not.toHaveBeenCalled();
    expect(second.toEnd).not.toHaveBeenCalled();
    controller.abort();
  });
});

describe('move-nav bar review styling', () => {
  const css = readFileSync('src/review/review-shell.css', 'utf8');
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  };

  it('closes the detached review bar as a bordered, rounded card on the band fill', () => {
    // Detached below the analyse table (game review, analysis), the bar keeps the
    // live band's tinted fill but needs its own full border and the panel's radius,
    // or it reads as a bare pale strip on the page.
    const card = block('.review-rail-mainwrap + .review-controls');
    expect(card).toContain('border: 1px solid var(--site-border)');
    expect(card).toContain('border-radius: 6px');
    expect(card).not.toContain('background');
  });

  it('keeps the fused study strip open at the bottom', () => {
    const fused = block('.review-rail-main > .review-controls');
    expect(fused).toContain('border-bottom: 0');
    expect(fused).not.toContain('border-radius');
  });
});
