// /practice — the front door for engine-adjudicated exercises.
//
// A curated shelf, not a directory: the server resolves a hardcoded catalogue
// (@mistboard/game practice-catalog.ts) and returns sections of cards in
// teaching order. This page's job is to render that shelf and get out of the way.
//
// Uses the SAME tile-map shell as /learn/xiangqi (tile-map.css): sticky sidebar
// with an emblem and a progress bar, letterspaced section headings, a grid of
// wide tiles with a folded corner ribbon. The two pages are the same kind of
// thing -- a shelf of sets you work through -- and lichess draws its /learn and
// /practice indexes the same way for the same reason. Building a second card
// language here would make two surfaces that do one job look like two products.
//
// Localized from two sources, which is the thing to keep straight here. The
// chrome (heading, progress, section titles) comes from the app catalog; a
// card's TITLE and BLURB come from the study the card points at, which carries
// its own per-locale text, with the catalogue's English as the fallback. Reading
// the card off the catalogue instead is what left this shelf in English while
// every study behind it was translated: the response already carried the
// overlay and the page threw it away.

import type { XiangqiPieceRole } from '@mistboard/game';
import { type I18nKey, t } from './i18n/catalog.js';
import { localizedHref } from './i18n/locale.js';
import { buildNav } from './site-shell.js';
import { localizedStudyDescription, localizedStudyName } from './study-i18n.js';
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

/** A card's title and blurb for the current locale.
 *
 *  The study's own text wins when it has any, because that is what the page the
 *  card opens is called; the catalogue's English is the fallback, and it is a
 *  real one -- these two sets of words are written separately and a study that
 *  is renamed should rename its card. */
function cardText(entry: PracticeCardDto): { title: string; blurb: string } {
  return {
    title: entry.name ? localizedStudyName(entry.name, entry.i18n) : entry.title,
    blurb: entry.description
      ? localizedStudyDescription(entry.description, entry.i18n)
      : entry.blurb,
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
    .then((sections) => {
      const target = practiceSetTarget(sections, window.location.search);
      if (target) window.location.replace(target);
      else render(root, sections);
    })
    .catch(() => {
      root.replaceChildren(buildNav(), notice(t('practice.failed')));
    });
}

/**
 * `/practice?set=<slug>` opens that set's study: the stable link for a set,
 * which an article can carry across re-seeds (the study id is minted by the
 * seed; the slug never changes). An unknown or unseeded slug shows the shelf.
 */
export function practiceSetTarget(sections: PracticeSectionDto[], search: string): string | null {
  const slug = new URLSearchParams(search).get('set');
  if (!slug) return null;
  for (const section of sections) {
    const card = section.cards.find((entry) => entry.slug === slug);
    if (card) return `/study/${encodeURIComponent(card.studyId)}`;
  }
  return null;
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
  for (const section of sections) {
    const block = document.createElement('section');
    block.className = 'learn-xq-categ';
    const heading = document.createElement('h2');
    heading.textContent = sectionTitle(section);
    const grid = document.createElement('div');
    grid.className = 'learn-xq-tile-grid';
    for (const entry of section.cards) grid.append(tile(entry));
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

  // The reference behind the shelf: which endgames are wins and which are
  // draws, each position playable from there.
  const guide = document.createElement('p');
  guide.className = 'practice-index__guide';
  const guideLink = document.createElement('a');
  guideLink.href = localizedHref('/blog/xiangqi-endgames');
  guideLink.textContent = t('practice.endgamesLink');
  guide.append(guideLink);
  side.append(guide);
  return side;
}

function tile(entry: PracticeCardDto): HTMLElement {
  const link = document.createElement('a');
  // `--link` is the tint /learn uses for an actionable destination tile.
  link.className = 'learn-xq-tile learn-xq-tile--link';
  link.href = `/study/${encodeURIComponent(entry.studyId)}`;

  const illus = document.createElement('div');
  illus.className = 'learn-xq-tile-illus';
  illus.innerHTML = renderXiangqiPiece(
    { color: 'red', role: pieceForSlug(entry.slug) },
    { size: 56 },
  );

  const text = document.createElement('div');
  text.className = 'learn-xq-tile-text';
  const copy = cardText(entry);
  const title = document.createElement('h3');
  title.textContent = copy.title;
  const blurb = document.createElement('p');
  blurb.textContent = copy.blurb;
  text.append(title, blurb);

  link.append(illus, text);

  // The folded corner ribbon carries state, as it does on /learn: "solved /
  // total", and the done tint once the set is finished.
  const done = entry.solvedCount >= entry.exerciseCount && entry.exerciseCount > 0;
  if (done) link.classList.add('learn-xq-tile--done');
  const wrap = document.createElement('div');
  wrap.className = 'learn-xq-ribbon-wrap';
  const ribbon = document.createElement('div');
  ribbon.className = `learn-xq-ribbon learn-xq-ribbon--${done ? 'done' : 'ongoing'}`;
  ribbon.textContent = `${entry.solvedCount} / ${entry.exerciseCount}`;
  wrap.append(ribbon);
  link.append(wrap);

  return link;
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
