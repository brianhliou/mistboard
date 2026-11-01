// The AB-JChess-20261031 match post reads every number from its data file
// (ab-jchess-vs-jqe-match.json, recomputed from the lab's match records). These
// checks hold the record to itself and each game caption to the moves it
// describes, so an edit to the data or the prose cannot drift unseen.

import {
  applyJieqiMove,
  createInitialJieqiState,
  isJieqiLegalMove,
  type JieqiGameState,
  type JieqiMove,
  type JieqiSquare,
  jieqiPublicDeal,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AB_JQE_GAMES, AB_JQE_JUDGE, AB_JQE_MATCH, abJchessVsJqeArticle, chance, AB_JQE_STUDY,
  darkPerGame, seenFrom } from './ab-jchess-vs-jqe.js';

const M = AB_JQE_MATCH;
// The 15 s judge's rows; its squares count ranks from 0 (f8c8 is f9c9).
type JudgeRow = { key: string; ply: number; played: string; best: string | null; cp: number };
const oneBased = (m: string) => m.replace(/([a-i])(\d)/g, (_, f: string, r: string) => `${f}${Number(r) + 1}`);
const JUDGE = new Map(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../scripts/variant-lab/ab-jchess-vs-jqe-judge.jsonl'),
    'utf8',
  )
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as JudgeRow)
    .map((r) => [`${r.key}@${r.ply}`, r] as const),
);
const judgeAt = (key: string, ply: number) => {
  const r = JUDGE.get(`${key}@${ply}`);
  if (!r) throw new Error(`no judge row for ${key} ply ${ply}`);
  return { ...r, played: oneBased(r.played), best: r.best && oneBased(r.best) };
};
const sum = (r: { wins: number; draws: number; losses: number }) => r.wins + r.draws + r.losses;
const elo = (r: { wins: number; draws: number; losses: number }) => {
  const score = (r.wins + r.draws / 2) / sum(r);
  return Math.round(-400 * Math.log10(1 / score - 1));
};

function parse(moves: string): JieqiMove[] {
  return moves.split(' ').map((tok) => {
    const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(tok);
    if (!m) throw new Error(`bad move token ${tok}`);
    return { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare };
  });
}

function play(key: string): { states: JieqiGameState[]; moves: JieqiMove[] } {
  const g = M.games.find((x) => x.key === key)!;
  const moves = parse(g.moves);
  let state = createInitialJieqiState('ab-jchess-vs-jqe', g.deal);
  const states = [state];
  for (const [i, move] of moves.entries()) {
    expect(isJieqiLegalMove(state, move), `${key} ply ${i + 1} ${move.from}${move.to}`).toBe(true);
    state = applyJieqiMove(state, move, { noCaptureClockLimit: Number.POSITIVE_INFINITY });
    states.push(state);
  }
  return { states, moves };
}

describe('AB-JChess vs jqe match record', () => {
  it('adds up', () => {
    const T = M.total;
    expect(sum(T)).toBe(T.games);
    expect(T.games).toBe(2 * T.pairs);
    expect(sum(M.runs.run1) + sum(M.runs.run2)).toBe(T.games);
    for (const key of ['wins', 'draws', 'losses'] as const) {
      expect(M.runs.run1[key] + M.runs.run2[key], key).toBe(T[key]);
      expect(M.asRed[key] + M.asBlack[key], key).toBe(T[key]);
    }
    expect(Object.values(T.pairPoints).reduce((a, b) => a + b, 0)).toBe(T.pairs);
    // Both pentanomial and trinomial estimates share the mean score.
    for (const r of [T, M.runs.run1, M.runs.run2]) {
      expect(elo(r)).toBe(r.pentaElo);
      expect(r.pentaLow).toBeLessThan(r.pentaElo);
      expect(r.pentaHigh).toBeGreaterThan(r.pentaElo);
    }
  });

  it('backs the prose claims about the record', () => {
    // "Every draw was a repetition."
    expect(M.reasons.repetition).toBe(M.total.draws);
    // "With Black, AB-JChess and jqe were close to even." Within 1% of the games.
    expect(Math.abs(M.asBlack.wins - M.asBlack.losses)).toBeLessThanOrEqual(sum(M.asBlack) / 100);
    // "Most of its edge came with Red."
    expect(M.asRed.wins - M.asRed.losses).toBeGreaterThan(10 * (M.asBlack.wins - M.asBlack.losses));
  });
});

