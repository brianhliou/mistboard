import {
  applyJieqiMove,
  type JieqiGameState,
  type JieqiSquare,
  parseJieqiFen,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { pct, pikaMoveMarks } from './articles/ab-jchess-examples.js';
import {
  AB_EXAMPLES,
  AB_JCHESS_STUDY,
  abExampleGame,
  abJchessArticle,
  abScoreSeries,
} from './articles/content/ab-jchess.js';

// The post quotes numbers read off the examples data; these tests are where the
// prose and the data meet, so an edit to either fails here first.
const prose = (): string =>
  [...(abJchessArticle.intro ?? []), ...abJchessArticle.sections.flatMap((s) => s.blocks)]
    .map((b) => (b && 'text' in b ? b.text : b?.kind === 'raw-svg' ? String(b.svg) : ''))
    .join('\n');
const TOKEN = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;
const move = (t: string) => {
  const m = TOKEN.exec(t)!;
  return { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare };
};
/** AB-JChess's side, at position `ply`, by engine. */
const side = (game: number, engine: 'ab' | 'pk', ply: number): number => {
  const g = abExampleGame(game);
  const red = (engine === 'ab' ? g.ab : g.pk)[ply]!;
  return g.abColor === 'red' ? red : 1 - red;
};

describe('ab-jchess examples data', () => {
  it('replays every game and line from its dealt root, reveals as the match drew them', () => {
    for (const g of AB_EXAMPLES.games) {
      const parsed = parseJieqiFen(g.rootFen, { gameId: `t-${g.game}` });
      expect(parsed.ok && !parsed.sampled).toBe(true);
      if (!parsed.ok) return;
      const states: JieqiGameState[] = [parsed.state];
      g.moves.forEach((t, i) => {
        const before = states[i]!;
        const next = applyJieqiMove(before, move(t));
        expect(next, `${g.game}:${i + 1}`).not.toBe(before);
        const wasDown = before.board[move(t).from]?.faceDown === true;
        expect(wasDown ? next.board[move(t).to]?.role : null).toBe(g.reveals[i] ?? null);
        states.push(next);
      });
      expect(states[states.length - 1]!.status.type).toBe('finished');
      expect(g.winner).toBe(g.abColor);
      for (const line of g.lines) {
        let s = states[line.ply]!;
        line.moves.forEach((t, k) => {
          // Only the last move of a line may turn a piece over.
          if (k < line.moves.length - 1) expect(s.board[move(t).from]?.faceDown).not.toBe(true);
          const next = applyJieqiMove(s, move(t));
          expect(next, `${g.game} line ${line.ply}:${k}`).not.toBe(s);
          s = next;
        });
      }
    }
  });

  it("marks Pikafish's moves on the review cutoffs, reveals by their own search", () => {
    const marks = (game: number) =>
      pikaMoveMarks(abExampleGame(game)).map((m) => `${m.ply + 1}${m.mark}`);
    expect(marks(68)).toEqual(['24inaccuracy', '30inaccuracy', '36inaccuracy']);
    expect(marks(6)).toEqual(['20inaccuracy', '34inaccuracy']);
    // Ply 24 of game 68 is a reveal: graded on the move's own search, not the
    // position after it.
    const g = abExampleGame(68);
    expect(g.reveals[23]).toBe('horse');
    expect(g.moveScore[23]).not.toBeNull();
  });
});

describe('ab-jchess examples prose', () => {
  it('quotes the settle plies the charts draw', () => {
    const s68 = abScoreSeries(abExampleGame(68));
    const s6 = abScoreSeries(abExampleGame(6));
    expect([s68.settledAb, s68.settledPk]).toEqual([36, 45]);
    expect([s6.settledAb, s6.settledPk]).toEqual([34, 41]);
    const text = prose();
    expect(text).toContain('AB-JChess stays above 80% from ply 36, Pikafish from ply 45.');
    expect(text).toContain('AB-JChess stays above 80% from ply 34, Pikafish from ply 41.');
    expect(text).toContain('9 plies later in game 68 and 7 in game 6');
  });

  it("quotes game 68's numbers from the data", () => {
    const ab = Array.from({ length: 17 }, (_, i) => side(68, 'ab', 25 + i));
    const pk = Array.from({ length: 17 }, (_, i) => side(68, 'pk', 25 + i));
    expect(Math.floor(Math.min(...ab) * 100)).toBe(69);
    expect([pct(Math.min(...pk)), pct(Math.max(...pk))]).toEqual(['40%', '58%']);
    expect([pct(side(68, 'ab', 36)), pct(side(68, 'pk', 36))]).toEqual(['85%', '50%']);
    expect(pct(abExampleGame(68).ingame[35]!)).toBe('47%');
    expect(pct(side(68, 'pk', 42))).toBe('85%');
    expect(abExampleGame(68).reveals[41]).toBe('soldier');
    const text = prose();
    expect(text).toContain('never had Red below 69%');
    expect(text).toContain('had Red between 40% and 58%');
    expect(text).toContain('AB-JChess had Red at 85%; Pikafish had Red at 50%');
    expect(text).toContain('it had reported 47%');
  });

  it("quotes game 6's numbers from the data", () => {
    expect([pct(side(6, 'ab', 31)), pct(side(6, 'pk', 31))]).toEqual(['83%', '48%']);
    expect(prose()).toContain('AB-JChess had Red at 83%; Pikafish had Red at 48%');
  });

  it('summarises the deep checks as the data has them', () => {
    const marked = AB_EXAMPLES.games.flatMap((g) => {
      const plies = new Set(pikaMoveMarks(g).map((m) => m.ply));
      // Pikafish is Black in both games: its score is 1 - red.
      return g.lines.filter((l) => plies.has(l.ply));
    });
    expect(marked).toHaveLength(5);
    const abGap = marked.map((l) => (1 - l.abAlt - (1 - l.abPlayed)) * 100);
    expect(abGap.filter((d) => d >= 5)).toHaveLength(2);
    expect(abGap.filter((d) => Math.abs(d) <= 2)).toHaveLength(3);
    const pkPrefersAlt = marked.filter((l) => 1 - l.pkAlt > 1 - l.pkPlayed);
    expect(pkPrefersAlt).toHaveLength(1);
    expect(prose()).toContain(
      "AB-JChess still puts two of them 5 points or more below its choice and the other three within 2 points. Pikafish prefers AB-JChess's choice once and its own game move four times.",
    );
  });

  it('embeds the study one chapter per game', () => {
    const embeds = abJchessArticle.sections
      .flatMap((s) => s.blocks)
      .filter((b) => b?.kind === 'embed')
      .map((b) => (b?.kind === 'embed' ? b.path : ''));
    expect(embeds).toEqual([
      `/embed/study/${AB_JCHESS_STUDY.id}/${AB_JCHESS_STUDY.chapters[68]}?ply=36`,
      `/embed/study/${AB_JCHESS_STUDY.id}/${AB_JCHESS_STUDY.chapters[6]}?ply=31`,
    ]);
  });
});
