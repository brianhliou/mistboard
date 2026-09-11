// Lichess analyse underboard: a tab strip (Computer analysis / Move times /
// Crosstable / Share & export) over a shared body. The "Computer analysis" body is
// supplied by the caller (the live advantage chart / request button); the other
// tab bodies are built here from plain data (per-ply times, player names, a live
// FEN/URL/move export). Tabs with no data are omitted.
//
// This module is variant-neutral: every body is a pure DOM builder over generic
// inputs (number[], { red, black }, input elements, strings), so the standard-
// xiangqi tree surface and the generalized tree controller share it unchanged.

import { t } from '../i18n/catalog.js';
import { type ReviewSeatColors, reviewColorForSeat } from './review-seat-colors.js';

export type UnderboardOptions = {
  /** Include the "Computer analysis" tab. False for surfaces with no whole-game
   *  analysis (e.g. the historical library), so they don't lead with an empty chart. */
  hasAnalysis?: boolean;
  /** Prebuilt provenance panel → a "Game info" tab. */
  provenance?: HTMLElement;
  /** A caller-labelled info tab, shown FIRST. The study surface uses it for the
   *  study's own description + favorite + errata, moving them off the left rail. */
  about?: { label: string; body: HTMLElement };
  /** Caller-owned tool tabs inserted after About and before analysis/share.
   *  Studies use these for the current move's comment, glyphs, and lesson
   *  authoring controls. */
  tools?: Array<{ id: string; label: string; body: HTMLElement }>;
  /** Prebuilt opening-explorer panel → an "Opening explorer" tab. Present only
   *  on surfaces with a corpus behind them (standard xiangqi today). */
  explorer?: HTMLElement;
  /** Per-ply elapsed milliseconds (index 0 = ply 1). Present + non-empty → a
   *  "Move times" tab renders a per-move bar chart. */
  moveTimes?: number[];
  /** Visual ink for first/second-seat move bars in flip variants. */
  seatColors?: ReviewSeatColors;
  /** Present = show the Crosstable tab; the names label its stub. */
  players?: { red?: string; black?: string };
  /** Lazy Crosstable body: called once, the first time the tab is shown; its
   *  result replaces the loading placeholder. Absent = the tab keeps a stub. */
  crosstable?: { load(): Promise<HTMLElement> };
  /** Live-FEN share input, refreshed by the caller on every navigation. Absent
   *  when the variant has no engine FEN (the fog reviews), so the row is
   *  omitted rather than shown empty. */
  shareFenInput?: HTMLInputElement;
  /** Live move-export textarea, refreshed by the caller on every navigation. */
  shareMovesInput: HTMLTextAreaElement;
  gameUrl: string;
  /** Extra rows for the Share & export tab, appended after FEN/Share/Moves. The
   *  study surface uses this for its PGN download, which belongs with the other
   *  ways of getting the content out and is NOT owner-gated. */
  shareExtra?: HTMLElement[];
  /** Fired with the newly shown tab id, including the initial one. Lets a tab
   *  body defer work until it is actually on screen — the explorer only queries
   *  its corpus while visible, instead of on every navigation for every reader
   *  who never opens it. */
  onTabChange?(id: string): void;
  /** Tab to open on first render. Defaults to the first tab. A surface uses this
   *  when the panel holds the only control that surface needs: a practice
   *  chapter opens on Lesson, because its board is read-only and Preview is the
   *  action the author actually came for. Ignored if the id is not present. */
  initialTabId?: string;
};

type UnderboardTab = { id: string; label: string; body: HTMLElement };

