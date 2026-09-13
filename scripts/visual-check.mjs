import { mkdir } from 'node:fs/promises';

import { launchChromium } from './lib/launch-browser.mjs';

const outputDir = '/private/tmp/mistboard-visual-check';
const baseUrl = process.env.MISTBOARD_WEB_URL ?? 'http://127.0.0.1:3000';
const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });

const browser = await launchChromium();
const failures = [];
const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const playPage = await browser.newPage({ viewport: viewports[0] });
await playPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
await playPage.waitForSelector('.landing-play-panel');
const playMetrics = await playPage.evaluate(() => ({
  actions: [...document.querySelectorAll('.landing-play-action')].map(
    (button) => button.textContent?.trim() ?? '',
  ),
  horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
}));
if (playMetrics.actions.join('|') !== 'Find opponent|Challenge a friend|Play the engine') {
  failures.push(
    `play page: expected lobby, friend, and engine actions, found ${playMetrics.actions.join(', ')}`,
  );
}
if (playMetrics.horizontalOverflow > 1) {
  failures.push(`play page: horizontal overflow is ${playMetrics.horizontalOverflow}px`);
}
const playPath = `${outputDir}/play.png`;
await playPage.screenshot({ path: playPath, fullPage: true });
console.log(`play page: ${JSON.stringify(playMetrics)} screenshot=${playPath}`);
await playPage.close();

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport });
  const room = `visual-${viewport.name}-${Date.now()}`;
  await page.goto(`${baseUrl}/room/${encodeURIComponent(room)}?reset=1&variant=fog-of-war`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('.board.cg-wrap');
  await page.waitForSelector('square.fog-hidden');
  await page.waitForSelector('piece');
  await page.waitForTimeout(250);

  const metrics = await page.evaluate(() => {
    const board = document.querySelector('.board.cg-wrap');
    const panel = document.querySelector('.side-panel');
    if (!board || !panel) throw new Error('missing board or side panel');

    const boardRect = board.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      boardHeight: boardRect.height,
      boardWidth: boardRect.width,
      fogHiddenCount: document.querySelectorAll('square.fog-hidden').length,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      mobilePanelBelowBoard: window.innerWidth > 780 ? true : panelRect.top >= boardRect.bottom - 1,
      pieceCount: document.querySelectorAll('piece:not(.fading)').length,
      roomLinks: [...document.querySelectorAll('.room-actions a')].map((link) => ({
        href: link.getAttribute('href') ?? '',
        label: link.textContent ?? '',
      })),
    };
  });

  if (Math.abs(metrics.boardWidth - metrics.boardHeight) > 1) {
    failures.push(
      `${viewport.name}: board is not square (${metrics.boardWidth}x${metrics.boardHeight})`,
    );
  }
  if (metrics.pieceCount <= 0 || metrics.pieceCount >= 32) {
    failures.push(
      `${viewport.name}: expected partial Fog piece render, found ${metrics.pieceCount}`,
    );
  }
  if (metrics.fogHiddenCount <= 0) {
    failures.push(`${viewport.name}: expected hidden fog squares`);
  }
  if (metrics.horizontalOverflow > 1) {
    failures.push(`${viewport.name}: horizontal overflow is ${metrics.horizontalOverflow}px`);
  }
  if (!metrics.mobilePanelBelowBoard) {
    failures.push(`${viewport.name}: side panel is not stacked below the board`);
  }
  if (metrics.roomLinks.length !== 1) {
    failures.push(
      `${viewport.name}: expected 1 room action link, found ${metrics.roomLinks.length}`,
    );
  }
  if (
    !metrics.roomLinks.some(
      (link) =>
        (link.label === 'Back home' || link.label.startsWith('Back to ')) &&
        (link.href === '/' || link.href === '/play'),
    )
  ) {
    failures.push(`${viewport.name}: missing back room action`);
  }
  if (metrics.roomLinks.some((link) => link.href.includes('dev=engine'))) {
    failures.push(
      `${viewport.name}: random-engine debug link should not be in the normal room picker`,
    );
  }
  const screenshotPath = `${outputDir}/${viewport.name}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`${viewport.name}: ${JSON.stringify(metrics)} screenshot=${screenshotPath}`);
  await page.close();

  const fogPage = await browser.newPage({ viewport });
  const fogRoom = `visual-fog-${viewport.name}-${Date.now()}`;
  await fogPage.goto(`${baseUrl}/room/${encodeURIComponent(fogRoom)}?reset=1&variant=fog-of-war`, {
    waitUntil: 'networkidle',
  });
  await fogPage.waitForSelector('.board.cg-wrap');
  await fogPage.waitForSelector('square.fog-hidden');
  await fogPage.waitForSelector('piece');
  await fogPage.waitForTimeout(250);

  const fogMetrics = await fogPage.evaluate(() => {
    const board = document.querySelector('.board.cg-wrap');
    const panel = document.querySelector('.side-panel');
    if (!board || !panel) throw new Error('missing board or side panel');

    const boardRect = board.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      boardHeight: boardRect.height,
      boardWidth: boardRect.width,
      fogHiddenCount: document.querySelectorAll('square.fog-hidden').length,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      mobilePanelBelowBoard: window.innerWidth > 780 ? true : panelRect.top >= boardRect.bottom - 1,
      pieceCount: document.querySelectorAll('piece:not(.fading)').length,
    };
  });

  if (Math.abs(fogMetrics.boardWidth - fogMetrics.boardHeight) > 1) {
    failures.push(
      `fog ${viewport.name}: board is not square (${fogMetrics.boardWidth}x${fogMetrics.boardHeight})`,
    );
  }
  if (fogMetrics.pieceCount <= 0 || fogMetrics.pieceCount >= 32) {
    failures.push(
      `fog ${viewport.name}: expected partial piece render, found ${fogMetrics.pieceCount}`,
    );
  }
  if (fogMetrics.fogHiddenCount <= 0) {
    failures.push(`fog ${viewport.name}: expected hidden fog squares`);
  }
  if (fogMetrics.horizontalOverflow > 1) {
    failures.push(
      `fog ${viewport.name}: horizontal overflow is ${fogMetrics.horizontalOverflow}px`,
    );
  }
  if (!fogMetrics.mobilePanelBelowBoard) {
    failures.push(`fog ${viewport.name}: side panel is not stacked below the board`);
  }

  const fogScreenshotPath = `${outputDir}/fog-${viewport.name}.png`;
  await fogPage.screenshot({ path: fogScreenshotPath, fullPage: true });
  console.log(
    `fog ${viewport.name}: ${JSON.stringify(fogMetrics)} screenshot=${fogScreenshotPath}`,
  );
  await fogPage.close();
}

const engineRoom = `visual-engine-${Date.now()}`;
const enginePage = await browser.newPage({ viewport: viewports[0] });
await enginePage.goto(
  `${baseUrl}/room/${encodeURIComponent(engineRoom)}?reset=1&variant=fog-of-war&dev=engine`,
  { waitUntil: 'networkidle' },
);
await enginePage.waitForFunction(() => window.__MISTBOARD_DEBUG__?.().seat === 'white');
await enginePage.waitForSelector('[data-dev-views-section]:not([hidden])');
await enginePage.waitForSelector('.dev-board');
await movePiece(enginePage, 'e2', 'e4');
await enginePage.waitForFunction(() => {
  const debug = window.__MISTBOARD_DEBUG__?.();
  return (
    debug?.currentView?.status.type === 'playing' &&
    debug.currentView.status.turn === 'white' &&
    debug.devViews?.truth.board.e4?.color === 'white'
  );
});
await enginePage.waitForTimeout(250);

const engineMetrics = await enginePage.evaluate(() => {
  const debug = window.__MISTBOARD_DEBUG__?.();
  if (!debug?.devViews) throw new Error('missing engine dev views');
  return {
    devBoards: document.querySelectorAll('.dev-board').length,
    e4Truth: debug.devViews.truth.board.e4,
    visibleMoveEvents: debug.events.filter((event) => event.type === 'move-played').length,
    visibleEngineMoveEvents: debug.events.filter(
      (event) => event.type === 'move-played' && event.color === 'black',
    ).length,
    opponent: debug.devViews.opponent,
    scrollOverflow: document.documentElement.scrollHeight - window.innerHeight,
    status: debug.currentView?.status,
    title: document.querySelector('h1')?.textContent,
    trueHiddenSquares: document.querySelectorAll(
      '.dev-board[aria-label="True view"] .dev-square.hidden',
    ).length,
  };
});
if (engineMetrics.devBoards !== 3) {
  failures.push(`engine harness: expected 3 dev boards, found ${engineMetrics.devBoards}`);
}
if (engineMetrics.opponent !== 'black') {
  failures.push(`engine harness: expected black random opponent, found ${engineMetrics.opponent}`);
}
if (engineMetrics.e4Truth?.color !== 'white' || engineMetrics.e4Truth?.role !== 'pawn') {
  failures.push(
    `engine harness: expected white pawn on e4 in true view, found ${JSON.stringify(engineMetrics.e4Truth)}`,
  );
}
if (engineMetrics.visibleMoveEvents !== 1 || engineMetrics.visibleEngineMoveEvents !== 0) {
  failures.push(
    `engine harness: expected only the human live move event visible, found visible=${engineMetrics.visibleMoveEvents} engine=${engineMetrics.visibleEngineMoveEvents}`,
  );
}
if (engineMetrics.title !== 'Fog Debug') {
  failures.push(`engine harness: expected Fog Debug page title, found ${engineMetrics.title}`);
}
if (engineMetrics.trueHiddenSquares !== 0) {
  failures.push(
    `engine harness: expected true view to be fully clear, found ${engineMetrics.trueHiddenSquares} hidden squares`,
  );
}
if (engineMetrics.scrollOverflow > 160) {
  failures.push(
    `engine harness: expected bounded vertical scroll, found ${engineMetrics.scrollOverflow}px overflow`,
  );
}
const enginePath = `${outputDir}/engine-harness.png`;
await enginePage.screenshot({ path: enginePath, fullPage: true });
console.log(`engine harness: ${JSON.stringify(engineMetrics)} screenshot=${enginePath}`);
await enginePage.close();

const fogVisionRoom = `visual-fog-vision-${Date.now()}`;
const whiteVisionPage = await browser.newPage({ viewport: viewports[0] });
const blackVisionPage = await browser.newPage({ viewport: viewports[0] });
await whiteVisionPage.goto(
  `${baseUrl}/room/${encodeURIComponent(fogVisionRoom)}?reset=1&variant=fog-of-war`,
  { waitUntil: 'networkidle' },
);
await blackVisionPage.goto(
  `${baseUrl}/room/${encodeURIComponent(fogVisionRoom)}?variant=fog-of-war`,
  { waitUntil: 'networkidle' },
);
await whiteVisionPage.waitForFunction(() => window.__MISTBOARD_DEBUG__?.().seat === 'white');
await blackVisionPage.waitForFunction(() => window.__MISTBOARD_DEBUG__?.().seat === 'black');
await whiteVisionPage.waitForSelector('.board.cg-wrap');
await blackVisionPage.waitForSelector('.board.cg-wrap');

await movePiece(whiteVisionPage, 'e2', 'e4');
await whiteVisionPage.waitForFunction(
  () =>
    window.__MISTBOARD_DEBUG__?.().currentView?.status.type === 'playing' &&
    window.__MISTBOARD_DEBUG__?.().currentView?.status.turn === 'black',
);
await movePiece(blackVisionPage, 'a7', 'a6');
await blackVisionPage.waitForFunction(
  () =>
    window.__MISTBOARD_DEBUG__?.().currentView?.status.type === 'playing' &&
    window.__MISTBOARD_DEBUG__?.().currentView?.status.turn === 'white',
);
await movePiece(whiteVisionPage, 'e4', 'e5');
await whiteVisionPage.waitForFunction(
  () =>
    window.__MISTBOARD_DEBUG__?.().currentView?.status.type === 'playing' &&
    window.__MISTBOARD_DEBUG__?.().currentView?.status.turn === 'black',
);
await movePiece(blackVisionPage, 'd7', 'd5');
await whiteVisionPage.waitForFunction(() => {
  const view = window.__MISTBOARD_DEBUG__?.().currentView;
  return (
    view?.status.type === 'playing' &&
    view.status.turn === 'white' &&
    view.board.d5?.role === 'pawn'
  );
});

const fogVisionMetrics = await whiteVisionPage.evaluate(() => {
  const view = window.__MISTBOARD_DEBUG__?.().currentView;
  if (!view) throw new Error('missing Fog vision view');
  return {
    d5Piece: view.board.d5,
    d5Visible: view.visibleSquares.includes('d5'),
    d6Visible: view.visibleSquares.includes('d6'),
    fogHiddenCount: document.querySelectorAll('square.fog-hidden').length,
    visibleMoveEvents:
      window.__MISTBOARD_DEBUG__?.().events.filter((event) => event.type === 'move-played')
        .length ?? 0,
    visibleOpponentMoveEvents:
      window
        .__MISTBOARD_DEBUG__?.()
        .events.filter((event) => event.type === 'move-played' && event.color === 'black').length ??
      0,
    pieceCount: document.querySelectorAll('piece:not(.fading)').length,
  };
});
if (fogVisionMetrics.d5Piece?.color !== 'black' || fogVisionMetrics.d5Piece?.role !== 'pawn') {
  failures.push(
    `fog vision: expected black pawn visible on d5, found ${JSON.stringify(fogVisionMetrics.d5Piece)}`,
  );
}
if (!fogVisionMetrics.d5Visible || !fogVisionMetrics.d6Visible) {
  failures.push(
    `fog vision: expected d5 and d6 visible, found d5=${fogVisionMetrics.d5Visible} d6=${fogVisionMetrics.d6Visible}`,
  );
}
if (fogVisionMetrics.visibleMoveEvents !== 2 || fogVisionMetrics.visibleOpponentMoveEvents !== 0) {
  failures.push(
    `fog vision: expected only White's live move events visible, found visible=${fogVisionMetrics.visibleMoveEvents} opponent=${fogVisionMetrics.visibleOpponentMoveEvents}`,
  );
}

