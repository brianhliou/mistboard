// The starting position of a variant as a static board SVG, for open-seek
// cards (/games, /correspondence): a seek is a game that has not started, so
// its card shows the board both players will sit down to.
//
// Every board comes from the variant's own rules kernel (createInitial*State,
// then the seat view a player would get), drawn by the same renderer the live
// game uses, so a seek card never carries a second copy of a start position.
// Face-down variants (jieqi, banqi, flip jungle) draw face-down pieces, exactly
// what a seated player sees before the first move. Each renderer is a dynamic
// import so the cards pay only for the variants on screen.
//
// `side` is the seat the board is drawn for: your own seek posted as Black
// draws from Black's side. Fog variants draw only for a named seat, and then
// only that seat's view (seat-start-view.ts); with no side (someone else's
// seek on /games or the lobby) they return null and the caller keeps its tile,
// since a non-participant has no seat view of hidden information. Banqi and
// the jungle boards have no sides to turn to and stay as drawn. Any id without
// a renderer here returns null.

import type { SeatSide } from './seat-start-view.js';

export async function renderStartPositionSvg(
  gameSpecId: string,
  side?: SeatSide,
): Promise<string | null> {
  const id = `start-${gameSpecId}`;
  const color = side === 'second' ? 'black' : 'red';
  switch (gameSpecId) {
    case 'xiangqi':
    case 'atomic-xiangqi':
    case 'duck-xiangqi':
    case 'crazyhouse-xiangqi':
      return xiangqiFamilyStart(gameSpecId, id, color);
    case 'dark-xiangqi': {
      if (!side) return null;
      const [seat, render] = await Promise.all([
        import('./seat-start-view.js'),
        import('./live-dark-xiangqi.js'),
      ]);
      const view = seat.fogXiangqiSeatStartView(side, id);
      return render.renderDarkXiangqiBoardSvg(view, view.perspective);
    }
    case 'dark-chess': {
      if (!side) return null;
      const [seat, render] = await Promise.all([
        import('./seat-start-view.js'),
        import('./dark-chess-render.js'),
      ]);
      const view = seat.fogChessSeatStartView(side, id);
      return render.renderDarkChessBoardSvg(view, { perspective: view.perspective });
    }
    case 'jieqi': {
      const [game, render] = await Promise.all([
        import('@mistboard/game'),
        import('./live-jieqi-render.js'),
      ]);
      render.installJieqiBoardStyles();
      const view = game.getJieqiPlayerView(game.createInitialJieqiState(id), color);
      return render.renderJieqiBoardSvg(view, color, { coordinates: false });
    }
    case 'banqi': {
      const [game, render] = await Promise.all([
        import('@mistboard/game'),
        import('./live-banqi-render.js'),
      ]);
      render.installBanqiBoardStyles();
      const view = game.getBanqiPlayerView(game.createInitialBanqiState(id), 'red');
      return render.renderBanqiBoardSvg(view, 'red');
    }
    case 'fortress-xiangqi': {
      const [game, render] = await Promise.all([
        import('@mistboard/game'),
        import('./fortress-xiangqi-render.js'),
      ]);
      render.installFortressXiangqiBoardStyles();
      const view = game.getFortressXiangqiPlayerView(
        game.createInitialFortressXiangqiState(id),
        color,
      );
      return render.renderFortressXiangqiBoardSvg(view, color, { coordinates: false });
    }
    case 'jungle': {
      const [game, render] = await Promise.all([
        import('@mistboard/game'),
        import('./jungle-render.js'),
      ]);
      return render.renderJungleBoardSvg(game.createInitialJungleState(id).board, {
        idSuffix: `-${id}`,
      });
    }
    case 'jungle-flip': {
      const [game, render] = await Promise.all([
        import('@mistboard/game'),
        import('./jungle-flip-render.js'),
      ]);
      const view = game.getJungleFlipPlayerView(game.createInitialJungleFlipState(id), 'red');
      return render.renderJungleFlipBoardSvg(view.board, { idSuffix: `-${id}` });
    }
    default:
      return null;
  }
}

// Xiangqi and the variants that play on its board with its pieces. Atomic and
// duck start from the xiangqi position (the duck enters on Red's first turn);
// crazyhouse starts with the advisors and elephants in hand, so its kernel's
// board is the one to draw.
async function xiangqiFamilyStart(
  gameSpecId: string,
  id: string,
  color: 'red' | 'black',
): Promise<string> {
  const [game, render] = await Promise.all([
    import('@mistboard/game'),
    import('./xiangqi-board.js'),
    import('./live-xiangqi.css'),
  ]);
  const view = game.getStandardXiangqiPlayerView(game.createInitialXiangqiState(id), color);
  const board =
    gameSpecId === 'crazyhouse-xiangqi'
      ? game.createInitialCrazyhouseXiangqiState(id).board
      : gameSpecId === 'atomic-xiangqi'
        ? game.createInitialAtomicXiangqiState(id).board
        : view.board;
  return render.renderXiangqiBoardSvg({ ...view, board, legalMoves: [] }, color, {
    coordinates: false,
  });
}
