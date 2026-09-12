import { buildNav } from './site-shell.js';
import { FINAL_VARIANT_MARKERS, renderVariantMarker } from './variant-markers.js';
import {
  renderVariantMiniBoard,
  VARIANT_MINIS,
  type VariantMiniDef,
  type VariantMiniId,
} from './variant-mini-boards.js';

const MINI_SIZES = [160, 128, 112, 96, 80] as const;
const GENERATED_MARKER_SIZES = [128, 96, 80, 64, 48, 32] as const;
const FOCUSED_MARKER_IDS: readonly VariantMiniId[] = [
  'xiangqi',
  'fortress-xiangqi',
  'jieqi',
  'jungle-flip',
  'banqi',
  'jungle',
  'dark-xiangqi',
  'dark-chess',
];

const FOCUSED_VARIANT_MINIS: readonly VariantMiniDef[] = FOCUSED_MARKER_IDS.map((id) =>
  variantMiniForLab(id),
);
const FINALIZED_GENERATED_MARKER_SOURCES = {
  xiangqi: {
    source: 'single regen from ig_052feae, row 1 col 1, enlarged',
  },
  'fortress-xiangqi': {
    source: 'single regen from ig_0009, row 2 col 2, enlarged',
  },
  jieqi: {
    source: 'v2 single regen, tighter overlapping discs',
  },
  'jungle-flip': {
    source: 'single regen from ig_024f, row 4 col 3, enlarged',
  },
  banqi: {
    source: 'single regen from ig_00a381, row 1 col 3, enlarged',
  },
  jungle: {
    source: 'single regen from ig_024f, row 4 col 2, enlarged',
  },
  'dark-xiangqi': {
    source: 'single regen from ig_052feae, row 2 col 2, enlarged',
  },
  'dark-chess': {
    source: 'v2 single regen, compact king with higher fog',
  },
} as const satisfies Partial<Record<VariantMiniId, { source: string }>>;
const COLOR_STATE_ROWS = [
  { className: 'is-default', label: 'Default' },
  { className: 'is-hover', label: 'Hover' },
  { className: 'is-selected', label: 'Selected' },
] as const;
const COLOR_PALETTES = [
  {
    name: 'Neutral',
    description: 'Lichess-like gray icons with a pale-blue selected surface.',
    marker: '#8a8f94',
    hover: '#646b73',
    selected: '#3f4a54',
    hoverBg: '#f2f6f9',
    selectedBg: '#d9ebf8',
  },
  {
    name: 'Warm',
    description: 'Playstrategy-like gold icons with a deeper brown selected state.',
    marker: '#d9aa5b',
    hover: '#b77b36',
    selected: '#9a5528',
    hoverBg: '#fff7e8',
    selectedBg: '#f6dfbd',
  },
] as const;

export function mountVariantMarksLab(root: HTMLElement): void {
  root.replaceChildren();
  root.classList.add('landing-page', 'variant-marks-route');
  installVariantMarksLabStyles();

  const main = document.createElement('main');
  main.className = 'site-section variant-marks-lab';
  main.append(
    buildIntro(),
    buildGeneratedMarkerPreview(),
    buildGeneratedMarkerScaleStrip(),
    buildColorStatePreview(),
    buildMiniBoardGrid(),
    buildMiniBoardScaleStrip(),
  );

  root.append(buildNav(), main);
}

function buildGeneratedMarkerPreview(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'variant-generated-markers';
  section.setAttribute('aria-label', 'Finalized generated marker sheet');

  const head = document.createElement('div');
  head.className = 'variant-generated-markers-head';
  const title = document.createElement('h2');
  title.textContent = 'Finalized marker sheet';
  const note = document.createElement('p');
  note.textContent =
    'The finalized imagegen marker masks for the active variant set. Each PNG is used as a one-color mask so the UI can apply neutral, hover, and selected palettes consistently.';
  head.append(title, note);
  section.append(head);

  const grid = document.createElement('div');
  grid.className = 'variant-generated-grid';
  for (const def of FOCUSED_VARIANT_MINIS) {
    const card = document.createElement('article');
    card.className = 'variant-generated-card';

    const marker = document.createElement('span');
    marker.className = 'variant-generated-card-mark';
    marker.innerHTML = renderGeneratedMarker(def.id, `${def.label} finalized generated marker`);

    const title = document.createElement('h3');
    title.textContent = def.label;

    const source = document.createElement('p');
    source.className = 'variant-generated-source';
    source.textContent = generatedMarkerForLab(def.id).source;

    card.append(marker, title, source);
    grid.append(card);
  }
  section.append(grid);
  return section;
}

