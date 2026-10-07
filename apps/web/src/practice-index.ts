// /practice — the front door for engine-adjudicated exercises.
//
// A curated shelf, not a directory: the server resolves a hardcoded catalogue
// (@mistboard/game practice-catalog.ts) and returns sections of cards in
// teaching order. This page's job is to render that shelf and get out of the way.
//
// Uses the SAME tile-map shell as /learn/xiangqi (tile-map.css, and the one card
// builder in tile-map.ts): sticky sidebar with an emblem and a progress bar,
// letterspaced section headings, a grid of compact cards with a folded corner
// ribbon. The two pages are the same kind of
// thing -- a shelf of sets you work through -- and lichess draws its /learn and
// /practice indexes the same way for the same reason. Building a second card
// language here would make two surfaces that do one job look like two products.
//
// Localized from two sources, which is the thing to keep straight here. A
// card's TITLE comes from the study the card points at, which carries its own
// per-locale name, with the catalogue's English as the fallback: reading it off
// the catalogue instead is what left this shelf in English while every study
// behind it was translated. The SUBTITLE is shelf copy, a few words in lichess's
// manner, so it comes from the app catalog by slug (the study's description is
// the long form and stays on the study page); everything else on the page is
// app-catalog chrome too.

import type { XiangqiPieceRole } from '@mistboard/game';
import { type I18nKey, t } from './i18n/catalog.js';
import { buildNav } from './site-shell.js';
import { localizedStudyName } from './study-i18n.js';
import { buildTileMapCard, type TileMapRibbon, type TileMapState } from './tile-map.js';
import { renderXiangqiPiece } from './xiangqi-pieces.js';
import './tile-map.css';
import './practice-index.css';

export interface PracticeCardDto {
  slug: string;
  /** The catalogue's English, the fallback when the study has no text for this
   *  reader's locale. */
  title: string;
  blurb: string;
  /** The study's own name and description, and its locale overlay. Optional
   *  because a client cached before this shipped will not have them. */
  name?: string;
  description?: string;
  i18n?: unknown;
  studyId: string;
  exerciseCount: number;
  solvedCount: number;
}

/** The shelf subtitle for each catalogue slug. A slug missing here shows the
 *  catalogue's English, which is untranslated but correct. */
const CARD_SUBTITLE_KEYS: Record<string, I18nKey> = {
  'endgames-soldier': 'practice.card.soldier',
  'endgames-chariot': 'practice.card.chariot',
  'endgames-horse': 'practice.card.horse',
  'endgames-cannon': 'practice.card.cannon',
  'endgames-insufficient': 'practice.card.insufficient',
};

/** A card's title and subtitle for the current locale.
 *
 *  The study's own name wins when it has one, because that is what the page the
 *  card opens is called; a study that is renamed renames its card. */
function cardText(entry: PracticeCardDto): { title: string; subtitle: string } {
  const key = CARD_SUBTITLE_KEYS[entry.slug];
  return {
    title: entry.name ? localizedStudyName(entry.name, entry.i18n) : entry.title,
    subtitle: key ? t(key) : entry.blurb,
  };
}

/** The heading for a catalogue section, by id.
 *
 *  A map rather than a key built by interpolation: `t` returns undefined for a
 *  key that is not in the catalog, so a constructed key would render the word
 *  "undefined" the first time someone adds a section. A missing id here falls
 *  back to the English the server sent, which is untranslated but correct.
 *  Keyed at all, rather than translated in the catalogue, so packages/game keeps
 *  holding ids and English and does not become a third dictionary. */
const SECTION_TITLE_KEYS: Record<string, I18nKey> = {
  endgames: 'practice.section.endgames',
};

function sectionTitle(section: PracticeSectionDto): string {
  const key = SECTION_TITLE_KEYS[section.id];
  return key ? t(key) : section.title;
}

export interface PracticeSectionDto {
  id: string;
  title: string;
  cards: PracticeCardDto[];
}

export function mountPracticeIndex(root: HTMLElement): void {
  root.classList.add('landing-page');
  root.replaceChildren(buildNav(), notice(t('practice.loading')));
  void load()
    .then((sections) => render(root, sections))
    .catch(() => {
      root.replaceChildren(buildNav(), notice(t('practice.failed')));
    });
}

async function load(): Promise<PracticeSectionDto[]> {
  const response = await fetch('/api/practice', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`practice ${response.status}`);
  const body = (await response.json()) as { sections: PracticeSectionDto[] };
  return body.sections ?? [];
}

function render(root: HTMLElement, sections: PracticeSectionDto[]): void {
  const page = document.createElement('div');
  page.className = 'learn-xq learn-xq--map practice-index';

  page.append(sidebar(sections));

  const main = document.createElement('main');
  main.className = 'learn-xq-map-main';

  if (sections.length === 0) {
    main.append(notice(t('practice.empty')));
  }
  const next = nextPracticeSlug(sections);
  for (const section of sections) {
    const block = document.createElement('section');
    block.className = 'learn-xq-categ';
    const heading = document.createElement('h2');
    heading.textContent = sectionTitle(section);
    const grid = document.createElement('div');
    grid.className = 'learn-xq-tile-grid';
    for (const entry of section.cards) grid.append(tile(entry, entry.slug === next));
    block.append(heading, grid);
    main.append(block);
  }

  page.append(main);
  root.replaceChildren(buildNav(), page);
}

