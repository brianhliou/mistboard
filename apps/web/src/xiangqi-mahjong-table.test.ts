import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  type XmjMove,
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
import { type XmjLogMove, xmjHandLog } from './xiangqi-mahjong-log.js';
import {
  XMJ_SCORING_HREF,
  type XmjTableOptions,
  xiangqiMahjongTableHtml,
  xmjFeltFromSearch,
  xmjHandsTableHtml,
  xmjLogHtml,
  xmjResultLine,
  xmjTileLookFromSearch,
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

function botStepMove(state: XmjRoomState): XmjMove {
  for (const seat of ['east', 'west'] as const) {
    const action = xmjBotAction(xmjViewFor(state, seat), seat);
    if (action) return { ...action, by: seat, at: 0 };
  }
  const pending = xmjPendingAction(state);
  if (pending) return pending.move;
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

  it('lays a third-party set on its own disc surface, in every look', () => {
    const view = xmjViewFor(afterDiscard(['bP', 'bP', 'bA', 'rE']), 'west');
    const tile = (options: Partial<XmjTableOptions>) =>
      doc(xiangqiMahjongTableHtml(view, opts(false, options))).querySelector<HTMLElement>(
        '[data-xmj-pond="east"] .xmj-tile--last',
      );
    const wood = tile({ pieceSet: 'wood' });
    expect(wood?.classList.contains('xmj-tile--faced')).toBe(true);
    expect(wood?.getAttribute('style')).toContain('/piece-sets/xiangqi/wood/tile/red-face.svg');
    expect(wood?.querySelector('image')?.getAttribute('href')).toContain(
      '/piece-sets/xiangqi/wood/tile/red-chariot.svg',
    );
    // A set Mistboard draws keeps the ivory.
    expect(tile({ pieceSet: 'traditional' })?.hasAttribute('style')).toBe(false);
    // Every look lays the set's surface edge to edge, the card included.
    const card = tile({ pieceSet: 'wood', tileLook: 'card' });
    expect(card?.getAttribute('style')).toContain('/piece-sets/xiangqi/wood/tile/red-face.svg');
    expect(card?.querySelector('.xmj-tile-art')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives a third-party set its own tile body: the band, the backs and the wall', () => {
    const view = xmjViewFor(afterDiscard(['bP', 'bP', 'bA', 'rE']), 'west');
    const host = (pieceSet: XmjTableOptions['pieceSet']) =>
      doc(xiangqiMahjongTableHtml(view, opts(false, { pieceSet })));
    const wood = host('wood');
    const body = '--xmj-jade:#a4692f;';
    expect(
      wood.querySelector('[data-xmj-pond="east"] .xmj-tile--last')?.getAttribute('style'),
    ).toContain(body);
    const backs = [...wood.querySelectorAll('.xmj-tile--back')];
    expect(backs.length).toBeGreaterThan(0);
    for (const back of backs) expect(back.getAttribute('style')).toContain(body);
    expect(wood.querySelector('.xmj-stack')?.getAttribute('style')).toContain(body);
    // A set Mistboard draws keeps the jade the stylesheet gives it.
    const jade = host('traditional');
    expect(jade.querySelector('.xmj-tile--back')?.hasAttribute('style')).toBe(false);
    expect(jade.querySelector('.xmj-stack')?.hasAttribute('style')).toBe(false);
  });

  it('keeps one pond per player, labelled, and notches the latest discard', () => {
    const after = afterDiscard(['bP', 'bP', 'bA', 'rE']);
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(after, 'west'), opts(false)));
    const east = host.querySelector('[data-xmj-pond="east"]');
    const west = host.querySelector('[data-xmj-pond="west"]');
    expect(east?.querySelector('.xmj-pond')?.getAttribute('aria-label')).toBe("You's discards");
    expect(west?.querySelector('.xmj-pond')?.getAttribute('aria-label')).toBe('Your discards');
    expect(east?.querySelectorAll('.xmj-tile').length).toBe(1);
    expect(east?.querySelector('.xmj-tile--last')?.getAttribute('aria-label')).toBe(
      xmjTileName('rR'),
    );
    expect(west?.querySelectorAll('.xmj-tile').length).toBe(0);
  });

  it('a claimant with a claim gets Take with the set, Pass, a prompt with no countdown and a bubble', () => {
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
    // The decision runs on the claimant's clock, so nothing counts down here.
    expect(host.querySelector('.xmj-actions__hint')?.textContent).toBe(
      `Claim ${xmjTileName('rR')}?`,
    );
    expect(host.querySelector('[data-xmj-deadline]')).toBeNull();
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

  it('reads the tile look from the query string, jade by default', () => {
    expect(xmjTileLookFromSearch('')).toBe('jade');
    expect(xmjTileLookFromSearch('?tiles=bamboo')).toBe('bamboo');
    expect(xmjTileLookFromSearch('?tiles=card')).toBe('card');
    // The disc look was dropped (Brian, 10-15); an old link falls back to jade.
    expect(xmjTileLookFromSearch('?tiles=disc')).toBe('jade');
    expect(xmjTileLookFromSearch('?tiles=<b>')).toBe('jade');
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
    // A finished match says its result in the foot, in plain points, and has
    // no running match line.
    expect(host.querySelector('.xmj-result__foot')?.textContent).toMatch(
      /^Match to (You|Bot), \d+ to \d+\.$|^Match drawn, \d+ points each\.$/,
    );
    expect(host.querySelector('.xmj-result__match')).toBeNull();
    expect(host.querySelector('.xmj-centre .xmj-hand-line')?.textContent).toBe('Hand 4 of 4');
    const final = xmjViewFor(current, 'east');
    const points = [...host.querySelectorAll('.xmj-points')].map((node) => node.textContent);
    expect(points).toEqual(
      (['west', 'east'] as const).map((seat) => `Score ${final.scores[seat]}`),
    );
  });

  it('lays the table out opponent, middle band, viewer, with the hand and the wall in the centre', () => {
    const view = xmjViewFor(state, mover);
    const host = doc(xiangqiMahjongTableHtml(view, opts(true)));
    const parts = [...(host.querySelector('.xmj-table')?.children ?? [])].map(
      (node) => node.className,
    );
    expect(parts).toEqual([
      'xmj-seat xmj-seat--opponent',
      'xmj-middle',
      'xmj-seat xmj-seat--self xmj-seat--you',
    ]);
    expect(host.querySelector('.xmj-centre .xmj-hand-line')?.textContent).toBe('Hand 1 of 4');
    // The wall is drawn tile by tile, with its count in words.
    expect(host.querySelectorAll('.xmj-wall .xmj-stack i').length).toBe(view.wallCount);
    expect(host.querySelector('.xmj-wall')?.getAttribute('aria-label')).toBe(
      `Wall ${view.wallCount}`,
    );
  });

  it('marks each discard made straight from the draw, and only those, with a key once one shows', () => {
    let current = state;
    let marked = 0;
    let keyed = 0;
    for (let steps = 0; current.status.type === 'playing' && steps < 5000; steps += 1) {
      for (const seat of ['east', 'west', 'spectator'] as const) {
        const view = xmjViewFor(current, seat);
        if (view.between) continue;
        const host = doc(xiangqiMahjongTableHtml(view, opts(false)));
        // The key's line is always laid out; it shows once any shaded tile does.
        const key = host.querySelector('.xmj-shaded-key');
        const any =
          view.drawnDiscards.east.includes(true) || view.drawnDiscards.west.includes(true);
        expect(key?.classList.contains('xmj-shaded-key--hidden')).toBe(!any);
        if (any) {
          keyed += 1;
          expect(key?.textContent).toBe('Shaded tiles were discarded as soon as they were drawn');
        }
        for (const pondSeat of ['east', 'west'] as const) {
          const tiles = [...host.querySelectorAll(`[data-xmj-pond="${pondSeat}"] .xmj-tile`)];
          const flags = tiles.map((tile) => tile.classList.contains('xmj-tile--fromdraw'));
          expect(flags).toEqual(view.drawnDiscards[pondSeat]);
          expect(tiles.map((tile) => tile.hasAttribute('title'))).toEqual(flags);
          for (const [index, tile] of tiles.entries()) {
            if (!flags[index]) continue;
            marked += 1;
            const said = `${xmjTileName(view.discards[pondSeat][index] as XmjTile)}, discarded as drawn`;
            expect(labelOf(tile)).toBe(said);
            // The dimming is explained on hover.
            expect(tile.getAttribute('title')).toBe(said);
          }
        }
      }
      current = botStep(current);
    }
    expect(marked).toBeGreaterThan(0);
    expect(keyed).toBeGreaterThan(0);
  });

  it('with a win on offer, raises one tapped discard and asks for a second tap', () => {
    let found: { view: XmjPlayerView; seat: XmjSeat } | null = null;
    for (let seed = 1; seed < 200 && !found; seed += 1) {
      let current = createXmjRoomState(createXmjSetup(seeded(seed)), 'xmj_test');
      for (let steps = 0; current.status.type === 'playing' && steps < 400 && !found; steps += 1) {
        for (const seat of ['east', 'west'] as const) {
          const view = xmjViewFor(current, seat);
          if (view.legal.selfDraw && view.phase.type === 'discard' && view.phase.drawn) {
            found = { view, seat };
          }
        }
        current = botStep(current);
      }
    }
    if (!found) throw new Error('no self-draw position in 200 seeds');
    const { view } = found;
    const drawn = view.phase.type === 'discard' ? (view.phase.drawn as XmjTile) : null;
    const plain = doc(xiangqiMahjongTableHtml(view, opts(true)));
    expect(plain.querySelectorAll('.xmj-tile--armed').length).toBe(0);
    expect(plain.querySelector('.xmj-actions__hint')?.textContent).toBe(
      'You can win. Declare it, or discard a tile.',
    );
    const armed = doc(
      xiangqiMahjongTableHtml(
        view,
        opts(true, { armedDiscard: { tile: drawn as XmjTile, drawn: true } }),
      ),
    );
    const raised = [...armed.querySelectorAll('.xmj-tile--armed')];
    expect(raised.length).toBe(1);
    expect(raised[0]?.classList.contains('xmj-tile--drawn')).toBe(true);
    expect(armed.querySelector('.xmj-actions__hint')?.textContent).toBe(
      `Tap the ${xmjTileName(drawn as XmjTile)} again to discard it and play on.`,
    );
    expect(armed.querySelector('[data-xmj-selfdraw]')).not.toBeNull();
  });

  it('stands the opponent tile just drawn apart, as a back', () => {
    // East discards, west passes and draws: east sees west's drawn back apart.
    const after = afterDiscard(['bP', 'bP', 'bA', 'rE']);
    const drew = applyXmjMove(after, { by: 'west', at: 20_000, action: 'pass' });
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(drew, 'east'), opts(false)));
    const backs = [...host.querySelectorAll('.xmj-seat--opponent .xmj-tile--back')];
    expect(backs.length).toBe(5);
    expect(backs.at(-1)?.classList.contains('xmj-tile--drawn')).toBe(true);
    expect(backs.filter((back) => back.classList.contains('xmj-tile--drawn')).length).toBe(1);
  });

  it('lists the points of every hand for the meta card, totals matching the match score', () => {
    let current = state;
    let checked = 0;
    for (let steps = 0; steps < 5000; steps += 1) {
      const view = xmjViewFor(current, 'east');
      const host = doc(xmjHandsTableHtml(view, NAMES));
      const heads = [...host.querySelectorAll('thead th:not(.xmj-hands__total)')];
      expect(heads.map((head) => head.textContent)).toEqual(
        Array.from({ length: view.handsInMatch }, (_, index) => String(index + 1)),
      );
      const rows = [...host.querySelectorAll('tbody tr')];
      // The card's player order (east, west), not the viewer first.
      expect(rows.map((row) => row.querySelector('th')?.textContent)).toEqual(['You', 'Bot']);
      for (const [index, seat] of (['east', 'west'] as const).entries()) {
        const cells = [...(rows[index]?.querySelectorAll('td:not(.xmj-hands__total)') ?? [])];
        cells.forEach((cell, hand) => {
          const result = view.results[hand];
          if (!result) {
            expect(cell.textContent).toBe('·');
            return;
          }
          const won = result.winner === seat;
          expect(cell.textContent).toBe(String(won ? result.score?.total : 0));
          expect(cell.classList.contains('xmj-hands__win')).toBe(won);
        });
        const sum = cells.reduce((total, cell) => total + (Number(cell.textContent) || 0), 0);
        expect(rows[index]?.querySelector('.xmj-hands__total')?.textContent).toBe(
          String(view.scores[seat]),
        );
        expect(sum).toBe(view.scores[seat]);
      }
      // Only the hand in play is marked, and only while it is played.
      const marked = host.querySelectorAll('thead .xmj-hands__now');
      expect(marked.length).toBe(view.between || view.status.type !== 'playing' ? 0 : 1);
      if (view.results.length > 1) checked += 1;
      if (current.status.type !== 'playing') break;
      current = botStep(current);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('leads the result with the winner and the points, never tai, and lays it over the middle band', () => {
    let current = state;
    let results = 0;
    for (let steps = 0; current.status.type === 'playing' && steps < 5000; steps += 1) {
      const view = xmjViewFor(current, 'east');
      const html = xiangqiMahjongTableHtml(view, opts(true));
      expect(html).not.toMatch(/\btai\b|台/i);
      if (view.between && view.phase.type === 'won') {
        results += 1;
        const host = doc(html);
        // Over the band, so nothing below it moves when a hand ends.
        expect(host.querySelector('.xmj-middle > .xmj-result')).not.toBeNull();
        const won = view.phase;
        const total = won.score.total;
        // The whole sentence is the region's name; the head splits it.
        const region = host.querySelector('.xmj-result')?.getAttribute('aria-label') ?? '';
        expect(region).toMatch(
          /^(You win|Bot wins) hand [1-4] (by self-draw|on a discard): \d+ points?$/,
        );
        expect(host.querySelector('.xmj-result__title')?.textContent).toBe(
          won.winner === 'east' ? 'You win' : 'Bot wins',
        );
        expect(host.querySelector('.xmj-result__sub')?.textContent).toBe(
          `Hand ${view.handNumber} of ${view.handsInMatch} · ${won.selfDrawn ? 'self-drawn' : 'on a discard'}`,
        );
        expect(host.querySelector('.xmj-result__total')?.textContent).toBe(
          `${total}${total === 1 ? 'point' : 'points'}`,
        );
        // The whole scoring table, in the rules page's order, with this hand's
        // lines lit; the lit lines add up to the total.
        const rows = [...host.querySelectorAll('.xmj-lines li')];
        expect(rows.length).toBe(9);
        const lit = rows.filter((row) => row.classList.contains('xmj-line--on'));
        expect(lit.length).toBe(won.score.lines.length);
        expect(lit.map((row) => row.querySelector('.xmj-sr')?.textContent)).toEqual(
          lit.map(() => ' (scored)'),
        );
        expect(lit.reduce((sum, row) => sum + Number(row.querySelector('b')?.textContent), 0)).toBe(
          total,
        );
        expect(host.querySelector('.xmj-result__how')?.getAttribute('href')).toBe(XMJ_SCORING_HREF);
        // The panel is this hand's result: the match score stays on the seat rows.
        expect(host.querySelector('.xmj-result__match')).toBeNull();
        // Points only grow: nobody's score goes below zero.
        expect(view.scores.east).toBeGreaterThanOrEqual(0);
        expect(view.scores.west).toBeGreaterThanOrEqual(0);
      }
      current = botStep(current);
    }
    expect(results).toBeGreaterThan(0);
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

  it('a match lost on the clock says so, not a +0 to +0 score', () => {
    const live = afterDiscard(['rH', 'rC', 'rP', 'bP', 'bP']);
    const timedOut: XmjRoomState = {
      ...live,
      status: { type: 'finished', winner: 'west', reason: 'timeout' },
    };
    const host = doc(xiangqiMahjongTableHtml(xmjViewFor(timedOut, 'east'), opts(false)));
    expect(host.querySelector('.xmj-result__title')?.textContent).toBe('Hand 1 was not finished.');
    expect(host.querySelector('.xmj-result__foot')?.textContent).toBe('Bot wins on time.');
    expect(host.textContent).not.toMatch(/Match to|\+0 to/);
    // A finished match has no running match line.
    expect(host.querySelector('.xmj-result__match')).toBeNull();
  });

  it('writes the move log one hand at a time: the latest open, earlier hands one line each', () => {
    let current = state;
    const moves: XmjLogMove[] = [];
    for (let steps = 0; current.status.type === 'playing' && steps < 5000; steps += 1) {
      const next = botStepMove(current);
      moves.push({ move: next, ply: moves.length + 1 });
      current = applyXmjMove(current, next);
    }
    const view = xmjViewFor(current, 'east');
    const hands = xmjHandLog(moves);
    const render = (extra: Partial<Parameters<typeof xmjLogHtml>[1]> = {}) =>
      doc(
        `<ol>${xmjLogHtml(hands, {
          names: NAMES,
          viewer: 'east',
          results: view.results,
          activePly: null,
          expanded: new Set(),
          hasPly: () => true,
          ...extra,
        })}</ol>`,
      );
    const host = render();
    const toggles = [...host.querySelectorAll('.xmj-log__toggle')];
    expect(toggles.length).toBe(hands.length - 1);
    expect(toggles[0]?.textContent).toMatch(
      /^Hand 1(You|Bot), (self-draw|on a discard)\d+ points?$|^Hand 1No winner$/,
    );
    expect(host.querySelectorAll('.xmj-log__rows').length).toBe(1);
    // The other player's turns step back; the reader's own and a spectator's
    // view stay at full strength.
    const rows = [...host.querySelectorAll('.xmj-log__row')];
    const theirs = rows.filter((row) => row.classList.contains('xmj-log__row--theirs'));
    expect(theirs.length).toBeGreaterThan(0);
    for (const row of theirs) expect(row.textContent).toMatch(/^Bot /);
    for (const row of rows.filter((row) => /^You /.test(row.textContent ?? ''))) {
      expect(row.classList.contains('xmj-log__row--theirs')).toBe(false);
    }
    expect(render({ viewer: null }).querySelector('.xmj-log__row--theirs')).toBeNull();
    // Words then one tile cell on every row, the win row too: the tiles
    // stood right on discards and left on the win, a ragged column.
    for (const row of rows) {
      expect([...row.children].map((child) => child.className)).toEqual([
        'xmj-log__text',
        'xmj-log__tile',
      ]);
      expect(row.querySelector('.xmj-log__text .xmj-tile')).toBeNull();
    }
    // Passes and the steps between hands never show.
    expect(host.textContent).not.toMatch(/Pass|Ready/);
    // A scrub into hand 1 opens it and marks the row.
    const first = hands[0]?.rows[0];
    const scrubbed = render({ activePly: first?.ply ?? 1 });
    expect(scrubbed.querySelectorAll('.xmj-log__rows').length).toBe(2);
    expect(scrubbed.querySelector('.xmj-log__row.active')?.getAttribute('data-xmj-ply')).toBe(
      String(first?.ply),
    );
    // A scrub onto a pass, which has no row, keeps the row before it lit.
    const shown = new Set(hands.flatMap((hand) => hand.rows.map((row) => row.ply)));
    const pass = moves.find((entry) => entry.move.action === 'pass' && !shown.has(entry.ply));
    expect(pass).toBeDefined();
    const before = Math.max(...[...shown].filter((ply) => ply < (pass?.ply ?? 0)));
    expect(
      render({ activePly: pass?.ply ?? null })
        .querySelector('.xmj-log__row.active')
        ?.getAttribute('data-xmj-ply'),
    ).toBe(String(before));
    // A ply this client holds no snapshot for is not a jump.
    expect(render({ hasPly: () => false }).querySelectorAll('[data-xmj-ply]').length).toBe(0);
  });
});

// East/west only alternate the deal; the table names players. The finished line
// in the room chrome printed "points • West is victorious" beside a table that
// said "You" and "Bot". Every reason, every locale: a player, never a seat.
describe('xiangqi mahjong result line', () => {
  const nameOf = (seat: XmjSeat) => (seat === 'east' ? 'brianhliou' : 'Misty');
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
    expect(xmjResultLine('west', 'points', 'east', nameOf)).toBe('Misty wins on points');
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
