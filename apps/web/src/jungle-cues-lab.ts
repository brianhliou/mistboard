// DEV-only lab: river-ability badges for the Rat, Tiger and Lion.
//
// Jungle's newcomer problem is that three of the eight pieces have business with
// the river and the other five do not, and the board never says which.
//
// This is the SECOND approach. The first drew concentric arcs outside the token
// and was wrong as a family, not as a set of values: it put a second ring on a
// piece that already wears one for identity, it borrowed a shape the board
// already spends on last-move / selection / target marks, and it fought for
// ~3px of axis margin that does not exist (the arcs came out shaved by the board
// edge on the back rank, which is exactly where both Lions and both Tigers
// start). The corners have roughly four times the clearance and read as icon
// rather than ring, so that is where this one goes. Numbers in jungle-art.ts.
//
// The GLYPH comes out of the rules (JUNGLE_JUMP_DIRS), never out of this file.
// Since 2026-09-21 (#430) the TIGER jumps sideways as well as vertically, like
// the LION, so both badges are a cross; the vertical bar remains available for a
// ruleset that restricts one of them again.
//
// Nothing here ships: main.ts gates the route on import.meta.env.DEV, and the
// badge is off by default in jungle-art.ts.

import { createInitialJungleBoard, JUNGLE_RANK, type JunglePieceRole } from '@mistboard/game';
import './site-shell.css';
import { framedTokenSvg, type JungleCueBadgeSpec } from './jungle-art.js';
import { renderJungleBoardSvg } from './jungle-render.js';
import { characterTokenSvg } from './jungle-skins.js';
import { buildNav } from './site-shell.js';

type BadgeSpec = Partial<JungleCueBadgeSpec>;

/** The three roles with river business, plus one control that must stay unmarked. */
const CUED_ROLES: readonly JunglePieceRole[] = ['rat', 'tiger', 'lion'];
const CONTROL_ROLE: JunglePieceRole = 'elephant';

const ROLE_NOTE: Partial<Record<JunglePieceRole, string>> = {
  rat: 'enters the water — droplet',
  tiger: 'jumps vertically or sideways — a cross',
  lion: 'jumps vertically or sideways — a cross',
  elephant: 'control: no river business, no badge',
};

/** Presets are the decisions worth making, shown rather than described. */
const PRESETS: ReadonlyArray<{ id: string; label: string; note: string; spec: BadgeSpec }> = [
  {
    id: 'default',
    label: 'A · Piece ink (default)',
    note: 'The badge wears the piece own red or navy, so the board gains a mark but no new colour. Bar for the Tiger, cross for the Lion, droplet for the Rat.',
    spec: {},
  },
  {
    id: 'water',
    label: 'B · Solid water blue',
    note: 'The alternate. Louder, and the colour itself says "river" — but it is openly a separate system laid over the board.',
    spec: { useInk: false },
  },
  {
    id: 'cream',
    label: 'C · Cream badge, blue glyph',
    note: 'Matches the token disc, so it sits on the piece instead of on top of it. Quietest of the ones that stay clearly visible.',
    spec: {
      useInk: false,
      fill: '#fff2cf',
      glyph: '#2f7f9e',
      stroke: '#2f7f9e',
      strokeRatio: 0.022,
    },
  },
  {
    id: 'small',
    label: 'D · Smaller, tucked in',
    note: 'Pulled toward the token and shrunk. Buys board-edge margin; costs glyph size.',
    spec: { radiusRatio: 0.1, offsetRatio: 0.52 },
  },
  {
    id: 'heads',
    label: 'E · With arrowheads (the merge)',
    note: 'Kept for comparison, not as a candidate. The Lion four close into a diamond: arms run to the centre and fuse into a blob, so this version already opens a hole and STILL reads as one rhombus.',
    spec: { arrowHeads: true, shaftInnerRatio: 0.26, armStrokeRatio: 0.17 },
  },
  {
    id: 'heads-open',
    label: 'F · Arrowheads, wider hole',
    note: 'The other thing I tried before dropping the heads. Separating the arms just re-forms the same diamond one ring further out.',
    spec: { arrowHeads: true, shaftInnerRatio: 0.42, armStrokeRatio: 0.15 },
  },
  {
    id: 'topright',
    label: 'G · Top-right corner',
    note: 'Same badge, other corner. Bottom-right sits under the token drop shadow; top-right is clear of it but nearer the piece above.',
    spec: { corner: 'tr' },
  },
  {
    id: 'big',
    label: 'H · Bigger (clips)',
    note: 'Spends the whole corner budget and goes over: the margin readout under the board turns red. Kept as the boundary marker.',
    spec: { radiusRatio: 0.14, offsetRatio: 0.58 },
  },
];

