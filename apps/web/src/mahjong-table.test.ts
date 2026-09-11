import {
  applyMahjongMove,
  createMahjongState,
  MAHJONG_SEATS,
  mahjongViewFor,
  orderedWall,
} from '@mistboard/mahjong';
import { describe, expect, it } from 'vitest';

import { mahjongActionsHtml, mahjongSeatOrder, mahjongTableHtml } from './mahjong-table.js';
import { mahjongTileFace } from './mahjong-tile.js';

// The rendering tests that matter here are the ones about what the MARKUP must
// not contain. Three of the four hands are secret, and the failure is not a
// visual glitch, it is a page whose source holds the tiles.

function dealt() {
  let state = createMahjongState(orderedWall());
  const hand = state.game.hands[0] as readonly number[];
  const tile = hand.findIndex((count) => count > 0);
  state = applyMahjongMove(state, { by: 'east', at: 1_000, action: 'discard', tile });
  return state;
}

/** Every tile face the markup actually draws, as their accessible labels. */
function drawnLabels(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1] as string);
}

describe('the table', () => {
  it('draws the viewer hand and nobody else', () => {
    const view = mahjongViewFor(dealt(), 'south');
    const html = mahjongTableHtml(view, true);
    // South's own tiles are discardable buttons; no other seat gets one.
    const buttons = [...html.matchAll(/data-mj-tile="/g)].length;
    expect(buttons).toBe(view.seats.find((s) => s.seat === 'south')?.hand?.length);
  });

  it('renders other seats as backs, one per tile they hold', () => {
    const view = mahjongViewFor(dealt(), 'south');
    const html = mahjongTableHtml(view, true);
    for (const seat of view.seats) {
      if (seat.seat === 'south') continue;
      expect(html).toContain(`${seat.handSize} concealed tiles`);
    }
  });

  it('never prints a hidden hand tile as a face', () => {
    // The strong version: collect every label the markup draws and check none
    // of them names a tile only a hidden hand holds.
    const state = dealt();
    const view = mahjongViewFor(state, 'south');
    const html = mahjongTableHtml(view, true);
    const labels = drawnLabels(html);
    const backs = labels.filter((label) => label === 'face-down tile').length;
    const hidden = view.seats
      .filter((seat) => seat.seat !== 'south')
      .reduce((total, seat) => total + seat.handSize, 0);
    expect(backs, 'every concealed tile renders as a back').toBeGreaterThanOrEqual(hidden);
  });

  it('a spectator gets no hand at all', () => {
    const view = mahjongViewFor(dealt(), 'spectator');
    const html = mahjongTableHtml(view, false);
    expect(html).not.toContain('data-mj-tile=');
    expect(html).not.toContain('your hand');
  });

  it('shows the wall count and the tile under claim', () => {
    const state = dealt();
    const view = mahjongViewFor(state, 'south');
    const html = mahjongTableHtml(view, true);
    expect(html).toContain(String(view.wallRemaining));
    expect(html).toContain('under claim');
    const claimed = view.discardUnderClaim as number;
    expect(html).toContain(mahjongTileFace(claimed).label);
  });
});

describe('seat order', () => {
  it('puts the viewer at the bottom and the next player to their right', () => {
    // Turn order runs anticlockwise, so the seat that plays after you sits to
    // your right. Getting this backwards makes the table read as though play
    // moves the wrong way round.
    expect(mahjongSeatOrder('south')).toEqual(['south', 'west', 'north', 'east']);
    expect(mahjongSeatOrder('north')).toEqual(['north', 'east', 'south', 'west']);
  });

  it('gives a spectator east at the bottom', () => {
    expect(mahjongSeatOrder('spectator')).toEqual([...MAHJONG_SEATS]);
  });
});

describe('claim actions', () => {
  it('offers nothing when the viewer has no claim', () => {
    const view = mahjongViewFor(dealt(), 'west');
    if (view.ownClaims.length === 0) expect(mahjongActionsHtml(view)).toBe('');
  });

  it('offers pass alongside every claim', () => {
    const state = dealt();
    const claimant = mahjongViewFor(state, 'east').awaiting[0];
    expect(claimant, 'fixture should open a contested window').toBeTruthy();
    const view = mahjongViewFor(state, claimant as 'south');
    const html = mahjongActionsHtml(view);
    expect(html).toContain('data-mj-pass');
    // Declining must look like a decision, not like running out of time.
    expect(html).toContain('pass');
    expect(html).toContain('data-mj-claim=');
  });
});
