// Replay only the stored recommendation, using each review's rules adapter and
// public postgame record. No engine requests and no invented continuation.
import {
  banqiRulesFromView,
  type EmbedPov,
  engineUciToBanqiMove,
  engineUciToJungleFlipMove,
  type GameEvent,
  jungleFlipLastMoverInk,
} from '@mistboard/game';
import { atomicXiangqiBlastMarkers } from '../atomic-xiangqi-board.js';
import type { AtomicXiangqiPostgameResponse } from '../atomic-xiangqi-postgame.js';
import type { FortressXiangqiPostgameResponse } from '../fortress-xiangqi-postgame.js';
import { renderFortressXiangqiBoardSvg } from '../fortress-xiangqi-render.js';
import { fillFortressXiangqiReserve } from '../fortress-xiangqi-view.js';
import { type JungleFlipRenderBoard, renderJungleFlipBoardSvg } from '../jungle-flip-render.js';
import { renderJungleBoardSvg } from '../jungle-render.js';
import type { BanqiPostgameResponse } from '../live-banqi-postgame.js';
import { renderBanqiBoardSvg } from '../live-banqi-render.js';
import type { JungleFlipPostgameResponse } from '../live-jungle-flip-postgame.js';
import type { JunglePostgameResponse } from '../live-jungle-postgame.js';
import { createBoard, setBoardFromView } from '../replay-board.js';
import { atomicXiangqiTreeAdapter } from '../review/atomic-xiangqi-tree-adapter.js';
import { makeBanqiTreeAdapter, recoverBanqiDeal } from '../review/banqi-tree-adapter.js';
import { darkChessTreeAdapter } from '../review/dark-chess-tree-adapter.js';
import { fortressXiangqiTreeAdapter } from '../review/fortress-xiangqi-tree-adapter.js';
import type { VariantTreeAdapter } from '../review/game-tree.js';
import {
  makeJungleFlipTreeAdapter,
  recoverJungleFlipDeal,
} from '../review/jungle-flip-tree-adapter.js';
import { jungleTreeAdapter } from '../review/jungle-tree-adapter.js';
import { xiangqiTreeAdapter } from '../review/xiangqi-tree-adapter.js';
import { renderXiangqiBoardSvg } from '../xiangqi-board.js';
import type { XiangqiPostgameResponse } from '../xiangqi-postgame.js';

export type StoredAlternative<View> = { label: string; view: View };
type RenderedAlternative = {
  label: string;
  mount(host: HTMLElement): (() => void) | undefined;
};
type Timeline<Move> = ReadonlyArray<{ type: string; move?: Move }>;

/** Project immediately: the branch data carries a player view, never a truth
 * state or a hidden deal. A malformed record invalidates all of its branches. */
export function storedAlternativeViews<Move, Truth, View>(
  adapter: VariantTreeAdapter<Move, Truth, View>,
  timeline: Timeline<Move>,
  bestMoves: ReadonlyMap<number, string>,
  options: {
    parse?: (uci: string, truth: Truth) => Move | null;
    canReplay?: (move: Move) => boolean;
    viewKey?: string;
  } = {},
): Map<number, StoredAlternative<View>> {
  const result = new Map<number, StoredAlternative<View>>();
  try {
    let truth = adapter.initialTruth();
    let ply = 0;
    for (const event of timeline) {
      if (event.type !== 'move-played') continue;
      if (!event.move || !adapter.isLegal(truth, event.move)) return new Map();
      ply += 1;
      const uci = bestMoves.get(ply);
      if (uci) {
        // Invalid advice must not suppress other valid stored recommendations.
        try {
          const move = (options.parse ?? adapter.fromUci)(uci, truth);
          if (
            move &&
            (options.canReplay?.(move) ?? true) &&
            adapter.isLegal(truth, move) &&
            adapter.moveKey(move) !== adapter.moveKey(event.move)
          ) {
            const after = adapter.applyMove(truth, move);
            if (after !== truth) {
              const view = adapter
                .project(after)
                .find((v) => v.key === (options.viewKey ?? 'truth'))?.view;
              if (view) result.set(ply, { label: adapter.moveLabel(move, truth), view });
            }
          }
        } catch {
          /* Unavailable/illegal advice is not a playable branch. */
        }
      }
      truth = adapter.applyMove(truth, event.move);
    }
    return result;
  } catch {
    return new Map();
  }
}

function svgLines<View>(
  lines: ReadonlyMap<number, StoredAlternative<View>>,
  render: (view: View, host: HTMLElement) => void,
): Map<number, RenderedAlternative> {
  return new Map(
    [...lines].map(([ply, { label, view }]) => [
      ply,
      {
        label,
        mount: (host: HTMLElement) => {
          host.replaceChildren();
          render(view, host);
          return undefined;
        },
      },
    ]),
  );
}

function svgBoard(host: HTMLElement, svg: string): void {
  const layout = document.createElement('div');
  layout.className = 'replay-layout-solo';
  const board = document.createElement('div');
  board.className = 'replay-board';
  board.innerHTML = svg;
  layout.append(board);
  host.append(layout);
}

async function publicRecord<T>(route: string, roomId: string): Promise<T | null> {
  const response = await fetch(`/api/${route}/games/${encodeURIComponent(roomId)}`);
  return response.ok ? (response.json() as Promise<T>) : null;
}

/** A flip may show only an identity that the played public line turned over.
 * The revealed root supplies the fixed deal; it does not authorize new reveals. */
function publicFlips<Move extends { from: string; to: string }>(
  timeline: Timeline<Move>,
): Set<string> {
  return new Set(
    timeline.flatMap((e) =>
      e.type === 'move-played' && e.move && e.move.from === e.move.to ? [e.move.from] : [],
    ),
  );
}