/** Canonical board cell, so "1x" here is exactly the size on a real board. */
const CELL = 48;
const TOKEN = CELL * 0.9;

function tokenTile(
  role: JunglePieceRole,
  ink: 'red' | 'black',
  spec: BadgeSpec,
  scale: number,
  characters: boolean,
): string {
  const cell = CELL * scale;
  const draw = characters ? characterTokenSvg : framedTokenSvg;
  const body = draw({
    cx: cell / 2,
    cy: cell / 2,
    size: TOKEN * scale,
    ink,
    role,
    cueBadge: true,
    cueBadgeOverrides: spec,
  });
  // Real board grass, so contrast is judged against what actually ships.
  return (
    `<svg class="cue-token" viewBox="0 0 ${cell} ${cell}" width="${cell}" height="${cell}" ` +
    `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${ink} ${role}">` +
    `<rect width="${cell}" height="${cell}" fill="#e7ce96"/>${body}</svg>`
  );
}

function presetBlock(preset: (typeof PRESETS)[number], scale: number, characters: boolean): string {
  const rows = [...CUED_ROLES, CONTROL_ROLE]
    .map((role) => {
      const art = (['red', 'black'] as const)
        .map((ink) => tokenTile(role, ink, preset.spec, scale, characters))
        .join('');
      return (
        `<div class="cue-row"><div class="cue-row-art">${art}</div>` +
        `<div class="cue-row-text"><strong>${role}</strong> <span>rank ${JUNGLE_RANK[role]}</span>` +
        `<em>${ROLE_NOTE[role] ?? ''}</em></div></div>`
      );
    })
    .join('');
  return `<section class="cue-preset"><h3>${preset.label}</h3><p class="cue-note">${preset.note}</p>${rows}</section>`;
}

