import {
  applyMahjongMove,
  createMahjongState,
  MAHJONG_SEATS,
  mahjongViewFor,
  orderedWall,
} from '@mistboard/mahjong';
import { describe, expect, it } from 'vitest';

import { mahjongActionsHtml, mahjongSeatOrder, mahjongTableHtml } from './mahjong-table.js';
import { mahjongTileFace, mahjongTileName } from './mahjong-tile.js';

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

describe('the table', () => {
  it('draws the viewer hand and nobody else', () => {
    const view = mahjongViewFor(dealt(), 'south');
    const html = mahjongTableHtml(view, true);
    // South's own tiles are discardable buttons; no other seat gets one.
    const buttons = [...html.matchAll(/data-mj-tile="/g)].length;
    expect(buttons).toBe(view.seats.find((s) => s.seat === 'south')?.hand?.length);
  });

  it('never prints a hidden hand tile as a face', () => {
    // Every tile FACE the markup draws must be one the viewer is entitled to
    // see: their own hand, plus everything face up on the mat. A concealed hand
    // is a rack of slivers carrying no tile at all.
    const view = mahjongViewFor(dealt(), 'south');
    const html = mahjongTableHtml(view, true);
    const own = new Set(
      (view.seats.find((s) => s.seat === 'south')?.hand ?? []).map(mahjongTileName),
    );
    const shown = new Set<string>();
    for (const seat of view.seats) {
      for (const tile of seat.discards) shown.add(mahjongTileName(tile));
      for (const meld of seat.melds) if (meld.tile !== null) shown.add(mahjongTileName(meld.tile));
    }
    const faces = [...html.matchAll(/role="img" aria-label="([^"]+)"/g)].map((m) => m[1] as string);
    for (const face of faces) {
      if (/concealed tiles$/.test(face)) continue;
      expect(own.has(face) || shown.has(face), `${face} is drawn but nobody may see it`).toBe(true);
    }
  });

  it('draws an opponent hand as a rack, not as tiles', () => {
    // Thirty-nine full-size blanks around the table carry one bit of
    // information between them and out-weigh the melds and the pond.
    const view = mahjongViewFor(dealt(), 'south');
    const html = mahjongTableHtml(view, true);
    for (const seat of view.seats) {
      if (seat.seat === 'south') continue;
      expect(html).toContain(`${seat.handSize} concealed tiles`);
    }
    const slivers = [...html.matchAll(/class="mj-sliver"/g)].length;
    const hidden = view.seats
      .filter((s) => s.seat !== 'south')
      .reduce((total, s) => total + s.handSize, 0);
    expect(slivers).toBe(hidden);
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
