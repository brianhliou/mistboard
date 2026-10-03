import {
  applyJungleMove,
  createInitialJungleState,
  engineUciToJungleMove,
  type JungleGameState,
  type JungleSquare,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  evaluatedGame,
  KATAGO_EVALS,
  KATAGO_LINES,
  KATAGO_STUDY,
  katagoJungleArticle,
  katagoScoreSeries,
  lineStart,
  studyChapterHref,
} from './articles/content/katago-jungle.js';
import { evalCompareChartSvg } from './articles/eval-compare-chart.js';
import {
  MARK_GLYPH,
  mistyExpected,
  mistyMoveMarks,
  settledPly,
} from './articles/katago-jungle-analysis.js';

// The post quotes numbers read off the evaluation data; these tests are where
// the prose and the data meet, so an edit to either fails here first.
const prose = (): string =>
  [...(katagoJungleArticle.intro ?? []), ...katagoJungleArticle.sections.flatMap((s) => s.blocks)]
    .map((b) => (b && 'text' in b ? b.text : ''))
    .join('\n');
const pct = (x: number): string => `${Math.round(x * 100)}%`;

describe('katago-jungle evals data', () => {
  it('replays every game through the kernel, with each KataGo choice legal', () => {
    for (const g of KATAGO_EVALS.games) {
      expect(g.kata).toHaveLength(g.plies);
      expect(g.misty).toHaveLength(g.plies);
      let state: JungleGameState = createInitialJungleState(`t-${g.game}`);
      g.moves.forEach((uci, ply) => {
        expect(
          applyJungleMove(state, engineUciToJungleMove(g.kataBest[ply]!)!),
          `${g.game}:${ply}`,
        ).toBeTruthy();
        state = applyJungleMove(state, engineUciToJungleMove(uci)!)!;
      });
      expect(state.status.type).toBe('finished');
      // Both games are KataGo wins.
      expect(g.result).toBe(g.red === 'katago' ? 'red' : 'black');
    }
  });

  it('maps Misty centipawns through the analysis curve, forced results to 0 or 1', () => {
    expect(mistyExpected(0)).toBeCloseTo(0.5);
    expect(mistyExpected(999_988)).toBe(1);
    expect(mistyExpected(-999_988)).toBe(0);
    expect(mistyExpected(113)).toBeCloseTo(1 / (1 + Math.exp(-0.00368208 * 113)), 6);
  });

  it('settles on the last run above the level', () => {
    expect(settledPly([0.9, 0.5, 0.85, 0.9], 0.8)).toBe(2);
    expect(settledPly([0.9, 0.5], 0.8)).toBeNull();
  });
});

describe('katago-jungle lines', () => {
  it('replays every KataGo line through the kernel from its game position', () => {
    expect(KATAGO_LINES.length).toBeGreaterThanOrEqual(3);
    for (const l of KATAGO_LINES) {
      let state = lineStart(l.game, l.ply);
      // A sideline: its first move is not the move the game played.
      expect(l.line[0]).not.toBe(evaluatedGame(l.game).moves[l.ply]);
      for (const uci of l.line) {
        const next = applyJungleMove(state, engineUciToJungleMove(uci)!);
        expect(next, `${l.game}@${l.ply}: ${uci}`).toBeTruthy();
        state = next!;
      }
    }
  });

  it('embeds one annotated study chapter per game, and links each chapter', () => {
    const embeds = katagoJungleArticle.sections
      .flatMap((s) => s.blocks)
      .filter((b): b is Extract<typeof b, { kind: 'embed' }> => b?.kind === 'embed');
    expect(embeds.map((b) => b.path)).toEqual([
      `/embed/study/${KATAGO_STUDY.id}/${KATAGO_STUDY.chapters[67]}?ply=57`,
      `/embed/study/${KATAGO_STUDY.id}/${KATAGO_STUDY.chapters[94]}?ply=100`,
    ]);
    expect(studyChapterHref(94)).toBe(`/study/${KATAGO_STUDY.id}/${KATAGO_STUDY.chapters[94]}`);
  });
});

describe('katago-jungle charts', () => {
  it('draw each game from the data: both settle plies, and one mark per marked move', () => {
    for (const [game, a, b] of [
      [67, 57, 72],
      [94, 100, 104],
    ] as const) {
      const g = evaluatedGame(game);
      const s = katagoScoreSeries(g);
      const svg = evalCompareChartSvg({
        id: `t${game}`,
        heading: 'h',
        ariaLabel: 'a',
        nameA: 'KataGo',
        nameB: 'Misty',
        a: s.kata,
        b: s.misty,
        threshold: { level: 0.8, settledA: s.settledKata, settledB: s.settledMisty },
        marks: mistyMoveMarks(g).map((m) => ({ ply: m.ply + 1, glyph: MARK_GLYPH[m.mark] })),
        xLabel: 'Ply',
      });
      expect(svg).toContain(`translate="no">${a}</text>`);
      expect(svg).toContain(`translate="no">${b}</text>`);
      expect(svg.match(/>\?\?</g)).toHaveLength(1);
    }
  });
});

