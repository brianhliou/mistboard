// DEV-ONLY game sheet (/game-sheet): a tabbed viewer over every LIVE variant's
// NATIVE game surfaces, seeded from each watch channel's latest finished game.
// One variant is shown at a time in a full-viewport-width iframe so the page
// renders at its true desktop layout (a shrunk grid of frames trips the pages'
// responsive breakpoints and misrepresents them). Click a tab or use the arrow
// keys to page through variants; "Open" pops the real page.
//
// Tuning-sweep controls: a Review/Room mode toggle (the same finished game as
// its postgame page or its finished-room page — both ride the shared uniboard
// layout), and width presets that DELIBERATELY narrow the iframe to the
// uniboard breakpoints (col3 / col2) to eyeball each tier. Tabs follow the
// canonical variant order and hide disabled variants entirely.

import { canonicalVariantOrderIndex, type GameSpecId } from '@mistboard/game';
import type { FeaturedGame } from './game-display.js';
import { t } from './i18n/catalog.js';
import { webVariantTenants } from './variant-tenant/registry.js';

type GameSheetVariant = {
  label: string;
  channel: string;
  routeBase: string;
  gameSpecId: GameSpecId;
};

type WatchFeed = {
  unlocked?: FeaturedGame[];
};

// The prod-live variant set. Client dev builds force every tenant's enabled()
// to true, so the sheet pins the list explicitly — the canonical liveness gate
// is the server env flags, which the client cannot read. Update when a variant
// launches or retires.
const SHEET_LIVE_SPECS: ReadonlySet<string> = new Set([
  'dark-chess',
  'xiangqi',
  'fortress-xiangqi',
  'jieqi',
  'banqi',
  'jungle',
  'jungle-flip',
  'dark-xiangqi',
]);

export function gameSheetVariants(): GameSheetVariant[] {
  const variants: GameSheetVariant[] = [
    {
      label: 'Fog Chess',
      channel: 'dark-chess',
      routeBase: '/game',
      gameSpecId: 'dark-chess' as GameSpecId,
    },
    ...webVariantTenants()
      .filter(
        (tenant) => tenant.watch && tenant.gameRouteBase && SHEET_LIVE_SPECS.has(tenant.gameSpecId),
      )
      .map((tenant) => ({
        label: t(tenant.pageTitleKey),
        channel: tenant.gameSpecId,
        routeBase: tenant.gameRouteBase!,
        gameSpecId: tenant.gameSpecId as GameSpecId,
      })),
  ];
  return variants.sort(
    (a, b) => canonicalVariantOrderIndex(a.gameSpecId) - canonicalVariantOrderIndex(b.gameSpecId),
  );
}

export function sheetReviewUrl(routeBase: string, roomId: string): string {
  return `${routeBase}/${encodeURIComponent(roomId)}`;
}

