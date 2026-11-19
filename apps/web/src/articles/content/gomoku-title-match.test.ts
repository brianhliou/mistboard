// The Gomoku title match record (gomoku-title-match.json, recomputed from the
// lab's per-game files) feeds the champions card and the rapfi-vs-katagomo post.
// These checks hold the record to itself, replay the featured game, and check
// that the post states the record's numbers, so an edit to either cannot drift
// unseen.

import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuSquare,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { articleProse } from '../../article-prose.js';
import blindspots from './gomoku-title-blindspots.json' with { type: 'json' };
import decisive from './gomoku-title-decisive.json' with { type: 'json' };
import match from './gomoku-title-match.json' with { type: 'json' };
import {
  FEATURED_FIVE,
  FEATURED_LAST,
  FEATURED_RAPFI_MOVES,
  FIRST,
  FIRST_BIN_STONES,
  featuredGameState,
  KATAGOMO_SCORE,
  LEVEL8_SHARE,
  ORACLE_SHARE,
  PARTED,
  PARTED_AT_STONES,
  RAPFI_KATAGOMO_STUDY,
  rapfiVsKatagomoArticle,
  VOIDED_MS,
} from './rapfi-vs-katagomo.js';

type Wdl = { games: number; wins: number; draws: number; losses: number };
const elo = (p: number): number => -400 * Math.log10(1 / p - 1);
const score = (r: Wdl): number => (r.wins + r.draws / 2) / r.games;
const sum = (rows: Wdl[]): Wdl =>
  rows.reduce(
    (a, r) => ({
      games: a.games + r.games,
      wins: a.wins + r.wins,
      draws: a.draws + r.draws,
      losses: a.losses + r.losses,
    }),
    { games: 0, wins: 0, draws: 0, losses: 0 },
  );
const wdlOf = ({ games, wins, draws, losses }: Wdl): Wdl => ({ games, wins, draws, losses });