export function underboardPanel(analysisBody: HTMLElement, opts: UnderboardOptions): HTMLElement {
  const tabDefs: UnderboardTab[] = [];
  if (opts.about) {
    tabDefs.push({ id: 'about', label: opts.about.label, body: opts.about.body });
  }
  if (opts.tools) tabDefs.push(...opts.tools);
  if (opts.hasAnalysis) {
    tabDefs.push({ id: 'analysis', label: t('underboard.computerAnalysis'), body: analysisBody });
  }
  if (opts.explorer) {
    tabDefs.push({ id: 'explorer', label: t('underboard.explorer'), body: opts.explorer });
  }
  if (opts.provenance) {
    tabDefs.push({ id: 'info', label: t('underboard.gameInfo'), body: opts.provenance });
  }
  if (opts.moveTimes && opts.moveTimes.length > 0) {
    tabDefs.push({
      id: 'times',
      label: t('underboard.moveTimes'),
      body: moveTimesBody(opts.moveTimes, opts.seatColors),
    });
  }
  if (opts.players) {
    tabDefs.push({
      id: 'crosstable',
      label: t('underboard.crosstable'),
      body: crosstableBody(opts.players, Boolean(opts.crosstable)),
    });
  }
  tabDefs.push({
    id: 'share',
    label: t('underboard.shareExport'),
    body: shareExportBody(opts.shareFenInput, opts.shareMovesInput, opts.gameUrl, opts.shareExtra),
  });

  const panel = document.createElement('section');
  panel.className = 'review-underboard-panel';
  const tabs = document.createElement('div');
  tabs.className = 'review-underboard-tabs';
  const bodies = document.createElement('div');
  bodies.className = 'review-underboard-bodies';

  const buttons = new Map<string, HTMLButtonElement>();
  let crosstableLoaded = false;

  /**
   * Tab bodies have very different natural heights, so switching tabs reflowed
   * the whole page: the board column and the rail beside it are aligned to this
   * panel, and every click moved them.
   *
   * The floor only ever GROWS, and only from a body that has actually rendered.
   * A fixed min-height would be a guess that is wrong on some viewport, and
   * stacking every body to take the max would force lazy tabs (the crosstable)
   * to load and would size the panel to its tallest content forever. Growing to
   * the tallest tab the reader has actually opened settles after a click or two
   * and never shrinks under them mid-session.
   */
  let heightFloor = 0;
  const raiseFloor = (height: number): void => {
    if (height <= heightFloor) return;
    heightFloor = height;
    bodies.style.minHeight = `${Math.round(heightFloor)}px`;
  };

  /**
   * Measure EVERY body once at mount rather than learning heights a click at a
   * time. Growing-on-visit still left the first visit to a taller tab (Share &
   * export is the tall one) moving the page, which is the jar this exists to
   * stop. Each body is briefly unhidden off-screen, measured, and restored.
   */
  const measureAll = (): void => {
    for (const def of tabDefs) {
      if (!def.body.hidden) {
        raiseFloor(def.body.getBoundingClientRect().height);
        continue;
      }
      const { position, visibility, left } = def.body.style;
      def.body.style.position = 'absolute';
      def.body.style.visibility = 'hidden';
      def.body.style.left = '-9999px';
      def.body.hidden = false;
      raiseFloor(def.body.getBoundingClientRect().height);
      def.body.hidden = true;
      def.body.style.position = position;
      def.body.style.visibility = visibility;
      def.body.style.left = left;
    }
  };

  // A body whose content arrives later (the lazy crosstable, a populated share
  // input) can outgrow the mount-time floor, so keep raising it on visit too.
  const holdHeight = (body: HTMLElement): void => {
    requestAnimationFrame(() => raiseFloor(body.getBoundingClientRect().height));
  };

  const show = (id: string): void => {
    if (id === 'crosstable' && opts.crosstable && !crosstableLoaded) {
      crosstableLoaded = true;
      const body = tabDefs.find((def) => def.id === 'crosstable')?.body;
      void opts.crosstable.load().then((el) => body?.replaceChildren(el));
    }
    for (const def of tabDefs) {
      const active = def.id === id;
      def.body.hidden = !active;
      buttons.get(def.id)?.classList.toggle('review-underboard-tab--active', active);
      if (active) holdHeight(def.body);
    }
    opts.onTabChange?.(id);
  };
  for (const def of tabDefs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-underboard-tab';
    button.textContent = def.label;
    button.addEventListener('click', () => show(def.id));
    buttons.set(def.id, button);
    tabs.append(button);
    def.body.classList.add('review-underboard-panel__body');
    bodies.append(def.body);
  }
  panel.append(tabs, bodies);
  const initial =
    opts.initialTabId && tabDefs.some((def) => def.id === opts.initialTabId)
      ? opts.initialTabId
      : tabDefs[0]!.id;
  show(initial);
  // After the panel is in the document, so the bodies have a width to wrap at.
  requestAnimationFrame(measureAll);
  return panel;
}

