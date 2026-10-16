import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  type XmjPlayerView,
  type XmjRoomState,
  type XmjSeat,
  type XmjTile,
  xmjBotAction,
  xmjOrderedTiles,
  xmjPendingAction,
  xmjViewFor,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import {
  signed,
  type XmjTableOptions,
  xiangqiMahjongTableHtml,
  xmjFeltFromSearch,
  xmjResultLine,
  xmjTileName,
  xmjViewOffersAction,
} from './xiangqi-mahjong-table.js';

function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

/** A bot move for whoever has one, else the runtime's deadline move. */
function botStep(state: XmjRoomState): XmjRoomState {
  for (const seat of ['east', 'west'] as const) {
    const action = xmjBotAction(xmjViewFor(state, seat), seat);
    if (action) return applyXmjMove(state, { ...action, by: seat, at: 0 });
  }
  const pending = xmjPendingAction(state);
  if (pending) return applyXmjMove(state, pending.move);
  throw new Error('nobody can act');
}

function doc(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

const labelOf = (tile: Element): string | null => tile.getAttribute('aria-label');

const NAMES = { east: 'You', west: 'Bot' } as const;
function opts(canAct: boolean, extra: Partial<XmjTableOptions> = {}): XmjTableOptions {
  return { canAct, names: NAMES, now: 0, ...extra };
}

/** East deals 將仕俥傌炮 and discards 俥; west holds `west`. */
function afterDiscard(west: XmjTile[]): XmjRoomState {
  const east: XmjTile[] = ['bK', 'rA', 'rR', 'bH', 'bC'];
  const rest = xmjOrderedTiles();
  for (const tile of [...east, ...west, 'rP' as XmjTile]) rest.splice(rest.indexOf(tile), 1);
  const wall = [...east, ...west, 'rP' as XmjTile, ...rest];
  const state = createXmjRoomState({ walls: [wall], firstDealer: 'east' }, 'xmj_test');
  return applyXmjMove(state, { by: 'east', at: 10_000, action: 'discard', tile: 'rR' });
}

describe('xiangqi mahjong table', () => {
  const state = createXmjRoomState(createXmjSetup(seeded(7)), 'xmj_test');
  const mover = state.status.type === 'playing' ? state.status.turn : ('east' as XmjSeat);
  const idle: XmjSeat = mover === 'east' ? 'west' : 'east';

  it('shows the viewer their tiles and full-size backs for the opponent', () => {
    const view = xmjViewFor(state, mover);
    const host = doc(xiangqiMahjongTableHtml(view, opts(true)));
    const own = view.hands[mover] ?? [];
    expect(host.querySelectorAll('.xmj-seat--self .xmj-rack .xmj-tile').length).toBe(own.length);
    const backs = host.querySelectorAll('.xmj-seat--opponent .xmj-tile--back');
    expect(backs.length).toBe(view.handCounts[idle]);
    // Same tiles turned over: no small modifier on the opponent's hand.
    expect(host.querySelectorAll('.xmj-seat--opponent .xmj-tile--back.xmj-tile--sm').length).toBe(
      0,
    );
    // The dealer's opening hand has a discard to make: every tile is a button.
    expect(host.querySelectorAll('[data-xmj-tile]').length).toBe(own.length);
  });

  it('names seats by who sits there and marks the dealer, with no winds', () => {
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(state, 'east'), opts(true)));
    const names = [...host.querySelectorAll('.xmj-name')].map((node) => node.textContent);
    expect(names.sort()).toEqual(['Bot', 'You']);
    expect(host.querySelectorAll('.xmj-badge--dealer').length).toBe(1);
    expect(host.textContent).not.toMatch(/East|West|東|西/);
  });

  it('offers no discard buttons when the room says this seat may not act', () => {
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(state, mover), opts(false)));
    expect(host.querySelectorAll('[data-xmj-tile]').length).toBe(0);
  });

  it('a spectator sees two concealed hands and no actions', () => {
    const view = xmjViewFor(state, 'spectator');
    const host = doc(xiangqiMahjongTableHtml(view, opts(true)));
    expect(host.querySelectorAll('.xmj-tile--back').length).toBe(
      view.handCounts.east + view.handCounts.west,
    );
    expect(host.querySelectorAll('button').length).toBe(0);
  });

  it('draws each tile in the viewer piece set, with no disc', () => {
    const view = xmjViewFor(afterDiscard(['bP', 'bP', 'bA', 'rE']), 'west');
    const last = (pieceSet: XmjTableOptions['pieceSet']) =>
      doc(xiangqiMahjongTableHtml(view, opts(false, { pieceSet }))).querySelector(
        '[data-xmj-pond="east"] .xmj-tile--last .xmj-tile-art',
      );
    const figure = last('international');
    expect(figure?.querySelector('image')?.getAttribute('href')).toContain(
      '/international/red-chariot.png',
    );
    const character = last('traditional');
    expect(character?.querySelector('image')).toBeNull();
    expect(character?.querySelector('path')).not.toBeNull();
    // No disc or ring: the tile itself is the frame.
    expect(character?.querySelector('circle')).toBeNull();
  });

  it('keeps one pond per player, labelled, and notches the latest discard', () => {
    const after = afterDiscard(['bP', 'bP', 'bA', 'rE']);
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(after, 'west'), opts(false)));
    const east = host.querySelector('[data-xmj-pond="east"]');
    const west = host.querySelector('[data-xmj-pond="west"]');
    expect(east?.querySelector('.xmj-pond-label')?.textContent).toBe("You's discards");
    expect(west?.querySelector('.xmj-pond-label')?.textContent).toBe('Your discards');
    expect(east?.querySelectorAll('.xmj-tile').length).toBe(1);
    expect(east?.querySelector('.xmj-tile--last')?.getAttribute('aria-label')).toBe(
      xmjTileName('rR'),
    );
    expect(west?.querySelectorAll('.xmj-tile').length).toBe(0);
  });

  it('a claimant with a claim gets Take with the set, Pass, a countdown and a bubble', () => {
    const after = afterDiscard(['rH', 'rC', 'bA', 'rE']);
    const view = xmjViewFor(after, 'west');
    expect(xmjViewOffersAction(view, 'west')).toBe(true);
    const html = xiangqiMahjongTableHtml(view, opts(true, { now: 12_000 }));
    const host = doc(html);
    const take = host.querySelector('[data-xmj-claim="chow"]');
    expect(take?.textContent).toBe('Take');
    expect([...(take?.querySelectorAll('.xmj-tile') ?? [])].map(labelOf)).toEqual(
      (['rR', 'rH', 'rC'] as const).map(xmjTileName),
    );
    expect(host.querySelector('[data-xmj-pass]')?.textContent).toBe('Pass');
    const timer = host.querySelector<HTMLElement>('.xmj-timer-line');
    expect(Number(timer?.dataset.xmjDeadline)).toBe(view.windowClosesAt);
    expect(timer?.querySelector('[data-xmj-secs]')?.textContent).toBe('8s');
    expect(host.querySelector('.xmj-bubble')?.textContent).toContain(xmjTileName('rR'));
    // A queued pass spends every button until it goes.
    const queued = doc(xiangqiMahjongTableHtml(view, opts(true, { passQueued: true })));
    for (const button of queued.querySelectorAll<HTMLButtonElement>('.xmj-actions button')) {
      expect(button.disabled).toBe(true);
    }
  });

  it('the discarder sees the same table whether or not the claimant can claim', () => {
    const render = (west: XmjTile[]) =>
      xiangqiMahjongTableHtml(xmjViewFor(afterDiscard(west), 'east'), opts(false));
    expect(render(['rH', 'rC', 'bA', 'rE'])).toBe(render(['bP', 'bP', 'bA', 'rE']));
  });

  it('a claimant with nothing to claim gets no buttons and no countdown', () => {
    const view = xmjViewFor(afterDiscard(['bP', 'bP', 'bA', 'rE']), 'west');
    expect(xmjViewOffersAction(view, 'west')).toBe(false);
    const host = doc(xiangqiMahjongTableHtml(view, opts(false)));
    expect(host.querySelector('.xmj-actions')).toBeNull();
    expect(host.querySelector('.xmj-bubble')).toBeNull();
  });

  it('reads the felt from the query string, green by default', () => {
    expect(xmjFeltFromSearch('')).toBe('green');
    expect(xmjFeltFromSearch('?felt=wood')).toBe('wood');
    expect(xmjFeltFromSearch('?x=1&felt=slate')).toBe('slate');
    expect(xmjFeltFromSearch('?felt=site')).toBe('site');
    expect(xmjFeltFromSearch('?felt=<b>')).toBe('green');
  });

  it('renders every state of a bot match, groups each win as scored, and ends in the ledger', () => {
    let current = state;
    let steps = 0;
    let wins = 0;
    while (current.status.type === 'playing' && steps < 5000) {
      for (const seat of ['east', 'west', 'spectator'] as const) {
        const view: XmjPlayerView = xmjViewFor(current, seat);
        const html = xiangqiMahjongTableHtml(view, opts(true));
        // No set or pair hints while a hand is in play.
        if (!view.between) expect(html).not.toContain('xmj-group');
        if (view.between && view.phase.type === 'won' && seat === 'east') {
          wins += 1;
          const host = doc(html);
          const { meld, pair } = view.phase.score.shape;
          const groups = [...host.querySelectorAll('.xmj-group')];
          const shown = groups.flatMap((group) =>
            [...group.querySelectorAll('.xmj-tile')].map(labelOf),
          );
          expect(shown).toEqual([...meld, ...pair].map((tile) => xmjTileName(tile)));
          expect(host.querySelectorAll('.xmj-tile--win').length).toBe(1);
          const caps = groups.map((group) => group.querySelector('.xmj-group__cap')?.textContent);
          expect(caps).toEqual(caps.length === 1 ? ['five soldiers'] : ['set', 'pair']);
        }
      }
      current = botStep(current);
      steps += 1;
    }
    expect(current.status.type).toBe('finished');
    expect(wins).toBeGreaterThan(0);
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(current, 'east'), opts(true)));
    expect(host.querySelectorAll('.xmj-ledger tbody tr').length).toBeGreaterThan(1);
    expect(host.textContent).toMatch(/Match to (You|Bot)|Match drawn/);
    expect(host.querySelector('.xmj-table > .xmj-hand-line')?.textContent).toBe('Hand 4 of 4');
    const final = xmjViewFor(current, 'east');
    const points = [...host.querySelectorAll('.xmj-points')].map((node) => node.textContent);
    expect(points).toEqual(
      (['west', 'east'] as const).map((seat) => `Score ${signed(final.scores[seat])}`),
    );
  });

  it('shows the hand number at the top of the table while a hand is played', () => {
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(state, mover), opts(true)));
    expect(host.querySelector('.xmj-table')?.firstElementChild?.textContent).toBe('Hand 1 of 4');
    expect(host.querySelector('.xmj-plate__facts')?.textContent).not.toContain('Hand');
  });

  it('a match resigned mid-hand titles the hand unfinished, not a dead wall', () => {
    const live = afterDiscard(['rH', 'rC', 'rP', 'bP', 'bP']);
    const resigned: XmjRoomState = {
      ...live,
      status: { type: 'finished', winner: 'west', reason: 'resignation' },
    };
    const text =
      doc(xiangqiMahjongTableHtml(xmjViewFor(resigned, 'east'), opts(false))).textContent ?? '';
    expect(text).toContain('Hand 1 was not finished.');
    expect(text).not.toContain('The wall ran out');
  });

  it('signs scores with a real minus sign', () => {
    expect([signed(3), signed(-3), signed(0)]).toEqual(['+3', '\u22123', '0']);
  });
});