describe('katago-jungle prose matches the data', () => {
  it('game 67: the wolf, the corner tiger, and who settled when', () => {
    const g = evaluatedGame(67);
    const s = katagoScoreSeries(g);
    expect(g.moves[20]).toBe('c7c8'); // ply 21, Misty's tiger takes the wolf
    expect(-g.misty[21]!).toBe(113);
    expect(pct(s.kata[21]!)).toBe('50%');
    expect(g.moves[56]).toBe('g8g9'); // ply 57
    expect(pct(s.kata[56]!)).toBe('61%');
    expect(pct(s.kata[57]!)).toBe('92%');
    expect(-g.misty[57]!).toBe(111);
    const marks = mistyMoveMarks(g);
    expect(marks.map((m) => [m.ply + 1, MARK_GLYPH[m.mark], m.kataBest])).toEqual([
      [57, '??', 'b1b2'],
    ]);
    expect([s.settledKata, s.settledMisty, g.plies]).toEqual([57, 72, 90]);
    const text = prose();
    expect(text).toContain('from 61% to 92% while Misty still read +111');
    expect(text).toContain('won a wolf on ply 21');
    expect(text).toContain('Misty got there on ply 72, 15 plies later');
    // KataGo's line for red from ply 56: lion b1-b2, red at 37% after it.
    const line = KATAGO_LINES.find((l) => l.game === 67 && l.ply === 56)!;
    expect(line.line[0]).toBe('b1b2');
    expect(lineStart(67, 56).board.b1).toMatchObject({ role: 'lion', color: 'red' });
    expect(pct(1 - line.kataBlackStart!)).toBe('37%');
    expect(text).toContain('starts with lion b1-b2 and keeps red at 37%');
  });

  it('game 94: the wolf, the slow climb, the cat, and who settled when', () => {
    const g = evaluatedGame(94);
    const s = katagoScoreSeries(g);
    let state: JungleGameState = createInitialJungleState('t94');
    const roleAt = (ply: number): string => {
      state = createInitialJungleState('t94');
      for (const uci of g.moves.slice(0, ply - 1))
        state = applyJungleMove(state, engineUciToJungleMove(uci)!)!;
      const uci = g.moves[ply - 1]!;
      return `${state.board[uci.slice(0, 2) as JungleSquare]?.role} ${uci}`;
    };
    expect(roleAt(38)).toBe('tiger d4d3'); // Misty (black) takes the wolf on d3
    expect(state.board.d3).toMatchObject({ role: 'wolf', color: 'red' });
    // Misty ahead (black cp > 0) for most of plies 38-99.
    const ahead = g.misty.slice(38, 100).filter((cp) => (cp ?? 0) > 0).length;
    expect(ahead / 62).toBeGreaterThan(0.8);
    expect(pct(s.kata[90]!)).toBe('63%');
    expect(roleAt(100)).toBe('cat c8c7');
    expect(pct(s.kata[99]!)).toBe('63%');
    expect(pct(s.kata[100]!)).toBe('98%');
    expect(g.misty[100]).toBe(80);
    expect(g.misty[104]).toBeLessThanOrEqual(-900_000);
    expect(roleAt(117)).toBe('lion c9d9');
    const marks = mistyMoveMarks(g);
    expect(marks.map((m) => [m.ply + 1, MARK_GLYPH[m.mark], m.kataBest])).toEqual([
      [100, '??', 'd6d7'],
    ]);
    expect([s.settledKata, s.settledMisty, g.plies]).toEqual([100, 104, 117]);
    const text = prose();
    expect(text).toContain('crept from 50% to 63%');
    expect(text).toContain('won a wolf on ply 38');
    expect(text).toContain('KataGo went from 63% to 98%');
    expect(text).toContain('Misty read +80 and found the forced loss four plies later');
    expect(text).toContain('15 and 4 plies before Misty');
    const line = KATAGO_LINES.find((l) => l.game === 94 && l.ply === 99)!;
    expect(line.line[0]).toBe('d6d7');
    expect(lineStart(94, 99).board.d6).toMatchObject({ role: 'elephant', color: 'black' });
    expect(pct(line.kataBlackStart!)).toBe('38%');
    expect(text).toContain('elephant d6-d7, keeps black at 38%');
  });
});