function buildGeneratedMarkerScaleStrip(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'variant-generated-scale';
  section.setAttribute('aria-label', 'Finalized marker size ramp');
  section.style.gridTemplateColumns = `148px ${GENERATED_MARKER_SIZES.map((s) => `${s}px`).join(' ')}`;

  const head = document.createElement('div');
  head.className = 'variant-generated-scale-head';
  const lead = document.createElement('div');
  lead.className = 'variant-generated-scale-lead';
  lead.textContent = 'Finalized marker scale';
  head.append(lead);
  for (const size of GENERATED_MARKER_SIZES) {
    const label = document.createElement('div');
    label.className = 'variant-generated-scale-size';
    label.textContent = `${size}px`;
    head.append(label);
  }
  section.append(head);

  for (const def of FOCUSED_VARIANT_MINIS) {
    const row = document.createElement('div');
    row.className = 'variant-generated-scale-row';

    const name = document.createElement('div');
    name.className = 'variant-generated-scale-name';
    name.textContent = def.label;
    row.append(name);

    for (const size of GENERATED_MARKER_SIZES) {
      const cell = document.createElement('div');
      cell.className = 'variant-generated-scale-cell';
      cell.style.setProperty('--variant-generated-scale-size', `${size}px`);
      cell.innerHTML = renderGeneratedMarker(def.id, `${def.label} generated marker at ${size}px`);
      row.append(cell);
    }
    section.append(row);
  }

  return section;
}

function buildColorStatePreview(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'variant-color-states';
  section.setAttribute('aria-label', 'Variant marker color states');

  const head = document.createElement('div');
  head.className = 'variant-color-states-head';
  const title = document.createElement('h2');
  title.textContent = 'Color states';
  const note = document.createElement('p');
  note.textContent =
    'Compare neutral gray against a warmer gold/brown palette across the full active marker set. These use the finalized generated marker masks.';
  head.append(title, note);
  section.append(head);

  const palettes = document.createElement('div');
  palettes.className = 'variant-color-palettes';
  for (const palette of COLOR_PALETTES) {
    const group = document.createElement('div');
    group.className = 'variant-color-palette';
    group.style.setProperty('--variant-marker-color', palette.marker);
    group.style.setProperty('--variant-marker-hover-color', palette.hover);
    group.style.setProperty('--variant-marker-selected-color', palette.selected);
    group.style.setProperty('--variant-marker-hover-bg', palette.hoverBg);
    group.style.setProperty('--variant-marker-selected-bg', palette.selectedBg);

    const paletteHead = document.createElement('div');
    paletteHead.className = 'variant-color-palette-head';
    const paletteName = document.createElement('h3');
    paletteName.textContent = palette.name;
    const paletteDescription = document.createElement('p');
    paletteDescription.textContent = palette.description;
    paletteHead.append(paletteName, paletteDescription);
    group.append(paletteHead);

    for (const state of COLOR_STATE_ROWS) {
      const row = document.createElement('div');
      row.className = `variant-color-state-row ${state.className}`;

      const label = document.createElement('span');
      label.className = 'variant-color-state-label';
      label.textContent = state.label;
      row.append(label);

      const marks = document.createElement('div');
      marks.className = 'variant-color-state-marks';
      for (const def of FOCUSED_VARIANT_MINIS) {
        const cell = document.createElement('span');
        cell.className = `variant-color-state-card ${state.className}`;
        cell.innerHTML = renderGeneratedMarker(
          def.id,
          `${palette.name} ${def.label} ${state.label} color state`,
        );
        marks.append(cell);
      }

      row.append(marks);
      group.append(row);
    }
    palettes.append(group);
  }

  section.append(palettes);
  return section;
}

