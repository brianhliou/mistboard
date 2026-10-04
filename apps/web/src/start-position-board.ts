// The starting position of a variant as a static board SVG, for open-seek
// cards (/games, /correspondence): a seek is a game that has not started, so
// its card shows the board both players will sit down to.
//
// Every board comes from the variant's own rules kernel (createInitial*State,
// then the seat view a player would get), drawn by the same renderer the live
// game uses, so a seek card never carries a second copy of a start position.
// Face-down variants (jieqi, banqi, flip jungle) draw face-down pieces, exactly
// what a seated player sees before the first move. Fog variants and any id
// without a renderer here return null; the caller keeps its marker or misty
// tile. Each renderer is a dynamic import so the cards pay only for the
// variants on screen.

export async function renderStartPositionSvg(gameSpecId: string): Promise<string | null> {
  const id = `start-${gameSpecId}`;
  switch (gameSpecId) {
    case 'xiangqi':
    case 'atomic-xiangqi':
    case 'duck-xiangqi':
    case 'crazyhouse-xiangqi':
      return xiangqiFamilyStart(gameSpecId, id);
    case 'jieqi': {
      const [game, render] = await Promise.all([
        import('@mistboard/game'),
        import('./live-jieqi-render.js'),
      ]);
      render.installJieqiBoardStyles();
      const view = game.getJieqiPlayerView(game.createInitialJieqiState(id), 'red');
      return render.renderJieqiBoardSvg(view, 'red', { coordinates: false });
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
        'red',
      );
      return render.renderFortressXiangqiBoardSvg(view, 'red', { coordinates: false });
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
async function xiangqiFamilyStart(gameSpecId: string, id: string): Promise<string> {
  const [game, render] = await Promise.all([
    import('@mistboard/game'),
    import('./xiangqi-board.js'),
    import('./live-xiangqi.css'),
  ]);
  const view = game.getStandardXiangqiPlayerView(game.createInitialXiangqiState(id), 'red');
  const board =
    gameSpecId === 'crazyhouse-xiangqi'
      ? game.createInitialCrazyhouseXiangqiState(id).board
      : gameSpecId === 'atomic-xiangqi'
        ? game.createInitialAtomicXiangqiState(id).board
        : view.board;
  return render.renderXiangqiBoardSvg({ ...view, board, legalMoves: [] }, 'red', {
    coordinates: false,
  });
}
