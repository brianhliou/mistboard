/**
 * The puzzles-page sidebar: the current-puzzle info card (identity, source
 * game, side to move), the rated toggle + rating summary, the spoiler-gated
 * themes card, and the settings card (variant picker + auto-next).
 */

import {
  FORTRESS_XIANGQI_SPEC_ID,
  puzzleShortCode,
  XIANGQI_MOTIF_BY_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import { currentLocale } from '../i18n/locale.js';
import { renderVariantMarker } from '../variant-markers.js';
import { colorLabel, type PuzzleSummary } from './adapter.js';
import type { UserPuzzleRating } from './api.js';
import { isPuzzleVariant, type PuzzleVariant, puzzleBoardAdapter } from './registry.js';

export type QueuePanelProps = {
  queue: readonly PuzzleSummary[];
  selectedId: string | null;
  solvedIds: ReadonlySet<string>;
  variantFilter: PuzzleVariant;
  // Variants surfaced in the Settings variant picker (order = display order).
  variantFilters: readonly PuzzleVariant[];
  autoNext: boolean;
  ratedEnabled: boolean;
  userRating: UserPuzzleRating | null;
  ratingDelta: number | null;
  onVariantChange: (variant: PuzzleVariant) => Promise<void>;
  onAutoNextChange: (enabled: boolean) => void;
  onRatedChange: (enabled: boolean) => void;
};

export function renderQueuePanel(host: HTMLElement, props: QueuePanelProps): void {
  const {
    queue,
    selectedId,
    solvedIds,
    variantFilter,
    variantFilters,
    autoNext,
    ratedEnabled,
    userRating,
    ratingDelta,
    onVariantChange,
    onAutoNextChange,
    onRatedChange,
  } = props;
  host.replaceChildren();

  const currentIndex = Math.max(
    0,
    queue.findIndex((puzzle) => puzzle.id === selectedId),
  );
  const current = queue[currentIndex] ?? null;
  const solvedCount = queue.filter((puzzle) => solvedIds.has(puzzle.id)).length;

  const infoCard = document.createElement('section');
  infoCard.className = 'puzzle-left-card puzzle-current-card puzzle-info-card';
  if (current) {
    infoCard.append(
      puzzleInfoRow('target', [
        puzzleCodeLine(current),
        puzzleInfoLine(t('puzzle.ratingHidden')),
        puzzleInfoLine(
          solvedIds.has(current.id) ? t('puzzle.statusSolved') : t('puzzle.playedLocally'),
        ),
      ]),
      puzzleInfoDivider(),
      puzzleInfoRow(
        'variant',
        [
          // Mined xiangqi puzzles carry attribution for the real game they came
          // from: show a lichess-style "From game" header instead of "From set".
          // The source game is not hosted yet (license-gated), so this is
          // display-only — no link.
          ...sourceGameLines(current),
          // The goal (e.g. "Mate in 1") is a spoiler while solving; reveal it only
          // once the puzzle is solved, like the puzzle rating.
          puzzleInfoLine(
            solvedIds.has(current.id)
              ? t('puzzle.goalToMove', {
                  goal: goalLabel(current),
                  color: colorLabel(current.sideToMove),
                })
              : t('puzzle.toMove', { color: colorLabel(current.sideToMove) }),
          ),
        ],
        current.variant,
      ),
    );
  } else {
    const empty = document.createElement('p');
    empty.className = 'puzzle-card-empty';
    empty.textContent = t('puzzle.noneForVariant');
    infoCard.append(empty);
  }

  // Rated on/off (lichess parity). Off = practice: attempts send rated:false, so
  // neither the user's nor the puzzle's rating moves.
  const ratingCard = document.createElement('section');
  ratingCard.className = `puzzle-left-card puzzle-rating-card${
    ratedEnabled ? ' puzzle-rating-card--enabled' : ' puzzle-rating-card--practice'
  }`;
  const ratedToggle = document.createElement('label');
  ratedToggle.className = 'puzzle-toggle puzzle-rated-toggle';
  const ratedInput = document.createElement('input');
  ratedInput.type = 'checkbox';
  ratedInput.checked = ratedEnabled;
  ratedInput.dataset.puzzleRated = 'true';
  ratedInput.addEventListener('change', () => onRatedChange(ratedInput.checked));
  const ratedSwitch = document.createElement('span');
  ratedSwitch.className = 'puzzle-toggle-switch';
  ratedSwitch.setAttribute('aria-hidden', 'true');
  const ratedName = document.createElement('span');
  ratedName.className = 'puzzle-toggle-label';
  ratedName.textContent = t('puzzle.rated');
  ratedToggle.append(ratedInput, ratedSwitch, ratedName);
  ratingCard.append(ratedToggle);
  if (ratedEnabled) {
    const ratingSummary = document.createElement('div');
    ratingSummary.className = 'puzzle-rating-summary';
    const ratingValue = document.createElement('strong');
    if (userRating) {
      ratingValue.textContent = `${userRating.rating}${userRating.provisional ? '?' : ''}`;
      if (ratingDelta) {
        const delta = document.createElement('span');
        delta.className = `puzzle-rating-delta puzzle-rating-delta--${ratingDelta > 0 ? 'up' : 'down'}`;
        delta.textContent = ` ${ratingDelta > 0 ? '+' : ''}${ratingDelta}`;
        ratingValue.append(delta);
      }
    } else {
      ratingValue.textContent = t('puzzle.unrated');
    }
    const ratingMeta = document.createElement('span');
    ratingMeta.className = 'puzzle-rating-meta';
    ratingMeta.textContent = t('puzzle.solvedOf', { solved: solvedCount, total: queue.length });
    ratingSummary.append(ratingValue, ratingMeta);
    ratingCard.append(ratingSummary);
  }
  if (!ratedEnabled) {
    const ratedNote = document.createElement('p');
    ratedNote.className = 'puzzle-rated-note';
    ratedNote.textContent = t('puzzle.ratingNote');
    ratingCard.append(ratedNote);
  }

  const themesCard = document.createElement('section');
  themesCard.className = 'puzzle-left-card puzzle-theme-card';
  const themesTitle = document.createElement('h2');
  themesTitle.textContent = t('puzzle.themesTitle');
  const themesCopy = document.createElement('p');
  themesCopy.textContent = t('puzzle.themesCopy');
  themesCard.append(themesTitle);
  if (current && solvedIds.has(current.id)) {
    // Themes name the piece/pattern (e.g. "Drop", "Treasure"), so reveal them
    // only after the puzzle is solved to avoid giving the move away.
    themesCard.append(themesCopy, tagsPanel(current));
  } else if (current) {
    const hidden = document.createElement('p');
    hidden.className = 'puzzle-card-empty';
    hidden.textContent = t('puzzle.themesHidden');
    themesCard.append(hidden);
  } else {
    const empty = document.createElement('p');
    empty.className = 'puzzle-card-empty';
    empty.textContent = t('puzzle.themesEmpty');
    themesCard.append(empty);
  }

  const settingsCard = document.createElement('section');
  settingsCard.className = 'puzzle-left-card puzzle-settings-card';
  const settingsTitle = document.createElement('h2');
  settingsTitle.textContent = t('puzzle.settings');
  const form = document.createElement('div');
  form.className = 'puzzle-settings';
  // The variant picker only appears when more than one variant is surfaced.
  if (variantFilters.length > 1) {
    const field = document.createElement('label');
    field.className = 'puzzle-field';
    const fieldLabel = document.createElement('span');
    fieldLabel.textContent = t('puzzle.variantField');
    const select = document.createElement('select');
    select.className = 'puzzle-select';
    select.dataset.puzzleVariant = 'true';
    for (const filter of variantFilters) {
      const option = document.createElement('option');
      option.value = filter;
      option.textContent = variantLabel(filter);
      select.append(option);
    }
    select.value = variantFilter;
    select.addEventListener('change', () => {
      void onVariantChange(parseVariantFilter(select.value));
    });
    field.append(fieldLabel, select);
    form.append(field);
  }
  const autoNextToggle = document.createElement('label');
  autoNextToggle.className = 'puzzle-toggle';
  const autoNextInput = document.createElement('input');
  autoNextInput.type = 'checkbox';
  autoNextInput.checked = autoNext;
  autoNextInput.dataset.puzzleAutoNext = 'true';
  autoNextInput.addEventListener('change', () => {
    onAutoNextChange(autoNextInput.checked);
  });
  const autoNextSwitch = document.createElement('span');
  autoNextSwitch.className = 'puzzle-toggle-switch';
  autoNextSwitch.setAttribute('aria-hidden', 'true');
  const autoNextLabel = document.createElement('span');
  autoNextLabel.className = 'puzzle-toggle-label';
  autoNextLabel.textContent = t('puzzle.autoNext');
  autoNextToggle.append(autoNextInput, autoNextSwitch, autoNextLabel);
  form.append(autoNextToggle);
  settingsCard.append(settingsTitle, form);

  host.append(infoCard, ratingCard, themesCard, settingsCard);
}

function variantLabel(variant: PuzzleVariant): string {
  return t(puzzleBoardAdapter(variant).labelKey);
}

function parseVariantFilter(value: string): PuzzleVariant {
  return isPuzzleVariant(value) ? value : FORTRESS_XIANGQI_SPEC_ID;
}

function puzzleInfoRow(
  icon: 'target' | 'variant',
  lines: readonly HTMLElement[],
  variant?: PuzzleVariant,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'puzzle-info-row';
  const iconEl = document.createElement('span');
  iconEl.className = `puzzle-info-icon puzzle-info-icon--${icon}`;
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.innerHTML =
    icon === 'target'
      ? targetAvatarSvg()
      : variant
        ? renderVariantMarker(puzzleBoardAdapter(variant).markerId, {
            size: 54,
            label: `${variantLabel(variant)} marker`,
            className: 'puzzle-variant-marker',
          })
        : '';
  const copy = document.createElement('div');
  copy.className = 'puzzle-info-copy';
  copy.append(...lines);
  row.append(iconEl, copy);
  return row;
}

function puzzleInfoLine(text: string): HTMLSpanElement {
  const line = document.createElement('span');
  line.textContent = text;
  return line;
}

// The "From X" header lines for the info card. Mined xiangqi puzzles that carry
// source-game attribution get a lichess-style "From game" header with the event
// and both players; everything else falls back to "From set <variant>".
export function sourceGameLines(
  puzzle: Pick<PuzzleSummary, 'variant' | 'sourceGame'>,
): HTMLElement[] {
  const source = puzzle.sourceGame;
  const hasAttribution =
    puzzle.variant === XIANGQI_SPEC_ID &&
    source !== undefined &&
    (source.event !== undefined || source.redName !== undefined || source.blackName !== undefined);
  if (!source || !hasAttribution) {
    return [puzzleInfoLine(t('puzzle.fromSet', { variant: variantLabel(puzzle.variant) }))];
  }
  const lines: HTMLElement[] = [puzzleInfoLine(sourceGameHeader(source))];
  if (source.redName !== undefined || source.blackName !== undefined) {
    lines.push(
      sourceGamePlayerLine('red', source.redName, source.result),
      sourceGamePlayerLine('black', source.blackName, source.result),
    );
  }
  return lines;
}

// "From game · <event> (<year>)" — event and year are both optional.
function sourceGameHeader(source: NonNullable<PuzzleSummary['sourceGame']>): string {
  const year = source.playedOn?.slice(0, 4);
  const parts = [source.event, year ? `(${year})` : undefined].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length > 0
    ? t('puzzle.fromGameWith', { details: parts.join(' ') })
    : t('puzzle.fromGame');
}

// One player row: a color disc, the player name, and a result glyph on the
// side that won (½ on a draw). Names are the raw source-archive strings.
function sourceGamePlayerLine(
  color: 'red' | 'black',
  name: string | undefined,
  result: string | undefined,
): HTMLSpanElement {
  const line = document.createElement('span');
  line.className = 'puzzle-source-player';
  const disc = document.createElement('span');
  disc.className = `puzzle-source-disc puzzle-source-disc--${color}`;
  disc.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'puzzle-source-player-name';
  label.textContent =
    name && name.length > 0 ? name : color === 'red' ? t('setup.red') : t('setup.black');
  line.append(disc, label);
  const glyph = sourceGameResultGlyph(color, result);
  if (glyph) {
    const outcome = document.createElement('span');
    outcome.className = 'puzzle-source-result';
    outcome.textContent = glyph;
    line.append(outcome);
  }
  return line;
}

function sourceGameResultGlyph(color: 'red' | 'black', result: string | undefined): string | null {
  if (result === '1/2-1/2') return '½';
  if (result === '1-0') return color === 'red' ? '1' : null;
  if (result === '0-1') return color === 'black' ? '1' : null;
  return null;
}

function puzzleInfoDivider(): HTMLHRElement {
  const divider = document.createElement('hr');
  divider.className = 'puzzle-info-divider';
  return divider;
}

// Stable, lichess-style puzzle identifier: "Puzzle #bMpKA", where the code is a
// deterministic hash of the puzzle id (unlike the old queue position, which
// shuffled every visit). The code links to the puzzle's canonical full-id URL;
// hand-typing /puzzles/<code> also resolves (see resolveToFullPuzzleId).
function puzzleCodeLine(puzzle: PuzzleSummary): HTMLSpanElement {
  const line = document.createElement('span');
  line.append(t('puzzle.label'));
  const link = document.createElement('a');
  link.className = 'puzzle-code-link';
  link.href = `/puzzles/${encodeURIComponent(puzzle.id)}`;
  link.dataset.puzzleCode = puzzleShortCode(puzzle.id);
  link.textContent = `#${puzzleShortCode(puzzle.id)}`;
  line.append(link);
  return line;
}

function tagsPanel(puzzle: Pick<PuzzleSummary, 'themes' | 'motifs'>): HTMLElement {
  const tags = document.createElement('div');
  tags.className = 'puzzle-tags';
  // Named kill patterns lead: the Chinese name is the name, the English
  // gloss rides beside it outside zh locales, pinyin sits in the tooltip.
  const zh = currentLocale().startsWith('zh');
  for (const id of puzzle.motifs ?? []) {
    const motif = XIANGQI_MOTIF_BY_ID.get(id);
    if (!motif) continue;
    const tag = document.createElement('span');
    tag.className = 'puzzle-tag puzzle-tag-motif';
    tag.lang = 'zh';
    tag.textContent = zh ? motif.hanzi : `${motif.hanzi} ${motif.label}`;
    tag.title = motif.pinyin;
    tags.append(tag);
  }
  for (const theme of puzzle.themes) {
    const tag = document.createElement('span');
    tag.className = 'puzzle-tag';
    tag.textContent = themeLabel(theme);
    tags.append(tag);
  }
  return tags;
}

function themeLabel(theme: string): string {
  return theme
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function goalLabel(puzzle: Pick<PuzzleSummary, 'goal' | 'solutionPlyCount'>): string {
  if (puzzle.goal.type === 'checkmate') {
    return t('puzzle.mateIn', { count: Math.ceil(puzzle.solutionPlyCount / 2) });
  }
  if (puzzle.goal.type === 'win') {
    return t('puzzle.winIn', { count: Math.ceil(puzzle.solutionPlyCount / 2) });
  }
  return t('puzzle.winning');
}

function targetAvatarSvg(): string {
  // Lucide `target` (24-grid, 2px round), consistent with the app's other inlined
  // Lucide icons (see landing-play.ts). Plain concentric bullseye, no arrow.
  return [
    '<svg class="puzzle-target-avatar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">',
    '<circle cx="12" cy="12" r="10"/>',
    '<circle cx="12" cy="12" r="6"/>',
    '<circle cx="12" cy="12" r="2"/>',
    '</svg>',
  ].join('');
}
