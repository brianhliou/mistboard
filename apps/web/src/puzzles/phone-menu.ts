/**
 * The phone ☰ sheet's own rows (puzzlePhoneMoveNav). Not the desktop sidebar
 * stacked: one header block (puzzle code, status, goal, source), then one-line
 * rows with the label on the left and the control on the right, hairline
 * dividers between them, the shape of the analysis board's Tools sheet. The
 * engine row and the analysis link are the page's own blocks, lent in between
 * the header and these rows while the sheet is open.
 *
 * Built from the same props as the desktop sidebar (QueuePanelProps), so the two
 * never disagree; the inputs carry `data-puzzle-menu` keys, not the sidebar's
 * `data-puzzle-*` hooks, so a selector for one never finds the other.
 */

import { XIANGQI_SPEC_ID } from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import { colorLabel } from './adapter.js';
import {
  goalLabel,
  parseVariantFilter,
  puzzleCodeLine,
  type QueuePanelProps,
  sourceGameLines,
  tagsPanel,
  variantLabel,
  withSelectedSource,
} from './queue-panel.js';
import { puzzleThemePicker, puzzleThemesLink } from './themes.js';

export type PuzzlePhoneMenuKey = 'rated' | 'autoNext' | 'variant';

function currentPuzzle(props: QueuePanelProps) {
  return withSelectedSource(
    props.queue.find((puzzle) => puzzle.id === props.selectedId) ?? props.queue[0] ?? null,
    props.selectedSource,
  );
}

/** Puzzle code and status, then the goal (spoiler-gated like the sidebar) and
 *  where the puzzle came from, all in small muted lines. */
export function puzzlePhoneMenuHead(props: QueuePanelProps): HTMLElement | null {
  const current = currentPuzzle(props);
  if (!current) return null;
  const solved = props.solvedIds.has(current.id);
  const head = document.createElement('div');
  head.className = 'puzzle-pm-head';

  const top = document.createElement('div');
  top.className = 'puzzle-pm-head__top';
  const title = puzzleCodeLine(current);
  title.className = 'puzzle-pm-head__title';
  const status = document.createElement('span');
  status.className = `puzzle-pm-head__status${solved ? ' puzzle-pm-head__status--solved' : ''}`;
  status.textContent = solved ? t('puzzle.statusSolved') : t('puzzle.playedLocally');
  top.append(title, status);

  const goal = document.createElement('span');
  goal.className = 'puzzle-pm-head__line';
  const color = colorLabel(current.sideToMove);
  goal.textContent = `${
    solved
      ? t('puzzle.goalToMove', { goal: goalLabel(current), color })
      : t('puzzle.toMove', { color })
  } · ${t('puzzle.ratingHidden')}`;

  const source = document.createElement('span');
  source.className = 'puzzle-pm-head__line puzzle-pm-head__source';
  // The player lines show the name only, the team in the tooltip (sourceGameLines).
  source.append(...sourceGameLines(current));

  head.append(top, goal, source);
  return head;
}

/** Rated, auto-next, themes once solved, and the variant picker when more than
 *  one variant is surfaced (never today). */
export function puzzlePhoneMenuRows(props: QueuePanelProps): HTMLElement[] {
  const current = currentPuzzle(props);
  const rows: HTMLElement[] = [];

  const ratedSub = document.createElement('span');
  if (props.ratedEnabled) {
    const value = document.createElement('strong');
    value.className = 'puzzle-pm-row__rating';
    const rating = props.userRating;
    value.textContent = rating
      ? `${rating.rating}${rating.provisional ? '?' : ''}`
      : t('puzzle.unrated');
    if (rating && props.ratingDelta) {
      const delta = document.createElement('span');
      delta.className = `puzzle-rating-delta puzzle-rating-delta--${props.ratingDelta > 0 ? 'up' : 'down'}`;
      delta.textContent = ` ${props.ratingDelta > 0 ? '+' : ''}${props.ratingDelta}`;
      value.append(delta);
    }
    const solvedCount = props.queue.filter((puzzle) => props.solvedIds.has(puzzle.id)).length;
    ratedSub.append(
      value,
      ` · ${t('puzzle.solvedOf', { solved: solvedCount, total: props.queue.length })}`,
    );
  }
  const rated = switchRow('rated', t('puzzle.rated'), ratedSub, props.ratedEnabled, (on) =>
    props.onRatedChange(on),
  );
  if (!props.ratedEnabled) rated.title = t('puzzle.ratingNote');
  rows.push(rated);

  rows.push(
    switchRow('autoNext', t('puzzle.autoNext'), null, props.autoNext, (on) =>
      props.onAutoNextChange(on),
    ),
  );

  if (current && props.solvedIds.has(current.id)) {
    const themes = document.createElement('div');
    themes.className = 'puzzle-pm-row puzzle-pm-row--themes';
    themes.dataset.puzzleMenuRow = 'themes';
    const label = document.createElement('span');
    label.className = 'puzzle-pm-row__label';
    label.textContent = t('puzzle.themesTitle');
    themes.append(label, tagsPanel(current));
    rows.push(themes);
  }

  if (props.variantFilters.length > 1) {
    const row = document.createElement('label');
    row.className = 'puzzle-pm-row';
    row.dataset.puzzleMenuRow = 'variant';
    const label = document.createElement('span');
    label.className = 'puzzle-pm-row__label';
    label.textContent = t('puzzle.variantField');
    const select = document.createElement('select');
    select.className = 'puzzle-select';
    select.dataset.puzzleMenu = 'variant';
    for (const filter of props.variantFilters) {
      const option = document.createElement('option');
      option.value = filter;
      option.textContent = variantLabel(filter);
      select.append(option);
    }
    select.value = props.variantFilter;
    select.addEventListener('change', () => {
      void props.onVariantChange(parseVariantFilter(select.value));
    });
    row.append(label, select);
    rows.push(row);
  }
  if (props.theme && props.variantFilter === XIANGQI_SPEC_ID) {
    rows.push(puzzleThemePicker(props.theme, true));
    const browse = document.createElement('div');
    browse.className = 'puzzle-pm-row';
    browse.append(puzzleThemesLink());
    rows.push(browse);
  }
  return rows;
}

function switchRow(
  key: PuzzlePhoneMenuKey,
  labelText: string,
  sub: HTMLElement | null,
  checked: boolean,
  onChange: (on: boolean) => void,
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'puzzle-pm-row puzzle-toggle';
  row.dataset.puzzleMenuRow = key;
  const text = document.createElement('span');
  text.className = 'puzzle-pm-row__text';
  const label = document.createElement('span');
  label.className = 'puzzle-pm-row__label';
  label.textContent = labelText;
  text.append(label);
  if (sub && sub.childNodes.length > 0) {
    sub.className = 'puzzle-pm-row__sub';
    text.append(sub);
  }
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.dataset.puzzleMenu = key;
  input.addEventListener('change', () => onChange(input.checked));
  // The switch follows the input: `.puzzle-toggle input:checked + …` paints it.
  const track = document.createElement('span');
  track.className = 'puzzle-toggle-switch';
  track.setAttribute('aria-hidden', 'true');
  row.append(text, input, track);
  return row;
}
