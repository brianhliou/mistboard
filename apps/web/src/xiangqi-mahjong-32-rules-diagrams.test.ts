import {
  isXmjPair,
  meldKindOf,
  tileColor,
  tilePiece,
  XMJ_COPIES,
  XMJ_DEALER_TILES,
  XMJ_HAND_SIZE,
  XMJ_OTHER_TILES,
  XMJ_TILE_KINDS,
  type XmjTile,
  xmjLegalClaims,
  xmjOrderedTiles,
  xmjScore,
  xmjWinShape,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  XMJ32_BLACK_SIDE,
  XMJ32_CLAIM_ANIMATION_SVG,
  XMJ32_CLAIM_DISCARD,
  XMJ32_CLAIM_EARLIER_DISCARD,
  XMJ32_CLAIM_HAND,
  XMJ32_CLAIM_KEPT,
  XMJ32_CLAIM_SET,
  XMJ32_CLAIM_STATIC_SVG,
  XMJ32_CLAIM_THROWN,
  XMJ32_DEAL,
  XMJ32_DEAL_SVG,
  XMJ32_MATCH,
  XMJ32_MATCH_HEADERS,
  XMJ32_NOT_WINS,
  XMJ32_PAIRS,
  XMJ32_RED_SIDE,
  XMJ32_SEQUENCES,
  XMJ32_TILES_SVG,
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
    // One figure, each kind named once per colour (7 kinds a side), and no
    // per-tile names.
    const svg = XMJ32_TILES_SVG();
    expect(svg.match(/class="xmj-article-tiles"/g)).toHaveLength(1);
    expect(svg).not.toContain('font-size="10.5"');
    const labels = [...svg.matchAll(/class="xmj-kind-label">([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual([
      ...['General', 'Advisor', 'Elephant', 'Chariot', 'Horse', 'Cannon', 'Soldier'],
      ...['General', 'Advisor', 'Elephant', 'Chariot', 'Horse', 'Cannon', 'Soldier'],
    ]);
  });

  it('draws a real kernel deal: 5 for the dealer, 4 for you, 23 in the wall', () => {
    const dealer = XMJ32_DEAL.hands[XMJ32_DEAL.dealer];
    const yours = XMJ32_DEAL.hands[XMJ32_DEAL.dealer === 0 ? 1 : 0];
    expect(dealer).toHaveLength(XMJ_DEALER_TILES);
    expect(yours).toHaveLength(XMJ_OTHER_TILES);
    expect(XMJ32_DEAL.wall).toHaveLength(23);
    expect(dealer.length + yours.length + XMJ32_DEAL.wall.length).toBe(32);
    expect(sorted([...dealer, ...yours, ...XMJ32_DEAL.wall])).toEqual(sorted(xmjOrderedTiles()));
    const svg = XMJ32_DEAL_SVG();
    for (const text of ['Dealer, 5 tiles', 'Wall', '23 left', 'You, 4 tiles']) {
      expect(svg).toContain(`>${text}</text>`);
    }
    // 5 dealer backs + 23 wall backs, each with its gradient; your four face up.
    expect(svg.match(/<linearGradient /g)).toHaveLength(5 + 23);
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
      expect(svg).toContain(`<title>Winning hand: ${example.title}</title>`);
      expect(svg).toContain(
        'class="xmj-badge xmj-badge--win" role="img" aria-label="Winning hand"',
      );
      expect(svg).not.toContain('xmj-badge--not-win');
    }
    for (const example of XMJ32_NOT_WINS) {
      const svg = xmj32NotWinSvg(example.id)();
      expect(svg).toContain('<title>Not a winning hand: ');
      expect(svg).toContain(
        'class="xmj-badge xmj-badge--not-win" role="img" aria-label="Not a winning hand"',
      );
    }
  });

  it('animates a claim the kernel allows, into a legal sequence', () => {
    const claims = xmjLegalClaims(XMJ32_CLAIM_HAND, [], XMJ32_CLAIM_DISCARD);
    const fromHand = XMJ32_CLAIM_SET.filter((t) => t !== XMJ32_CLAIM_DISCARD);
    expect(claims).toContainEqual({ kind: 'chow', fromHand: expect.arrayContaining(fromHand) });
    expect(claims.some((c) => c.kind === 'win')).toBe(false);
    expect(meldKindOf(XMJ32_CLAIM_SET)).toBe('sequence');
    expect(XMJ32_CLAIM_SET).toContain(XMJ32_CLAIM_DISCARD);
    // The hand ends as the claimed set plus the kept tile: four tiles, the
    // Soldier gone to the discards.
    expect(sorted([...fromHand, XMJ32_CLAIM_KEPT, XMJ32_CLAIM_THROWN])).toEqual(
      sorted(XMJ32_CLAIM_HAND),
    );
    expect(XMJ32_CLAIM_EARLIER_DISCARD).not.toBe(XMJ32_CLAIM_DISCARD);
  });

  it('draws the claim animation playing once, with a static before and after', () => {
    const svg = XMJ32_CLAIM_ANIMATION_SVG();
    expect(svg.match(/class="xmj-article-tiles"/g)).toHaveLength(1);
    // Every keyframe holds its end state and none loops.
    expect(svg.match(/s ease-in-out both/g)).toHaveLength(4);
    expect(svg).not.toContain('infinite');
    for (const cls of [
      'xmj-claim-cannon',
      'xmj-claim-kept',
      'xmj-claim-mark',
      'xmj-claim-thrown',
    ]) {
      expect(svg).toContain(`class="${cls}"`);
    }
    const still = XMJ32_CLAIM_STATIC_SVG();
    expect(still.match(/class="xmj-article-tiles"/g)).toHaveLength(2);
    expect(still).toContain('<title>Before: ');
    expect(still).toContain('<title>After: ');
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
    expect(XMJ32_MATCH_HEADERS).toEqual(['Hand', '1', '2', '3', '4', '5', '6', 'Total']);
    expect(rows.map((r) => r[0])).toEqual(['Ana', 'Ben']);
    for (const row of rows) expect(row).toHaveLength(XMJ32_MATCH_HEADERS.length);
    expect(rows.map((r) => r.at(-1))).toEqual([String(totals.Ana), String(totals.Ben)]);
    expect(totals).toEqual({ Ana: 7, Ben: 6 });
    XMJ32_MATCH.forEach((hand, i) => {
      const [ana, ben] = [rows[0]?.[i + 1], rows[1]?.[i + 1]];
      if (!hand.winner) {
        expect([ana, ben]).toEqual(['void', 'void']);
        return;
      }
      const points = String(hand.win?.expectedTotal);
      expect([ana, ben]).toEqual(hand.winner === 'Ana' ? [points, ''] : ['', points]);
    });
  });
});