function buildMiniBoardGrid(): HTMLElement {
  const grid = document.createElement('section');
  grid.className = 'variant-minis-grid';
  grid.setAttribute('aria-label', 'Variant mini-board previews');

  for (const def of FOCUSED_VARIANT_MINIS) {
    const card = document.createElement('article');
    card.className = 'variant-mini-card';
    card.style.setProperty('--variant-mark-accent', def.accent);

    const lead = document.createElement('div');
    lead.className = 'variant-mini-lead';
    lead.innerHTML = renderVariantMiniBoard(def.id, {
      size: 132,
      label: `${def.label} mini-board`,
    });

    const text = document.createElement('div');
    text.className = 'variant-mark-text';

    const title = document.createElement('h3');
    title.textContent = def.label;

    const accent = document.createElement('span');
    accent.className = 'variant-mini-accent-chip';
    accent.textContent = def.shortLabel;

    const titleRow = document.createElement('div');
    titleRow.className = 'variant-mini-title-row';
    titleRow.append(title, accent);

    const description = document.createElement('p');
    description.textContent = def.blurb;

    text.append(titleRow, description);
    card.append(lead, text);
    grid.append(card);
  }

  return grid;
}

function buildMiniBoardScaleStrip(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'variant-mini-scale';
  section.setAttribute('aria-label', 'Mini-board size ramp');
  // One column per size, each as wide as that board, so a header of px labels
  // lines up exactly over the boards beneath it.
  section.style.gridTemplateColumns = `132px ${MINI_SIZES.map((s) => `${s}px`).join(' ')}`;

  const head = document.createElement('div');
  head.className = 'variant-mini-scale-head';
  const lead = document.createElement('span');
  lead.className = 'variant-mini-scale-lead';
  lead.textContent = 'Size (px)';
  head.append(lead);
  for (const size of MINI_SIZES) {
    const label = document.createElement('span');
    label.className = 'variant-mini-scale-size';
    label.textContent = String(size);
    head.append(label);
  }
  section.append(head);

  for (const def of FOCUSED_VARIANT_MINIS) {
    const row = document.createElement('div');
    row.className = 'variant-mini-scale-row';

    const name = document.createElement('span');
    name.className = 'variant-mini-scale-name';
    name.textContent = def.label;
    row.append(name);

    for (const size of MINI_SIZES) {
      const cell = document.createElement('span');
      cell.className = 'variant-mini-scale-cell';
      cell.innerHTML = renderVariantMiniBoard(def.id, {
        size,
        label: `${def.label} at ${size}px`,
      });
      row.append(cell);
    }

    section.append(row);
  }

  return section;
}

function buildIntro(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'variant-marks-header';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'variant-marks-eyebrow';
  eyebrow.textContent = 'Variant reference sheet';

  const title = document.createElement('h1');
  title.className = 'site-section-heading';
  title.textContent = 'Every variant, one visual system';

  const copy = document.createElement('p');
  copy.className = 'site-section-copy';
  copy.textContent =
    'The finalized sheet for the active Mistboard variant markers. The imagegen masks are the approved marker set; the older mini-board fragments remain below only as a reference against the playable board families.';

  header.append(eyebrow, title, copy);
  return header;
}

function variantMiniForLab(id: VariantMiniId): VariantMiniDef {
  const def = VARIANT_MINIS.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`Unknown variant marker in lab focus list: ${id}`);
  return def;
}

function generatedMarkerForLab(id: VariantMiniId): { path: string; source: string } {
  const marker = (FINAL_VARIANT_MARKERS as Partial<Record<VariantMiniId, { path: string }>>)[id];
  const source = (
    FINALIZED_GENERATED_MARKER_SOURCES as Partial<Record<VariantMiniId, { source: string }>>
  )[id];
  if (!marker) throw new Error(`No finalized generated marker for lab id: ${id}`);
  if (!source) throw new Error(`No finalized generated marker source for lab id: ${id}`);
  return { ...marker, source: source.source };
}

