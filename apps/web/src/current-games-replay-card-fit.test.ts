// A /games card mounts the replay renderer in its square tile. Fog of War chess
// picks a one-seat pane (replay-layout-single-white/-black, replay.ts), and
// until 2026-10-16 only replay-layout-solo was stretched to the tile, so the
// fog card kept the replay page's 200px board in a 156px tile and clipped its
// last file and rank. jsdom has no layout, so this pins the rules instead: every
// layout the replay can pick for one pane fills the tile, and the pane's clock
// rows (the card has its own seat lines) are hidden.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'current-games.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const replaySource = readFileSync(resolve(__dirname, 'replay.ts'), 'utf8');

function ruleBodiesFor(selector: string): string[] {
  const bodies: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

const ONE_PANE_LAYOUTS = [
  'replay-layout-solo',
  'replay-layout-single-white',
  'replay-layout-single-black',
];

describe('/games card fits a replay board to its tile', () => {
  it('knows the one-seat layouts the replay can choose', () => {
    for (const layout of ONE_PANE_LAYOUTS.slice(1)) expect(replaySource).toContain(`'${layout}'`);
  });

  it.each(ONE_PANE_LAYOUTS)('stretches %s, its pane and its board to the tile', (layout) => {
    expect(ruleBodiesFor(`.current-game-board .${layout}`).join(';')).toMatch(/height:\s*100%/);
    for (const child of ['replay-pane', 'replay-board']) {
      const body = ruleBodiesFor(`.current-game-board .${layout} .${child}`).join(';');
      expect(body).toMatch(/width:\s*100%/);
      expect(body).toMatch(/height:\s*100%/);
      expect(body).toMatch(/min-width:\s*0/);
    }
  });

  it('hides the replay clock rows, which would squeeze the board', () => {
    for (const part of ['replay-clock-row', 'replay-pane-clock-slot']) {
      expect(ruleBodiesFor(`.current-game-board .${part}`).join(';')).toMatch(/display:\s*none/);
    }
  });
});
