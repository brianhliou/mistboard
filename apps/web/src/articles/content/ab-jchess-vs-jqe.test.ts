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
  jieqiPerpetualCheckLoser,
  jieqiPublicDeal,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  AB_JQE_GAMES,
  AB_JQE_MATCH,
  AB_JQE_STUDY,
  abJchessVsJqeArticle,
  darkPerGame,
  openPlyOf,
} from './ab-jchess-vs-jqe.js';

const M = AB_JQE_MATCH;
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
  // The match played threefold repetition as a draw; only the drawn game reaches it.
  let state = createInitialJieqiState('ab-jchess-vs-jqe', g.deal, { repetition: true });
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
  const game = (key: string) => M.games.find((x) => x.key === key)!;
  const sq = (s: string) => s as JieqiSquare;
  const engineOf = (name: string) => (name === 'jqe' ? 'jqe' : 'abj');

  it('shows each game the post names, once, opened on its marked move (game 1 unmarked)', () => {
    const shown = abJchessVsJqeArticle.sections
      .flatMap((s) => s.blocks)
      .filter((b) => b?.kind === 'embed');
    expect(shown).toHaveLength(AB_JQE_GAMES.length);
    expect(shown.map((b) => (b as { path: string }).path)).toEqual(
      AB_JQE_GAMES.map(
        (key) => `/embed/study/${AB_JQE_STUDY.id}/${AB_JQE_STUDY.chapters[key]}?ply=${openPlyOf(game(key))}`,
      ),
    );
    expect(M.games.map((g) => g.key)).toEqual([...AB_JQE_GAMES]);
    // Only game 1 opens off its marked move.
    expect(AB_JQE_GAMES.map((k) => game(k).deep.openPly ?? null)).toEqual([57, null, null, null, null]);
    // Wins for each engine and a draw.
    expect(M.games.some((g) => g.winner !== 'draw' && g.abWon)).toBe(true);
    expect(M.games.some((g) => g.winner !== 'draw' && !g.abWon)).toBe(true);
    expect(M.games.filter((g) => g.winner === 'draw')).toHaveLength(1);
  });

  for (const key of AB_JQE_GAMES) {
    it(`${key} replays legally to its recorded result on a public deal`, () => {
      const g = game(key);
      const { states, moves } = play(key);
      const end = states.at(-1)!;
      if (g.winner === 'draw') {
        expect(end.status).toMatchObject({ type: 'finished', winner: null, reason: 'repetition' });
        // A plain repetition: nobody was checking perpetually.
        expect(jieqiPerpetualCheckLoser(end)).toBeNull();
        expect(g.abWon).toBe(false);
      } else {
        expect(end.status).toMatchObject({ type: 'finished', winner: g.winner, reason: 'checkmate' });
        expect(g.abWon).toBe(engineOf(g.winner === 'red' ? g.red : g.black) === 'abj');
      }
      expect(moves).toHaveLength(g.plies);
      expect(Math.ceil(moves.length / 2)).toBe(g.moveCount);
      // The stored deal is already public: nothing in it names a piece that was
      // captured face-down or never turned over.
      expect(jieqiPublicDeal(g.deal, moves)).toEqual(g.deal);
    });
  }

  it("charts the loser's chance by both engines, ending on the result", () => {
    for (const key of AB_JQE_GAMES) {
      const g = game(key);
      const d = g.deep;
      // The loser is the engine on the losing side (the drawn game: the side in trouble).
      expect(engineOf(d.side === 'red' ? g.red : g.black), key).toBe(d.loser);
      if (g.winner !== 'draw') expect(d.side, key).not.toBe(g.winner);
      expect(d.nodes).toBe(22_000_000);
      for (const e of ['abj', 'jqe'] as const) {
        const s = d.series[e];
        expect(s, key).toHaveLength(g.plies + 1);
        for (const v of s) expect(v >= 0 && v <= 1, key).toBe(true);
        expect(s.at(-1), key).toBe(g.winner === 'draw' ? 0.5 : 0);
      }
    }
  });

  it("marks one move per game: the loser's, where the winner's engine wanted another", () => {
    for (const key of AB_JQE_GAMES) {
      const g = game(key);
      const { states, moves } = play(key);
      const d = g.deep;
      expect(d.moments, key).toHaveLength(1);
      const m = d.moments[0]!;
      const before = states[m.ply]!;
      const played = moves[m.ply]!;
      // The loser is to move, and the move is the one played in the game.
      expect(m.ply % 2 === 0 ? 'red' : 'black', key).toBe(d.side);
      expect(m.move, key).toBe(Math.floor(m.ply / 2) + 1);
      expect(`${played.from}${played.to}`, key).toBe(m.played);
      // The winner's pick is a different legal move, and neither turns a piece over.
      const pick = parse(m.pick)[0]!;
      expect(m.pick, key).not.toBe(m.played);
      expect(isJieqiLegalMove(before, pick), `${key} pick ${m.pick}`).toBe(true);
      for (const mv of [played, pick]) expect(before.board[mv.from]?.faceDown, key).toBe(false);
      expect([m.pickTurnsOver, m.playedTurnsOver], key).toEqual([false, false]);
      expect(m.revealsBeforeCaught, key).toEqual([]);
      // Each engine prefers its own: the winner's sees at least 5 points more for the
      // loser after its pick, the loser's at least as much after the move it played.
      expect(m.winner.pick - m.winner.played, key).toBeGreaterThanOrEqual(0.05);
      expect(m.loser.played, key).toBeGreaterThanOrEqual(m.loser.pick);
    }
  });

  it("counts the moves until the loser's own number comes down to the winner's", () => {
    for (const key of AB_JQE_GAMES) {
      const g = game(key);
      const d = g.deep;
      const m = d.moments[0]!;
      const own = d.series[d.loser];
      const other = d.series[d.loser === 'abj' ? 'jqe' : 'abj'];
      const gap = (j: number) => own[j]! - other[j]!;
      // The loser's own positions after the move, in order.
      const loserPlies: number[] = [];
      for (let j = m.ply + 2; j < g.plies; j += 2) loserPlies.push(j);
      const caught = loserPlies.find((j) => gap(j) < 0.05) ?? null;
      expect(m.caughtPly, key).toBe(caught);
      expect(m.lagMoves, key).toBe(caught === null ? null : (caught - m.ply) / 2);
    }
    // The lags the headings name.
    expect(AB_JQE_GAMES.map((k) => game(k).deep.moments[0]!.lagMoves)).toEqual([6, 7, 5, null, 6]);
  });

  it("backs game 1's evaluation gap against the charted numbers", () => {
    const g = game(AB_JQE_GAMES[0]);
    const d = g.deep;
    const gap = d.gap!;
    expect(gap, g.key).toBeDefined();
    const own = d.series[d.loser];
    const other = d.series[d.loser === 'abj' ? 'jqe' : 'abj'];
    const win = own.slice(gap.fromPly, gap.toPly + 1);
    const winOther = other.slice(gap.fromPly, gap.toPly + 1);
    expect(gap.range[d.loser]).toEqual([Math.min(...win), Math.max(...win)]);
    expect(gap.range[d.loser === 'abj' ? 'jqe' : 'abj']).toEqual([Math.min(...winOther), Math.max(...winOther)]);
    // The gap holds through the window (at least 5 points every position) and nothing turns over.
    for (let j = gap.fromPly; j <= gap.toPly; j++) expect(own[j]! - other[j]!, `ply ${j}`).toBeGreaterThanOrEqual(0.05);
    expect(gap.revealsInWindow).toEqual([]);
    expect(gap.moves).toBe(gap.toPly - gap.fromPly + 1);
    expect(gap.agree).toBeGreaterThan(gap.moves / 2);
    // The snap is the first position after the window where the loser's number comes within 5 points.
    let snap = gap.toPly + 1;
    while (own[snap]! - other[snap]! >= 0.05) snap++;
    expect(gap.snapPly).toBe(snap);
    expect([gap.snapFrom, gap.snapTo]).toEqual([own[snap - 1], own[snap]]);
    expect(gap.snapMove).toBe(Math.floor((snap - 1) / 2) + 1);
    // The widest differing choice in the window costs about 5 points: no single move decides it.
    const m = d.moments[0]!;
    expect(m.ply).toBeGreaterThanOrEqual(gap.fromPly);
    expect(m.ply).toBeLessThanOrEqual(gap.toPly);
    expect(Math.round(100 * (m.winner.pick - m.winner.played))).toBe(Math.round(100 * gap.maxCost));
    expect(gap.maxCost).toBeLessThan(0.06);
    // The board opens unmarked on move 29, inside the window, Black to move, at 82% and 56% for Red.
    const open = d.openPly!;
    expect([open, Math.floor(open / 2) + 1, open % 2]).toEqual([57, 29, 1]);
    expect(open).toBeGreaterThanOrEqual(gap.fromPly);
    expect(open).toBeLessThanOrEqual(gap.toPly);
    expect([Math.round(100 * (1 - d.series.abj[open]!)), Math.round(100 * (1 - d.series.jqe[open]!))]).toEqual([82, 56]);
  });

  it('backs the pieces and points the captions name', () => {
    const at = (key: string) => {
      const g = game(key);
      const m = g.deep.moments[0]!;
      return { g, m, board: play(key).states[m.ply]!.board };
    };
    const piece = (role: string, color: string) => ({ role, color, faceDown: false });
    // Game 1: jqe's chariot c6 to c7; AB-JChess would move the advisor c9 to d8.
    {
      const { g, m, board } = at('run2:198');
      expect([g.red, g.black, m.played, m.pick]).toEqual(['AB-JChess-20261031', 'jqe', 'c6c7', 'c9d8']);
      expect(board[sq('c6')]).toMatchObject(piece('chariot', 'black'));
      expect(board[sq('c9')]).toMatchObject(piece('advisor', 'black'));
    }
    // Game 2: jqe's soldier d5 to d6; AB-JChess's horse e6 to c5 "kept the game level".
    {
      const { g, m, board } = at('run2:115');
      expect([g.red, m.played, m.pick]).toEqual(['jqe', 'd5d6', 'e6c5']);
      expect(board[sq('d5')]).toMatchObject(piece('soldier', 'red'));
      expect(board[sq('e6')]).toMatchObject(piece('horse', 'red'));
      expect(Math.abs(m.winner.pick - 0.5)).toBeLessThanOrEqual(0.02);
    }
    // Game 3: AB-JChess's general e10 to f10; jqe's chariot f4 takes the soldier on e4.
    {
      const { g, m, board } = at('run1:293');
      expect([g.red, g.winner, m.played, m.pick]).toEqual(['jqe', 'red', 'e10f10', 'f4e4']);
      expect(board[sq('e10')]).toMatchObject(piece('general', 'black'));
      expect(board[sq('f4')]).toMatchObject(piece('chariot', 'black'));
      expect(board[sq('e4')]).toMatchObject(piece('soldier', 'red'));
    }
    // Game 4: jqe's general d10 to d9; AB-JChess's soldier f5 to g5.
    {
      const { g, m, board } = at('run2:96');
      expect([g.red, m.played, m.pick]).toEqual(['AB-JChess-20261031', 'd10d9', 'f5g5']);
      expect(board[sq('d10')]).toMatchObject(piece('general', 'black'));
      expect(board[sq('f5')]).toMatchObject(piece('soldier', 'black'));
    }
    // Game 5: jqe's chariot b4 to c4; AB-JChess's advisor g8 to f9, beside the general on f8.
    {
      const { g, m, board } = at('run1:194');
      expect([g.red, m.played, m.pick]).toEqual(['AB-JChess-20261031', 'b4c4', 'g8f9']);
      expect(board[sq('b4')]).toMatchObject(piece('chariot', 'black'));
      expect(board[sq('g8')]).toMatchObject(piece('advisor', 'black'));
      expect(board[sq('f8')]).toMatchObject(piece('general', 'black'));
    }
  });

  it('backs the drawn game: jqe stays near even, AB-JChess scores it won, the position repeats', () => {
    const g = game('run2:96');
    const d = g.deep;
    const m = d.moments[0]!;
    const after = (e: 'abj' | 'jqe') => d.series[e].slice(m.ply, -1);
    // "jqe's number for Red stays between 50% and 63%"; "AB-JChess's rises to 100%".
    expect(Math.min(...after('jqe'))).toBeGreaterThanOrEqual(0.35);
    expect(Math.max(...after('jqe'))).toBeLessThanOrEqual(0.5);
    expect(Math.min(...after('abj'))).toBeLessThan(0.05);
    // From move 74 AB-JChess's in-game score was its top score (match log, ply 146 on).
    expect(g.abjTopScoreFromPly).toBe(146);
    expect(Math.floor(g.abjTopScoreFromPly! / 2) + 1).toBe(74);
    // Red's soldier goes between e8 and f8, Black's cannon between d4 and e4.
    const tail = g.moves.split(' ').slice(g.abjTopScoreFromPly!);
    const red = tail.filter((_, i) => (g.abjTopScoreFromPly! + i) % 2 === 0);
    const black = tail.filter((_, i) => (g.abjTopScoreFromPly! + i) % 2 === 1);
    for (const mv of red.slice(-3)) expect(['e8f8', 'f8e8']).toContain(mv);
    for (const mv of black.slice(-3)) expect(['d4e4', 'e4d4']).toContain(mv);
    const { states } = play(g.key);
    const end = states.at(-1)!;
    expect(end.board[sq('f8')] ?? end.board[sq('e8')]).toMatchObject({ role: 'soldier', color: 'red' });
    expect(end.board[sq('d4')] ?? end.board[sq('e4')]).toMatchObject({ role: 'cannon', color: 'black' });
  });

  it('backs the chase-rule account of the drawn game (AB-JChess replays, rep_g4.jsonl)', () => {
    const c = game('run2:96').abjNoChase!;
    // Its default chase rule scores Red's repeating moves as the repetition verdict (+20000)…
    expect(c.cpChaseRule).toEqual([20000]);
    expect([c.fromPly, c.toPly]).toEqual([146, 152]);
    // …and with the rule off as an ordinary edge for Red: 70% to 79% by its own K.
    expect(c.cpNone).toEqual([311, 492]);
    const chance = (cp: number) => Math.round(100 / (1 + Math.exp(-0.00269 * cp)));
    expect(c.cpNone.map(chance)).toEqual([70, 79]);
  });

  it('backs the deeper searches of games 2 and 5 (horizon.jsonl, fresh hash, 1x/4x/16x)', () => {
    const win = (x: number) => Math.round(100 * (1 - x));
    // Game 2: jqe holds its soldier push at a draw at every budget; AB-JChess's view of it only hardens.
    const h2 = game('run2:115').deep.horizon!;
    expect(h2.mults).toEqual([1, 4, 16]);
    expect(h2.played.jqe).toEqual([0.5, 0.5, 0.5]);
    expect(h2.played.abj[2]!).toBeLessThan(h2.played.abj[0]!);
    expect([win(h2.played.jqe[2]!), win(h2.played.abj[2]!)]).toEqual([50, 87]);
    // Game 5: at 16x jqe scores both moves within 10 points of AB-JChess.
    const h5 = game('run1:194').deep.horizon!;
    expect([win(h5.played.jqe[2]!), win(h5.pick.jqe[2]!), win(h5.played.abj[2]!), win(h5.pick.abj[2]!)]).toEqual([
      82, 45, 90, 47,
    ]);
    expect(Math.abs(h5.played.jqe[2]! - h5.played.abj[2]!)).toBeLessThan(0.1);
    expect(Math.abs(h5.pick.jqe[2]! - h5.pick.abj[2]!)).toBeLessThan(0.1);
    // At the match budget jqe's view of its move was 30 points off AB-JChess's deep view.
    expect(game('run1:194').deep.moments[0]!.loser.played - h5.played.abj[2]!).toBeGreaterThan(0.3);
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
    // The closing paragraph: within a move in most of AB-JChess's wins.
    expect(L.abWon.withinOne / L.abWon.games).toBeGreaterThan(0.7);
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
