// A public authored chapter replays on the study page's fog kernel, including
// moves into attack and the final general capture. The board and per-seat
// projections are the same ones its tree review uses, with no room API reads.
import type { EmbedPov, XiangqiColor, XiangqiMove } from '@mistboard/game';
import { renderDarkXiangqiBoardSvg } from './live-dark-xiangqi.js';
import { darkXiangqiTreeAdapter as adapter } from './review/dark-xiangqi-tree-adapter.js';
import { type ChapterAnnotations, GLYPH_SUFFIX_CLASS } from './study-chapter-annotations.js';
import './live-xiangqi.css';

export function replayDarkXiangqiStudy(moves: readonly string[]) {
  let truth = adapter.initialTruth();
  const states = [truth];
  const played: XiangqiMove[] = [];
  for (const token of moves) {
    const move = adapter.fromUci(token, truth);
    if (!move || !adapter.isLegal(truth, move)) break;
    truth = adapter.applyMove(truth, move);
    states.push(truth);
    played.push(move);
  }
  return { states, played };
}

export function mountDarkXiangqiStudyReplay(
  host: HTMLElement,
  line: ReturnType<typeof replayDarkXiangqiStudy>,
  annotations: Pick<ChapterAnnotations, 'glyphs' | 'notes'>,
  orientation: XiangqiColor,
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
) {
  const frame = document.createElement('div');
  frame.className = 'dxq-postgame__board xiangqi-live-board';
  host.replaceChildren(frame);
  let index = 0;
  let pov: EmbedPov = 'truth';
  // The embed contract calls the first seat "white"; in xiangqi it is Red.
  const perspective = (): XiangqiColor =>
    pov === 'truth' ? orientation : pov === 'white' ? 'red' : 'black';
  function render(): void {
    const key = pov === 'white' ? 'red' : pov;
    const projection = adapter.project(line.states[index]!).find((view) => view.key === key)!;
    frame.innerHTML = renderDarkXiangqiBoardSvg(projection.view, perspective(), {
      showFog: pov !== 'truth',
    });
    hooks.onPlyChange?.(index, line.played.length);
  }
  render();
  return {
    destroy: () => host.replaceChildren(),
    jumpToPly: (ply: number) => {
      index = Math.max(0, Math.min(line.played.length, Math.trunc(ply)));
      render();
    },
    plyCount: () => line.played.length,
    moveEntries: () =>
      line.played.map((move, i) => {
        const ply = i + 1;
        const glyph = annotations.glyphs[ply];
        const note = annotations.notes[ply];
        return {
          ply,
          label: adapter.moveLabel(move, line.states[i]!),
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
        };
      }),
    bottomSeat: (): 'first' | 'second' => (perspective() === 'red' ? 'first' : 'second'),
    setPov: (next: EmbedPov) => {
      pov = next;
      render();
    },
  };
}
