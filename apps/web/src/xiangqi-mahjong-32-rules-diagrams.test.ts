import {
  isXmjPair,
  meldKindOf,
  tileColor,
  tilePiece,
  XMJ_COPIES,
  XMJ_HAND_SIZE,
  XMJ_TILE_KINDS,
  type XmjTile,
  xmjLegalClaims,
  xmjScore,
  xmjWinShape,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  XMJ32_BLACK_SIDE,
  XMJ32_BLACK_SIDE_SVG,
  XMJ32_CLAIM_DISCARD,
  XMJ32_CLAIM_HAND,
  XMJ32_CLAIM_THROWN,
  XMJ32_MATCH,
  XMJ32_NOT_WINS,
  XMJ32_PAIRS,
  XMJ32_RED_SIDE,
  XMJ32_RED_SIDE_SVG,
  XMJ32_SEQUENCES,
  XMJ32_TRIPLETS,
  XMJ32_WINS,
  XMJ32_WORKED,
  xmj32MatchRows,
  xmj32NotWinSvg,
  xmj32WinSvg,
  xmjExampleHand,
} from './xiangqi-mahjong-32-rules-diagrams.js';

// The rules page draws these hands; the kernel decides whether they win and
// what they score. A diagram that disagrees with xmjWinShape / xmjScore is a
// second, wrong copy of the rules.

const sorted = (tiles: readonly XmjTile[]) => [...tiles].sort();