describe('gomoku title match record', () => {
  for (const key of ['uneven', 'equal'] as const) {
    const t = match[key].total;
    it(`${key}: totals, colours and endings add up`, () => {
      expect(t.wins + t.draws + t.losses).toBe(t.games);
      expect(sum([t.rapfiAsBlack, t.rapfiAsWhite])).toEqual(wdlOf(t));
      expect(Object.values(t.endings).reduce((a, b) => a + b, 0)).toBe(t.games);
      // Every decisive game ended in a five; every draw filled the board.
      expect(t.endings.five).toBe(t.wins + t.losses);
      expect(t.endings['board-full']).toBe(t.draws);
    });

    it(`${key}: score and Elo follow from the counts, inside the paired range`, () => {
      expect(t.score).toBeCloseTo(score(t), 4);
      expect(t.elo).toBe(Math.round(elo(score(t))));
      expect(t.eloLow).toBe(Math.round(elo(t.pairedScoreLow)));
      expect(t.eloHigh).toBe(Math.round(elo(t.pairedScoreHigh)));
      expect(t.pairedScoreLow).toBeLessThan(t.pairedScore);
      expect(t.pairedScore).toBeLessThan(t.pairedScoreHigh);
      expect(t.eloLow).toBeLessThan(t.elo);
      expect(t.elo).toBeLessThan(t.eloHigh);
    });
  }

  it('the two first-match runs make up its total', () => {
    const runs = match.uneven.runs;
    expect(sum(runs)).toEqual(wdlOf(match.uneven.total));
    expect(match.uneven.total.pairs * 2).toBe(match.uneven.total.games);
  });

  it('the rematch counts every game it played but the voided one', () => {
    const e = match.equal;
    expect(e.played).toBe(e.total.games + 1);
    // The voided game's pair drops out of the paired range only.
    expect(e.total.pairs).toBe(e.played / 2 - 1);
    expect(VOIDED_MS).toBeGreaterThan(e.rapfiBudget.timeMs);
  });

  it('the title result clears the bar the champions page states', () => {
    // KataGomo needed 55%; the paired range keeps Rapfi above 55% itself.
    expect(KATAGOMO_SCORE).toBeLessThan(0.55);
    expect(match.equal.total.pairedScoreLow).toBeGreaterThan(0.55);
  });

  it('the featured game replays to the five the post describes', () => {
    const f = match.featured;
    expect(f.match).toBe('equal');
    expect(f.rapfiColor).toBe('white');
    const final = featuredGameState();
    expect(final.status).toMatchObject({ type: 'finished', winner: 'white', reason: 'five' });
    expect(f.winner).toBe('white');
    expect(f.reason).toBe('five');
    // No earlier position was already over.
    expect(featuredGameState(f.moves.length - 1).status.type).not.toBe('finished');
    // Black moved first, so White (Rapfi) played every second move.
    expect(f.opening.turn).toBe('black');
    expect(FEATURED_RAPFI_MOVES).toBe(f.moves.length / 2);
    const white = new Set(f.moves.filter((_, i) => i % 2 === 1));
    expect(FEATURED_FIVE.every((sq) => white.has(sq))).toBe(true);
    expect(FEATURED_FIVE).toContain(FEATURED_LAST);
  });

  it.each([
    ['blackWin', 'black'],
    ['loss', 'white'],
  ] as const)('the %s example replays every recorded move to its five', (key, winner) => {
    const game = match.examples[key];
    expect(game.match).toBe('equal');
    expect(game.rapfiColor).toBe('black');
    expect(game.winner).toBe(winner);
    expect(game.reason).toBe('five');
    expect(game.index).not.toBe(match.equal.voided.index);
    expect(game.sourceFile).toContain(`${String(game.index).padStart(3, '0')}-${game.opening.id}-rapfi-${game.rapfiColor}.json`);
    let state = createGomokuRoomState(`example-${key}`, {
      stones: game.opening.stones.map((s) => ({
        square: s.square as GomokuSquare,
        color: s.color as 'black' | 'white',
      })),
      turn: game.opening.turn as 'black' | 'white',
    });
    for (const to of game.moves) {
      expect(state.status.type).toBe('playing');
      const next = applyGomokuRoomMove(state, { to: to as GomokuSquare });
      expect(next).not.toBe(state);
      state = next;
    }
    expect(state.status).toMatchObject({ type: 'finished', winner, reason: 'five' });
  });
});