// East/west only alternate the deal; the table names players. The finished line
// in the room chrome printed "points • West is victorious" beside a table that
// said "You" and "Bot". Every reason, every locale: a player, never a seat.
describe('xiangqi mahjong result line', () => {
  const nameOf = (seat: XmjSeat) => (seat === 'east' ? 'brianhliou' : 'Xiangqi mahjong bot');
  const reasons = ['points', 'timeout', 'resignation', 'abandonment', 'rules'];
  const lines = () => [
    ...reasons.flatMap((reason) =>
      (['east', 'west'] as const).flatMap((winner) =>
        (['east', 'west', 'spectator'] as const).map((viewer) =>
          xmjResultLine(winner, reason, viewer, nameOf),
        ),
      ),
    ),
    xmjResultLine(null, 'tie', 'east', nameOf),
    xmjResultLine(null, 'abandonment', 'spectator', nameOf),
  ];

  it('names the winner by player in English', () => {
    expect(xmjResultLine('west', 'points', 'east', nameOf)).toBe(
      'Xiangqi mahjong bot wins on points',
    );
    expect(xmjResultLine('east', 'points', 'east', nameOf)).toBe('You win on points');
    expect(xmjResultLine('east', 'timeout', 'spectator', nameOf)).toBe('brianhliou wins on time');
    expect(xmjResultLine(null, 'tie', 'east', nameOf)).toBe('Match drawn on points');
    for (const line of lines()) expect(line).not.toMatch(/East|West/);
  });

  it('never names a wind in zh-Hans or zh-Hant', async () => {
    for (const [path, locale] of [
      ['/zh-hans/play', 'zh-Hans'],
      ['/zh-hant/play', 'zh-Hant'],
    ] as const) {
      await ensureLocaleCatalog(locale);
      window.history.pushState(null, '', path);
      try {
        expect(xmjResultLine('east', 'points', 'east', nameOf)).toMatch(
          /^你以积分获胜$|^你以積分獲勝$/,
        );
        for (const line of lines()) expect(line).not.toMatch(/[东東西]|East|West/);
      } finally {
        window.history.pushState(null, '', '/');
      }
    }
  });
});
