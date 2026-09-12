import { createInitialCrazyhouseState, getCrazyhousePlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { renderCrazyhouseBoardSvg } from './crazyhouse-render.js';

describe('Dark Crazyhouse board renderer', () => {
  it('uses the dark-chess square tokens without an outer frame', () => {
    const view = getCrazyhousePlayerView(createInitialCrazyhouseState('dczh-style'), 'white');
    const svg = renderCrazyhouseBoardSvg(view, { showFog: false });

    expect(svg).toContain('class="crazyhouse-live-svg"');
    expect(svg).not.toContain('var(--board-frame)');
    expect(svg).toContain('var(--board-light)');
    expect(svg).toContain('var(--board-dark)');
  });

  it('emits light and dark fog squares for themed dark-chess fog styling', () => {
    const view = getCrazyhousePlayerView(createInitialCrazyhouseState('dczh-fog'), 'white');
    const svg = renderCrazyhouseBoardSvg(view, { showFog: true });

    expect(svg).toContain('crazyhouse-fog-square crazyhouse-fog-square--light');
    expect(svg).toContain('crazyhouse-fog-square crazyhouse-fog-square--dark');
    expect(svg).not.toContain('var(--board-fog-light-fill)');
  });

  it('renders board pieces at the full dark-chess square scale', () => {
    const view = getCrazyhousePlayerView(createInitialCrazyhouseState('dczh-pieces'), 'white');
    const svg = renderCrazyhouseBoardSvg(view, { showFog: false });

    expect(svg).toMatch(/<svg x="\d+" y="\d+" width="50" height="50" viewBox="0 0 45 45"/);
    expect(svg).not.toContain('width="43" height="43"');
  });

  it('emits hit targets, selection, and drop target markers when interactive', () => {
    const view = getCrazyhousePlayerView(createInitialCrazyhouseState('dczh-interactive'), 'white');
    const svg = renderCrazyhouseBoardSvg(
      {
        ...view,
        board: {
          a1: { color: 'white', role: 'king' },
          a2: { color: 'black', role: 'pawn' },
        },
      },
      {
        showFog: false,
        interactive: true,
        selected: 'a1',
        targets: ['a2', 'a3'],
      },
    );

    expect((svg.match(/data-square="/g) ?? []).length).toBe(64);
    expect(svg).toContain('data-square="a1"');
    expect(svg).toContain('rgba(31,111,91,0.32)');
    expect(svg).toContain('rgba(31,111,91,0.72)');
    expect(svg).toContain('rgba(31,111,91,0.48)');
    expect(svg).toContain('mb-grid-target-hover');
  });

  it('marks the dragged source piece as an origin ghost', () => {
    const view = getCrazyhousePlayerView(createInitialCrazyhouseState('dczh-drag-source'), 'white');
    const svg = renderCrazyhouseBoardSvg(
      {
        ...view,
        board: {
          a1: { color: 'white', role: 'king' },
        },
      },
      {
        showFog: false,
        draggingFrom: 'a1',
      },
    );

    expect(svg).toContain('crazyhouse-board-piece crazyhouse-board-piece--drag-source');
  });
});