function renderGeneratedMarker(id: VariantMiniId, label: string): string {
  return renderVariantMarker(id, { className: 'variant-generated-mark', label });
}

function installVariantMarksLabStyles(): void {
  if (document.querySelector('#variant-marks-lab-styles')) return;
  const style = document.createElement('style');
  style.id = 'variant-marks-lab-styles';
  style.textContent = `
    .variant-marks-lab {
      --variant-marker-color: #8a8f94;
      --variant-marker-hover-color: #646b73;
      --variant-marker-selected-color: #3f4a54;
      --variant-marker-hover-bg: #f2f6f9;
      --variant-marker-selected-bg: #d9ebf8;
      display: grid;
      gap: 28px;
      max-width: 1120px;
    }

    .variant-marks-header {
      max-width: 760px;
      display: grid;
      gap: 10px;
    }

    .variant-marks-eyebrow {
      margin: 0;
      color: var(--site-muted);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .variant-generated-markers {
      display: grid;
      gap: 14px;
      padding: 16px;
      border: 1px solid var(--site-border);
      border-radius: 8px;
      background: var(--site-panel);
    }

    .variant-generated-markers-head {
      display: grid;
      gap: 6px;
    }

    .variant-generated-markers-head h2 {
      margin: 0;
      color: var(--site-text);
      font-size: 18px;
      line-height: 1.25;
    }

    .variant-generated-markers-head p {
      margin: 0;
      color: var(--site-muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .variant-generated-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .variant-generated-card {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      min-height: 96px;
      padding: 10px;
      border: 1px solid var(--site-border);
      border-radius: 8px;
      background: var(--site-bg);
    }

    .variant-generated-card h3 {
      margin: 0;
      min-width: 0;
      color: var(--site-text);
      font-size: 14px;
      line-height: 1.2;
    }

    .variant-generated-card-mark {
      display: grid;
      place-items: center;
      grid-row: span 2;
      width: 76px;
      height: 76px;
    }

    .variant-generated-source {
      margin: 0;
      color: var(--site-muted);
      font-size: 11px;
      line-height: 1.25;
    }

    .variant-generated-mark {
      display: block;
      width: 64px;
      height: 64px;
      color: var(--variant-marker-color);
    }

    .variant-generated-scale {
      display: grid;
      gap: 8px 10px;
      overflow-x: auto;
      padding: 16px;
      border: 1px solid var(--site-border);
      border-radius: 8px;
      background: var(--site-panel);
    }

    .variant-generated-scale-head,
    .variant-generated-scale-row {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
      align-items: center;
    }

    .variant-generated-scale-lead {
      color: var(--site-text);
      font-size: 14px;
      font-weight: 900;
      line-height: 1.2;
    }

    .variant-generated-scale-size {
      color: var(--site-muted);
      font-size: 11px;
      font-weight: 800;
      line-height: 1.1;
      text-align: center;
    }

    .variant-generated-scale-name {
      min-width: 0;
      color: var(--site-text);
      font-size: 13px;
      font-weight: 800;
      line-height: 1.2;
    }

    .variant-generated-scale-cell {
      display: grid;
      place-items: center;
      width: var(--variant-generated-scale-size);
      height: var(--variant-generated-scale-size);
      border: 1px solid var(--site-border);
      border-radius: 6px;
      background: var(--site-bg);
      color: var(--variant-marker-color);
    }

    .variant-generated-scale-cell .variant-generated-mark {
      width: calc(var(--variant-generated-scale-size) * 0.86);
      height: calc(var(--variant-generated-scale-size) * 0.86);
      color: currentColor;
    }

    .variant-color-states {
      display: grid;
      gap: 14px;
      padding: 16px;
      border: 1px solid var(--site-border);
      border-radius: 8px;
      background: var(--site-panel);
    }

    .variant-color-states-head {
      display: grid;
      gap: 6px;
    }

    .variant-color-states-head h2 {
      margin: 0;
      color: var(--site-text);
      font-size: 18px;
      line-height: 1.25;
    }

    .variant-color-states-head p {
      margin: 0;
      color: var(--site-muted);
      font-size: 13px;
      line-height: 1.4;
    }

    .variant-color-palettes {
      display: grid;
      gap: 14px;
    }

    .variant-color-palette {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--site-border);
      border-radius: 8px;
      background: var(--site-bg);
    }

    .variant-color-palette-head {
      display: grid;
      gap: 3px;
      margin-bottom: 2px;
    }

    .variant-color-palette-head h3 {
      margin: 0;
      color: var(--site-text);
      font-size: 15px;
      line-height: 1.2;
    }

    .variant-color-palette-head p {
      margin: 0;
      color: var(--site-muted);
      font-size: 12px;
      line-height: 1.35;
    }

    .variant-color-state-row {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }

    .variant-color-state-row > .variant-color-state-label {
      color: var(--site-muted);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.1;
    }

    .variant-color-state-marks {
      display: grid;
      grid-template-columns: repeat(9, 44px);
      gap: 8px;
      align-items: center;
      overflow-x: auto;
      padding: 2px;
    }

    .variant-color-state-card {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 1px solid var(--site-border);
      border-radius: 8px;
      background: var(--site-panel);
      color: var(--variant-marker-color);
    }

    .variant-color-state-card .variant-generated-mark {
      width: 34px;
      height: 34px;
      color: currentColor;
    }

    .variant-color-state-card.is-hover {
      border-color: var(--variant-marker-hover-color);
      background: var(--variant-marker-hover-bg);
      color: var(--variant-marker-hover-color);
    }

    .variant-color-state-card.is-selected {
      border-color: var(--variant-marker-selected-color);
      background: var(--variant-marker-selected-bg);
      color: var(--variant-marker-selected-color);
      box-shadow: inset 0 0 0 1px var(--variant-marker-selected-color);
    }

    .variant-minis-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .variant-mini-card {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr);
      gap: 16px;
      align-items: center;
      padding: 16px;
      border: 1px solid var(--site-border);
      border-radius: 8px;
      background: var(--site-panel);
      color: var(--site-text);
      box-shadow: 0 12px 28px rgba(29, 37, 34, 0.08);
    }

    .variant-mini-lead {
      display: grid;
      place-items: center;
      width: 132px;
      height: 132px;
    }

    .variant-mini-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .variant-mini-title-row h3 {
      margin: 0;
      color: var(--site-text);
      font-size: 16px;
      line-height: 1.2;
    }

    .variant-mini-accent-chip {
      display: inline-grid;
      place-items: center;
      min-width: 26px;
      height: 18px;
      padding: 0 6px;
      border-radius: 5px;
      background: var(--variant-mark-accent);
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }

    .variant-mini-scale {
      display: grid;
      /* grid-template-columns set inline: 132px name + one column per size */
      gap: 12px 16px;
      align-items: center;
      padding: 16px;
      border: 1px solid var(--site-border);
      border-radius: 8px;
      background: var(--site-panel);
    }

    .variant-mini-scale-head,
    .variant-mini-scale-row {
      display: contents;
    }

    .variant-mini-scale-lead {
      color: var(--site-muted);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .variant-mini-scale-size {
      justify-self: center;
      color: var(--site-muted);
      font-size: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .variant-mini-scale-name {
      color: var(--site-muted);
      font-size: 13px;
      font-weight: 700;
    }

    .variant-mini-scale-cell {
      justify-self: center;
      display: grid;
      place-items: center;
    }

    .variant-mark-text {
      min-width: 0;
      display: grid;
      gap: 9px;
    }

    .variant-mark-text p {
      margin: 0;
      color: var(--site-muted);
      font-size: 13px;
      line-height: 1.45;
    }

    @media (max-width: 940px) {
      .variant-generated-grid,
      .variant-minis-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 640px) {
      .variant-generated-grid,
      .variant-minis-grid {
        grid-template-columns: 1fr;
      }

      .variant-color-state-row {
        grid-template-columns: 1fr;
      }

      .variant-mini-card {
        grid-template-columns: 104px minmax(0, 1fr);
      }

      .variant-mini-lead {
        width: 104px;
        height: 104px;
      }
    }
  `;
  document.head.append(style);
}
