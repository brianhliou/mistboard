import {
  applyMahjongMove,
  createMahjongState,
  MAHJONG_SEATS,
  mahjongViewFor,
  orderedWall,
} from '@mistboard/mahjong';
import { describe, expect, it } from 'vitest';

import {
  chowHint,
  mahjongActionsHtml,
  mahjongBarHtml,
  mahjongSeatOrder,
  mahjongTableHtml,
} from './mahjong-table.js';
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

describe('the bar', () => {
  it('is always there, and says where the hand stands when nothing is asked', () => {
    const view = mahjongViewFor(createMahjongState(orderedWall()), 'east');
    const html = mahjongTableHtml(view, true);
    expect(html).toContain('class="mj-bar"');
    expect(html).toMatch(/away from complete|Waiting on one tile|Complete/);
  });

  it('shows the claim buttons with a draining strip when the viewer is asked', () => {
    const state = dealt();
    const claimant = mahjongViewFor(state, 'east').awaiting[0] as 'south';
    const view = mahjongViewFor(state, claimant);
    const html = mahjongBarHtml(view, 1_000 + 2_000);
    expect(html).toContain('mj-bar-asking');
    expect(html).toContain('data-mj-claim=');
    // Four seconds of the six-second window left at render time.
    expect(html).toContain('--mj-window-ms:4000ms');
  });

  it('tells a seat that was not asked what was thrown and who is deciding', () => {
    const state = dealt();
    const asked = new Set(mahjongViewFor(state, 'east').awaiting);
    const idle = (['south', 'west', 'north'] as const).find((seat) => !asked.has(seat));
    expect(idle, 'fixture should leave one seat unasked').toBeTruthy();
    const view = mahjongViewFor(state, idle as 'south');
    const html = mahjongBarHtml(view);
    expect(html).toContain('mj-bar-note');
    expect(html).toContain('East threw');
    expect(html).not.toContain('data-mj-claim=');
  });

  it('does not mark the discarder as to play while their tile is under claim', () => {
    // view.turn stays with the discarder through the window; the marker must
    // not follow it there, or the dot sits on a player with nothing to decide.
    const view = mahjongViewFor(dealt(), 'south');
    expect(view.turn).toBe('east');
    const html = mahjongTableHtml(view, false);
    expect(html).not.toContain('mj-seat-turn-label');
    expect(html).not.toContain('mj-turn-dot');
  });
});

describe('the chow hint', () => {
  it('names the seat whose discard a chow could take, only when the tile fits', () => {
    // East (the dealer) throws; west holds 2m 3m so a 1m or 4m fits, but west
    // can only chow south's discard.
    let state = createMahjongState(orderedWall());
    const counts = Array<number>(34).fill(0);
    for (const tile of [1, 2, 9, 9, 9, 18, 18, 18, 27, 27, 27, 31, 31]) counts[tile] += 1;
    // North holds only honours, so nothing fits and nothing is said.
    const honours = Array<number>(34).fill(0);
    for (const tile of [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 30, 32]) honours[tile] += 1;
    // South holds a pair of 4m, so the window actually opens.
    const pair = [...honours];
    pair[32] -= 1;
    pair[3] += 2;
    pair[30] -= 1;
    const hands = state.game.hands.map((h, i) =>
      i === 1 ? pair : i === 2 ? counts : i === 3 ? honours : h,
    );
    // Give east a 4m to throw.
    const eastCounts = [...(state.game.hands[0] as readonly number[])];
    eastCounts[3] += 1;
    hands[0] = eastCounts;
    state = { ...state, game: { ...state.game, hands } };
    state = applyMahjongMove(state, { by: 'east', at: 1_000, action: 'discard', tile: 3 });
    expect(state.game.phase.type).toBe('claim-window');
    const west = mahjongViewFor(state, 'west');
    expect(west.ownClaims.some((c) => c.kind === 'chow')).toBe(false);
    expect(chowHint(west)).toContain("South's discard");

    // A tile that does not fit says nothing.
    expect(chowHint(mahjongViewFor(state, 'north'))).toBe('');
  });
});

describe('flowers', () => {
  it('draws every seat’s flowers in its head row', () => {
    let state = createMahjongState(orderedWall());
    const flowers = state.game.flowers.map((f, i) => (i === 1 ? [1, 5] : f));
    state = { ...state, game: { ...state.game, flowers } };
    const html = mahjongTableHtml(mahjongViewFor(state, 'east'), true);
    expect(html).toContain('aria-label="蘭 2"');
    expect(html).toContain('aria-label="夏 2"');
    expect([...html.matchAll(/mj-tile-flower"/g)].length).toBe(2);
  });
});