function sidebar(sections: PracticeSectionDto[]): HTMLElement {
  const side = document.createElement('aside');
  side.className = 'learn-xq-side-card';

  const illus = document.createElement('div');
  illus.className = 'learn-xq-mascot';
  illus.innerHTML = renderXiangqiPiece({ color: 'red', role: 'chariot' }, { size: 96 });

  const title = document.createElement('h1');
  title.textContent = t('practice.title');
  const sub = document.createElement('p');
  // Says what the surface actually is, because it is not the puzzle page: a
  // learner who expects a puzzle will read a failed conversion as a broken one.
  sub.textContent = t('practice.subtitle');
  side.append(illus, title, sub);

  // The same progress bar /learn uses, reading from practice progress.
  const total = sections.reduce(
    (sum, section) => sum + section.cards.reduce((n, card) => n + card.exerciseCount, 0),
    0,
  );
  const solved = sections.reduce(
    (sum, section) => sum + section.cards.reduce((n, card) => n + card.solvedCount, 0),
    0,
  );
  if (total > 0) {
    const pct = Math.round((solved / total) * 100);
    const bar = document.createElement('div');
    bar.className = 'learn-xq-progress-bar';
    const fill = document.createElement('div');
    fill.className = 'learn-xq-progress-fill';
    fill.style.width = `${pct}%`;
    const label = document.createElement('span');
    label.textContent = t('practice.progress', { pct });
    bar.append(fill, label);
    side.append(bar);

    const count = document.createElement('p');
    count.className = 'practice-index__total';
    count.textContent = t('practice.solvedOfTotal', { solved, total });
    side.append(count);
  }
  return side;
}

/** How a card reads: its state and what its corner ribbon says. */
export interface PracticeTileState {
  state: TileMapState;
  ribbon: 'done' | 'progress' | 'play' | 'count';
}

/**
 * A card's state from its counts, lichess's practice rule plus its /learn
 * "Play!" marker: finished is done; started is ongoing ("3 / 11"); the next set
 * to do, not yet started, is ongoing too and says "Play!"; any other untouched
 * set is future and shows its size ("0 / 9"). Ongoing is what carries the accent
 * ring and the progress line.
 */
export function practiceTileState(
  card: Pick<PracticeCardDto, 'solvedCount' | 'exerciseCount'>,
  isNext: boolean,
): PracticeTileState {
  if (card.exerciseCount > 0 && card.solvedCount >= card.exerciseCount) {
    return { state: 'done', ribbon: 'done' };
  }
  if (card.solvedCount > 0) return { state: 'ongoing', ribbon: 'progress' };
  if (isNext) return { state: 'ongoing', ribbon: 'play' };
  return { state: 'future', ribbon: 'count' };
}

/**
 * The next set to do: the first card in teaching order that is not finished.
 * Null when every set is done (or the shelf is empty).
 */
export function nextPracticeSlug(sections: PracticeSectionDto[]): string | null {
  for (const section of sections) {
    for (const card of section.cards) {
      if (practiceTileState(card, false).state !== 'done') return card.slug;
    }
  }
  return null;
}

function tile(entry: PracticeCardDto, isNext: boolean): HTMLElement {
  const { state, ribbon } = practiceTileState(entry, isNext);
  const copy = cardText(entry);
  const count = `${entry.solvedCount} / ${entry.exerciseCount}`;
  const ribbonSpec: TileMapRibbon =
    ribbon === 'done'
      ? { variant: 'done', text: t('practice.ribbon.done') }
      : ribbon === 'play'
        ? { variant: 'ongoing', text: t('practice.ribbon.play') }
        : { variant: ribbon === 'progress' ? 'ongoing' : 'future', text: count };
  return buildTileMapCard({
    href: `/study/${encodeURIComponent(entry.studyId)}`,
    state,
    illustration: renderXiangqiPiece(
      { color: 'red', role: pieceForSlug(entry.slug) },
      { size: 46 },
    ),
    title: copy.title,
    subtitle: copy.subtitle,
    ribbon: ribbonSpec,
    progress: entry.exerciseCount > 0 ? entry.solvedCount / entry.exerciseCount : 0,
  });
}

/**
 * The piece a card's illustration shows.
 *
 * Driven off the slug rather than stored in the catalogue: every endgame set is
 * named for the piece that defines it, so the mapping is already implied and a
 * second place to state it is a second place to get it wrong. An unrecognised
 * slug falls back to the general, which is the piece every xiangqi position has.
 */
function pieceForSlug(slug: string): XiangqiPieceRole {
  if (slug.includes('chariot')) return 'chariot';
  if (slug.includes('horse')) return 'horse';
  if (slug.includes('cannon')) return 'cannon';
  if (slug.includes('soldier')) return 'soldier';
  return 'general';
}

function notice(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'practice-index__notice';
  p.textContent = text;
  return p;
}