export function mountJungleCuesLab(root: HTMLElement): void {
  root.replaceChildren();
  const nav = buildNav();
  const main = document.createElement('main');
  main.className = 'cue-lab';

  const state = { scale: 2, characters: false, boardPreset: 'default' };

  const style = document.createElement('style');
  style.textContent = `
    .cue-lab { max-width: 1240px; margin: 0 auto; padding: 24px 20px 64px; color: var(--site-text); }
    .cue-lab h1 { font-size: 22px; margin: 0 0 4px; }
    .cue-lab .lede { color: var(--site-muted); margin: 0 0 18px; max-width: 66ch; line-height: 1.5; }
    .cue-lab .rule-callout { border-left: 3px solid #2f7f9e; padding: 8px 12px; margin: 0 0 22px;
      background: color-mix(in srgb, #2f7f9e 8%, transparent); max-width: 66ch; line-height: 1.5; }
    .cue-controls { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin-bottom: 24px;
      padding: 12px 14px; border: 1px solid var(--site-border); border-radius: 8px; }
    .cue-controls label { display: flex; align-items: center; gap: 6px; font-size: 13px; }
    /* The column has to grow with the zoom, or a 3x pair of tokens (288px of art
       alone) bursts out of the card and the presets overlap each other. */
    .cue-grid { display: grid; gap: 20px;
      grid-template-columns: repeat(auto-fit, minmax(var(--cue-col, 250px), 1fr)); }
    .cue-preset { border: 1px solid var(--site-border); border-radius: 8px; padding: 14px;
      min-width: 0; overflow: hidden; }
    .cue-preset h3 { margin: 0 0 4px; font-size: 14px; }
    .cue-note { margin: 0 0 12px; font-size: 12px; color: var(--site-muted); line-height: 1.45; }
    .cue-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; flex-wrap: wrap;
      border-top: 1px solid var(--site-border); }
    .cue-row:first-of-type { border-top: 0; }
    .cue-row-art { display: flex; gap: 4px; flex: 0 0 auto; }
    .cue-token { display: block; border-radius: 2px; }
    .cue-row-text { font-size: 12px; line-height: 1.35; min-width: 0; }
    .cue-row-text strong { text-transform: capitalize; }
    .cue-row-text span { color: var(--site-muted); }
    .cue-row-text em { display: block; font-style: normal; color: var(--site-muted); }
    .cue-boards { display: flex; flex-wrap: wrap; gap: 28px; margin-top: 32px; }
    .cue-board figcaption { font-size: 12px; color: var(--site-muted); margin-top: 8px; max-width: 44ch; line-height: 1.45; }
    .cue-margin { display: block; margin-top: 6px; font-weight: 600; }
    .cue-margin--ok { color: #4a9d7c; }
    .cue-margin--warn { color: #c9a227; }
    .cue-margin--bad { color: #c0563f; }
    .cue-board svg { width: 336px; height: auto; }
  `;

  const header = document.createElement('div');
  header.innerHTML =
    `<h1>Jungle river-ability badges</h1>` +
    `<p class="lede">A corner badge saying "this piece and the river have business with each ` +
    `other". Droplet = enters the water. A bar or a cross = leaps it, along those axes.</p>` +
    `<div class="rule-callout"><strong>Rules check:</strong> in this ruleset the <strong>Tiger</strong> ` +
    `and the <strong>Lion</strong> both jump vertically <em>or</em> sideways (a cross); a bar ` +
    `would mean vertical only. The glyph is generated from <code>JUNGLE_JUMP_DIRS</code>, so ` +
    `it follows the move generator rather than a second copy of the rule.</div>`;

  const controls = document.createElement('div');
  controls.className = 'cue-controls';
  controls.innerHTML =
    `<label>Scale <select data-scale>` +
    `<option value="1">1x (board size)</option>` +
    `<option value="2" selected>2x</option>` +
    `<option value="3">3x</option></select></label>` +
    `<label><input type="checkbox" data-characters> Character skin</label>` +
    `<label>Board preset <select data-board-preset>` +
    PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('') +
    `</select></label>`;

  const grid = document.createElement('div');
  grid.className = 'cue-grid';
  const boards = document.createElement('div');
  boards.className = 'cue-boards';

  function render(): void {
    // Art is 2 tokens + gap; the caption needs ~170px beside it before it wraps.
    grid.style.setProperty('--cue-col', `${CELL * state.scale * 2 + 170}px`);
    grid.innerHTML = PRESETS.map((p) => presetBlock(p, state.scale, state.characters)).join('');
    const spec = PRESETS.find((p) => p.id === state.boardPreset)?.spec ?? {};
    const board = createInitialJungleBoard();
    const pieceSkin = state.characters ? ('characters' as const) : ('animals' as const);
    boards.innerHTML =
      `<figure class="cue-board">` +
      renderJungleBoardSvg(board, {
        cueBadges: true,
        cueBadgeOverrides: spec,
        pieceSkin,
        idSuffix: '-cues-on',
      }) +
      `<figcaption>Badges ON, opening position. The only honest test: six marked pieces among ` +
      `sixteen, next to the water they are about. Signal, or noise?` +
      `<span class="cue-margin" data-margin></span></figcaption></figure>` +
      `<figure class="cue-board">` +
      renderJungleBoardSvg(board, { pieceSkin, idSuffix: '-cues-off' }) +
      `<figcaption>Badges OFF, for comparison.</figcaption></figure>`;
    reportMargin();
  }

  /**
   * Print the tightest gap between any badge and the board boundary, in board px
   * at the canonical 48px cell.
   *
   * The first attempt at this feature died of exactly this measurement and nobody
   * took it until the arcs were already drawn: they cleared the edge by under a
   * pixel and read as shaved on the back rank. A preset that looks fine in the
   * swatch row can still be too big on the board, because only the board has
   * outermost ranks -- so the number belongs next to the board, not in a comment.
   */
  function reportMargin(): void {
    const svg = boards.querySelector('svg');
    const slot = boards.querySelector('[data-margin]');
    if (!svg || !slot) return;
    const [, , w, h] = (svg.getAttribute('viewBox') ?? '0 0 0 0').split(' ').map(Number);
    if (!w || !h) return;
    let worst = Number.POSITIVE_INFINITY;
    for (const c of svg.querySelectorAll('circle[data-cue-badge]')) {
      const cx = Number(c.getAttribute('cx'));
      const cy = Number(c.getAttribute('cy'));
      const r = Number(c.getAttribute('r')) + Number(c.getAttribute('stroke-width') ?? 0) / 2;
      worst = Math.min(worst, cx - r, cy - r, w - (cx + r), h - (cy + r));
    }
    if (!Number.isFinite(worst)) return;
    const verdict = worst < 0 ? 'CLIPPED' : worst < 1.5 ? 'knife-edge' : 'ok';
    slot.textContent = ` Tightest badge-to-board-edge gap: ${worst.toFixed(2)}px (${verdict}).`;
    slot.className = `cue-margin cue-margin--${worst < 0 ? 'bad' : worst < 1.5 ? 'warn' : 'ok'}`;
  }

  controls.querySelector<HTMLSelectElement>('[data-scale]')?.addEventListener('change', (e) => {
    state.scale = Number((e.target as HTMLSelectElement).value);
    render();
  });
  controls.querySelector<HTMLInputElement>('[data-characters]')?.addEventListener('change', (e) => {
    state.characters = (e.target as HTMLInputElement).checked;
    render();
  });
  controls
    .querySelector<HTMLSelectElement>('[data-board-preset]')
    ?.addEventListener('change', (e) => {
      state.boardPreset = (e.target as HTMLSelectElement).value;
      render();
    });

  main.append(style, header, controls, grid, boards);
  root.append(nav, main);
  render();
}
