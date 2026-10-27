/** Theme preferences and shared desktop/phone picker; the in-product glossary. */
import { XIANGQI_MOTIF_BY_ID, type XiangqiMotif, type XiangqiMotifId } from '@mistboard/game';
import { t } from '../i18n/catalog.js';

export type PuzzleThemeCount = XiangqiMotif & { count: number };
export type PuzzleThemeSettings = {
  id: XiangqiMotifId | null;
  options: readonly PuzzleThemeCount[];
  onChange: (id: XiangqiMotifId | null) => Promise<void>;
};

const THEME_STORAGE_KEY = 'mistboard:puzzles:theme';

export function parsePuzzleTheme(value: string | null): XiangqiMotifId | null {
  return value && XIANGQI_MOTIF_BY_ID.has(value as XiangqiMotifId)
    ? (value as XiangqiMotifId)
    : null;
}

export function loadPuzzleTheme(): XiangqiMotifId | null {
  try {
    return parsePuzzleTheme(window.localStorage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function savePuzzleTheme(id: XiangqiMotifId | null): void {
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, id ?? '');
  } catch {
    // Training works when storage is unavailable.
  }
}

export function puzzleThemesLink(): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = '/puzzles/themes';
  link.textContent = t('puzzle.browseThemes');
  return link;
}

export function puzzleThemePicker(settings: PuzzleThemeSettings, phone = false): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = phone ? 'puzzle-pm-row' : 'puzzle-field';
  if (phone) field.dataset.puzzleMenuRow = 'theme';
  const label = document.createElement('span');
  label.className = phone ? 'puzzle-pm-row__label' : '';
  label.textContent = t('puzzle.themeField');
  const select = document.createElement('select');
  select.className = 'puzzle-select';
  if (phone) select.dataset.puzzleMenu = 'theme';
  else select.dataset.puzzleTheme = 'true';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('puzzle.allThemes');
  select.append(all);
  for (const motif of settings.options) {
    const option = document.createElement('option');
    option.value = motif.id;
    option.textContent = `${motif.label} (${motif.count})`;
    option.disabled = motif.count === 0;
    select.append(option);
  }
  select.value = settings.id ?? '';
  select.addEventListener('change', () => {
    void settings.onChange(parsePuzzleTheme(select.value));
  });
  field.append(label, select);
  return field;
}

export function renderPuzzleThemesIndex(themes: readonly PuzzleThemeCount[]): HTMLElement {
  const main = document.createElement('main');
  main.className = 'puzzle-themes-index';
  const title = document.createElement('h1');
  title.className = 'site-section-heading';
  title.textContent = t('puzzle.themesTitle');
  const intro = document.createElement('p');
  intro.textContent = t('puzzle.themeIndexIntro');
  const all = document.createElement('a');
  all.href = '/puzzles?theme=';
  all.textContent = t('puzzle.allThemes');
  const grid = document.createElement('div');
  grid.className = 'puzzle-themes-grid';
  for (const motif of themes) {
    const card = document.createElement('article');
    card.className = 'puzzle-theme-entry';
    card.dataset.puzzleThemeCard = motif.id;
    const heading = document.createElement('h2');
    if (motif.count > 0) {
      const link = document.createElement('a');
      link.href = `/puzzles?theme=${encodeURIComponent(motif.id)}`;
      link.textContent = motif.label;
      heading.append(link);
    } else heading.textContent = motif.label;
    const name = document.createElement('p');
    name.className = 'puzzle-theme-name';
    const hanzi = document.createElement('span');
    hanzi.lang = 'zh-Hans';
    hanzi.textContent = motif.hanzi;
    name.append(hanzi, ` · ${motif.pinyin} · “${motif.literal}”`);
    const gloss = document.createElement('p');
    gloss.textContent = motif.gloss;
    const count = document.createElement('p');
    count.className = 'puzzle-theme-count';
    count.textContent =
      motif.count === 1
        ? t('puzzle.themeCountOne')
        : t('puzzle.themeCount', { count: motif.count });
    card.append(heading, name, gloss, count);
    grid.append(card);
  }
  main.append(title, intro, all, grid);
  return main;
}
