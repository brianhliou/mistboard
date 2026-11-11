import './puzzle-menu.css';
import { type I18nKey, t } from '../i18n/catalog.js';

export type PuzzleMenuPage = 'puzzles' | 'themes' | 'streak' | 'storm' | 'dashboard' | 'history';

const ITEMS: ReadonlyArray<{ page: PuzzleMenuPage; href: string; labelKey: I18nKey }> = [
  { page: 'puzzles', href: '/puzzles', labelKey: 'nav.puzzles' },
  { page: 'themes', href: '/puzzles/themes', labelKey: 'nav.puzzleThemes' },
  { page: 'streak', href: '/puzzles?mode=streak', labelKey: 'nav.puzzleStreak' },
  { page: 'storm', href: '/puzzles?mode=storm', labelKey: 'puzzle.stormTitle' },
  { page: 'dashboard', href: '/puzzles/dashboard', labelKey: 'puzzle.dashboardTitle' },
  { page: 'history', href: '/puzzles/history', labelKey: 'puzzle.historyTitle' },
];

/** Shared puzzle navigation. The caller identifies the page, including the run modes. */
export function renderPuzzleMenu(active: PuzzleMenuPage): HTMLElement {
  const menu = document.createElement('nav');
  menu.className = 'puzzle-menu';
  menu.setAttribute('aria-label', t('nav.puzzles'));
  for (const item of ITEMS) {
    if (item.page === 'dashboard') {
      const gap = document.createElement('span');
      gap.className = 'puzzle-menu__gap';
      gap.setAttribute('aria-hidden', 'true');
      menu.append(gap);
    }
    const link = document.createElement('a');
    link.className = 'puzzle-menu__link';
    link.href = item.href;
    link.textContent = t(item.labelKey);
    if (item.page === active) link.setAttribute('aria-current', 'page');
    menu.append(link);
  }
  // On a phone the menu is one scrolling row; bring the current page into view
  // once the strip is laid out, so it is never the item cut off at the edge.
  requestAnimationFrame(() => centreActivePuzzleMenuItem(menu));
  return menu;
}

/** Scroll a horizontal menu strip so its current item sits in the middle. No-op when nothing overflows. */
export function centreActivePuzzleMenuItem(menu: HTMLElement): void {
  if (menu.scrollWidth <= menu.clientWidth) return;
  const active = menu.querySelector<HTMLElement>('[aria-current="page"]');
  if (!active) return;
  const strip = menu.getBoundingClientRect();
  const item = active.getBoundingClientRect();
  const target = menu.scrollLeft + item.left - strip.left - (menu.clientWidth - item.width) / 2;
  menu.scrollLeft = Math.max(0, Math.min(target, menu.scrollWidth - menu.clientWidth));
}

/** Put any puzzle page beside the menu, or below its scrollable row on phones. */
export function renderPuzzleMenuLayout(active: PuzzleMenuPage, content: HTMLElement): HTMLElement {
  const layout = document.createElement('div');
  layout.className = 'puzzle-menu-layout';
  content.classList.add('puzzle-menu-content');
  layout.append(renderPuzzleMenu(active), content);
  return layout;
}