// Per-move time bars (lichess "Move times"): odd plies belong to the first seat,
// even plies to the second. Heights scale to the slowest move.
function moveTimesBody(times: number[], seatColors?: ReviewSeatColors): HTMLElement {
  const body = document.createElement('div');
  const chart = document.createElement('div');
  chart.className = 'review-move-times';
  const max = Math.max(1, ...times);
  for (let i = 0; i < times.length; i += 1) {
    const seat = i % 2 === 0 ? 'red' : 'black'; // ply 1 belongs to the first-mover seat
    const color = reviewColorForSeat(seat, seatColors);
    const col = document.createElement('div');
    col.className = `review-move-times__bar review-move-times__bar--${color}`;
    col.style.height = `${Math.max(2, Math.round((times[i]! / max) * 100))}%`;
    col.title = `Move ${i + 1}: ${formatDuration(times[i]!)}`;
    chart.append(col);
  }
  const total = times.reduce((sum, t) => sum + t, 0);
  const caption = document.createElement('p');
  caption.className = 'review-move-times__caption';
  caption.textContent = `Total move time ${formatDuration(total)}`;
  body.append(chart, caption);
  return body;
}

function crosstableBody(players: { red?: string; black?: string }, lazy: boolean): HTMLElement {
  const body = document.createElement('div');
  const note = document.createElement('p');
  note.className = 'review-underboard-empty';
  if (lazy) {
    note.textContent = t('underboard.crosstableLoading');
    body.append(note);
    return body;
  }
  const names = players.red && players.black ? `${players.red} vs ${players.black}` : '';
  note.textContent = names
    ? `Head-to-head record for ${names} is coming soon.`
    : 'Head-to-head record is coming soon.';
  body.append(note);
  return body;
}

function shareExportBody(
  fenInput: HTMLInputElement | undefined,
  movesInput: HTMLTextAreaElement,
  gameUrl: string,
  extra?: readonly HTMLElement[],
): HTMLElement {
  const body = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'review-share';

  if (fenInput) {
    fenInput.className = 'review-share__field';
    fenInput.readOnly = true;
    grid.append(shareRow('FEN', fenInput));
  }

  const urlInput = document.createElement('input');
  urlInput.className = 'review-share__field';
  urlInput.readOnly = true;
  urlInput.value = gameUrl;
  grid.append(shareRow('Share', urlInput));

  movesInput.className = 'review-share__field review-share__field--moves';
  movesInput.readOnly = true;
  movesInput.rows = 2;
  grid.append(shareRow('Moves', movesInput));
  if (extra) grid.append(...extra);

  body.append(grid);
  return body;
}

function shareRow(label: string, field: HTMLInputElement | HTMLTextAreaElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'review-share__row';
  const name = document.createElement('span');
  name.className = 'review-share__label';
  name.textContent = label;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'review-share__copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(field.value).then(
      () => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1200);
      },
      () => {},
    );
  });
  row.append(name, field, copy);
  return row;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export type DownloadLink = { text: string; href: string; filename: string };

/** A Share & export row of file downloads (lichess "Download PGN"): the row label
 *  plus one link per format, dressed like the Copy buttons beside them. Postgame
 *  surfaces pass the result through `shareExtra`, so the downloads sit with the
 *  other ways of getting the game out instead of in a stray row under the board. */
export function downloadRow(links: readonly DownloadLink[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'review-share__row review-share__row--downloads';
  const name = document.createElement('span');
  name.className = 'review-share__label';
  name.textContent = t('underboard.download');
  const group = document.createElement('div');
  group.className = 'review-share__downloads';
  for (const link of links) {
    const anchor = document.createElement('a');
    anchor.className = 'review-share__copy review-share__download';
    anchor.href = link.href;
    anchor.textContent = link.text;
    anchor.setAttribute('download', link.filename);
    group.append(anchor);
  }
  row.append(name, group);
  return row;
}
