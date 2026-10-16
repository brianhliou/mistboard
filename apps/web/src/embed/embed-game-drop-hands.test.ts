import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { boardAspectForSpec } from '../watch-board-aspect.js';
import { EMBED_HAND_BAND_RATIO, embedColumnAspect } from './embed-card.js';
import { mountEmbedGame } from './embed-game-page.js';

// The card is replaced with a recorder: the question is what column it was
// asked to size, which jsdom cannot lay out.
const cardCalls: Array<{ aspect: number }> = [];
vi.mock('./embed-card.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./embed-card.js')>();
  return {
    ...actual,
    mountEmbedCard: async (_root: HTMLElement, options: { aspect: number }) => {
      cardCalls.push(options);
      return { remountBoard: async () => {} };
    },
  };
});

async function cardAspectFor(variant: string): Promise<number | undefined> {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ game: { roomId: 'r', variant, result: 'black-wins', mode: 'pve' } }),
  }));
  cardCalls.length = 0;
  await mountEmbedGame(document.createElement('div'), { roomId: 'r' });
  vi.unstubAllGlobals();
  return cardCalls[0]?.aspect;
}

describe('a drop variant on the game embed', () => {
  it('sizes the column for the board plus both hands, not the board alone', async () => {
    // The watch board draws each hand as a band above and below the board.
    // Sized as the bare board, the card left the hands no room: the crazyhouse
    // embed collapsed to a strip of oversized pocket pieces (2026-10-02).
    for (const variant of ['crazyhouse-xiangqi', 'fortress-xiangqi']) {
      const board = boardAspectForSpec(variant);
      const hand = EMBED_HAND_BAND_RATIO[variant] ?? 0;
      expect(hand, variant).toBeGreaterThan(0);
      expect(await cardAspectFor(variant), variant).toBeCloseTo(1 / (1 / board + 2 * hand), 6);
    }
    // Board-only variants keep the board's own ratio.
    for (const variant of ['atomic-xiangqi', 'duck-xiangqi', 'xiangqi']) {
      expect(await cardAspectFor(variant), variant).toBe(boardAspectForSpec(variant));
      expect(embedColumnAspect(variant), variant).toBe(boardAspectForSpec(variant));
    }
  });

  it('keeps embed.css on the same band numbers the card sizes with', () => {
    // The column aspect (TS) and the band heights (CSS) are one number written
    // twice; a drift leaves the board overflowing or floating in its column.
    const cssPath = ['src/embed/embed.css', 'apps/web/src/embed/embed.css']
      .map((candidate) => resolve(process.cwd(), candidate))
      .find((candidate) => existsSync(candidate));
    const css = readFileSync(cssPath as string, 'utf8');
    const chx = EMBED_HAND_BAND_RATIO['crazyhouse-xiangqi'];
    const fxq = EMBED_HAND_BAND_RATIO['fortress-xiangqi'];
    // Study boards.
    expect(css).toMatch(
      new RegExp(`\\.chx-embed-hand-band \\{[^}]*height: calc\\(100cqw \\* ${chx}\\)`),
    );
    expect(css).toMatch(new RegExp(`--drop-mini-hand-band-height: calc\\(100cqw \\* ${fxq}\\)`));
    // Game boards (.showcase-reserve inside the card).
    expect(css).toMatch(
      new RegExp(
        `showcase-board-row:has\\(> \\.showcase-reserve\\) \\{\\s*--embed-hand-band: ${chx};`,
      ),
    );
    expect(css).toMatch(new RegExp(`:has\\(\\.fxq-board\\) \\{\\s*--embed-hand-band: ${fxq};`));
  });
});
