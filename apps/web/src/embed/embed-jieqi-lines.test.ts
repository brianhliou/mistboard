import {
  createInitialJieqiState,
  getJieqiPlayerView,
  type JieqiSquare,
  jieqiTruthView,
} from '@mistboard/game';
import { afterEach, expect, it, vi } from 'vitest';
import { JIEQI_PLATFORM_GAME } from '../jieqi-platform-game.js';
import type { JieqiPostgameResponse } from '../live-jieqi-postgame.js';
import type { EmbedBoardHandle } from './embed-card.js';
import { installJieqiEmbedLines, publicJieqiReplay } from './embed-jieqi-lines.js';

function fixture(): JieqiPostgameResponse {
  const state = createInitialJieqiState('public-embed', JIEQI_PLATFORM_GAME.deal);
  const moves = JIEQI_PLATFORM_GAME.moves.split(/\s+/).map((token) => {
    const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token)!;
    return { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare };
  });
  return {
    history: { truth: [{ ply: 0, view: jieqiTruthView(state) }] },
    timeline: moves.map((move) => ({ type: 'move-played', move, at: 0 })),
  } as JieqiPostgameResponse;
}
afterEach(() => vi.unstubAllGlobals());

it('keeps never-determined board pieces masked throughout the reconstructed public record', () => {
  const line = publicJieqiReplay(fixture())!;
  expect(line.played).toHaveLength(146);
  expect(line.states.at(-1)?.status).toEqual({
    type: 'finished',
    winner: 'black',
    reason: 'checkmate',
  });
  for (const state of line.states) {
    for (const color of ['red', 'black'] as const) {
      const view = JSON.parse(JSON.stringify(getJieqiPlayerView(state, color)));
      for (const piece of Object.values(view.board) as Array<{
        unknown?: boolean;
        role?: string;
      }>) {
        if (piece?.unknown) expect(piece.role).toBeUndefined();
      }
    }
  }
});

it('plays stored UCI alternatives, restores the mainline and refuses sampled unknown reveals', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => fixture() })),
  );
  const host = document.createElement('div');
  const main = document.createElement('div');
  main.textContent = 'Mainline';
  host.append(main);
  const jump = vi.fn();
  const destroy = vi.fn();
  const handle: EmbedBoardHandle = {
    jumpToPly: jump,
    destroy,
    moveEntries: () => [
      { ply: 21, label: 'h3-h10+' },
      { ply: 37, label: 'b3-c3' },
    ],
  };
  const unknownReveals = await installJieqiEmbedLines(
    host,
    handle,
    'public-game',
    new Map([
      [21, 'd0e1'],
      [37, 'b2d2'],
    ]),
    'black',
  );
  expect([...unknownReveals]).toEqual([21]);
  expect(handle.moveEntries!()[0]?.line).toBeUndefined();
  expect(handle.moveEntries!()[1]?.line?.moves).toEqual(['b3-d3']);
  handle.jumpToLine!(37, 1);
  expect(jump).toHaveBeenCalledWith(36);
  expect(main.parentElement?.hidden).toBe(true);
  expect(host.querySelector('.jieqi-embed-board')?.parentElement?.hidden).toBe(false);
  handle.jumpToPly!(37);
  expect(main.parentElement?.hidden).toBe(false);
  expect(jump).toHaveBeenCalledWith(37);
  handle.destroy();
  expect(destroy).toHaveBeenCalledOnce();
});