const fogVisionWhitePath = `${outputDir}/fog-vision-white.png`;
const fogVisionBlackPath = `${outputDir}/fog-vision-black.png`;
await whiteVisionPage.screenshot({ path: fogVisionWhitePath, fullPage: true });
await blackVisionPage.screenshot({ path: fogVisionBlackPath, fullPage: true });
console.log(
  `fog vision: ${JSON.stringify(fogVisionMetrics)} screenshots=${fogVisionWhitePath},${fogVisionBlackPath}`,
);
await whiteVisionPage.close();
await blackVisionPage.close();

const fogFlowRoom = `visual-fog-flow-${Date.now()}`;
const whitePage = await browser.newPage({ viewport: viewports[0] });
const blackPage = await browser.newPage({ viewport: viewports[0] });
await whitePage.goto(
  `${baseUrl}/room/${encodeURIComponent(fogFlowRoom)}?reset=1&variant=fog-of-war&views=all`,
  { waitUntil: 'networkidle' },
);
await blackPage.goto(`${baseUrl}/room/${encodeURIComponent(fogFlowRoom)}?variant=fog-of-war`, {
  waitUntil: 'networkidle',
});
await whitePage.waitForFunction(() => window.__MISTBOARD_DEBUG__?.().seat === 'white');
await blackPage.waitForFunction(() => window.__MISTBOARD_DEBUG__?.().seat === 'black');
await whitePage.waitForSelector('.board.cg-wrap');
await blackPage.waitForSelector('.board.cg-wrap');