describe('xiangqi mahjong 32 rules diagrams', () => {
  it('draws all 32 tiles: every kind as often as one xiangqi set holds it', () => {
    const all = [...XMJ32_RED_SIDE.flat(), ...XMJ32_BLACK_SIDE.flat()];
    expect(all).toHaveLength(32);
    expect(XMJ32_RED_SIDE.flat().every((t) => tileColor(t) === 'r')).toBe(true);
    expect(XMJ32_BLACK_SIDE.flat().every((t) => tileColor(t) === 'b')).toBe(true);
    for (const kind of XMJ_TILE_KINDS) {
      expect(all.filter((t) => t === kind).length, kind).toBe(XMJ_COPIES[tilePiece(kind)]);
    }
    for (const side of [XMJ32_RED_SIDE_SVG, XMJ32_BLACK_SIDE_SVG]) {
      expect(side().match(/<text [^>]*text-anchor="middle" font-size="10.5"/g)).toHaveLength(16);
    }
  });

  it('draws only real sets and pairs in the sets section', () => {
    for (const group of XMJ32_SEQUENCES) expect(meldKindOf(group.tiles)).toBe('sequence');
    for (const group of XMJ32_TRIPLETS) expect(meldKindOf(group.tiles)).toBe('triplet');
    for (const group of XMJ32_PAIRS) {
      const [a, b] = group.tiles as [XmjTile, XmjTile];
      expect(isXmjPair(a, b)).toBe(true);
    }
  });

  const matchWins = XMJ32_MATCH.flatMap((h) => (h.win ? [h.win] : []));

  for (const example of [...XMJ32_WINS, XMJ32_WORKED, ...matchWins]) {
    it(`${example.id}: wins with the drawn set and pair, and scores as captioned`, () => {
      const { concealed, melds } = xmjExampleHand(example);
      expect(concealed.length + melds.length * 3).toBe(XMJ_HAND_SIZE);
      const shape = xmjWinShape(concealed, melds);
      expect(shape).not.toBeNull();
      const drawnSet = example.groups.find((g) => g.tiles.length === 3)?.tiles ?? [];
      const drawnPair = example.groups.find((g) => g.tiles.length === 2)?.tiles ?? [];
      expect(sorted(shape?.meld ?? [])).toEqual(sorted(drawnSet));
      expect(sorted(shape?.pair ?? [])).toEqual(sorted(drawnPair));
      const score = xmjScore({ concealed, melds, ...example.context });
      expect(score.lines.map((l) => l.key)).toEqual(example.expectedLines);
      expect(score.total).toBe(example.expectedTotal);
    });
  }

  it('the claimed example lays its set face up with the claimed tile in it', () => {
    const claimed = XMJ32_WINS.find((w) => w.id === 'claimed');
    const { melds } = xmjExampleHand(claimed as (typeof XMJ32_WINS)[number]);
    expect(melds).toHaveLength(1);
    expect(melds[0]?.tiles).toContain(melds[0]?.claimed);
  });

  it('the worked example totals 6 points', () => {
    const { concealed, melds } = xmjExampleHand(XMJ32_WORKED);
    expect(xmjScore({ concealed, melds, ...XMJ32_WORKED.context }).total).toBe(6);
  });

  for (const example of XMJ32_NOT_WINS) {
    it(`${example.id}: is not a winning hand`, () => {
      const { concealed, melds } = xmjExampleHand(example);
      expect(concealed.length).toBe(XMJ_HAND_SIZE);
      expect(xmjWinShape(concealed, melds)).toBeNull();
      expect(() => xmjScore({ concealed, melds, ...XMJ32_WORKED.context })).toThrow();
    });
  }

  it('every hand uses no tile more often than the set holds it', () => {
    for (const example of [...XMJ32_WINS, ...XMJ32_NOT_WINS, XMJ32_WORKED, ...matchWins]) {
      const counts = new Map<XmjTile, number>();
      for (const g of example.groups)
        for (const t of g.tiles) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [tile, n] of counts) {
        expect(n, `${example.id} ${tile}`).toBeLessThanOrEqual(XMJ_COPIES[tilePiece(tile)]);
      }
    }
  });

  it('renders every row as an SVG with its title', () => {
    for (const example of XMJ32_WINS) {
      const svg = xmj32WinSvg(example.id)();
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain(`<title>${example.title}</title>`);
    }
    for (const example of XMJ32_NOT_WINS) {
      expect(xmj32NotWinSvg(example.id)()).toContain('<title>Not a win');
    }
  });

  it('walks through a claim the kernel allows and that ends in the claimed win', () => {
    const claims = xmjLegalClaims(XMJ32_CLAIM_HAND, [], XMJ32_CLAIM_DISCARD);
    expect(claims).toContainEqual({ kind: 'chow', fromHand: expect.arrayContaining(['rR', 'rH']) });
    expect(claims.some((c) => c.kind === 'win')).toBe(false);
    const kept = XMJ32_CLAIM_HAND.filter((t) => !['rR', 'rH', XMJ32_CLAIM_THROWN].includes(t));
    const claimed = XMJ32_WINS.find((w) => w.id === 'claimed')!;
    const { concealed, melds } = xmjExampleHand(claimed);
    expect(melds[0]?.tiles).toEqual(['rR', 'rH', XMJ32_CLAIM_DISCARD]);
    expect(sorted(concealed)).toEqual(sorted([...kept, 'bE']));
  });

  it('plays the match as the rules say: six hands, the deal alternating', () => {
    expect(XMJ32_MATCH).toHaveLength(6);
    XMJ32_MATCH.forEach((hand, i) => {
      expect(hand.dealer).toBe(i % 2 === 0 ? 'Ana' : 'Ben');
      expect(hand.winner === null).toBe(hand.win === null);
      if (!hand.win) {
        expect(hand.how).toMatch(/^Void/);
        return;
      }
      const ctx = hand.win.context;
      expect(ctx.winnerIsDealer, `hand ${i + 1}`).toBe(hand.winner === hand.dealer);
      expect(ctx.selfDrawn, `hand ${i + 1}`).toBe(hand.how.startsWith('Self-draw'));
      expect(ctx.lastTile).toBe(hand.how.includes('last tile'));
      expect(hand.how.includes('as dealer')).toBe(ctx.winnerIsDealer);
      expect(hand.how.includes('one colour')).toBe(hand.win.expectedLines.includes('one-colour'));
      if (!ctx.selfDrawn) {
        expect(hand.how.startsWith(`${hand.winner === 'Ana' ? 'Ben' : 'Ana'}’s discard`)).toBe(
          true,
        );
      }
    });
  });

  it('adds the match up to the result the page states', () => {
    const rows = xmj32MatchRows();
    const totals = { Ana: 0, Ben: 0 };
    for (const hand of XMJ32_MATCH) {
      if (!hand.win || !hand.winner) continue;
      const { concealed, melds } = xmjExampleHand(hand.win);
      totals[hand.winner] += xmjScore({ concealed, melds, ...hand.win.context }).total;
    }
    expect(rows.at(-1)?.slice(5)).toEqual([String(totals.Ana), String(totals.Ben)]);
    expect(totals).toEqual({ Ana: 7, Ben: 6 });
  });
});
