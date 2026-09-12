// DEV-ONLY variant sheet (/showcase-sheet): renders every variant's opening
// position inside the real homepage showcase widget, in a grid, so the widget can
// be tweaked across all board shapes at once. Data-driven from the live watch feed
// (run the dev server proxied at prod). The board cells carry the `.showcase-widget`
// class, so they share landing.css's widget styling with the homepage — tweak
// there and every cell (and the homepage) updates. Never shipped (DEV-gated).

import { displayParticipantName, type FeaturedGame, matchupSeats } from './game-display.js';
import { gameMetaForGame } from './game-meta.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { mountShowcaseBoard } from './showcase-board.js';
import { specIdForShowcaseVariant } from './showcase-dispatch.js';
import { buildNav } from './site-shell.js';

const SHEET_VARIANTS: ReadonlyArray<{ labelKey: I18nKey; channel: string }> = [
  { labelKey: 'variant.darkChess.name', channel: 'dark-chess' },
  { labelKey: 'variant.jungle.name', channel: 'jungle' },
  { labelKey: 'variant.jungleFlip.name', channel: 'jungle-flip' },
  { labelKey: 'variant.banqi.name', channel: 'banqi' },
  { labelKey: 'variant.jieqi.name', channel: 'jieqi' },
  { labelKey: 'variant.miniXiangqi.name', channel: 'mini-xiangqi' },
  { labelKey: 'variant.darkMiniXiangqi.name', channel: 'dark-mini-xiangqi' },
  { labelKey: 'variant.fortressXiangqi.name', channel: 'fortress-xiangqi' },
  { labelKey: 'variant.duckXiangqi.name', channel: 'duck-xiangqi' },
];

async function firstGameForChannel(channel: string): Promise<FeaturedGame | null> {
  try {
    const resp = await fetch(`/api/watch?channel=${encodeURIComponent(channel)}`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { unlocked?: FeaturedGame[] };
    // Prefer a longer game so the opening is a real position, not an early resign.
    const games = [...(data.unlocked ?? [])].sort((a, b) => b.plyCount - a.plyCount);
    return games[0] ?? null;
  } catch {
    return null;
  }
}

async function chessEvents(roomId: string): Promise<import('@mistboard/game').GameEvent[]> {
  const resp = await fetch(`/api/games/${encodeURIComponent(roomId)}/events`);
  if (!resp.ok) return [];
  const data = (await resp.json()) as { events: import('@mistboard/game').GameEvent[] };
  return data.events;
}

export async function mountShowcaseSheet(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page', 'showcase-sheet-route');
  installStyles();

  const main = document.createElement('main');
  main.className = 'showcase-sheet';
  const intro = document.createElement('p');
  intro.className = 'showcase-sheet-intro';
  intro.textContent =
    'Every variant’s opening in the homepage widget. Tweak .showcase-widget / .replay-layout-solo in landing.css — every cell and the homepage update together.';
  const grid = document.createElement('div');
  grid.className = 'showcase-sheet-grid';
  main.append(intro, grid);
  root.append(buildNav(), main);

  for (const variant of SHEET_VARIANTS) {
    // The variant name is a caption ABOVE the panel (not inside it), so the panel
    // itself is exactly what production home renders.
    const item = document.createElement('section');
    item.className = 'showcase-sheet-item';
    const caption = document.createElement('div');
    caption.className = 'showcase-sheet-caption';
    caption.textContent = t(variant.labelKey);
    // .showcase-widget now carries the full production panel chrome (shared with
    // the homepage), so the board mounts into the real panel.
    const widget = document.createElement('div');
    widget.className = 'showcase-widget';
    item.append(caption, widget);
    grid.append(item);

    void (async () => {
      const game = await firstGameForChannel(variant.channel);
      if (!game) {
        widget.classList.add('showcase-sheet-empty');
        widget.textContent = 'no games';
        return;
      }
      try {
        await mountShowcaseBoard(widget, specIdForShowcaseVariant(game.variant), game.roomId, {
          metadataByRoomId: { [game.roomId]: gameMetaForGame(game) },
          namesByRoomId: {
            [game.roomId]: {
              first: displayParticipantName(game, matchupSeats(game)[0]),
              second: displayParticipantName(game, matchupSeats(game)[1]),
            },
          },
          autoplay: false, // paused at the opening position
          pov: 'white',
          loaderForId: chessEvents,
        });
      } catch (err) {
        console.warn('[showcase-sheet] mount failed', variant.channel, err);
        widget.classList.add('showcase-sheet-empty');
        widget.textContent = 'failed to load';
      }
    })();
  }
}

function installStyles(): void {
  if (document.getElementById('showcase-sheet-styles')) return;
  const style = document.createElement('style');
  style.id = 'showcase-sheet-styles';
  style.textContent = `
    .showcase-sheet { width: 100%; padding: 16px clamp(16px, 2.5vw, 36px) 60px; }
    .showcase-sheet-intro { color: var(--site-muted); max-width: 70ch; margin: 4px 0 18px; }
    .showcase-sheet-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(490px, 1fr));
      gap: clamp(18px, 2vw, 32px);
      align-items: start;
      justify-items: center;
    }
    .showcase-sheet-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .showcase-sheet-caption {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--site-muted);
    }
    .showcase-sheet-empty {
      display: grid;
      place-items: center;
      min-height: var(--showcase-widget-size);
      color: var(--site-muted);
    }
  `;
  document.head.append(style);
}
