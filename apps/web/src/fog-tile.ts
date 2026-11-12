// The misty tile shown in place of a board for a hidden-information game on
// /games and /correspondence (Fog Xiangqi, Fog Chess, Banqi, Three Kingdoms
// Banqi, Flip Jungle and any later one).
//
// It takes the variant id and a fixed note and nothing else: the marker is the
// variant's own art, the same for every game of it, so the tile can say nothing
// about one game's pieces. Never pass it a game, a view or a position.
import { variantDisplayLabel } from './game-display.js';
import { isVariantMarkerId, renderVariantMarker } from './variant-markers.js';
import type { VariantMiniId } from './variant-mini-boards.js';

const FOG_WAVES =
  '<svg viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 8c6-5 12 5 19 0s13-5 19 0M3 16c6-5 12 5 19 0s13-5 19 0M3 24c6-5 12 5 19 0s13-5 19 0"/></svg>';

/** The marker a hidden-information variant shows on its tile; plain fog rooms
 *  ('fog') are Fog Chess. Null keeps the generic waves. */
export function fogTileMarkerId(gameSpecId: string): VariantMiniId | null {
  const id = gameSpecId === 'fog' ? 'dark-chess' : gameSpecId;
  return isVariantMarkerId(id) ? id : null;
}

export function buildFogTile(gameSpecId: string, note: string | null): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'current-game-fog';
  const markerId = fogTileMarkerId(gameSpecId);
  const art = document.createElement('span');
  if (markerId) {
    tile.classList.add('has-marker');
    art.className = 'current-game-fog-marker notranslate';
    art.setAttribute('translate', 'no');
    art.setAttribute('aria-hidden', 'true');
    art.innerHTML = renderVariantMarker(markerId, { size: 160, label: '' });
  } else {
    art.className = 'current-game-fog-waves';
    art.innerHTML = FOG_WAVES;
  }
  const name = document.createElement('span');
  name.className = 'current-game-fog-variant';
  name.textContent = variantDisplayLabel(gameSpecId);
  tile.append(art, name);
  if (note) {
    const text = document.createElement('span');
    text.className = 'current-game-fog-note';
    text.textContent = note;
    tile.append(text);
  }
  return tile;
}
