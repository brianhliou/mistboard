// A finished game's cached advice uses the same single-line navigation contract
// as a study. The watch handle still owns the mainline, clocks and overlays.
import type { EmbedPov } from '@mistboard/game';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import type { EmbedBoardHandle } from './embed-card.js';
import { loadStoredAlternatives } from './embed-variant-lines.js';

export async function installEmbedGameLines(
  host: HTMLElement,
  handle: EmbedBoardHandle,
  specId: string,
  roomId: string,
  bestMoves: ReadonlyMap<number, string>,
  pov: EmbedPov | null,
): Promise<void> {
  if (!bestMoves.size || !handle.jumpToPly || handle.jumpToLine) return;
  const destroy = handle.destroy.bind(handle);
  let destroyed = false;
  // A view picker can replace this handle while the public record loads.
  // Never attach the old view's branch to the replacement board.
  handle.destroy = () => {
    destroyed = true;
    destroy();
  };
  const lines = await loadStoredAlternatives(specId, roomId, bestMoves, pov);
  if (destroyed || !lines.size) return;
  const main = document.createElement('div');
  main.append(...host.childNodes);
  const branch = document.createElement('div');
  branch.className = 'embed-game-alternative';
  branch.hidden = true;
  host.append(main, branch);
  const entries = handle.moveEntries?.bind(handle);
  const jump = handle.jumpToPly.bind(handle);
  let selected: number | null = null;
  let cleanup: (() => void) | undefined;
  const paint = () => {
    if (selected === null) return;
    cleanup?.();
    cleanup = lines.get(selected)?.mount(branch);
  };
  window.addEventListener(xiangqiAppearanceChangedEvent, paint);
  handle.moveEntries = () =>
    (entries?.() ?? []).map((entry) => {
      const alternative = lines.get(entry.ply);
      return alternative ? { ...entry, line: { moves: [alternative.label] } } : entry;
    });
  handle.jumpToLine = (atPly, cursor) => {
    if (cursor !== 1 || !lines.has(atPly)) return;
    if (selected !== atPly) jump(atPly - 1);
    selected = atPly;
    main.hidden = true;
    branch.hidden = false;
    paint();
  };
  handle.jumpToPly = (ply) => {
    selected = null;
    cleanup?.();
    cleanup = undefined;
    branch.hidden = true;
    main.hidden = false;
    jump(ply);
  };
  handle.destroy = () => {
    destroyed = true;
    window.removeEventListener(xiangqiAppearanceChangedEvent, paint);
    cleanup?.();
    destroy();
  };
}