export async function loadStoredAlternatives(
  specId: string,
  roomId: string,
  bestMoves: ReadonlyMap<number, string>,
  pov: EmbedPov | null,
): Promise<Map<number, RenderedAlternative>> {
  const perspective = pov === 'black' ? 'black' : 'red';
  // Explicitly supported dispatch only; unlisted/unknown variants get no branches.
  switch (specId) {
    case 'xiangqi': {
      const record = await publicRecord<XiangqiPostgameResponse>('xiangqi', roomId);
      return record
        ? svgLines(
            storedAlternativeViews(xiangqiTreeAdapter, record.timeline, bestMoves),
            (view, host) => svgBoard(host, renderXiangqiBoardSvg(view, perspective)),
          )
        : new Map();
    }
    case 'atomic-xiangqi': {
      const record = await publicRecord<AtomicXiangqiPostgameResponse>(specId, roomId);
      return record
        ? svgLines(
            storedAlternativeViews(atomicXiangqiTreeAdapter, record.timeline, bestMoves),
            (view, host) =>
              svgBoard(
                host,
                renderXiangqiBoardSvg(view, perspective, {
                  markers: atomicXiangqiBlastMarkers(view, { fresh: false }),
                }),
              ),
          )
        : new Map();
    }
    case 'fortress-xiangqi': {
      const record = await publicRecord<FortressXiangqiPostgameResponse>(specId, roomId);
      return record
        ? svgLines(
            storedAlternativeViews(fortressXiangqiTreeAdapter, record.timeline, bestMoves),
            (view, host) => {
              const frame = document.createElement('div');
              frame.className = 'fxq-embed-board';
              for (const owner of [perspective === 'red' ? 'black' : 'red', perspective] as const) {
                const hand = document.createElement('div');
                hand.className = 'fxq-embed-hand';
                fillFortressXiangqiReserve(hand, view, owner, { allRoles: true, pocket: true });
                frame.append(hand);
                if (owner !== perspective) {
                  const board = document.createElement('div');
                  board.className = 'fxq-embed-board-svg';
                  board.innerHTML = renderFortressXiangqiBoardSvg(view, perspective);
                  frame.append(board);
                }
              }
              host.append(frame);
            },
          )
        : new Map();
    }
    case 'jungle': {
      const record = await publicRecord<JunglePostgameResponse>(specId, roomId);
      return record
        ? svgLines(
            storedAlternativeViews(jungleTreeAdapter, record.timeline, bestMoves),
            (view, host) =>
              svgBoard(
                host,
                renderJungleBoardSvg(view.board, {
                  perspective,
                  lastMove: view.lastMove ?? null,
                }),
              ),
          )
        : new Map();
    }
    case 'banqi': {
      const record = await publicRecord<BanqiPostgameResponse>(specId, roomId);
      const root = record?.history?.revealed?.find((s) => s.ply === 0)?.view;
      if (!record || !root) return new Map();
      const adapter = makeBanqiTreeAdapter(roomId, {
        deal: recoverBanqiDeal(root),
        rules: banqiRulesFromView(record.view),
      });
      const known = publicFlips(record.timeline);
      return svgLines(
        storedAlternativeViews(adapter, record.timeline, bestMoves, {
          parse: engineUciToBanqiMove,
          canReplay: (move) => move.from !== move.to || known.has(move.from),
        }),
        (view, host) => svgBoard(host, renderBanqiBoardSvg(view, perspective)),
      );
    }
    case 'jungle-flip': {
      const record = await publicRecord<JungleFlipPostgameResponse>(specId, roomId);
      const root = record?.history?.revealed?.find((s) => s.ply === 0)?.view;
      if (!record || !root) return new Map();
      const adapter = makeJungleFlipTreeAdapter(roomId, recoverJungleFlipDeal(root));
      const known = publicFlips(record.timeline);
      return svgLines(
        storedAlternativeViews(adapter, record.timeline, bestMoves, {
          parse: engineUciToJungleFlipMove,
          canReplay: (move) => move.from !== move.to || known.has(move.from),
        }),
        (view, host) =>
          svgBoard(
            host,
            renderJungleFlipBoardSvg(view.board as JungleFlipRenderBoard, {
              lastMove: view.lastMove ?? null,
              lastMoveInk: jungleFlipLastMoverInk(view),
            }),
          ),
      );
    }
    case 'dark-chess': {
      const response = await fetch(`/api/games/${encodeURIComponent(roomId)}/events`);
      if (!response.ok) return new Map();
      const record = (await response.json()) as { events: GameEvent[] };
      const lines = storedAlternativeViews(darkChessTreeAdapter, record.events, bestMoves, {
        viewKey: pov === 'white' || pov === 'black' ? pov : 'truth',
        parse: (uci, truth) =>
          /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)
            ? darkChessTreeAdapter.fromUci(uci, truth)
            : null,
      });
      return new Map(
        [...lines].map(([ply, { label, view }]) => [
          ply,
          {
            label,
            mount: (host: HTMLElement) => {
              host.replaceChildren();
              const pane = document.createElement('div');
              pane.className = 'replay-pane-truth';
              const board = document.createElement('div');
              board.className = 'board replay-board';
              pane.append(board);
              host.append(pane);
              const orientation = pov === 'black' ? 'black' : 'white';
              const api = createBoard(board, orientation);
              setBoardFromView(api, view, orientation, false);
              return () => api.destroy();
            },
          },
        ]),
      );
    }
    default:
      return new Map();
  }
}
