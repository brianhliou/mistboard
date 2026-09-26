// /embed/tv — Mistboard TV in someone else's page.
//
// The same controller the homepage runs: follow the channel's featured LIVE
// game (moves arrive on a short poll of /api/watch/live), and when there is no
// live game, freeze on the channel's most recently finished one. Nothing that
// finished before the reader arrived ever auto-plays; a game that finishes
// while they watch airs once and then freezes. Fog games can never appear live
// (the server's visibility policy is fail-closed), so the frame never shows a
// position its own players could not see.
//
// `?channel=` picks a /watch channel; the default is the cross-channel election.

import '../app-base.css';
import '../landing.css';
import {
  displayParticipantName,
  type FeaturedGame,
  matchupSeats,
  variantDisplayLabel,
} from '../game-display.js';
import { gameMetaForGame } from '../game-meta.js';
import { pickHeroPovForGame } from '../landing-showcase.js';
import { type LandingTvMode, mountLandingTv } from '../landing-tv.js';
import type { GameMeta } from '../replay.js';
import { renderWatchReplaySkeleton } from '../replay-skeleton.js';
import { type ShowcaseEntry, showcaseAirFields } from '../showcase-cycler.js';
import { specIdForShowcaseVariant } from '../showcase-dispatch.js';
import { boardAspectForSpec } from '../watch-board-aspect.js';
import { fitSoloBoardWidth } from './embed-game-page.js';
import './embed.css';

// How often the finished-game pool is re-read, so a game that ends while the
// reader watches can air. The live game itself polls on its own 4s beat.
const POOL_REFRESH_MS = 60_000;

export type EmbedTvOptions = { channel: string };

function note(root: HTMLElement, message: string): void {
  const box = document.createElement('div');
  box.className = 'embed-note';
  box.textContent = message;
  root.replaceChildren(box);
}

async function loadEvents(roomId: string) {
  const resp = await fetch(`/api/games/${encodeURIComponent(roomId)}/events`);
  if (!resp.ok) throw new Error(`failed to load events for ${roomId}: ${resp.status}`);
  const data = (await resp.json()) as { events: import('@mistboard/game').GameEvent[] };
  return data.events;
}

// The finished-game pool for a channel: the homepage showcase for 'top' (its
// curated cross-variant interleave), the channel's own unlocked feed otherwise.
async function loadPool(channel: string): Promise<FeaturedGame[]> {
  const url =
    channel === 'top' ? '/api/games/showcase' : `/api/watch?channel=${encodeURIComponent(channel)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`failed to load ${url}: ${resp.status}`);
  const data = (await resp.json()) as { games?: FeaturedGame[]; unlocked?: FeaturedGame[] };
  return data.games ?? data.unlocked ?? [];
}

/** Caption under the board: "Xiangqi · live" or "Xiangqi · last game". */
export function tvCaption(variant: string, mode: LandingTvMode): string {
  const name = variantDisplayLabel(variant);
  return mode === 'live' ? `${name} · live` : `${name} · last game`;
}

export async function mountEmbedTv(root: HTMLElement, options: EmbedTvOptions): Promise<void> {
  document.body.classList.add('embed-body');
  document.documentElement.dataset.embed = 'tv';
  root.className = 'embed-root';

  const frame = document.createElement('div');
  frame.className = 'embed-frame';
  const stage = document.createElement('div');
  stage.className = 'embed-tv';
  const boardCol = document.createElement('div');
  boardCol.className = 'embed-board embed-tv-board';
  stage.append(boardCol);
  frame.append(stage);
  const credit = document.createElement('a');
  credit.className = 'embed-credit';
  credit.href =
    options.channel === 'top' ? '/watch' : `/watch?channel=${encodeURIComponent(options.channel)}`;
  credit.target = '_blank';
  credit.rel = 'noopener';
  credit.textContent = 'Mistboard TV · mistboard.com';
  frame.append(credit);
  root.replaceChildren(frame);
  renderWatchReplaySkeleton(boardCol);

  const metadataByRoomId: Record<string, GameMeta> = {};
  const namesByRoomId: Record<string, { first: string; second: string }> = {};
  const variantByRoomId: Record<string, string> = {};
  const toEntry = (game: FeaturedGame): ShowcaseEntry => {
    metadataByRoomId[game.roomId] ??= gameMetaForGame(game);
    const [firstSeat, secondSeat] = matchupSeats(game);
    namesByRoomId[game.roomId] ??= {
      first: displayParticipantName(game, firstSeat),
      second: displayParticipantName(game, secondSeat),
    };
    variantByRoomId[game.roomId] = game.variant;
    return {
      roomId: game.roomId,
      specId: specIdForShowcaseVariant(game.variant),
      pov: pickHeroPovForGame(game),
      endedAt: game.endedAt,
      ...showcaseAirFields(game),
    };
  };

  let pool: ShowcaseEntry[] = [];
  try {
    pool = (await loadPool(options.channel)).map(toEntry);
  } catch {
    // A pool that fails to load is not fatal: a live game can still be shown.
  }
  if (pool.length === 0 && options.channel !== 'top') {
    // An unknown channel answers 400 and an empty one has nothing to freeze on.
    note(root, 'Nothing to show on this channel yet.');
    return;
  }

  // Size the board to the box at the CURRENT game's aspect; games on a
  // cross-variant channel differ, so refit on every change.
  let aspect = boardAspectForSpec(pool[0]?.specId ?? null);
  const fitBoard = (): void => {
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    boardCol.style.width = `${fitSoloBoardWidth(rect, aspect)}px`;
  };
  fitBoard();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitBoard).observe(stage);

  const tv = await mountLandingTv(boardCol, pool, {
    metadataByRoomId,
    namesByRoomId,
    loaderForId: loadEvents,
    isConnected: () => boardCol.isConnected,
    channel: options.channel,
    onGameChange: ({ roomId, specId, mode }) => {
      aspect = boardAspectForSpec(specId);
      fitBoard();
      credit.textContent = `${tvCaption(variantByRoomId[roomId] ?? specId, mode)} · mistboard.com`;
      credit.href = mode === 'live' ? '/watch' : `/game/${encodeURIComponent(roomId)}`;
    },
  });

  const refresh = async (): Promise<void> => {
    if (!boardCol.isConnected) return;
    if (document.visibilityState !== 'hidden') {
      try {
        const fresh = (await loadPool(options.channel)).map(toEntry);
        if (fresh.length > 0) tv.updateCompletedPool(fresh);
      } catch {
        // Keep the current pool.
      }
    }
    window.setTimeout(() => void refresh(), POOL_REFRESH_MS);
  };
  window.setTimeout(() => void refresh(), POOL_REFRESH_MS);
  document.title = 'Mistboard TV';
}
