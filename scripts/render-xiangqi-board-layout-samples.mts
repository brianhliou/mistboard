import { mkdir, writeFile } from 'node:fs/promises';
import {
  applyMove,
  createInitialXiangqiState,
  getStandardXiangqiPlayerView,
  type StandardXiangqiGameState,
  type XiangqiMove,
} from '@mistboard/game';
import { renderXiangqiBoardSvg } from '../apps/web/src/xiangqi-board.ts';

const outputDir = '/private/tmp/mistboard-xiangqi-board-layout-samples';
const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    location: { search: '' },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  },
});

const styles = `
  .xq-live-bg,.xq-live-cell--light{fill:#f5dca8}
  .xq-live-line,.xq-live-palace line{stroke:#5a3a14;stroke-width:1.2}
  .xq-live-cell--dark{fill:#dfbd82}
  .xq-live-cell-line{stroke:#5a3a14;stroke-opacity:.38;stroke-width:1}
  .xq-live-palace-band{fill:none}
  .xq-live-svg--cell .xq-live-palace-band{fill:#925f88;fill-opacity:.16}
  .xq-live-svg--cell .xq-live-palace line{stroke-width:2;stroke-opacity:.68}
  .xq-live-cell-river{fill:#6badd0}
  .xq-live-river-label{display:none}
  .xq-live-lastmove-cell{fill:#a16207;opacity:.34}
  .xq-live-lastmove-ring{fill:none;stroke:#d6af4e;stroke-width:4}
`;

function withStyles(svg: string): string {
  return svg.replace(
    'xmlns="http://www.w3.org/2000/svg">',
    `xmlns="http://www.w3.org/2000/svg"><style>${styles}</style>`,
  );
}

function replay(id: string, moves: readonly XiangqiMove[]): StandardXiangqiGameState {
  let state = createInitialXiangqiState(id);
  for (const move of moves) state = applyMove(state, move);
  return state;
}

async function renderSample(
  name: string,
  state: StandardXiangqiGameState,
  layout: 'intersection' | 'cell',
  pieceSet: 'traditional' | 'international',
): Promise<void> {
  storage.set('mistboard.xiangqiPieceSet', pieceSet);
  storage.set('mistboard.xiangqiPieceSetVersion', '3');
  const view = getStandardXiangqiPlayerView(state, 'red');
  await writeFile(
    `${outputDir}/${name}.svg`,
    withStyles(renderXiangqiBoardSvg(view, 'red', { layout })),
    'utf8',
  );
}

await mkdir(outputDir, { recursive: true });
const start = createInitialXiangqiState('layout-start');
const sampleGame = replay('layout-game', [
  { from: 'h3', to: 'e3' },
  { from: 'h8', to: 'e8' },
  { from: 'b1', to: 'c3' },
  { from: 'b10', to: 'c8' },
  { from: 'i1', to: 'i2' },
  { from: 'i10', to: 'i9' },
  { from: 'a4', to: 'a5' },
  { from: 'a7', to: 'a6' },
]);

await renderSample('classic-start-traditional', start, 'intersection', 'traditional');
await renderSample('square-start-traditional', start, 'cell', 'traditional');
await renderSample('classic-start-international', start, 'intersection', 'international');
await renderSample('square-start-international', start, 'cell', 'international');
await renderSample('square-game-international', sampleGame, 'cell', 'international');
