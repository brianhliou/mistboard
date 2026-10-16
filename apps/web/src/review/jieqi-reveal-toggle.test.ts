import { STANDARD_JIEQI_DEAL } from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import { mountJieqiReview } from './jieqi-review.js';

// The jieqi review board is masked as-played: a piece nobody moved is still a "?",
// which is what makes the review honest about what each player could see. The menu's
// Reveal item is the deliberate opt-out, and it is the ONLY way to see the deal —
// the default must survive a mount, a flip, and a round trip through the toggle.

afterEach(() => {
  document.body.replaceChildren();
});

function mountReview(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  mountJieqiReview(root, 'room-reveal', STANDARD_JIEQI_DEAL, {
    ariaLabel: 'test',
    title: 'Jieqi',
    summary: 'test',
    moves: [],
    // No engine analysis: this test is about what the board discloses.
    analysis: null,
  });
  return root;
}

function boardHtml(root: HTMLElement): string {
  return root.querySelector('.jieqi-board')?.innerHTML ?? '';
}

function menuItem(root: HTMLElement, label: string): HTMLButtonElement | null {
  for (const button of root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')) {
    if (button.querySelector('.move-nav-menu__item-label')?.textContent === label) return button;
  }
  return null;
}

function openMenu(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.move-nav-bar__menu-button')?.click();
}

describe('jieqi review reveal toggle', () => {
  it('masks the deal until the menu item asks for it, and re-masks on the way back', () => {
    const root = mountReview();

    // Opening position: the 30 dealt pieces are face-down, both generals face-up.
    expect(boardHtml(root)).toContain('hidden piece');
    expect(boardHtml(root)).toContain('red general');
    expect(boardHtml(root)).not.toContain('red chariot');

    openMenu(root);
    const reveal = menuItem(root, 'Reveal identities');
    expect(reveal).not.toBeNull();
    reveal?.click();

    // Revealed: the deal is on the board and nothing is left shrouded.
    expect(boardHtml(root)).toContain('red chariot');
    expect(boardHtml(root)).not.toContain('hidden piece');

    // The label states what the next click does, so the row is readable as a
    // switch rather than a one-way action.
    openMenu(root);
    const hide = menuItem(root, 'Hide identities');
    expect(hide).not.toBeNull();
    expect(menuItem(root, 'Reveal identities')).toBeNull();
    hide?.click();

    expect(boardHtml(root)).toContain('hidden piece');
    expect(boardHtml(root)).not.toContain('red chariot');
  });

  it('leaves the board masked when the menu is merely opened', () => {
    const root = mountReview();
    openMenu(root);
    expect(boardHtml(root)).toContain('hidden piece');
    expect(boardHtml(root)).not.toContain('red chariot');
  });
});