await movePiece(whitePage, 'e2', 'e4');
await whitePage.waitForFunction(
  () =>
    window.__MISTBOARD_DEBUG__?.().currentView?.status.type === 'playing' &&
    window.__MISTBOARD_DEBUG__?.().currentView?.status.turn === 'black',
);
await movePiece(blackPage, 'f7', 'f6');
await blackPage.waitForFunction(
  () =>
    window.__MISTBOARD_DEBUG__?.().currentView?.status.type === 'playing' &&
    window.__MISTBOARD_DEBUG__?.().currentView?.status.turn === 'white',
);
await movePiece(whitePage, 'd1', 'h5');
await whitePage.waitForFunction(
  () =>
    window.__MISTBOARD_DEBUG__?.().currentView?.status.type === 'playing' &&
    window.__MISTBOARD_DEBUG__?.().currentView?.status.turn === 'black',
);
await movePiece(blackPage, 'e8', 'f7');
await blackPage.waitForFunction(
  () =>
    window.__MISTBOARD_DEBUG__?.().currentView?.status.type === 'playing' &&
    window.__MISTBOARD_DEBUG__?.().currentView?.status.turn === 'white',
);
await movePiece(whitePage, 'h5', 'f7');
await whitePage.waitForFunction(() => {
  const debug = window.__MISTBOARD_DEBUG__?.();
  return (
    debug?.currentView?.status.type === 'finished' &&
    debug.events.filter((event) => event.type === 'move-played').length === 3 &&
    debug.currentView.visibleSquares.length < 64 &&
    debug.devViews?.player.visibleSquares.length === 64 &&
    debug.devViews.opponentView.visibleSquares.length === 64 &&
    debug.devViews.truth.visibleSquares.length === 64 &&
    document.querySelectorAll('square.fog-hidden').length > 0
  );
});

