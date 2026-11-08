// A seated player's own rack with a claimed set shown beside two concealed
// tiles ran wider than the table had room for at the default board size, and
// its "To discard" badge ran past the felt's edge ("To discar", 2026-10-27).
// The rack's grid puts the hand in an `auto` column between two `1fr` badge
// columns; happy-dom has no layout, so these tests model that grid's geometry
// and check the fit shrinks the tiles until the badge sits inside its column.
import { describe, expect, it } from 'vitest';
import {
  fitXmjRackBadges,
  type XmjRackMeasure,
  xmjRackTileScale,
} from './xiangqi-mahjong-table.js';

/** The rack at a 1280px window: 390px inside the felt, 8px grid gaps. */
const RACK_W = 390;
const GRID_GAP = 8;
const BASE_TILE = 48.45;
/** The hand's fixed width: the 20px gap to the set, its tray, the tile gaps. */
const HAND_FIXED = 36;
const BADGE_W = 75;

function measureAt(tiles: number, badge = BADGE_W) {
  return (scale: number): XmjRackMeasure => {
    const hand = HAND_FIXED + tiles * BASE_TILE * scale;
    const column = (RACK_W - 2 * GRID_GAP - hand) / 2;
    return { overflow: Math.max(0, badge - column), tiles: tiles * BASE_TILE * scale };
  };
}

describe('xmjRackTileScale', () => {
  it('shrinks a rack whose badge runs past its column until it fits', () => {
    const measure = measureAt(5);
    expect(measure(1).overflow).toBeGreaterThan(10);
    const scale = xmjRackTileScale(measure);
    expect(scale).toBeLessThan(1);
    expect(measure(scale).overflow).toBeLessThanOrEqual(0.5);
  });

  it('leaves a rack whose badges fit at full size', () => {
    expect(xmjRackTileScale(measureAt(5, 40))).toBe(1);
  });

  it('never shrinks tiles past the floor, however long the badge', () => {
    expect(xmjRackTileScale(measureAt(5, 400))).toBeCloseTo(0.6, 5);
  });
});

function rect(left: number, width: number, height = 20): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: height,
    height,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/** A rack with one tile per entry and a turn badge, laid out as the grid would. */
function mountRack(tiles: number, badge: string): { rack: HTMLElement; hand: HTMLElement } {
  const root = document.createElement('div');
  root.innerHTML = `<div class="xmj-rack"><span class="xmj-rack__tag xmj-rack__tag--start"></span><span class="xmj-rack__hand"><span class="xmj-concealed">${'<span class="xmj-tile"></span>'.repeat(2)}</span><span class="xmj-melds"><span class="xmj-meld"><span class="xmj-meld__tiles">${'<span class="xmj-tile"></span>'.repeat(tiles - 2)}</span></span></span></span><span class="xmj-rack__tag xmj-rack__tag--end">${badge}</span></div>`;
  document.body.append(root);
  const rack = root.querySelector<HTMLElement>('.xmj-rack') as HTMLElement;
  const hand = rack.querySelector<HTMLElement>('.xmj-rack__hand') as HTMLElement;
  const tileW = () => Number.parseFloat(hand.style.getPropertyValue('--xmj-tile-w')) || BASE_TILE;
  const handW = () => HAND_FIXED + tiles * tileW();
  const column = () => (RACK_W - 2 * GRID_GAP - handW()) / 2;
  const endLeft = () => RACK_W - column();
  for (const tile of hand.querySelectorAll<HTMLElement>('.xmj-tile')) {
    tile.getBoundingClientRect = () => rect(0, tileW(), tileW() * 1.3);
  }
  const start = rack.querySelector<HTMLElement>('.xmj-rack__tag--start') as HTMLElement;
  const end = rack.querySelector<HTMLElement>('.xmj-rack__tag--end') as HTMLElement;
  start.getBoundingClientRect = () => rect(0, column());
  end.getBoundingClientRect = () => rect(endLeft(), column());
  const turn = end.firstElementChild as HTMLElement | null;
  if (turn) turn.getBoundingClientRect = () => rect(endLeft(), BADGE_W);
  return { rack, hand };
}

describe('fitXmjRackBadges', () => {
  it('sizes the tiles of a rack with a shown set so "To discard" stays inside the felt', () => {
    const { rack, hand } = mountRack(
      5,
      '<span class="xmj-badge xmj-badge--turn">To discard</span>',
    );
    const badge = rack.querySelector('.xmj-badge--turn') as HTMLElement;
    expect(badge.getBoundingClientRect().right).toBeGreaterThan(RACK_W);
    fitXmjRackBadges(document.body);
    expect(hand.style.getPropertyValue('--xmj-tile-w')).not.toBe('');
    const column = (
      rack.querySelector('.xmj-rack__tag--end') as HTMLElement
    ).getBoundingClientRect();
    expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(column.right + 0.5);
    expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(RACK_W + 0.5);
    rack.parentElement?.remove();
  });

  it('leaves a rack with no badge at its own size', () => {
    const { rack, hand } = mountRack(5, '');
    hand.style.setProperty('--xmj-tile-w', '30px');
    fitXmjRackBadges(document.body);
    expect(hand.style.getPropertyValue('--xmj-tile-w')).toBe('');
    rack.parentElement?.remove();
  });
});