async function firstGameForChannel(channel: string): Promise<FeaturedGame | null> {
  try {
    const resp = await fetch(`/api/watch?channel=${encodeURIComponent(channel)}`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as WatchFeed;
    const games = [...(data.unlocked ?? [])].sort((a, b) => b.plyCount - a.plyCount);
    return games[0] ?? null;
  } catch {
    return null;
  }
}

export async function mountGameSheet(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('postgame-sheet-route');
  installStyles();

  const variants = gameSheetVariants();
  // Resolve every channel's latest game up front so the tab dots reflect
  // availability and switching tabs is instant (no per-click fetch).
  const games = await Promise.all(variants.map((v) => firstGameForChannel(v.channel)));

  const shell = document.createElement('div');
  shell.className = 'postgame-sheet-shell';

  const bar = document.createElement('div');
  bar.className = 'postgame-sheet-bar';

  const brand = document.createElement('span');
  brand.className = 'postgame-sheet-brand';
  brand.textContent = t('replay.gameSheet');

  const tabs = document.createElement('div');
  tabs.className = 'postgame-sheet-tabs';

  const spacer = document.createElement('span');
  spacer.className = 'postgame-sheet-bar-spacer';

  // Review/Room mode + breakpoint width presets for the tuning sweep.
  let mode: 'review' | 'room' = 'review';
  const modeGroup = document.createElement('div');
  modeGroup.className = 'postgame-sheet-seg';
  const modeButtons = (['review', 'room'] as const).map((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'postgame-sheet-seg-btn';
    button.textContent = value === 'review' ? 'Review' : 'Room';
    button.addEventListener('click', () => {
      mode = value;
      syncSegs();
      select(current);
    });
    modeGroup.append(button);
    return { value, button };
  });

  let frameWidth: number | null = null; // null = full
  const widthGroup = document.createElement('div');
  widthGroup.className = 'postgame-sheet-seg';
  const widthButtons = (
    [
      { label: 'Full', value: null },
      { label: 'col3·1300', value: 1300 },
      { label: 'col2·1000', value: 1000 },
    ] as const
  ).map(({ label, value }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'postgame-sheet-seg-btn';
    button.textContent = label;
    button.addEventListener('click', () => {
      frameWidth = value;
      syncSegs();
      applyFrameWidth();
    });
    widthGroup.append(button);
    return { value, button };
  });

  function syncSegs(): void {
    for (const { value, button } of modeButtons) {
      button.classList.toggle('is-active', value === mode);
    }
    for (const { value, button } of widthButtons) {
      button.classList.toggle('is-active', value === frameWidth);
    }
  }

  const openLink = document.createElement('a');
  openLink.className = 'postgame-sheet-open';
  openLink.target = '_blank';
  openLink.rel = 'noreferrer';
  openLink.textContent = t('replay.openExternal');

  bar.append(brand, tabs, spacer, modeGroup, widthGroup, openLink);

  const stage = document.createElement('div');
  stage.className = 'postgame-sheet-stage';
  const frame = document.createElement('iframe');
  frame.className = 'postgame-sheet-frame';
  frame.title = t('replay.postgameReview');
  const empty = document.createElement('div');
  empty.className = 'postgame-sheet-empty';
  stage.append(frame, empty);

  function applyFrameWidth(): void {
    if (frameWidth === null) {
      frame.style.width = '100%';
      frame.style.marginInline = '0';
      frame.style.borderInline = 'none';
    } else {
      frame.style.width = `${frameWidth}px`;
      frame.style.marginInline = 'auto';
      frame.style.borderInline = '1px dashed var(--site-border, #4a453d)';
    }
  }

  shell.append(bar, stage);
  root.append(shell);

  const tabButtons = variants.map((variant, index) => {
    const game = games[index];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'postgame-sheet-tab';
    if (!game) button.classList.add('is-empty');
    const dot = document.createElement('span');
    dot.className = 'postgame-sheet-dot';
    const label = document.createElement('span');
    label.textContent = variant.label;
    button.append(dot, label);
    button.addEventListener('click', () => select(index));
    tabs.append(button);
    return button;
  });

  let current = -1;

  function select(index: number): void {
    if (index < 0 || index >= variants.length) return;
    current = index;
    for (const [i, button] of tabButtons.entries()) {
      button.classList.toggle('is-active', i === index);
    }
    tabButtons[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    const variant = variants[index]!;
    const game = games[index];
    if (!game) {
      frame.style.display = 'none';
      frame.removeAttribute('src');
      empty.style.display = 'grid';
      empty.textContent = `No finished games in the "${variant.channel}" channel — seed one with npm run db:seed:variant-fixtures.`;
      openLink.style.visibility = 'hidden';
      return;
    }
    const href =
      mode === 'room'
        ? `/room/${encodeURIComponent(game.roomId)}`
        : sheetReviewUrl(variant.routeBase, game.roomId);
    empty.style.display = 'none';
    frame.style.display = 'block';
    if (frame.getAttribute('src') !== href) frame.src = href;
    frame.title = `${variant.label} ${mode === 'room' ? 'finished room' : 'postgame review'}`;
    openLink.href = href;
    openLink.style.visibility = 'visible';
    openLink.textContent = `Open ↗ · ${game.plyCount} plies`;
  }

  // Arrow keys page through variants; skip channels with no game so review flows
  // straight across the ones worth looking at.
  function step(delta: number): void {
    if (variants.length === 0) return;
    let index = current;
    for (let i = 0; i < variants.length; i++) {
      index = (index + delta + variants.length) % variants.length;
      if (games[index]) break;
    }
    select(index);
  }
  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(-1);
    }
  });

  syncSegs();
  applyFrameWidth();
  const firstWithGame = games.findIndex(Boolean);
  select(firstWithGame >= 0 ? firstWithGame : 0);
}

function installStyles(): void {
  if (document.getElementById('postgame-sheet-styles')) return;
  const style = document.createElement('style');
  style.id = 'postgame-sheet-styles';
  style.textContent = `
    .postgame-sheet-route {
      position: fixed;
      inset: 0;
      background: var(--site-bg, #12100e);
    }
    .postgame-sheet-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .postgame-sheet-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--site-border, #2c2822);
      background: var(--site-surface, #1a1713);
      flex: 0 0 auto;
    }
    .postgame-sheet-brand {
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--site-muted, #9a9086);
      white-space: nowrap;
    }
    .postgame-sheet-tabs {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: thin;
      flex: 1 1 auto;
    }
    .postgame-sheet-bar-spacer { flex: 0 0 0; }
    .postgame-sheet-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: var(--site-fg, #e8e2d8);
      font-size: 0.8rem;
      white-space: nowrap;
      cursor: pointer;
    }
    .postgame-sheet-tab:hover { background: var(--site-bg, #12100e); }
    .postgame-sheet-tab.is-active {
      border-color: var(--site-accent, #4f9d7f);
      background: color-mix(in srgb, var(--site-accent, #4f9d7f) 18%, transparent);
    }
    .postgame-sheet-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--site-accent, #4f9d7f);
      flex: 0 0 auto;
    }
    .postgame-sheet-tab.is-empty .postgame-sheet-dot { background: var(--site-border, #4a453d); opacity: 0.5; }
    .postgame-sheet-tab.is-empty { color: var(--site-muted, #9a9086); }
    .postgame-sheet-tab.is-disabled { opacity: 0.5; }
    .postgame-sheet-seg {
      display: inline-flex;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--site-border, #2c2822);
      border-radius: 8px;
      flex: 0 0 auto;
    }
    .postgame-sheet-seg-btn {
      padding: 3px 9px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--site-muted, #9a9086);
      font-size: 0.76rem;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
    }
    .postgame-sheet-seg-btn.is-active {
      background: color-mix(in srgb, var(--site-accent, #4f9d7f) 22%, transparent);
      color: var(--site-fg, #e8e2d8);
    }
    .postgame-sheet-open {
      font-size: 0.78rem;
      color: var(--site-muted, #9a9086);
      white-space: nowrap;
      text-decoration: none;
    }
    .postgame-sheet-open:hover { color: var(--site-fg, #e8e2d8); }
    .postgame-sheet-stage {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      background: var(--site-bg, #12100e);
    }
    .postgame-sheet-frame {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: white;
    }
    .postgame-sheet-empty {
      display: none;
      position: absolute;
      inset: 0;
      place-items: center;
      text-align: center;
      padding: 24px;
      color: var(--site-muted, #9a9086);
      font-size: 0.9rem;
    }
  `;
  document.head.append(style);
}
