// The TV uses only server-projected public frames, including every live-history ply.
import { type ThreeKingdomsBanqiPlayerView, threeKingdomsBanqiMoveLabel } from '@mistboard/game';
import { banqiResultLabel, seatInkLabel } from './banqi-result-label.js';
import { flipSeatInk } from './flip-seat-ink.js';
import { installBanqiBoardStyles } from './live-banqi-render.js';
import {
  loadThreeKingdomsBanqiPostgame,
  type ThreeKingdomsBanqiPostgameResponse,
} from './live-three-kingdoms-banqi-postgame.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { threeKingdomsBanqiLastMoverInk } from './three-kingdoms-banqi-board.js';
import {
  renderThreeKingdomsBanqiLiveBoardSvg,
  type TkBoardArrow,
  type TkBoardMarker,
} from './three-kingdoms-banqi-diagrams.js';
import {
  mountTenantWatchReplay,
  type TenantWatchReplayOptions,
  tenantMoveLabelsFromViews,
} from './watch-tenant-replay.js';

function viewAtPly(postgame: ThreeKingdomsBanqiPostgameResponse, _key: 'truth', ply: number) {
  return postgame.history?.truth?.find((entry) => entry.ply === ply)?.view ?? postgame.view;
}

export function mountThreeKingdomsBanqiWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: TenantWatchReplayOptions,
) {
  return mountTenantWatchReplay<
    ThreeKingdomsBanqiPostgameResponse,
    ThreeKingdomsBanqiPlayerView,
    'truth'
  >(root, roomId, options, {
    installStyles: installBanqiBoardStyles,
    appearanceEvent: xiangqiAppearanceChangedEvent,
    loadPostgame: loadThreeKingdomsBanqiPostgame,
    maxPly: (postgame) => postgame.game.plyCount,
    viewEntries: () => [{ key: 'truth', label: 'Public board' }],
    viewAtPly,
    moveLabels: (postgame) =>
      tenantMoveLabelsFromViews(
        postgame.timeline,
        (ply) => viewAtPly(postgame, 'truth', ply),
        (move, view) => {
          const piece = view?.board[move.to];
          return threeKingdomsBanqiMoveLabel(move, piece && !piece.faceDown ? piece : null);
        },
      ),
    paneKind: () => 'truth',
    renderBoard: (view, _orientation, _key, overlay) =>
      renderThreeKingdomsBanqiLiveBoardSvg(view.board, {
        selected: null,
        targets: [],
        draggingFrom: null,
        lastMove: view.lastMove ?? null,
        lastMoveInk: threeKingdomsBanqiLastMoverInk(view),
        arrows: overlay.arrows as readonly TkBoardArrow[],
        markers: overlay.glyphs as readonly TkBoardMarker[],
      }),
    fillCaptures: () => {},
    resultLabel: (result, postgame) => banqiResultLabel(result, postgame.view.firstColor),
    seatLabel: (seat, postgame) => seatInkLabel(seat, postgame.view.firstColor),
    seatInk: (seat, postgame) => flipSeatInk(seat, postgame.view.firstColor ?? null),
  });
}