describe('rapfi-vs-katagomo prose', () => {
  const prose = articleProse(rapfiVsKatagomoArticle)
    .map((x) => x.text)
    .join('\n');
  const e = match.equal.total;

  it('states the record numbers', () => {
    for (const text of [
      `${e.wins} wins, ${e.draws} draws and ${e.losses} losses`,
      `+${e.elo} Elo`,
      `+${e.eloLow} to +${e.eloHigh}`,
      '80,000 positions',
      '450,000 positions',
      `${e.timing.katagomoVisitsMedian} visits`,
      `about ${LEVEL8_SHARE} times`,
      '72%',
      '28%',
    ]) {
      expect(prose, text).toContain(text);
    }
  });

  it('joins scores with non-breaking hyphens so a line never wraps mid-score', () => {
    expect(prose).not.toMatch(/\d+-\d+-\d+/);
  });

  it('gives the earlier matched-search match one sentence, its result only', () => {
    const u = match.uneven.total;
    const sentences = prose.split(/(?<=[.:])\s+/).filter((x) => x.includes(`${u.wins}\u2011${u.draws}\u2011${u.losses}`));
    expect(sentences).toHaveLength(1);
    expect(prose).toContain(
      `KataGomo at ${match.uneven.katagomoBudget.maxVisits} visits, the two scored level: ${u.wins}\u2011${u.draws}\u2011${u.losses} over ${u.games} games`,
    );
    expect(prose.match(new RegExp(`${match.uneven.katagomoBudget.maxVisits} visits`, 'g'))).toHaveLength(1);
    // No table, Elo range or TL;DR line for it.
    expect(prose).not.toContain(`${u.eloLow} to`);
    expect(rapfiVsKatagomoArticle.tldr?.join(' ')).not.toContain(`${u.wins}\u2011${u.draws}\u2011${u.losses}`);
    expect(prose).not.toMatch(/rematch/i);
  });

  it('frames the title on the CPUs the site serves from', () => {
    expect(prose).toContain('On the CPUs Mistboard serves from, Rapfi is the stronger engine.');
    expect(prose).toContain(`on its ${match.katagomo.backend} backend`);
    expect(prose).toContain('one CPU thread');
  });

  it('tables the title result from the record', () => {
    const table = rapfiVsKatagomoArticle.sections
      .flatMap((s) => s.blocks ?? [])
      .find((b) => b.kind === 'table');
    expect(table?.kind === 'table' ? table.rows[0]?.[1] : null).toBe(`${e.wins}\u2011${e.draws}\u2011${e.losses}`);
  });

  it('derived ratios match the record', () => {
    expect(LEVEL8_SHARE).toBe(6);
  });

  it('shows game 1, a Black win, a draw and a loss from the study on their last moves', () => {
    const embeds = rapfiVsKatagomoArticle.sections.flatMap((s) =>
      (s.blocks ?? []).flatMap((b) => (b.kind === 'embed' ? [b.path] : [])),
    );
    expect(embeds).toEqual([
      `/embed/study/${RAPFI_KATAGOMO_STUDY.id}/${RAPFI_KATAGOMO_STUDY.chapters.featured}?ply=${match.featured.moves.length}`,
      `/embed/study/${RAPFI_KATAGOMO_STUDY.id}/${RAPFI_KATAGOMO_STUDY.chapters.blackWin}?ply=${match.examples.blackWin.moves.length}`,
      // Every draw filled the board, so the draw's last move is the record's draw length.
      `/embed/study/${RAPFI_KATAGOMO_STUDY.id}/${RAPFI_KATAGOMO_STUDY.chapters.draw}?ply=${decisive.lengths.drawMoves}`,
      `/embed/study/${RAPFI_KATAGOMO_STUDY.id}/${RAPFI_KATAGOMO_STUDY.chapters.loss}?ply=${match.examples.loss.moves.length}`,
    ]);
    expect(RAPFI_KATAGOMO_STUDY.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    for (const id of Object.values(RAPFI_KATAGOMO_STUDY.chapters)) expect(id).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it('explains each new game beside its embed using the record, without a caption', () => {
    for (const key of ['blackWin', 'loss'] as const) {
      const game = match.examples[key];
      const chapterId = RAPFI_KATAGOMO_STUDY.chapters[key];
      const blocks = rapfiVsKatagomoArticle.sections.find((s) =>
        s.blocks?.some((b) => b.kind === 'embed' && b.path.includes(chapterId)),
      )!.blocks!;
      const at = blocks.findIndex((b) => b.kind === 'embed' && b.path.includes(chapterId));
      const paragraph = blocks[at - 1];
      expect(paragraph.kind).toBe('paragraph');
      if (paragraph.kind !== 'paragraph') throw new Error('missing game explanation');
      expect(paragraph.text).toContain(`game ${game.index + 1}`);
      expect(paragraph.text).toContain('Rapfi had Black');
      expect(paragraph.text).toContain(`${game.moves.length} moves`);
      expect(paragraph.text).not.toContain('\u2014');
      expect(blocks[at]).not.toHaveProperty('caption');
    }
    const lossSection = rapfiVsKatagomoArticle.sections.find((s) =>
      s.heading === "Rapfi's losing moves came late, in positions already behind",
    );
    expect(lossSection?.blocks?.some((b) => b.kind === 'embed' && b.path.includes(RAPFI_KATAGOMO_STUDY.chapters.loss))).toBe(true);
  });
});

describe('why the title games are decisive (gomoku-title-decisive.json)', () => {
  const prose = articleProse(rapfiVsKatagomoArticle)
    .map((x) => x.text)
    .join('\n');
  const L = decisive.lengths;
  const pctOf = (x: number) => `${Math.round(x * 100)}%`;

  it('holds the record to itself and to the match record', () => {
    expect(L.decisive + L.draws).toBe(decisive.games);
    expect(L.bins.reduce((a, b) => a + b.games, 0)).toBe(L.decisive);
    expect(L.drawMovesMin).toBe(L.drawMoves);
    const e = match.equal.total;
    expect(decisive.games).toBe(e.games);
    expect(L.draws).toBe(e.draws);
    expect(L.decisive).toBe(e.endings.five);
    expect(L.draws).toBe(e.endings['board-full']);
    expect(decisive.losses.games).toBe(e.losses);
    expect(decisive.forcedWin.rapfiWins).toBe(e.wins);
    for (const line of [decisive.trajectory.wins, decisive.trajectory.draws, decisive.trajectory.losses]) {
      for (const p of line) {
        expect(p.chance).toBeGreaterThanOrEqual(0);
        expect(p.chance).toBeLessThanOrEqual(1);
      }
    }
  });

  it('states the record numbers', () => {
    const a = decisive.attack;
    for (const text of [
      `${L.decisive} of the ${decisive.games} games ended in a five, at a median of ${L.decisiveMedian} moves`,
      `All ${L.draws} draws ran the full ${L.drawMoves} moves`,
      `by stone ${PARTED_AT_STONES}`,
      `They read ${pctOf(FIRST.wins)}, ${pctOf(FIRST.draws)} and ${pctOf(FIRST.losses)} ${FIRST_BIN_STONES - 5} moves after the deal`,
      `${pctOf(PARTED.wins)} in its eventual wins, ${pctOf(PARTED.draws)} in the draws and ${pctOf(PARTED.losses)} in its losses`,
      `a median stone ${decisive.forcedWin.medianStone}`,
      `Its ${decisive.losses.games} losses`,
      `in the ${decisive.losses.read} with logged readings`,
      `a median ${pctOf(decisive.losses.bestChanceMedian)}`,
      `only ${decisive.losses.aboveSeventy} went above 70%`,
      `${((a.rapfi.fours / a.rapfi.moves) * 100).toFixed(1)}% of its moves made a four`,
      `${((a.katagomo.fours / a.katagomo.moves) * 100).toFixed(1)}% of KataGomo's`,
      `${a.rapfi.doubleThreats} moves with two threats at once to KataGomo's ${a.katagomo.doubleThreats}`,
      `anywhere from ${pctOf(decisive.katagomoView.openings.blackMin)} to ${pctOf(decisive.katagomoView.openings.blackMax)}`,
      `put ${decisive.katagomoView.openings.outsideFortySixty} of the ${decisive.katagomoView.openings.read} outside 40-60%`,
      `in the ${decisive.katagomoView.openings.high.openings} openings it gave Black over 60%, Black scored ${pctOf(decisive.katagomoView.openings.high.blackScore)}`,
      `in the ${decisive.katagomoView.openings.low.openings} it gave Black under 40%, Black scored ${pctOf(decisive.katagomoView.openings.low.blackScore)}`,
      `In ${decisive.katagomoView.rapfiWins.sample} of Rapfi's wins`,
      `a median ${pctOf(decisive.katagomoView.rapfiWins.chanceMedian)}`,
      `it still gave itself ${pctOf(decisive.katagomoView.rapfiWins.deepChanceMedian)}`,
      `about ${Math.round(decisive.edges.colour * 100)} points of score`,
      `being Rapfi about ${Math.round(decisive.edges.engine * 100)}`,
      `at a median move ${decisive.draws.settledMedianMove}`,
      `the other ${L.drawMoves - decisive.draws.settledMedianMove} or so moves fill the board`,
      `Game ${decisive.draws.featured.game} is one of them`,
      `until move ${decisive.draws.featured.lastUnevenMove}, then dead even`,
    ]) {
      expect(prose, text).toContain(text);
    }
  });

  it('pins the figures the coordinator read from the analysis', () => {
    // A re-run of the analysis that moves these must be re-read in the prose.
    expect(L.decisiveMedian).toBe(44.5);
    expect(decisive.forcedWin.medianStone).toBe(22);
    expect(decisive.losses.bestChanceMedian).toBe(0.53);
    expect(decisive.katagomoView.openings.outsideFortySixty).toBe(34);
    expect(decisive.katagomoView.rapfiWins.chanceMedian).toBe(0.244);
    expect(decisive.draws.settledMedianMove).toBe(66);
  });

  it('draws both charts from the record', () => {
    const svgs = rapfiVsKatagomoArticle.sections.flatMap((s) =>
      (s.blocks ?? []).flatMap((b) => (b.kind === 'raw-svg' ? [b.svg] : [])),
    );
    expect(svgs).toHaveLength(2);
    expect(svgs[0]).toContain(`median ${L.decisiveMedian} moves`);
    expect(svgs[0]).toContain(`Draws: ${L.draws} games, ${L.drawMoves} moves each`);
    expect(svgs[1]).toContain('Rapfi won');
    expect(svgs[1]).toContain('Rapfi lost');
  });

  it('starts every trajectory line in the same bin the heading names', () => {
    const T = decisive.trajectory;
    expect(T.draws[0].stones).toBe(FIRST_BIN_STONES);
    expect(T.losses[0].stones).toBe(FIRST_BIN_STONES);
    const headings = rapfiVsKatagomoArticle.sections.map((x) => x.heading);
    expect(headings).toContain(`The games start to turn within ${FIRST_BIN_STONES - 5} moves`);
  });

  it('links release pages, never a direct file download', () => {
    expect(prose).toContain("[Gomocup 2025 release](https://github.com/hzyhhzy/KataGomo/releases/tag/gomocup2025)");
    expect(prose).not.toMatch(/releases\/download/);
  });

  it('reminds readers the openings are dealt and screened, with the rules page linked', () => {
    expect(prose).toContain(
      `[dealt openings](/rules/gomoku#dealt-openings), with stones already on the board. Rapfi screened all ${match.openings.poolSize} in the pool at the time as close to even`,
    );
  });
});

describe('where Rapfi lost (gomoku-title-blindspots.json)', () => {
  const prose = articleProse(rapfiVsKatagomoArticle)
    .map((x) => x.text)
    .join('\n');
  const B = blindspots;
  const R = B.rapfiLosses;
  const K = B.katagomoLosses;
  const pctOf = (x: number) => `${Math.round(x * 100)}%`;
  const section = rapfiVsKatagomoArticle.sections.find((s) => s.heading.startsWith("Rapfi's losing moves"));

  it('holds the record to itself and to the match record', () => {
    const e = match.equal.total;
    expect(R.games).toBe(e.losses);
    expect(K.sample).toBeLessThanOrEqual(e.wins);
    expect(R.located + R.lostFromFirstMove + R.stillLostStepsBack).toBe(R.games);
    expect(R.oracleSameMove + R.oracleDisagreed).toBe(R.located);
    expect(R.oracleBlocked).toBeLessThanOrEqual(R.oracleDisagreed);
    expect(R.katagomo.read).toBe(R.located);
    expect(R.katagomo.bestMatchesOracle).toBeLessThanOrEqual(R.katagomo.read);
    expect(R.katagomo.chanceAfterMedian).toBeLessThan(R.katagomo.chanceBeforeMedian);
    for (const x of [R, K]) {
      expect(x.withinFifteen).toBeLessThanOrEqual(x.withinThirty);
      expect(x.withinThirty).toBeLessThanOrEqual(x.located);
      expect(x.sharp).toBeLessThanOrEqual(x.located);
      // The losing move is the last one read above the lost line.
      expect(x.chanceBeforeMedian).toBeGreaterThan(B.oracle.lostAt);
    }
    for (const r of [R.matchSearch, R.tenX]) {
      expect(r.repeats + r.oracleMove).toBeLessThanOrEqual(R.located + R.oracleSameMove);
      expect(r.holds).toBeLessThanOrEqual(R.located - r.repeats);
    }
    // The replays run at the match's median search and ten times it.
    expect(R.matchSearch.nodes).toBe(match.equal.total.timing.rapfiNodesMedian);
    expect(R.tenX.nodes).toBe(R.matchSearch.nodes * 10);
    expect(ORACLE_SHARE).toBe(22);
  });

  it('pins the figures the coordinator read from the analysis', () => {
    // A re-run of the analysis that moves these must be re-read in the prose.
    expect([R.games, R.located, R.moveMedian, R.withinFifteen, R.movesToEndMedian, R.sharp]).toEqual([25, 22, 32, 6, 44, 5]);
    expect(R.chanceBeforeMedian).toBe(0.164);
    expect([R.tenX.oracleMove, R.tenX.holds, R.matchSearch.repeats, R.oracleSameMove]).toEqual([19, 16, 12, 5]);
    expect([K.sample, K.located, K.moveMedian, K.withinFifteen, K.sharp]).toEqual([20, 19, 10, 11, 13]);
  });

  it('states the record numbers', () => {
    for (const text of [
      "Rapfi's losing moves came late, in positions already behind",
      `at ${B.oracle.confirmNodes / 1_000_000} million positions a move, about ${ORACLE_SHARE} times its match search`,
      `a win chance of ${pctOf(B.oracle.lostAt)} or less`,
      `It found one in ${R.located} of the ${R.games} losses; in the other ${R.games - R.located}, Rapfi was lost as far back as it looked`,
      `a random ${K.sample} of Rapfi's wins`,
      `a median ${R.winnerQuietMovesMedian} moves that made no three or four`,
      `In ${R.oracleBlocked} of the ${R.oracleDisagreed} positions where the deeper search chose a different move`,
      `${R.tenX.nodes / 1_000_000} million positions, Rapfi plays the deeper search's move in ${R.tenX.oracleMove} of the ${R.located} positions, and in ${R.tenX.holds} the position after its move no longer reads as lost`,
      `it plays the losing move again in ${R.matchSearch.repeats}`,
      `In ${R.oracleSameMove} of the ${R.located}, the deeper search would have played Rapfi's move too`,
      `at ${B.oracle.katagomoVisits.toLocaleString('en-US')} visits`,
      `from a median ${pctOf(R.katagomo.chanceBeforeMedian)} to ${pctOf(R.katagomo.chanceAfterMedian)}`,
      `matched the deeper search's in ${R.katagomo.bestMatchesOracle} of the ${R.katagomo.read}`,
    ]) {
      expect(prose, text).toContain(text);
    }
  });

  it('tables both sides from the record', () => {
    const table = section?.blocks?.find((b) => b.kind === 'table');
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    expect(table.headers).toEqual(['The losing move', 'Rapfi lost', 'KataGomo lost']);
    expect(table.rows).toEqual([
      ['Found', `${R.located} of ${R.games}`, `${K.located} of ${K.sample}`],
      ['Median move', `${R.moveMedian}`, `${K.moveMedian}`],
      ['In the first 15 moves', `${R.withinFifteen}`, `${K.withinFifteen}`],
      ["Loser's win chance before it, median", pctOf(R.chanceBeforeMedian), pctOf(K.chanceBeforeMedian)],
      [`From ${pctOf(B.oracle.sharpFrom)} or more to lost`, `${R.sharp}`, `${K.sharp}`],
      ['Moves left after it, median', `${R.movesToEndMedian}`, `${K.movesToEndMedian}`],
    ]);
  });
});