const fogTerminalMetrics = await whitePage.evaluate(() => {
  const debug = window.__MISTBOARD_DEBUG__?.();
  if (!debug?.devViews || !debug.currentView) throw new Error('missing terminal Fog debug views');
  return {
    mainVisibleSquares: debug.currentView.visibleSquares.length,
    opponentVisibleSquares: debug.devViews.opponentView.visibleSquares.length,
    playerVisibleSquares: debug.devViews.player.visibleSquares.length,
    trueVisibleSquares: debug.devViews.truth.visibleSquares.length,
    hiddenSquares: document.querySelectorAll('square.fog-hidden').length,
    visibleMoveEvents: debug.events.filter((event) => event.type === 'move-played').length,
    visibleOpponentMoveEvents: debug.events.filter(
      (event) => event.type === 'move-played' && event.color === 'black',
    ).length,
  };
});
if (
  fogTerminalMetrics.mainVisibleSquares >= 64 ||
  fogTerminalMetrics.playerVisibleSquares !== 64 ||
  fogTerminalMetrics.opponentVisibleSquares !== 64 ||
  fogTerminalMetrics.trueVisibleSquares !== 64 ||
  fogTerminalMetrics.hiddenSquares <= 0 ||
  fogTerminalMetrics.visibleMoveEvents !== 3 ||
  fogTerminalMetrics.visibleOpponentMoveEvents !== 0
) {
  failures.push(
    `fog terminal room redaction: expected live board fogged with full debug views, found ${JSON.stringify(fogTerminalMetrics)}`,
  );
}

