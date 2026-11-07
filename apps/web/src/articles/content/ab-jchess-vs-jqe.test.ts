// The AB-JChess-20261031 match post reads every number from its data file
// (ab-jchess-vs-jqe-match.json, recomputed from the lab's match records). These
// checks hold the record to itself and each game caption to the moves it
// describes, so an edit to the data or the prose cannot drift unseen.

import {
  applyJieqiMove,
  createInitialJieqiState,
  isJieqiLegalMove,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiSquare,
  jieqiPerpetualCheckLoser,
  jieqiPublicDeal,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { abJqeNotes } from '../ab-jchess-vs-jqe-notes.js';
import {
  AB_JQE_CHASE,
  AB_JQE_GAMES,
  AB_JQE_MATCH,
  AB_JQE_STUDY,
  abJchessVsJqeArticle,
  darkPerGame,
  disagreementArrows,
  openPlyOf,
} from './ab-jchess-vs-jqe.js';
import AB_JQE_DRAWS from './ab-jchess-vs-jqe-draws.json' with { type: 'json' };
import AB_JQE_LUCK from './ab-jchess-vs-jqe-luck.json' with { type: 'json' };

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
  const other = (e: 'abj' | 'jqe') => (e === 'abj' ? 'jqe' : 'abj');
  const ALL = [...AB_JQE_GAMES, AB_JQE_CHASE];
  const pts = (x: number) => Math.round(100 * x);
  const abjChance = (cp: number) => Math.round(100 / (1 + Math.exp(-0.00269 * cp)));
  /** Whether the move at this ply moved or took a face-down piece. */
  const touchesHidden = (key: string, ply: number) => {
    const { states, moves } = play(key);
    const mv = moves[ply]!;
    const b = states[ply]!.board;
    return Boolean(b[mv.from]?.faceDown || b[mv.to]?.faceDown);
  };

  it('shows each game the post names, once, opened on its marked move', () => {
    const shown = abJchessVsJqeArticle.sections
      .flatMap((s) => s.blocks)
      .filter((b) => b?.kind === 'embed');
    expect(shown).toHaveLength(ALL.length);
    // Every number the prose reads from the data resolved.
    expect(JSON.stringify(abJchessVsJqeArticle)).not.toMatch(/undefined|NaN/);
    expect(shown.map((b) => (b as { path: string }).path)).toEqual(
      ALL.map((key) => `/embed/study/${AB_JQE_STUDY.id}/${AB_JQE_STUDY.chapters[key]}?ply=${openPlyOf(game(key))}`),
    );
    expect(Object.keys(AB_JQE_STUDY.chapters)).toEqual(ALL);
    expect(M.games.map((g) => g.key)).toEqual(ALL);
    // Wins for each engine, and two draws: the game AB-JChess had won and the chase game.
    expect(M.games.some((g) => g.winner !== 'draw' && g.abWon)).toBe(true);
    expect(M.games.some((g) => g.winner !== 'draw' && !g.abWon)).toBe(true);
    expect(M.games.filter((g) => g.winner === 'draw').map((g) => g.key)).toEqual(['run1:157', 'run1:54']);
    // The second chase game is a mention only, with no board.
    expect(game('run1:54').chase!.also.key).toBe('run2:96');
    expect(M.games.some((g) => g.key === 'run2:96')).toBe(false);
  });

  for (const key of ALL) {
    it(`${key} replays legally to its recorded result on a public deal`, () => {
      const g = game(key);
      const { states, moves } = play(key);
      const end = states.at(-1)!;
      if (g.winner === 'draw') {
        expect(end.status).toMatchObject({ type: 'finished', winner: null, reason: 'repetition' });
        // A plain repetition: nobody was checking perpetually, so Mistboard draws it too.
        expect(jieqiPerpetualCheckLoser(end)).toBeNull();
        expect(g.abWon).toBe(false);
      } else {
        // The side to move has no legal move: "wins on move N, when X has no legal move".
        expect(end.status).toMatchObject({ type: 'finished', winner: g.winner, reason: 'checkmate' });
        expect(g.reason).toMatch(/^no-move-/);
        expect(g.abWon).toBe(engineOf(g.winner === 'red' ? g.red : g.black) === 'abj');
      }
      expect(moves).toHaveLength(g.plies);
      expect(Math.ceil(moves.length / 2)).toBe(g.moveCount);
      // The stored deal is already public: nothing in it names a piece that was
      // captured face-down or never turned over.
      expect(jieqiPublicDeal(g.deal, moves)).toEqual(g.deal);
    });
  }

  it("charts the board's side by both engines at match settings, ending on the result", () => {
    for (const key of ALL) {
      const g = game(key);
      const a = g.aligned;
      // The board follows the lead engine's side: the winner's (a draw: the side one engine had winning).
      expect(engineOf(a.side === 'red' ? g.red : g.black), key).toBe(a.lead);
      if (g.winner !== 'draw') expect(a.side, key).toBe(g.winner);
      expect([a.movetimeMs, a.threads, a.catch], key).toEqual([M.movetimeMs, M.threads, 0.1]);
      for (const e of ['abj', 'jqe'] as const) {
        const s = a.series[e];
        expect(s, key).toHaveLength(g.plies + 1);
        for (const v of s) expect(v >= 0 && v <= 1, key).toBe(true);
        expect(s.at(-1), key).toBe(g.winner === 'draw' ? 0.5 : 1);
        // One choice per position, and the mover's is the move played.
        expect(a.best[e], key).toHaveLength(g.plies);
      }
      const moves = g.moves.split(' ');
      for (const [i, mv] of moves.entries()) {
        const mover = engineOf(i % 2 === 0 ? g.red : g.black);
        expect(a.best[mover][i], `${key} ply ${i}`).toBe(mv);
      }
    }
  });

  it("marks one move per game: the other side's, where the lead engine wanted another", () => {
    for (const key of ALL) {
      const g = game(key);
      const a = g.aligned;
      const m = a.moment;
      const { states, moves } = play(key);
      const before = states[m.ply]!;
      const played = moves[m.ply]!;
      expect(m.ply % 2 === 0 ? 'red' : 'black', key).not.toBe(a.side);
      expect(m.by, key).toBe(other(a.lead));
      expect(m.move, key).toBe(Math.floor(m.ply / 2) + 1);
      expect(`${played.from}${played.to}`, key).toBe(m.played);
      const pick = parse(m.pick)[0]!;
      expect(m.pick, key).not.toBe(m.played);
      expect(isJieqiLegalMove(before, pick), `${key} pick ${m.pick}`).toBe(true);
      expect(a.best[a.lead][m.ply], key).toBe(m.pick);
      // The move played never turns a piece over; only jqe's pick in game 4 does.
      expect(before.board[played.from]?.faceDown, key).toBe(false);
      expect(before.board[pick.from]?.faceDown, key).toBe(key === 'run2:104');
      for (const e of ['abj', 'jqe'] as const) {
        expect(m.before[e], key).toBe(a.series[e][m.ply]);
        expect(m.after[e], key).toBe(a.series[e][m.ply + 1]);
      }
      // The lead engine's number for its side rises on the move.
      expect(m.after[a.lead] - m.before[a.lead], key).toBeGreaterThanOrEqual(0.03);
    }
  });

  it("counts the other side's moves until its engine's number comes within 10 points", () => {
    for (const key of ALL) {
      const g = game(key);
      const a = g.aligned;
      const m = a.moment;
      const d = (p: number) => a.series[a.lead][p]! - a.series[other(a.lead)][p]!;
      let caught: number | null = null;
      for (let p = m.ply + 2; p < g.plies; p++) {
        if (d(p) < a.catch) {
          caught = p;
          break;
        }
      }
      expect(m.caughtPly, key).toBe(caught);
      let lag = 0;
      if (caught !== null) for (let k = m.ply + 1; k < caught; k++) if (k % 2 === m.ply % 2) lag++;
      expect(m.lagMoves, key).toBe(caught === null ? null : lag);
    }
    expect(AB_JQE_GAMES.map((k) => game(k).aligned.moment.lagMoves)).toEqual([8, 2, 2, 3, 3]);
    expect(game(AB_JQE_CHASE).aligned.moment.lagMoves).toBeNull();
  });

  it('backs the pieces and points the captions name', () => {
    const at = (key: string) => {
      const g = game(key);
      const m = g.aligned.moment;
      return { g, m, board: play(key).states[m.ply]!.board };
    };
    const piece = (role: string, color: string) => ({ role, color, faceDown: false });
    // Game 1: every piece face up; jqe's soldier d5 to d6, AB-JChess's horse e6 to c5.
    {
      const { g, m, board } = at('run2:115');
      expect([g.red, g.black, m.played, m.pick]).toEqual(['jqe', 'AB-JChess-20261031', 'd5d6', 'e6c5']);
      expect(board[sq('d5')]).toMatchObject(piece('soldier', 'red'));
      expect(board[sq('e6')]).toMatchObject(piece('horse', 'red'));
      const roles = (color: string) =>
        Object.values(board)
          .filter((p) => p && p.color === color)
          .map((p) => {
            expect(p!.faceDown).toBe(false);
            return p!.role;
          })
          .sort();
      expect(roles('red')).toEqual(['advisor', 'advisor', 'general', 'horse', 'soldier']);
      expect(roles('black')).toEqual(['advisor', 'cannon', 'general', 'soldier', 'soldier']);
    }
    // Game 2: jqe's chariot h1 to h7; AB-JChess would move it to g1.
    {
      const { g, m, board } = at('run2:22');
      expect([g.red, m.played, m.pick]).toEqual(['AB-JChess-20261031', 'h1h7', 'h1g1']);
      expect(board[sq('h1')]).toMatchObject(piece('chariot', 'black'));
    }
    // Game 3: jqe's cannon e4 to e6; AB-JChess's horse d6 to f5.
    {
      const { g, m, board } = at('run1:8');
      expect([g.red, m.played, m.pick]).toEqual(['AB-JChess-20261031', 'e4e6', 'd6f5']);
      expect(board[sq('e4')]).toMatchObject(piece('cannon', 'black'));
      expect(board[sq('d6')]).toMatchObject(piece('horse', 'black'));
    }
    // Game 4: AB-JChess's cannon h6 to h9; jqe would turn over the piece on h1.
    {
      const { g, m, board } = at('run2:104');
      expect([g.red, m.played, m.pick]).toEqual(['AB-JChess-20261031', 'h6h9', 'h1f2']);
      expect(board[sq('h6')]).toMatchObject(piece('cannon', 'red'));
      expect(board[sq('h1')]).toMatchObject({ color: 'red', faceDown: true });
    }
    // Game 5: jqe's chariot f3 to d3; AB-JChess's other chariot a10 to f10.
    {
      const { g, m, board } = at('run1:157');
      expect([g.red, m.played, m.pick]).toEqual(['jqe', 'f3d3', 'a10f10']);
      expect(board[sq('f3')]).toMatchObject(piece('chariot', 'red'));
      expect(board[sq('a10')]).toMatchObject(piece('chariot', 'red'));
    }
    // The chase game: AB-JChess's chariot c9 to c3; jqe would move it to f9.
    {
      const { g, m, board } = at('run1:54');
      expect([g.red, m.played, m.pick]).toEqual(['AB-JChess-20261031', 'c9c3', 'c9f9']);
      expect(board[sq('c9')]).toMatchObject(piece('chariot', 'red'));
    }
  });

  it("backs game 1: jqe holds at 50%, and AB-JChess's verdict survives its chase rule off", () => {
    const g = game('run2:115');
    const a = g.aligned;
    const m = a.moment;
    // "jqe keeps saying 50% for its next three moves" (Red moves at plies 164, 166, 168).
    for (let p = m.ply + 1; p <= m.ply + 6; p++) expect(a.series.jqe[p], `p ${p}`).toBe(0.5);
    expect(a.series.jqe[m.ply + 7]).toBeGreaterThan(0.5);
    // "Nothing is left to turn over": no move from here touches a face-down piece.
    for (let i = m.ply; i < g.plies; i++) expect(touchesHidden(g.key, i), `ply ${i}`).toBe(false);
    const c = g.check!;
    expect([c.ply, c.chaseRule, c.nodes]).toEqual([m.ply, 'none', [22e6, 88e6, 352e6]]);
    expect(c.playedCp.map(abjChance)).toEqual([31, 27, 21]);
    expect(c.pickCp.map(abjChance)).toEqual([50, 48, 48]);
    // "More search made the push look worse."
    expect(c.playedCp[1]!).toBeLessThan(c.playedCp[0]!);
    expect(c.playedCp[2]!).toBeLessThan(c.playedCp[1]!);
    // "with 16 times the search it still picks the push and still calls the game a dead draw"
    const j = g.jqeCheck!;
    expect([j.ply, j.nodes]).toEqual([m.ply, [22e6, 88e6, 352e6]]);
    expect(j.bestUci).toEqual(['d4d5', 'd4d5', 'd4d5']);
    expect(j.playedCp).toEqual([0, 0, 0]);
    for (const cp of j.pickCp) expect(cp).toBeLessThan(0);
  });

  it('backs game 2: the reveal on move 35 and the face-down capture on move 36 decide it', () => {
    const g = game('run2:22');
    const a = g.aligned;
    const { states, moves } = play(g.key);
    expect(states[68]!.board[moves[68]!.from]).toMatchObject({ color: 'red', faceDown: true });
    expect(states[70]!.board[moves[70]!.from]).toMatchObject({ color: 'red', role: 'soldier', faceDown: false });
    expect(states[70]!.board[moves[70]!.to]).toMatchObject({ color: 'black', faceDown: true });
    expect([pts(a.series.abj[69]!), pts(a.series.jqe[69]!)]).toEqual([50, 45]);
    expect([pts(a.series.abj[71]!), pts(a.series.jqe[71]!)]).toEqual([94, 94]);
    // "it runs 3 to 16 points under AB-JChess's" from the chariot move to move 35.
    const gaps: number[] = [];
    for (let p = a.moment.ply + 1; p <= 68; p++) gaps.push(pts(a.series.abj[p]!) - pts(a.series.jqe[p]!));
    expect([Math.min(...gaps), Math.max(...gaps)]).toEqual([3, 16]);
  });

  it('backs game 3: jqe stays below until face-down pieces come into play', () => {
    const g = game('run1:8');
    const a = g.aligned;
    for (let p = a.moment.ply; p < 42; p++) expect(a.series.abj[p]!, `p ${p}`).toBeGreaterThanOrEqual(a.series.jqe[p]!);
    expect([pts(a.series.abj[42]!), pts(a.series.jqe[42]!)]).toEqual([83, 83]);
    expect([39, 40, 41].map((i) => touchesHidden(g.key, i))).toEqual([true, true, true]);
    expect([38, 42].map((i) => touchesHidden(g.key, i))).toEqual([false, false]);
  });

  it("backs game 4: jqe rates Black higher, then two of Red's reveals settle it", () => {
    const g = game('run2:104');
    const a = g.aligned;
    const gaps: number[] = [];
    for (let p = a.moment.ply; p <= 36; p++) gaps.push(pts(a.series.jqe[p]!) - pts(a.series.abj[p]!));
    expect([Math.min(...gaps), Math.max(...gaps)]).toEqual([6, 16]);
    // "came within 10 points three moves later and fell back".
    expect(a.series.jqe[34]! - a.series.abj[34]!).toBeGreaterThanOrEqual(0.1);
    const { states, moves } = play(g.key);
    for (const i of [36, 38]) expect(states[i]!.board[moves[i]!.from]).toMatchObject({ color: 'red', faceDown: true });
    expect(pts(a.series.abj[39]!)).toBe(84);
    expect(a.series.jqe[39]!).toBeGreaterThanOrEqual(a.series.abj[39]!);
  });

  it('backs game 5: AB-JChess has Black won, and the position repeats', () => {
    const g = game('run1:157');
    const a = g.aligned;
    const { states, moves } = play(g.key);
    expect(states[98]!.board[moves[98]!.from]).toMatchObject({ color: 'red', faceDown: true });
    expect([pts(a.series.abj[99]!), pts(a.series.jqe[99]!)]).toEqual([81, 71]);
    for (let p = 105; p < g.plies; p++) expect(a.series.abj[p]!, `p ${p}`).toBeGreaterThan(0.9);
    expect(a.series.abj[104]!).toBeLessThan(0.9);
    const jqe = a.series.jqe.slice(105, g.plies).map(pts);
    expect([Math.min(...jqe), Math.max(...jqe)]).toEqual([73, 90]);
    expect(pts(a.series.jqe[g.plies - 1]!)).toBe(90);
    // Red's chariot between f7 and f4, Black's elephant between c4 and e6, to the end.
    const tail = g.moves.split(' ').slice(106);
    tail.forEach((mv, i) => expect(i % 2 === 0 ? ['f7f4', 'f4f7'] : ['c4e6', 'e6c4']).toContain(mv));
    expect(states[106]!.board[sq('f7')]).toMatchObject({ role: 'chariot', color: 'red' });
    expect(states[107]!.board[sq('c4')]).toMatchObject({ role: 'elephant', color: 'black' });
  });

  it("backs the chase game: Red's chariot attacks the horse every move, and the rules disagree", () => {
    const g = game(AB_JQE_CHASE);
    const a = g.aligned;
    const c = g.chase!;
    expect([a.lead, a.side, c.fromPly, c.toPly]).toEqual(['jqe', 'black', 100, 108]);
    expect(g.moves.split(' ').slice(100)).toEqual(['c9c3', 'a3b5', 'c3c5', 'b5a3', 'c5c3', 'a3b5', 'c3c5', 'b5a3', 'c5c3']);
    const { states } = play(g.key);
    const file = (s: string) => s.charCodeAt(0);
    const rank = (s: string) => Number(s.slice(1));
    // After each of Red's moves the chariot and the horse share a rank with nothing between.
    for (let ply = 100; ply <= 108; ply += 2) {
      const board = states[ply + 1]!.board;
      const chariot = g.moves.split(' ')[ply]!.slice(2);
      expect(board[sq(chariot)]).toMatchObject({ role: 'chariot', color: 'red' });
      const horse = ply % 4 === 0 ? 'a3' : 'b5';
      expect(board[sq(horse)]).toMatchObject({ role: 'horse', color: 'black' });
      expect(rank(chariot)).toBe(rank(horse));
      for (let f = Math.min(file(chariot), file(horse)) + 1; f < Math.max(file(chariot), file(horse)); f++) {
        expect(board[sq(`${String.fromCharCode(f)}${rank(horse)}`)], `ply ${ply}`).toBeFalsy();
      }
    }
    // "jqe gave Black 72% or more to the end" (rounded as the prose rounds); AB-JChess holds 50%.
    for (let p = 101; p < g.plies; p++) {
      expect(pts(a.series.jqe[p]!), `p ${p}`).toBeGreaterThanOrEqual(72);
      expect(a.series.abj[p]!, `p ${p}`).toBe(0.5);
    }
    // On move 53: jqe -2.9 with its rule on, 0 off; AB-JChess 0 on or off.
    const t = c.toggle.at(-1)!;
    expect(t.ply).toBe(104);
    expect([t.jqe.on, t.jqe.off, t.abj.skyrule, t.abj.none]).toEqual([-294, 0, 0, 0]);
    // run2:96: AB-JChess's rule calls its own Red side winning; jqe says 0 either way.
    expect(c.also).toMatchObject({ key: 'run2:96', stm: 'red', jqe: { on: 0, off: 0 } });
    expect([c.also.abj.skyrule, c.also.abj.none]).toEqual([1349, 173]);
  });

  it('draws both engines\' moves wherever they disagree, and nothing where they agree', () => {
    for (const key of ALL) {
      const best = game(key).aligned.best;
      const arrows = disagreementArrows(best);
      const split = best.abj.map((m, i) => (m !== best.jqe[i] ? i : -1)).filter((i) => i >= 0);
      expect(Object.keys(arrows).map(Number), key).toEqual(split);
      for (const [i, pair] of Object.entries(arrows)) {
        expect(pair.map((a) => a.brush), `${key} ${i}`).toEqual(['blue', 'orange']);
        expect(`${pair[0]!.orig}${pair[0]!.dest}`).toBe(best.abj[Number(i)]);
        expect(`${pair[1]!.orig}${pair[1]!.dest}`).toBe(best.jqe[Number(i)]);
      }
    }
    // Game 1's marked move: jqe's push in orange, AB-JChess's horse move in blue.
    const g1 = disagreementArrows(game('run2:115').aligned.best);
    expect(g1[162]).toEqual([
      { kind: 'arrow', brush: 'blue', orig: 'e6', dest: 'c5' },
      { kind: 'arrow', brush: 'orange', orig: 'd5', dest: 'd6' },
    ]);
    // Both engines open with the same move: no arrows on the first position.
    expect(g1[0]).toBeUndefined();
  });

  /** Plays an engine's line from the marked position. Each step names the piece that
   *  moved and the piece it took, both face up; the line is cut at its first move that
   *  touches a face-down piece, which must be legal and is returned as `hidden`. */
  const line = (key: string, e: 'abj' | 'jqe', what: 'played' | 'pick') => {
    const g = game(key);
    const m = g.aligned.moment;
    let state = play(key).states[m.ply]!;
    const steps: { mv: string; role: string; color: string; took?: string }[] = [];
    let hidden: { mv: string; took: boolean } | null = null;
    for (const mv of m.lines[e][what].pv) {
      const move = parse(mv)[0]!;
      expect(isJieqiLegalMove(state, move), `${key} ${e} ${what} ${mv}`).toBe(true);
      const p = state.board[move.from]!;
      const t = state.board[move.to];
      if (p.faceDown || t?.faceDown) {
        hidden = { mv, took: Boolean(t?.faceDown) };
        break;
      }
      steps.push({ mv, role: p.role!, color: p.color, took: t?.role });
      state = applyJieqiMove(state, move, { noCaptureClockLimit: Number.POSITIVE_INFINITY });
    }
    return { steps, hidden, cp: m.lines[e][what].cp };
  };
  const took = (s: ReturnType<typeof line>['steps']) => s.filter((x) => x.took).map((x) => `${x.mv}x${x.took}`);

  it("reads each engine's line at the marked move, from searches of a few seconds", () => {
    for (const key of ALL) {
      const m = game(key).aligned.moment;
      for (const e of ['abj', 'jqe'] as const) {
        for (const what of ['played', 'pick'] as const) {
          const l = m.lines[e][what];
          expect(l.pv[0], `${key} ${e} ${what}`).toBe(m[what]);
          expect(l.pv.length).toBeLessThanOrEqual(14);
          expect(l.secs).toBeLessThan(10);
          line(key, e, what);
        }
      }
    }
  });

  it("backs game 1's reading: the push's line attacks Red's general, the horse move takes the advisor", () => {
    const k = 'run2:115';
    const { board } = { board: play(k).states[162]!.board };
    expect(board[sq('d3')]).toMatchObject({ role: 'advisor', color: 'black', faceDown: false });
    // AB-JChess after the push: cannon to e10, soldier f3-f2-e2, general to f1, advisor d3-e4-f3, horse to g5 and h3.
    const ab = line(k, 'abj', 'played');
    const moved = ab.steps.map((s) => `${s.color} ${s.role} ${s.mv}`);
    for (const x of [
      'black cannon c10e10',
      'black soldier f3f2',
      'black soldier f2e2',
      'red general e1f1',
      'black advisor d3e4',
      'black advisor e4f3',
      'red horse e6g5',
      'red horse g5h3',
    ])
      expect(moved).toContain(x);
    expect(took(ab.steps)).toEqual([]);
    // jqe after the push: soldier to e2, then Black's cannon and general shuttle, no captures.
    const jq = line(k, 'jqe', 'played');
    expect(jq.steps.map((s) => s.mv)).toContain('f2e2');
    expect(took(jq.steps)).toEqual([]);
    expect(jq.steps.filter((s) => s.color === 'black' && s.mv !== 'f3f2' && s.mv !== 'f2e2').map((s) => s.role).sort()).toEqual(
      ['cannon', 'cannon', 'cannon', 'general', 'general'],
    );
    // The horse move, in both lines: the horse takes the advisor on d3 and a soldier takes it back.
    for (const e of ['abj', 'jqe'] as const) {
      const pk = line(k, e, 'pick');
      expect(pk.steps.slice(0, 4).map((s) => `${s.color} ${s.role} ${s.mv}${s.took ? `x${s.took}` : ''}`)).toEqual([
        'red horse e6c5',
        'black soldier f3e3',
        'red horse c5d3xadvisor',
        'black soldier e3d3xhorse',
      ]);
    }
    // "AB-JChess scores what is left as level"; jqe scores the push level and the trade worse.
    expect(line(k, 'abj', 'pick').cp).toBe(0);
    expect(jq.cp).toBe(0);
    expect(line(k, 'jqe', 'pick').cp).toBeLessThan(jq.cp);
    expect(ab.cp).toBeLessThan(line(k, 'abj', 'pick').cp);
  });

  it('backs the shape of each game the prose describes', () => {
    const band = (key: string, a: number, b: number) => {
      const s = game(key).aligned.series;
      const v = [...s.abj.slice(a, b), ...s.jqe.slice(a, b)].map(pts);
      return [Math.min(...v), Math.max(...v)];
    };
    const high = (key: string, p: number) => Math.max(pts(game(key).aligned.series.abj[p]!), pts(game(key).aligned.series.jqe[p]!));
    expect(band('run2:115', 80, 162)).toEqual([33, 52]);
    expect(high('run2:22', 24)).toBe(16);
    expect(high('run1:8', 12)).toBe(23);
    expect(high('run1:157', 64)).toBe(9);
    // Game 2: Black's chariot takes a face-down piece on g1, then the advisor on h1.
    {
      const { states, moves } = play('run2:22');
      expect(states[43]!.board[moves[43]!.from]).toMatchObject({ role: 'chariot', color: 'black', faceDown: false });
      expect(moves[43]).toEqual({ from: 'g3', to: 'g1' });
      expect(states[43]!.board[sq('g1')]).toMatchObject({ color: 'red', faceDown: true });
      expect(moves[47]).toEqual({ from: 'g1', to: 'h1' });
      expect(states[47]!.board[sq('h1')]).toMatchObject({ role: 'advisor', color: 'red', faceDown: false });
      const at = states[49]!.board;
      expect(at[sq('d9')]).toMatchObject({ role: 'chariot', color: 'red', faceDown: false });
      expect(at[sq('b9')]).toMatchObject({ role: 'soldier', color: 'red', faceDown: false });
      expect(moves[68]!.from).toBe('f1');
      expect(states[69]!.board[moves[68]!.to]).toMatchObject({ role: 'soldier', color: 'red' });
      expect(moves[70]!.to).toBe('d10');
    }
    // Game 3: Black's soldier takes a face-down piece on move 6; Red's cannon one on move 14, putting Red ahead.
    {
      const { states, moves } = play('run1:8');
      const s = game('run1:8').aligned.series;
      expect(states[11]!.board[moves[11]!.from]).toMatchObject({ role: 'soldier', color: 'black', faceDown: false });
      expect(states[11]!.board[moves[11]!.to]).toMatchObject({ color: 'red', faceDown: true });
      expect(states[26]!.board[moves[26]!.from]).toMatchObject({ role: 'cannon', color: 'red', faceDown: false });
      expect(states[26]!.board[moves[26]!.to]).toMatchObject({ color: 'black', faceDown: true });
      expect(s.abj[27]!).toBeGreaterThan(0.5);
      expect(s.jqe[27]!).toBeGreaterThan(0.5);
    }
    // Game 4: jqe already rates Black higher at the marked move.
    {
      const s = game('run2:104').aligned.series;
      expect(s.jqe[26]!).toBeGreaterThan(s.abj[26]!);
    }
    // Game 5: both engines still have Red ahead at the marked move, AB-JChess by less.
    {
      const s = game('run1:157').aligned.series;
      expect(s.abj[76]!).toBeLessThan(0.5);
      expect(s.jqe[76]!).toBeLessThan(s.abj[76]!);
    }
  });

  it("backs games 2 to 5 and the chase game's readings of the engines' lines", () => {
    // Game 2: staying, both lines: general to d1, the cannon takes the horse on e2, a chariot takes a face-down piece on d10.
    for (const e of ['abj', 'jqe'] as const) {
      const l = line('run2:22', e, 'pick');
      expect(l.steps.map((s) => `${s.color} ${s.role} ${s.mv}${s.took ? `x${s.took}` : ''}`)).toEqual([
        'black chariot h1g1',
        'red general e1d1',
        'black cannon e8e2xhorse',
      ]);
      expect(l.hidden).toEqual({ mv: 'd9d10', took: true });
    }
    // Black's view: AB-JChess prefers staying, jqe going home.
    expect(line('run2:22', 'abj', 'pick').cp).toBeGreaterThan(line('run2:22', 'abj', 'played').cp);
    expect(line('run2:22', 'jqe', 'pick').cp).toBeLessThan(line('run2:22', 'jqe', 'played').cp);

    // Game 3: the game followed jqe's line for the cannon move.
    {
      const g = game('run1:8');
      const l = line(g.key, 'jqe', 'played');
      const six = l.steps.slice(0, 6);
      expect(six.map((s) => s.mv)).toEqual(g.moves.split(' ').slice(29, 35));
      expect(took(six)).toEqual(['c5c6xelephant', 'e6c6xsoldier', 'c6f6xadvisor', 'g6d6xhorse']);
      expect(six.map((s) => s.color)).toEqual(['black', 'red', 'black', 'red', 'black', 'red']);
      const pk = line(g.key, 'abj', 'pick');
      expect(took(pk.steps)).toEqual(['f2e4xcannon', 'c6e4xhorse', 'f5h6xelephant']);
      expect(pk.steps.find((s) => s.mv === 'f5h6')).toMatchObject({ role: 'horse', color: 'black' });
      expect(pk.steps.find((s) => s.mv === 'c6e4')).toMatchObject({ role: 'elephant', color: 'black' });
      // jqe: close; AB-JChess: clearly worse for Black.
      expect(Math.abs(l.cp - line(g.key, 'jqe', 'pick').cp)).toBeLessThan(20);
      expect(line(g.key, 'abj', 'pick').cp - line(g.key, 'abj', 'played').cp).toBeGreaterThan(100);
    }

    // Game 4: both lines for the cannon move stop at Black turning over d10, which it did; jqe's pick turns one over at once.
    {
      const g = game('run2:104');
      for (const e of ['abj', 'jqe'] as const) {
        const l = line(g.key, e, 'played');
        expect(l.steps.map((s) => s.mv)).toEqual(['h6h9']);
        expect(l.hidden).toEqual({ mv: 'd10e9', took: false });
        expect(line(g.key, e, 'pick').steps).toEqual([]);
      }
      expect(g.moves.split(' ')[27]).toBe('d10e9');
      // Red's view: AB-JChess above, jqe below.
      expect(line(g.key, 'abj', 'played').cp).toBeGreaterThan(line(g.key, 'abj', 'pick').cp);
      expect(line(g.key, 'jqe', 'played').cp).toBeLessThan(line(g.key, 'jqe', 'pick').cp);
      // Black's cannon takes the piece Red turned over on move 20.
      const { states, moves } = play(g.key);
      expect(moves[39]!.to).toBe(moves[38]!.to);
      expect(states[39]!.board[moves[39]!.from]).toMatchObject({ role: 'cannon', color: 'black' });
    }

    // Game 5: the game went down jqe's line; AB-JChess's own choice trades chariots on f10.
    {
      const g = game('run1:157');
      const l = line(g.key, 'jqe', 'played');
      // Move for move through Red's chariot taking a face-down piece on a7.
      expect([...l.steps.map((s) => s.mv), l.hidden!.mv]).toEqual(g.moves.split(' ').slice(76, 87));
      expect(took(l.steps)).toEqual(['d3d9xhorse', 'd10e10xchariot', 'f10e10xchariot']);
      expect(l.hidden).toEqual({ mv: 'a9a7', took: true });
      expect(play(g.key).states[86]!.board[sq('a9')]).toMatchObject({ role: 'chariot', color: 'red' });
      const pk = line(g.key, 'abj', 'pick');
      expect(took(pk.steps.slice(0, 3))).toEqual(['f9f10xchariot', 'f3f10xchariot']);
      expect(pk.steps.find((s) => s.mv === 'g5f7')).toMatchObject({ role: 'horse', color: 'red' });
      expect(pk.steps.find((s) => s.mv === 'f10f3')).toMatchObject({ role: 'chariot', color: 'red' });
      expect(l.cp).toBeGreaterThan(line(g.key, 'jqe', 'pick').cp);
      expect(line(g.key, 'abj', 'played').cp).toBeLessThan(line(g.key, 'abj', 'pick').cp);
    }

    // The chase game: AB-JChess's line keeps the chariot after the horse at 0; jqe's pick takes the advisor on f7.
    {
      const k = AB_JQE_CHASE;
      const ab = line(k, 'abj', 'played');
      expect(ab.cp).toBe(0);
      expect(ab.steps.slice(0, 3).map((s) => s.mv)).toEqual(['c9c3', 'a3b5', 'c3c5']);
      expect(line(k, 'abj', 'pick').cp).toBeLessThan(0);
      const jq = line(k, 'jqe', 'pick');
      expect(jq.steps.slice(0, 4).map((s) => `${s.color} ${s.role} ${s.mv}${s.took ? `x${s.took}` : ''}`)).toEqual([
        'red chariot c9f9',
        'black general f10e10',
        'red chariot f9f7xadvisor',
        'black chariot d10d1',
      ]);
      expect(line(k, 'jqe', 'played').cp).toBeLessThan(jq.cp);
    }
  });

  it('comments only where something happens, and never with a number the graph shows', () => {
    for (const key of ALL) {
      const g = game(key);
      const notes = abJqeNotes(key);
      const plies = Object.keys(notes).map(Number);
      // A handful per game (Brian, 2026-11-03: a percentage on every move was "way too noisy").
      expect(plies.length, key).toBeGreaterThanOrEqual(3);
      expect(plies.length, key).toBeLessThanOrEqual(10);
      for (const p of plies) expect(p >= 1 && p <= g.plies, `${key} ${p}`).toBe(true);
      // One on the position the post opens on, naming both moves, and one on the finish.
      const m = g.aligned.moment;
      const pts = (mv: string) => /^([a-i]\d+)([a-i]\d+)$/.exec(mv)!.slice(1);
      for (const pt of pts(m.played)) expect(notes[m.ply], key).toContain(pt);
      expect(pts(m.pick).some((pt) => notes[m.ply]!.includes(pt)), key).toBe(true);
      expect(notes[g.plies], key).toMatch(g.winner === 'draw' ? /^Drawn/ : /has no legal move/);
      for (const [p, text] of Object.entries(notes)) {
        expect(text, `${key} ${p}`).not.toMatch(/%|undefined|NaN|\u2014/);
        expect(text, `${key} ${p}`).not.toMatch(/\b(squares?|king|rook|knight|bishop|pawn)\b/i);
        // Plain sentences, one or two (three for the split, which names both moves and why).
        expect(text.split(/[.!?](?:\s|$)/).filter(Boolean).length, `${key} ${p}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('backs the reveals and face-down captures the comments name', () => {
    const turned = (key: string, i: number) => {
      const { states, moves } = play(key);
      expect(states[i]!.board[moves[i]!.from], `${key} ${i}`).toMatchObject({ faceDown: true });
      return { ...states[i + 1]!.board[moves[i]!.to]!, from: moves[i]!.from, to: moves[i]!.to, took: states[i]!.board[moves[i]!.to] };
    };
    const ser = (key: string) => game(key).aligned.series;
    // Game 1: jqe level for three more moves, then caught up at 180.
    expect(game('run2:115').aligned.moment.caughtPly).toBe(180);
    // Game 3: the two face-down captures on b3 and g7, and the numbers either side.
    {
      const { moves } = play('run1:8');
      expect([moves[11]!.to, moves[26]!.to]).toEqual(['b3', 'g7']);
      const s = ser('run1:8');
      expect(Math.max(s.abj[12]!, s.jqe[12]!)).toBeLessThan(0.3);
    }
    // Game 2: the f1 reveal leaves it about even, the d10 capture has Red winning.
    {
      const s = ser('run2:22');
      for (const e of ['abj', 'jqe'] as const) {
        expect(Math.abs(s[e][69]! - 0.5), e).toBeLessThanOrEqual(0.06);
        expect(s[e][71]!, e).toBeGreaterThan(0.9);
      }
      expect(play('run2:22').moves[70]!.from).toBe('d9');
    }
    // Game 4: Black turns over a soldier on d10; Red a soldier on d1, then a chariot on c4 taking a soldier on c5.
    {
      const k = 'run2:104';
      const s = ser(k);
      expect(turned(k, 27)).toMatchObject({ from: 'd10', role: 'soldier', color: 'black' });
      expect(turned(k, 36)).toMatchObject({ from: 'd1', role: 'soldier', color: 'red' });
      const c = turned(k, 38);
      expect(c).toMatchObject({ from: 'c4', to: 'c5', role: 'chariot', color: 'red' });
      expect(c.took).toMatchObject({ role: 'soldier', color: 'black', faceDown: false });
      for (const e of ['abj', 'jqe'] as const) {
        expect(s[e][28]!, e).toBeLessThan(s[e][27]!);
        expect(s[e][37]!, e).toBeGreaterThan(s[e][36]!);
        for (let p = 40; p <= game(k).plies; p++) expect(s[e][p]!, `${e} ${p}`).toBeGreaterThan(0.8);
      }
    }
    // Game 5: Red turns over a soldier on d1, and AB-JChess has Black well ahead.
    {
      expect(turned('run1:157', 98)).toMatchObject({ from: 'd1', role: 'soldier', color: 'red' });
      expect(ser('run1:157').abj[99]!).toBeGreaterThan(0.75);
    }
  });

  // The rows imported into each chapter (scripts/study-chapter-decisions.mjs), scored offline
  // by AB-JChess over the mover's believed pool: what both players could see, plus the mover's
  // own pieces captured face-down, which it never saw. No row names a face-down victim.
  it('stores a luck row for every public reveal, from public information only', () => {
    for (const key of ALL) {
      const rows = AB_JQE_LUCK[key as keyof typeof AB_JQE_LUCK];
      expect(rows, key).toBeDefined();
      expect(rows.engineId).toBe('abjchess-20261031');
      const { states, moves } = play(key);
      const reveals = moves.flatMap((mv, i) => (states[i]!.board[mv.from]?.faceDown ? [i + 1] : []));
      expect(rows.decisions.map((d) => d.ply), key).toEqual(reveals);
      for (const d of rows.decisions) {
        expect(d.mover, `${key} ${d.ply}`).toBe(d.ply % 2 === 1 ? 'red' : 'black');
        // Win percentages, mover's view; a pool of one identity has no luck.
        for (const v of [d.playedWin, d.realizedWin]) expect(v >= 0 && v <= 100, `${key} ${d.ply}`).toBe(true);
      }
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
    // The closing paragraph: within a move in most of AB-JChess's wins.
    expect(L.abWon.withinOne / L.abWon.games).toBeGreaterThan(0.7);
  });

  it('backs the deal-sides claim: about half the deals went to one colour twice', () => {
    const S = M.dealSides;
    const T = M.total;
    expect(S.red + S.black).toBe(S.sameColourWonBoth);
    // A pair scoring 1 is one win each (the same colour twice) or two draws.
    expect(S.sameColourWonBoth).toBeLessThanOrEqual(T.pairPoints['1']!);
    expect(S.sameColourWonBoth / T.pairs).toBeGreaterThan(0.45);
    expect(S.sameColourWonBoth / T.pairs).toBeLessThan(0.55);
    // "AB-JChess's edge comes from the rest": it won both games of a deal more often.
    expect(T.pairPoints['2']).toBeGreaterThan(T.pairPoints['0']!);
  });

  it('rescores the drawn games under Mistboard rules', () => {
    const R = M.mistboardRules;
    const T = M.total;
    const draws = AB_JQE_DRAWS.games as {
      key: string;
      abjColour: 'red' | 'black';
      agreedWinner: 'abj' | 'jqe' | null;
      deal: JieqiDeal;
      moves: string;
    }[];
    expect(draws).toHaveLength(T.draws);
    const checked = { abj: 0, jqe: 0 };
    let agreedLost = 0;
    let stillWon = 0;
    let stillWonAbj = 0;
    const stillDrawn: string[] = [];
    for (const d of draws) {
      let state = createInitialJieqiState(d.key, d.deal, { repetition: true });
      for (const [i, move] of parse(d.moves).entries()) {
        expect(isJieqiLegalMove(state, move), `${d.key} ply ${i + 1}`).toBe(true);
        state = applyJieqiMove(state, move, { noCaptureClockLimit: Number.POSITIVE_INFINITY });
      }
      expect(state.status, d.key).toMatchObject({ type: 'finished', reason: 'repetition' });
      const loser = jieqiPerpetualCheckLoser(state);
      if (loser) {
        const checker = loser === d.abjColour ? 'abj' : 'jqe';
        checked[checker] += 1;
        if (d.agreedWinner !== null && d.agreedWinner !== checker) agreedLost += 1;
      } else {
        stillDrawn.push(d.key);
        if (d.agreedWinner !== null) stillWon += 1;
        if (d.agreedWinner === 'abj') stillWonAbj += 1;
      }
    }
    expect(checked.abj + checked.jqe).toBe(R.perpetualCheck);
    expect(agreedLost).toBe(R.checkerAgreedLost);
    expect(stillDrawn).toHaveLength(R.stillDrawn);
    expect([stillWon, stillWonAbj]).toEqual([R.stillDrawnAgreedWon, R.stillDrawnAgreedWonAbj]);
    // "Most draws were not draws", and the checking side was nearly always the losing one.
    expect(R.perpetualCheck).toBeGreaterThan(T.draws / 2);
    expect(R.checkerAgreedLost / R.perpetualCheck).toBeGreaterThan(0.9);
    // The rescored record is the played one with each perpetual check a loss for the checker.
    expect([R.wins, R.draws, R.losses]).toEqual([T.wins + checked.jqe, R.stillDrawn, T.losses + checked.abj]);
    expect([R.games, R.pairs]).toEqual([T.games, T.pairs]);
    for (const r of [T, R]) {
      const pts = Object.entries(r.pairPoints).reduce((a, [k, n]) => a + Number(k) * n, 0);
      expect(pts).toBe(r.wins + r.draws / 2);
      expect(Object.values(r.pairPoints).reduce((a, b) => a + b, 0)).toBe(r.pairs);
    }
    expect(elo(R)).toBe(R.pentaElo);
    expect(R.pentaLow).toBeLessThan(R.pentaElo);
    expect(R.pentaHigh).toBeGreaterThan(R.pentaElo);
    expect(R.pentaElo).toBeLessThan(T.pentaElo);
    // Game 5 stays a draw: the blindness it shows is the plain repetition kind.
    expect(stillDrawn).toContain(AB_JQE_GAMES[4]);
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
