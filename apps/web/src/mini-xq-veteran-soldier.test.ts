import { createInitialMiniXiangqiState, getMiniXiangqiPlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  miniXiangqiPieceGhostSvg,
  miniXiangqiTruthView,
  renderMiniXiangqiBoardSvg,
} from './live-mini-xiangqi-render.js';
import { renderVariantMiniBoard } from './variant-mini-boards.js';

// The Mini Xiangqi family gives the soldier its sideways step unconditionally,
// so every soldier is a veteran and draws with the promoted-soldier art.
// Fortress Xiangqi did too until 2026-09-02, when it reverted to the river gate. This is the cross-surface guard: the article diagrams,
// the live board, the replay and the variant cards all have to agree, because
// the last time this rule was open-coded per renderer the copies drifted and
// the same soldier was a veteran on one surface and a recruit on another.
//
// Only the international sets have distinct crossed art, so the assertions read
// hrefs from that set.

const PLAIN_SOLDIER = /\/(red|black)-soldier\.png/;

describe('mini xiangqi veteran soldier art', () => {
  it('promotes soldiers on the live board', () => {
    const state = createInitialMiniXiangqiState('veteran-test');
    const svg = renderMiniXiangqiBoardSvg(miniXiangqiTruthView(state), 'red', {
      pieceSet: 'international',
      showFog: false,
    });

    expect(svg).toContain('red-crossed-soldier.png');
    expect(svg).toContain('black-crossed-soldier.png');
    expect(svg).not.toMatch(PLAIN_SOLDIER);
  });

  it('leaves shrouded blockers as hidden tokens under fog', () => {
    const state = createInitialMiniXiangqiState('veteran-fog-test');
    const svg = renderMiniXiangqiBoardSvg(getMiniXiangqiPlayerView(state, 'red'), 'red', {
      pieceSet: 'international',
    });

    // Red's own soldiers are promoted; Black is shrouded, so no black soldier
    // art of either kind may appear.
    expect(svg).toContain('red-crossed-soldier.png');
    expect(svg).not.toContain('black-crossed-soldier.png');
    expect(svg).not.toMatch(PLAIN_SOLDIER);
  });

  it('promotes the drag ghost, so it matches the piece it lifted', () => {
    const ghost = miniXiangqiPieceGhostSvg({ color: 'red', role: 'soldier' }, 'international');

    expect(ghost).toContain('red-crossed-soldier.png');
    expect(ghost).not.toMatch(PLAIN_SOLDIER);
  });

  it.each(['mini-xiangqi', 'dark-mini-xiangqi'] as const)(
    'promotes soldiers on the %s variant card',
    (id) => {
      const svg = renderVariantMiniBoard(id, { xqSet: 'international' });

      expect(svg).toContain('crossed-soldier.png');
      expect(svg).not.toMatch(PLAIN_SOLDIER);
    },
  );

  it.each(['xiangqi', 'fortress-xiangqi'] as const)(
    'leaves the %s card alone: those soldiers are river-gated',
    (id) => {
      // Fortress joined this list on 2026-09-02 when its soldier was reverted
      // from veteran to river-gated; its card soldiers sit on their own half.
      const svg = renderVariantMiniBoard(id, { xqSet: 'international' });

      expect(svg).toMatch(PLAIN_SOLDIER);
      expect(svg).not.toContain('crossed-soldier.png');
    },
  );
});