await whitePage.locator('[data-replay="first"]').click();
await whitePage.waitForTimeout(500);

const fogFlowMetrics = await whitePage.evaluate(() => {
  const debug = window.__MISTBOARD_DEBUG__?.();
  const view = debug?.currentView;
  if (!debug || !view) throw new Error('missing Fog flow view');
  return {
    debugTruthVisibleSquares: debug.devViews?.truth.visibleSquares.length,
    e8Piece: view.board.e8,
    e2Piece: view.board.e2,
    e4Piece: view.board.e4,
    f6Piece: view.board.f6,
    f7Piece: view.board.f7,
    fogHiddenCount: document.querySelectorAll('square.fog-hidden').length,
    moveEvents: debug.events.filter((event) => event.type === 'move-played').length,
    opponentMoveEvents: debug.events.filter(
      (event) => event.type === 'move-played' && event.color === 'black',
    ).length,
    pieceCount: document.querySelectorAll('piece:not(.fading)').length,
    replayVisibleSquares: view.visibleSquares.length,
  };
});
if (fogFlowMetrics.e8Piece !== undefined) {
  failures.push(
    `fog flow replay: expected black king hidden on e8, found ${JSON.stringify(fogFlowMetrics.e8Piece)}`,
  );
}
if (fogFlowMetrics.f7Piece !== undefined || fogFlowMetrics.e2Piece?.color !== 'white') {
  failures.push(
    `fog flow replay: expected white pawn visible and black pawn hidden, found e2=${JSON.stringify(fogFlowMetrics.e2Piece)} f7=${JSON.stringify(fogFlowMetrics.f7Piece)}`,
  );
}
if (fogFlowMetrics.e4Piece !== undefined || fogFlowMetrics.f6Piece !== undefined) {
  failures.push(
    `fog flow replay: expected moved pawns absent from e4/f6 at first event, found e4=${JSON.stringify(fogFlowMetrics.e4Piece)} f6=${JSON.stringify(fogFlowMetrics.f6Piece)}`,
  );
}
if (fogFlowMetrics.replayVisibleSquares >= 64 || fogFlowMetrics.fogHiddenCount <= 0) {
  failures.push(
    `fog flow replay: expected fogged player replay board, found visible=${fogFlowMetrics.replayVisibleSquares} hidden=${fogFlowMetrics.fogHiddenCount}`,
  );
}
if (fogFlowMetrics.debugTruthVisibleSquares !== 64) {
  failures.push(
    `fog flow replay: expected debug true view to stay fully visible, found visible=${fogFlowMetrics.debugTruthVisibleSquares}`,
  );
}
if (fogFlowMetrics.moveEvents !== 3 || fogFlowMetrics.opponentMoveEvents !== 0) {
  failures.push(
    `fog flow: expected only own move events in live-room history, found own+visible=${fogFlowMetrics.moveEvents} opponent=${fogFlowMetrics.opponentMoveEvents}`,
  );
}