describe('AB-JChess vs jqe games', () => {
  it('shows each game the post names, once', () => {
    const shown = abJchessVsJqeArticle.sections
      .flatMap((s) => s.blocks)
      .filter((b) => b?.kind === 'embed');
    expect(shown).toHaveLength(AB_JQE_GAMES.length);
    // Each opens its own chapter on the position before the disputed move.
    expect(shown.map((b) => (b as { path: string }).path)).toEqual(
      AB_JQE_GAMES.map((key) => {
        const g = M.games.find((x) => x.key === key)!;
        return `/embed/study/${AB_JQE_STUDY.id}/${AB_JQE_STUDY.chapters[key]}?ply=${g.dispute.ply - 1}`;
      }),
    );
    expect(M.games.map((g) => g.key)).toEqual([...AB_JQE_GAMES]);
  });

  for (const key of AB_JQE_GAMES) {
    it(`${key} replays legally to the recorded checkmate on a public deal`, () => {
      const g = M.games.find((x) => x.key === key)!;
      const { states, moves } = play(key);
      const end = states.at(-1)!;
      expect(end.status).toMatchObject({ type: 'finished', winner: g.winner, reason: 'checkmate' });
      expect(Math.ceil(moves.length / 2)).toBe(g.moveCount);
      // The stored deal is already public: nothing in it names a piece that was
      // captured face-down or never turned over.
      expect(jieqiPublicDeal(g.deal, moves)).toEqual(g.deal);
      expect(g.abWon).toBe((g.winner === 'red' ? g.red : g.black) !== 'jqe');
    });
  }

  it('opens each game on a disputed move that both engines searched', () => {
    for (const key of AB_JQE_GAMES) {
      const g = M.games.find((x) => x.key === key)!;
      const d = g.dispute;
      const { states, moves } = play(key);
      const before = states[d.ply - 1];
      const played = moves[d.ply - 1];
      // The stored move is the one played, by the engine the post names, and the
      // other engine's choice was a different legal move.
      expect(`${played.from}${played.to}`, key).toBe(d.played);
      expect(d.move).toBe(Math.ceil(d.ply / 2));
      const moverEngine = d.ply % 2 === 1 ? g.red : g.black;
      expect(d.mover, key).toBe(moverEngine === 'jqe' ? 'jqe' : 'AB-JChess');
      const alt = parse(d.alt)[0];
      expect(d.alt).not.toBe(d.played);
      expect(isJieqiLegalMove(before, alt), `${key} alt ${d.alt}`).toBe(true);
      // Neither the move played nor the post's framing rests on a reveal.
      expect(before.board[played.from]?.faceDown, key).toBe(false);
      // At a glance the critic called it a mistake by the post's margin.
      expect(d.glance.alt - d.glance.played, key).toBeGreaterThanOrEqual(M.disagree.costCp);
      expect(Math.abs(d.glance.played)).toBeLessThanOrEqual(M.disagree.contestedCp);
    }
  });

  it("charts both engines' in-game scores from the match log", () => {
    // Each engine's own fitted curve (fit-k.txt, |cp| <= 1000), as AB-JChess's chance.
    const K = { 'AB-JChess': 0.00269, jqe: 0.00271 } as const;
    const abChance = (engine: 'AB-JChess' | 'jqe', cp: number) => {
      const own = 1 / (1 + Math.exp(-K[engine] * Math.max(-1000, Math.min(1000, cp))));
      return engine === 'AB-JChess' ? own : 1 - own;
    };
    for (const key of AB_JQE_GAMES) {
      const g = M.games.find((x) => x.key === key)!;
      const { abj, jqe } = g.series;
      const plies = g.moves.split(' ').length;
      for (const s of [abj, jqe]) {
        expect(s.length, key).toBe(plies + 1);
        for (const v of s) expect(v >= 0 && v <= 1, key).toBe(true);
        // The last position is the result: every game shown ends in mate.
        expect(s[plies], key).toBe(g.abWon ? 1 : 0);
      }
      // The critic's own next score in the game (criticOwn, from the log) is the
      // point its line passes through just after the disputed move.
      const d = g.dispute;
      const critic = d.mover === 'jqe' ? 'AB-JChess' : 'jqe';
      const line = critic === 'jqe' ? jqe : abj;
      expect(line[d.ply], key).toBeCloseTo(abChance(critic, d.criticOwn[0]!), 3);
      expect(line[d.ply + 1], key).toBeCloseTo(abChance(critic, d.criticOwn[0]!), 3);
    }
  });

  it('backs the move-by-move captions', () => {
    const g = (key: string) => M.games.find((x) => x.key === key)!;
    const board = (key: string, ply: number) => play(key).states[ply].board;
    const sq = (s: string) => s as JieqiSquare;
    const keeps = (d: { played: number; alt: number }) => d.played >= d.alt;

    // Game 1: AB-JChess's chariot f9 to f6; jqe wanted f9 to h9. After h9 both lines
    // check from i2, push the general to f1 and take the soldier on e3; after f6 the
    // chariot goes to d1 in the game and in both lines. jqe at 4 s scores both the same.
    {
      const G = g('run2:30');
      const d = G.dispute;
      expect([G.red, d.played, d.alt]).toEqual(['AB-JChess-20261031', 'f9f6', 'f9h9']);
      const b = board(G.key, d.ply - 1);
      expect(b[sq('f9')]).toMatchObject({ role: 'chariot', color: 'red', faceDown: false });
      expect(b[sq('i1')]).toMatchObject({ role: 'chariot', color: 'black' });
      expect(b[sq('e3')]).toMatchObject({ role: 'soldier', color: 'red' });
      for (const line of [d.pv.abj_alt, d.pv.jqe_alt]) {
        expect(line.split(' ').slice(0, 6).join(' ')).toBe('f9h9 i1i2 e2e1 i2i3 e1f1 i3e3');
      }
      for (const line of [d.pv.abj_played, d.pv.jqe_played]) expect(line.split(' ')[1]).toBe('i1d1');
      expect(G.moves.split(' ')[d.ply]).toBe('i1d1');
      expect(chance(d.jqe.played)).toBe(chance(d.jqe.alt));
      expect(keeps(d.abj)).toBe(true);
      // "AB-JChess itself prefers a third move, the chariot to c9."
      const j = judgeAt(G.key, d.ply - 1);
      expect(j.played).toBe(d.played);
      expect(j.best).toBe(AB_JQE_JUDGE.game1Best);
      expect(b[sq('f9')]).toMatchObject({ role: 'chariot' });
      expect([d.played, d.alt]).not.toContain(j.best);
      expect(G.abWon).toBe(true);
    }
    // Game 2: elephant g3 to e5 against the advisor d1 to c2; the engines read the
    // position far apart, and AB-JChess's side wins.
    {
      const G = g('run2:198');
      const d = G.dispute;
      const b = board(G.key, d.ply - 1);
      expect(b[sq('g3')]).toMatchObject({ role: 'elephant', color: 'red', faceDown: false });
      expect(b[sq('d1')]).toMatchObject({ role: 'advisor', color: 'red', faceDown: false });
      expect([d.played, d.alt]).toEqual(['g3e5', 'd1c2']);
      expect(chance(d.abj.played) - chance(d.jqe.played)).toBeGreaterThanOrEqual(20);
      expect(keeps(d.abj) && !keeps(d.jqe)).toBe(true);
      expect(G.winner).toBe('red');
      expect(G.abWon).toBe(true);
    }
    // Game 3: AB-JChess's soldier h5 to g5 against the chariot g6 to g7; jqe's glance
    // wanted the chariot, at 4 s it agrees, still favours Red, and AB-JChess's chance
    // for Black passes 70% for good before jqe's does.
    {
      const G = g('run2:115');
      const d = G.dispute;
      const b = board(G.key, d.ply - 1);
      expect([G.red, d.mover, d.played, d.alt]).toEqual(['jqe', 'AB-JChess', 'h5g5', 'g6g7']);
      expect(b[sq('h5')]).toMatchObject({ role: 'soldier', color: 'black', faceDown: false });
      expect(b[sq('g6')]).toMatchObject({ role: 'chariot', color: 'black', faceDown: false });
      expect(keeps(d.jqe)).toBe(true);
      expect(chance(d.glance.played)).toBeLessThan(chance(d.glance.alt));
      expect(chance(-d.jqe.played)).toBeGreaterThan(50);
      // The turn: jqe's soldier d5-d6 on move 82, a ?? by the judge (Red 50% to 22%).
      const t = AB_JQE_JUDGE.game3Turn;
      expect(G.moves.split(' ')[t.ply - 1]).toBe(t.played);
      expect(t.move).toBe(Math.ceil(t.ply / 2));
      expect(t.ply % 2).toBe(1); // Red's move: jqe's
      expect(board(G.key, t.ply - 1)[sq('d5')]).toMatchObject({ role: 'soldier', color: 'red' });
      const before = judgeAt(G.key, t.ply - 1);
      const after = judgeAt(G.key, t.ply);
      expect(before.played).toBe(t.played);
      expect(before.cp).toBe(t.redBefore); // Red to move
      expect(-after.cp).toBe(t.redAfter); // Black to move
      expect(chance(t.redBefore) - chance(t.redAfter)).toBeGreaterThanOrEqual(15);
      const abj = seenFrom(G, G.series.abj);
      const jqe = seenFrom(G, G.series.jqe);
      expect(abj).toBeGreaterThan(d.move);
      expect(abj).toBeLessThan(jqe);
      // Read off the move-by-move dump: AB-JChess 74% after Red's soldier d5-d6 (ply
      // 163, its reply is move 82); jqe 72% scored before its horse i1-g2 (move 89).
      expect([abj, jqe]).toEqual([82, 89]);
      expect(abj).toBe(t.move);
      expect(G.series.abj[163]).toBeGreaterThanOrEqual(0.7);
      expect(G.series.abj[162]).toBeLessThan(0.7);
      expect(G.abWon).toBe(true);
      expect(G.winner).toBe('black');
    }
    // Game 4: jqe's cannon h3 to e3 against AB-JChess's chariot d8 to g8; AB-JChess
    // still prefers its own at 4 s, its general steps to f10 at once, and jqe wins.
    {
      const G = g('run1:293');
      const d = G.dispute;
      const b = board(G.key, d.ply - 1);
      expect([G.red, d.mover, d.played, d.alt]).toEqual(['jqe', 'jqe', 'h3e3', 'd8g8']);
      expect(b[sq('h3')]).toMatchObject({ role: 'cannon', color: 'red', faceDown: false });
      expect(b[sq('d8')]).toMatchObject({ role: 'chariot', color: 'red', faceDown: false });
      expect(b[sq('e10')]).toMatchObject({ role: 'general', color: 'black' });
      expect(G.moves.split(' ')[d.ply]).toBe('e10f10');
      expect(keeps(d.jqe) && !keeps(d.abj)).toBe(true);
      expect(d.criticOwn[1]).toBeLessThan(d.criticOwn[0]);
      expect(G.abWon).toBe(false);
    }
  });

  it('backs the face-down capture claim', () => {
    const X = M.darkCaptures;
    // "jqe takes more", "fell" for both, and "too small to tell apart from chance".
    expect(X.jqe.captures).toBeGreaterThan(X.abj.captures);
    expect(X.jqe.meanPts).toBeLessThan(0);
    expect(X.abj.meanPts).toBeLessThan(0);
    expect(Math.abs(X.gapZ)).toBeLessThan(2);
  });

  it('backs the late-to-see-a-loss claim', () => {
    const L = M.seenLate;
    const T = M.total;
    for (const k of ['abWon', 'jqeWon'] as const) {
      const b = L[k];
      expect(b.jqeLater + b.same + b.abjLater).toBe(b.games);
      expect(b.withinOne).toBeLessThanOrEqual(b.games);
    }
    // Nearly every decisive game is counted (a few end with no score past 70%).
    expect(L.abWon.games).toBeLessThanOrEqual(T.wins);
    expect(L.abWon.games).toBeGreaterThan(T.wins - 5);
    expect(L.jqeWon.games).toBeLessThanOrEqual(T.losses);
    expect(L.jqeWon.games).toBeGreaterThan(T.losses - 5);
    // "jqe later ... more often": a clear lean in AB-JChess's wins; "about even" in jqe's.
    expect(L.abWon.jqeLater).toBeGreaterThan(1.4 * L.abWon.abjLater);
    expect(Math.abs(L.jqeWon.abjLater - L.jqeWon.jqeLater)).toBeLessThanOrEqual(5);
    // Game 3 is the far end: a gap wider than one move.
    const g3 = M.games.find((g) => AB_JQE_GAMES.includes(g.key as never) && seenFrom(g, g.series.jqe) - seenFrom(g, g.series.abj) > 1);
    expect(g3).toBeDefined();
  });

  it('splits the face-down captures by result, and jqe takes more in every row', () => {
    const X = M.darkCaptures;
    const T = M.total;
    // Each engine's games by its own result are the match result from its side.
    const games = { abj: [T.wins, T.draws, T.losses], jqe: [T.losses, T.draws, T.wins] };
    for (const e of ['abj', 'jqe'] as const) {
      const r = X[e].byResult;
      expect([r.won.games, r.drawn.games, r.lost.games]).toEqual(games[e]);
      expect(r.won.captures + r.drawn.captures + r.lost.captures).toBe(X[e].captures);
    }
    for (const res of ['won', 'drawn', 'lost'] as const) {
      expect(Number(darkPerGame('jqe', res))).toBeGreaterThan(Number(darkPerGame('abj', res)));
    }
    // "Both engines take more in the games they win."
    for (const e of ['abj', 'jqe'] as const) {
      expect(Number(darkPerGame(e, 'won'))).toBeGreaterThan(Number(darkPerGame(e, 'lost')));
    }
  });

  it('backs the disagreement and calibration claims', () => {
    const D = M.disagree;
    // "jqe came round on half the AB-JChess moves… AB-JChess on fewer than half of jqe's."
    expect(Math.round((2 * D.abj.criticCameRound) / D.abj.disputed)).toBe(1);
    expect(D.jqe.criticCameRound / D.jqe.disputed).toBeLessThan(0.5);
    for (const e of ['abj', 'jqe'] as const) {
      const s = D[e];
      expect(s.bothKeptWon + s.bothKeptDrawn + s.bothKeptLost).toBe(s.bothKept);
      // The table's rows add up to the moves called mistakes.
      expect(s.criticCameRound + s.moverSwitched + s.bothKept).toBe(s.disputed);
      expect(s.bothKeptGamesWon + s.bothKeptGamesDrawn + s.bothKeptGamesLost).toBe(s.bothKeptGames);
      expect(s.bothKeptGames).toBeLessThanOrEqual(s.bothKept);
    }
    // "AB-JChess's choices held up better" and "lean the same way as the match".
    expect(D.abj.bothKeptGamesWon).toBeGreaterThan(D.abj.bothKeptGamesLost);
    expect(D.jqe.bothKeptGamesWon).toBeLessThan(D.jqe.bothKeptGamesLost);
    expect(M.total.wins).toBeGreaterThan(M.total.losses);
    // "jqe also thinks it is doing better than it is."
    expect(M.calibration.jqe.scorePct).toBeLessThan(50);
    expect(M.calibration.abj.scorePct).toBeGreaterThan(50);
    // "With Red, both nearly always start by moving the piece on a4 forward."
    expect(M.openings.abj.move).toBe(M.openings.jqe.move);
    for (const o of Object.values(M.openings)) expect(o.count / o.of).toBeGreaterThan(0.8);
  });
});
