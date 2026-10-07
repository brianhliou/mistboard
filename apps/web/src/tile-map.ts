// The tile-map card: one shelf card for /learn/xiangqi and /practice.
//
// Both pages drew their cards with their own DOM code over the same stylesheet,
// and the two had already drifted (the ribbon states, the tint, which tiles got
// the ring). One builder means one look, and a change to it lands on both.
//
// Anatomy, after lichess /learn and /practice: a square icon tile tinted by
// state, a title and one short subtitle, a folded corner ribbon carrying state.
// An ongoing card (the one being worked through, or the next one to start) gets
// the accent ring and a thin progress line along its bottom edge. The ring and
// the line animate once when the card is drawn and again when it is hovered or
// focused; nothing on the shelf moves while it is left alone.

import './tile-map.css';

/** done: finished. ongoing: in progress, or the next one to play. future: not
 *  started (on /learn, also not yet open). link: a destination, not a set. */
export type TileMapState = 'done' | 'ongoing' | 'future' | 'link';

export interface TileMapRibbon {
  variant: 'done' | 'ongoing' | 'future';
  /** Plain text ("Done", "3 / 11", "Play!"). */
  text?: string;
  /** Trusted markup (star icons, a check) when the ribbon is not plain text. */
  html?: string;
  /** Accessible name when the ribbon is a symbol rather than words. */
  label?: string;
}

export interface TileMapCardSpec {
  href: string;
  state: TileMapState;
  /** Trusted markup for the icon tile: a piece SVG or a glyph. */
  illustration: string;
  /** Extra class on the icon tile (the glyph tiles size their text). */
  illustrationClass?: string;
  title: string;
  subtitle: string;
  ribbon?: TileMapRibbon;
  /** Share of the set solved, 0..1. Drawn as the bottom line on an ongoing card;
   *  nothing is drawn at 0, so a not-yet-started next card shows the ring only. */
  progress?: number;
}

export function buildTileMapCard(spec: TileMapCardSpec): HTMLAnchorElement {
  const tile = document.createElement('a');
  tile.className = `learn-xq-tile learn-xq-tile--${spec.state}`;
  tile.href = spec.href;

  const illus = document.createElement('div');
  illus.className = spec.illustrationClass
    ? `learn-xq-tile-illus ${spec.illustrationClass}`
    : 'learn-xq-tile-illus';
  illus.setAttribute('aria-hidden', 'true');
  illus.innerHTML = spec.illustration;

  const text = document.createElement('div');
  text.className = 'learn-xq-tile-text';
  const title = document.createElement('h3');
  title.textContent = spec.title;
  const subtitle = document.createElement('p');
  subtitle.textContent = spec.subtitle;
  text.append(title, subtitle);
  tile.append(illus, text);

  if (spec.ribbon) {
    const wrap = document.createElement('div');
    wrap.className = 'learn-xq-ribbon-wrap';
    const ribbon = document.createElement('div');
    ribbon.className = `learn-xq-ribbon learn-xq-ribbon--${spec.ribbon.variant}`;
    if (spec.ribbon.html !== undefined) ribbon.innerHTML = spec.ribbon.html;
    else ribbon.textContent = spec.ribbon.text ?? '';
    if (spec.ribbon.label) {
      ribbon.setAttribute('role', 'img');
      ribbon.setAttribute('aria-label', spec.ribbon.label);
    }
    wrap.append(ribbon);
    tile.append(wrap);
  }

  if (spec.state === 'ongoing') {
    const ring = document.createElement('span');
    ring.className = 'learn-xq-tile-ring';
    ring.setAttribute('aria-hidden', 'true');
    tile.append(ring);

    const share = clampShare(spec.progress ?? 0);
    if (share > 0) {
      const line = document.createElement('span');
      line.className = 'learn-xq-tile-line';
      line.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.className = 'learn-xq-tile-line-fill';
      fill.style.width = `${Math.round(share * 1000) / 10}%`;
      line.append(fill);
      tile.append(line);
    }

    // Once on draw; again on hover or focus. The replay restarts by swapping
    // the class (remove, reflow, add) rather than by a :hover rule, because a
    // :hover animation also replays when the pointer leaves.
    tile.classList.add('learn-xq-tile--intro');
    const replay = (): void => {
      tile.classList.remove('learn-xq-tile--intro', 'learn-xq-tile--replay');
      void tile.offsetWidth;
      tile.classList.add('learn-xq-tile--replay');
    };
    tile.addEventListener('pointerenter', replay);
    tile.addEventListener('focus', replay);
  }

  return tile;
}

function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