const fogFlowWhitePath = `${outputDir}/fog-flow-white.png`;
const fogFlowBlackPath = `${outputDir}/fog-flow-black.png`;
await whitePage.screenshot({ path: fogFlowWhitePath, fullPage: true });
await blackPage.screenshot({ path: fogFlowBlackPath, fullPage: true });
console.log(
  `fog flow: ${JSON.stringify(fogFlowMetrics)} screenshots=${fogFlowWhitePath},${fogFlowBlackPath}`,
);
await whitePage.close();
await blackPage.close();

await browser.close();

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

async function movePiece(page, from, to) {
  try {
    await page.waitForFunction((square) => {
      const view = window.__MISTBOARD_DEBUG__?.().currentView;
      return view?.legalMoves.some((move) => move.from === square);
    }, from);
  } catch (error) {
    const debug = await page.evaluate(() => {
      const snapshot = window.__MISTBOARD_DEBUG__?.();
      return {
        seat: snapshot?.seat,
        status: snapshot?.currentView?.status,
        legalMoves: snapshot?.currentView?.legalMoves,
        visibleBoard: snapshot?.currentView?.board,
      };
    });
    console.error(`move ${from}-${to} unavailable: ${JSON.stringify(debug)}`);
    throw error;
  }
  await clickSquare(page, from);
  await clickSquare(page, to);
}

async function clickSquare(page, square) {
  const box = await page.locator('.board.cg-wrap').boundingBox();
  if (!box) throw new Error('missing board box');

  const orientation = await page.evaluate(
    () => window.__MISTBOARD_DEBUG__?.().currentView?.perspective ?? 'white',
  );
  const fileIndex = files.indexOf(square[0]);
  const rank = Number(square[1]);
  const column = orientation === 'white' ? fileIndex : 7 - fileIndex;
  const row = orientation === 'white' ? 8 - rank : rank - 1;
  await page.mouse.click(
    box.x + ((column + 0.5) * box.width) / 8,
    box.y + ((row + 0.5) * box.height) / 8,
  );
}
