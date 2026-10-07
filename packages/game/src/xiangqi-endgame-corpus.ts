// Xiangqi basic-endgame reference corpus — the "book win / book draw" verdicts
// that every Chinese-language endgame manual states and almost no English source
// collects in one place.
//
// WHERE THE VERDICTS COME FROM. Two Wikipedia articles, not a manual we own:
//
//   'en-wikipedia' — the Endgame section of the English "Xiangqi" article. It
//                    states these verdicts in prose and cites NOTHING; treat it
//                    as a compressed report of the Chinese manual tradition, not
//                    as a source of record.
//   'zh-wikipedia' — 象棋勝和定式 ("Winning and drawing formations in xiangqi
//                    endgames"), which diagrams the positions and cites 金启昌 /
//                    杨典《象棋残局胜和定式》(北京体育大学出版社, 2008, ISBN
//                    9787810513623) and 薛榮賢《象棋初學實戰指南》(2009).
//
// Neither book has been read first-hand. Where the two articles disagree, the
// Chinese one wins: it carries the diagram, and twice now the English prose has
// turned out to be a lossy summary of it (Chinese endgame verdicts are graded
// 必胜 / 例胜 / 巧胜 / 难胜 / 例和 / 必和, and English "win / draw" only has two
// buckets to put six words in).
//
// Each entry pairs a verdict with ONE representative position. A position is not
// a proof of its class: book results assume best play from a sound defensive
// formation, and a badly-placed snapshot can be a tactical win in a drawn class
// (or vice versa). So entries carry their provenance:
//
//   'diagram'     — the position is the one the cited source diagrams, moves and
//                   all. These are the load-bearing ones.
//   'constructed' — we built a representative position for a verdict the source
//                   states as prose. Treat the verdict as the source's claim and
//                   the position as our illustration of it.
//
// Defenders holding all four defensive pieces use the book formation Wikipedia
// describes: general home, one advisor and one elephant on the two points
// directly in front of it (e9/e8), the other advisor and elephant at home. That
// is the cannon-immune setup, so the drawing claims are tested against the
// defence that actually earns them rather than a random scatter.
//
// Positions are authored as piece tokens (`Ke1`, `ke10`, uppercase = red) and
// compiled to FEN through this package's own writer, so a typo fails the
// parser rather than reaching an engine as a plausible-looking wrong board.
//
// Verify with: npx tsx apps/server/src/verify-xiangqi-endgames.ts
// Add --tablebase to cross-check every position that fits in the chessdb.cn
// cloud database, which answers exactly (win/draw/loss plus distance to mate)
// for the small-material end of this corpus.

import type {
  XiangqiBoard,
  XiangqiColor,
  XiangqiGameState,
  XiangqiPieceRole,
  XiangqiSquare,
} from './variants-xiangqi.js';
import { standardXiangqiEngineFen, standardXiangqiFen } from './xiangqi-position.js';

export type EndgameVerdict = 'win' | 'draw';

export type EndgameCategory =
  | 'soldier'
  | 'horse'
  | 'cannon'
  | 'horse-and-cannon'
  | 'chariot'
  | 'insufficient';

export type EndgameProvenance = 'diagram' | 'constructed';

/** Which article the verdict (and, for 'diagram' entries, the position) is from. */
export type EndgameSource = 'en-wikipedia' | 'zh-wikipedia';

export type EndgameEntry = {
  id: string;
  category: EndgameCategory;
  /** Attacking (Red) material, in English. */
  attacker: string;
  /** Defending (Black) material, in English. */
  defender: string;
  verdict: EndgameVerdict;
  /** Whose move the representative position is set up for. */
  turn: XiangqiColor;
  /** `Ke1` style tokens: k/a/b/n/r/c/p, uppercase = red. */
  pieces: readonly string[];
  provenance: EndgameProvenance;
  /** Defaults to 'en-wikipedia'; set where the entry follows the Chinese article. */
  source?: EndgameSource;
  /** What a reader needs to know that the verdict alone does not say. */
  note?: string;
  /**
   * Set when a strong engine contradicts the stated verdict from every position
   * we could build. Recorded rather than hidden: the honest reading is almost
   * always that our representative does not capture the defensive setup the
   * claim assumes, but a reader deserves to know the claim is not reproduced.
   */
  engineDispute?: string;
};

const FEN_LETTER_TO_ROLE: Record<string, XiangqiPieceRole> = {
  k: 'general',
  a: 'advisor',
  b: 'elephant',
  n: 'horse',
  r: 'chariot',
  c: 'cannon',
  p: 'soldier',
};

export function parseEndgameToken(token: string): {
  square: XiangqiSquare;
  color: XiangqiColor;
  role: XiangqiPieceRole;
} {
  const letter = token.slice(0, 1);
  const role = FEN_LETTER_TO_ROLE[letter.toLowerCase()];
  if (!role) throw new Error(`Unknown piece letter in endgame token "${token}"`);
  const square = token.slice(1);
  if (!/^[a-i](10|[1-9])$/.test(square)) {
    throw new Error(`Unknown square in endgame token "${token}"`);
  }
  return {
    square: square as XiangqiSquare,
    color: letter === letter.toUpperCase() ? 'red' : 'black',
    role,
  };
}

/** Compile an entry's tokens into a playable state. Throws on a bad token. */
export function endgameEntryState(entry: EndgameEntry): XiangqiGameState {
  const board: XiangqiBoard = {};
  for (const token of entry.pieces) {
    const { square, color, role } = parseEndgameToken(token);
    if (board[square]) throw new Error(`${entry.id}: two pieces on ${square}`);
    board[square] = { color, role };
  }
  return {
    id: entry.id,
    board,
    status: { type: 'playing', turn: entry.turn },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
}

/** Position key FEN (turn written r/b) — the human-facing form. */
export function endgameEntryFen(entry: EndgameEntry): string {
  return standardXiangqiFen(endgameEntryState(entry));
}

/** Engine-dialect FEN (turn written w/b) — what Pikafish accepts. */
export function endgameEntryEngineFen(entry: EndgameEntry): string {
  return standardXiangqiEngineFen(endgameEntryState(entry));
}

// The four-defensive-piece book formation for the defender (Black).
const FULL_DEFENCE = ['ke10', 'ae9', 'af10', 'be8', 'bc10'] as const;
// Three defensive pieces: drop the second elephant.
const THREE_DEFENCE = ['ke10', 'ae9', 'af10', 'be8'] as const;
// Red's own four, for the entries where the attacker keeps a defence.
const RED_FULL_DEFENCE = ['Ke1', 'Ae2', 'Ad1', 'Be3', 'Bc1'] as const;

export const XIANGQI_ENDGAME_CORPUS: readonly EndgameEntry[] = [
  // ── Soldier endgames ──────────────────────────────────────────────────────
  {
    id: 'soldier-vs-bare-general',
    category: 'soldier',
    attacker: 'One soldier, across the river',
    defender: 'Bare general',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Pe6', 'ke10'],
    provenance: 'constructed',
    note: 'Wins as long as the soldier has not reached the last rank, where it can no longer advance.',
  },
  {
    id: 'soldier-vs-advisor',
    category: 'soldier',
    attacker: 'One soldier (with general and elephant)',
    defender: 'One advisor',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke2', 'Be3', 'Pe7', 'ke10', 'ae9'],
    provenance: 'diagram',
    note: 'Tempo decides it: Red to play wins, Black to play draws. The general rule is that any extra defensive piece draws, and this is the case that takes real technique.',
  },
  {
    id: 'soldiers-five-on-last-rank',
    category: 'insufficient',
    attacker: 'Five soldiers, all on the last rank',
    defender: 'Bare general',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Kd1', 'Pa10', 'Pc10', 'Pe10', 'Pg10', 'Pi10', 'ke9'],
    provenance: 'constructed',
    note: 'Soldiers cannot move backward, so on the last rank five of them still cannot force mate or stalemate. Material is not the same thing as mating power.',
  },
  {
    id: 'two-soldiers-vs-two-advisors',
    category: 'soldier',
    attacker: 'Two unadvanced soldiers',
    defender: 'Two advisors',
    verdict: 'win',
    turn: 'red',
    pieces: ['Kd1', 'Pd6', 'Pf6', 'ke10', 'ad10', 'af10'],
    provenance: 'constructed',
  },
  {
    id: 'two-soldiers-vs-two-elephants',
    category: 'soldier',
    attacker: 'Two unadvanced soldiers',
    defender: 'Two elephants',
    verdict: 'win',
    turn: 'red',
    pieces: ['Kd1', 'Pd6', 'Pf6', 'ke10', 'bc10', 'bg10'],
    provenance: 'constructed',
  },
  {
    id: 'two-soldiers-vs-bare-cannon',
    category: 'soldier',
    attacker: 'Two unadvanced soldiers',
    defender: 'A bare cannon',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Pd6', 'Pf6', 'ke10', 'ce5'],
    provenance: 'constructed',
    note: 'A cannon with no platform to jump is close to useless on defence.',
  },
  {
    id: 'two-soldiers-vs-advisor-and-elephant',
    category: 'soldier',
    attacker: 'Two unadvanced soldiers',
    defender: 'One advisor and one elephant',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke1', 'Pd6', 'Pf6', 'ke10', 'ae9', 'bc10'],
    provenance: 'constructed',
    note: 'The mixed pair defends where either pair alone does not: the advisor covers the palace, the elephant covers the approach.',
  },
  {
    id: 'three-soldiers-vs-full-defence',
    category: 'soldier',
    attacker: 'Three unadvanced soldiers',
    defender: 'All four defensive pieces (士象全)',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Pc7', 'Pe7', 'Pg7', ...FULL_DEFENCE],
    provenance: 'constructed',
    note: 'The headline surprise of xiangqi endgames: three soldiers beat the full defence, while a chariot does not.',
  },
  {
    id: 'three-soldiers-vs-horse-and-two-advisors',
    category: 'soldier',
    attacker: 'Three unadvanced soldiers',
    defender: 'A horse and two advisors',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Pc7', 'Pe7', 'Pg7', 'ke10', 'ad10', 'af10', 'ne8'],
    provenance: 'constructed',
  },
  {
    id: 'three-soldiers-vs-cannon-and-two-elephants',
    category: 'soldier',
    attacker: 'Three unadvanced soldiers',
    defender: 'A cannon and two elephants',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Pc7', 'Pe7', 'Pg7', 'ke10', 'bc10', 'bg10', 'ce5'],
    provenance: 'constructed',
  },
  {
    id: 'general-and-soldier-zugzwang',
    category: 'soldier',
    attacker: 'General and soldier',
    defender: 'Bare general',
    verdict: 'win',
    turn: 'red',
    pieces: ['Kd2', 'Pg9', 'ke9'],
    provenance: 'diagram',
    note: 'Red wins with either side to move. 1.Gd1 is a waiting move that puts Black in zugzwang; the win comes from the red general seizing the middle file, not from the soldier alone.',
  },
  {
    id: 'reciprocal-zugzwang',
    category: 'soldier',
    attacker: 'Two soldiers and an elephant',
    defender: 'Two soldiers',
    verdict: 'win',
    turn: 'black',
    pieces: ['Ke1', 'Be3', 'Pd9', 'Pf9', 'ke10', 'pd2', 'pf2'],
    provenance: 'diagram',
    note: 'Reciprocal zugzwang: whoever moves first loses. Set for Black to move, so the verdict is a Red win; flip the side to move and it is a Black win.',
  },

  // ── Horse endgames ────────────────────────────────────────────────────────
  {
    id: 'horse-vs-advisor',
    category: 'horse',
    attacker: 'A bare horse',
    defender: 'A bare advisor',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Ne5', 'ke10', 'ad10'],
    provenance: 'constructed',
  },
  {
    id: 'horse-vs-elephant',
    category: 'horse',
    attacker: 'A bare horse',
    defender: 'A bare elephant',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke1', 'Ne5', 'ke10', 'bc10'],
    provenance: 'constructed',
    note: 'The horse beats a lone advisor but not a lone elephant, which can shuttle between flanks faster than the horse can cut it off.',
  },
  {
    id: 'horse-vs-elephant-zugzwang',
    category: 'horse',
    attacker: 'A bare horse',
    defender: 'A bare elephant, caught on one flank',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke2', 'Nf8', 'kd10', 'bc6'],
    provenance: 'diagram',
    note: 'The same material as above, but tempo-dependent: Red to play wins with 1.Hd7, cutting the elephant off from the far flank. Black to play draws with 1...Ee8. This is why the class verdict is a draw and this position is not.',
  },
  {
    id: 'horse-and-soldier-vs-three-defence',
    category: 'horse',
    attacker: 'A horse and one unadvanced soldier',
    defender: 'Three defensive pieces',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Ne5', 'Pe6', ...THREE_DEFENCE],
    provenance: 'constructed',
  },
  {
    id: 'horse-and-soldier-vs-full-defence',
    category: 'horse',
    attacker: 'A horse and one unadvanced soldier',
    defender: 'All four defensive pieces',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke1', 'Ne5', 'Pe6', ...FULL_DEFENCE],
    provenance: 'constructed',
    note: 'The fourth defensive piece is the whole difference between this and the win above.',
  },
  {
    id: 'two-horses-vs-full-defence',
    category: 'horse',
    attacker: 'Two horses',
    defender: 'All four defensive pieces',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Nd5', 'Nf5', ...FULL_DEFENCE],
    provenance: 'constructed',
    note: 'Two horses beat the full defence; a chariot, worth more than both, does not.',
  },

  // ── Cannon endgames ───────────────────────────────────────────────────────
  {
    id: 'cannon-vs-bare-general',
    category: 'insufficient',
    attacker: 'A bare cannon',
    defender: 'Bare general',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke1', 'Ce5', 'ke10'],
    provenance: 'constructed',
    note: 'A cannon needs a platform to capture, so with nothing to jump it cannot mate. Adding elephants does not help; it needs an advisor, which can screen on any of the three central files.',
  },
  {
    id: 'cannon-and-advisor-vs-two-advisors',
    category: 'cannon',
    attacker: 'A cannon and one advisor',
    defender: 'Two advisors',
    verdict: 'win',
    turn: 'red',
    pieces: ['Kf3', 'Ad3', 'Cd1', 'kd10', 'ae9', 'ad8'],
    provenance: 'diagram',
    note: '1.Ge3 wins an advisor: 1...Gd9 runs into 2.Ae2#, and after 1...Ge10 2.Cxd8 the recapture is illegal because the advisor is pinned by the facing generals.',
  },
  {
    id: 'cannon-and-full-defence-vs-full-defence',
    category: 'cannon',
    attacker: 'A cannon with all four defensive pieces',
    defender: 'All four defensive pieces',
    verdict: 'draw',
    turn: 'red',
    pieces: [...RED_FULL_DEFENCE, 'Ce5', ...FULL_DEFENCE],
    provenance: 'constructed',
    note: 'A cannon needs at least an extra soldier to break the full defence.',
  },

  // ── Horse + cannon ────────────────────────────────────────────────────────
  {
    id: 'horse-cannon-vs-horse',
    category: 'horse-and-cannon',
    attacker: 'Horse and cannon, both sides with four defensive pieces',
    defender: 'A horse',
    verdict: 'win',
    turn: 'red',
    pieces: [...RED_FULL_DEFENCE, 'Nd5', 'Cf5', ...FULL_DEFENCE, 'nc8'],
    provenance: 'constructed',
  },
  {
    id: 'horse-cannon-vs-cannon',
    category: 'horse-and-cannon',
    attacker: 'Horse and cannon, both sides with four defensive pieces',
    defender: 'A cannon',
    verdict: 'draw',
    turn: 'red',
    pieces: [...RED_FULL_DEFENCE, 'Nd5', 'Cf5', ...FULL_DEFENCE, 'cc8'],
    provenance: 'constructed',
    note: 'Same attacking material, and the defending minor piece alone flips the result: a cannon holds where a horse does not.',
  },

  // ── Chariot endgames ──────────────────────────────────────────────────────
  {
    id: 'chariot-vs-full-defence',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'All four defensive pieces',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke1', 'Re5', ...FULL_DEFENCE],
    provenance: 'constructed',
    note: 'The strongest piece on the board cannot break the full defence, though three soldiers or two horses can. Piece values do not survive into the basic endgames.',
  },
  {
    id: 'chariot-vs-three-defence',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'Three defensive pieces',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Re5', ...THREE_DEFENCE],
    provenance: 'constructed',
  },
  {
    id: 'chariot-vs-horse-two-elephants-fortress',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'A horse and two elephants, in the drawing fortress',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke2', 'Re7', 'ke10', 'ne8', 'bi8', 'bg6'],
    provenance: 'diagram',
    note: 'This exact arrangement holds. Most other defensive placements of the same material lose, which is what makes it a fortress rather than a material verdict.',
  },
  {
    id: 'chariot-vs-horse-two-elephants-broken',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'A horse and two elephants, one elephant misplaced',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke2', 'Re7', 'ke10', 'ne8', 'bi8', 'bg10'],
    provenance: 'diagram',
    note: 'The fortress above with the g6 elephant moved to g10 instead. Same material, same attacker, and now Red wins starting with 1.Rb7. The pair is the clearest demonstration in the corpus that material does not decide these endgames.',
  },
  {
    id: 'chariot-vs-two-minor-pieces',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'A horse and cannon, no defensive pieces (單車難勝馬炮)',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke1', 'Ra5', 'kf9', 'cf10', 'nd7'],
    provenance: 'diagram',
    source: 'zh-wikipedia',
    note: 'The whole draw is one geometric relation: the cannon sits directly behind its own general, where it covers the back rank and cannot be skewered against it. Move that cannon one point sideways and the tablebase turns the position into a Red mate. The horse only has to stay off squares a single chariot move attacks. This replaced a position of our own (Ke1 Ra5 kd10 ne8 ce9) that had the cannon beside the general instead of behind it, and loses: Pikafish mates it in 15 and the database in 13.',
  },
  {
    id: 'chariot-cannon-vs-chariot',
    category: 'chariot',
    attacker: 'A chariot and cannon, no defensive pieces',
    defender: 'A bare chariot holding the middle file',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Kd1', 'Ra5', 'Cc5', 'kf10', 're5'],
    provenance: 'constructed',
    note: 'The defending chariot has to hold the middle file BELOW the attacking pieces, because the mate it is preventing (海底撈月) is executed at the bottom of that file. It also drives the red general off the middle file. Leave the chariot on the middle file but a rank too high and Red plants the cannon underneath it, defended by the chariot on the same rank, and wins: move the defender here from e5 to e6 and the database turns the draw into a Red win.',
  },
  {
    id: 'chariot-cannon-full-vs-chariot-full',
    category: 'chariot',
    attacker: 'A chariot and cannon with all four defensive pieces',
    defender: 'A chariot with all four defensive pieces',
    verdict: 'draw',
    turn: 'red',
    pieces: [...RED_FULL_DEFENCE, 'Rd5', 'Cf5', ...FULL_DEFENCE, 'ra8'],
    provenance: 'constructed',
  },
  {
    id: 'two-chariots-vs-chariot-full-defence',
    category: 'chariot',
    attacker: 'Two chariots',
    defender: 'A chariot and all four defensive pieces',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke1', 'Rd5', 'Rf5', ...FULL_DEFENCE, 'ra8'],
    provenance: 'constructed',
    note: 'Drawn with good defensive placement.',
  },
  {
    id: 'two-chariots-vs-two-horses-full-defence',
    category: 'chariot',
    attacker: 'Two chariots',
    defender: 'Two horses and all four defensive pieces',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Rd5', 'Rf5', ...FULL_DEFENCE, 'nc8', 'ng8'],
    provenance: 'constructed',
    note: 'Two horses is the losing pair; other two-minor-piece combinations hold.',
  },
  // ── The counterexample pairs ────────────────────────────────────────────────
  // Three positions that differ from the entry above them by ONE point, and have
  // the opposite verdict. Two of them were already described in prose in the
  // notes on `chariot-vs-two-minor-pieces` and `chariot-cannon-vs-chariot`
  // ("move that cannon one point sideways and the tablebase turns the position
  // into a Red mate"); this makes them positions a reader can play out instead of
  // sentences they have to take on trust. The third is new: nobody had checked
  // what happens when three unadvanced soldiers step back a rank.
  //
  // All three verdicts are chessdb.cn lookups, not searches -- the mate distance
  // falls by one every ply, which is what distinguishes a tablebase answer from
  // an evaluation. They are `constructed`: the position is ours, built by moving
  // one piece of a sourced diagram, and only the verdict comes from the database.
  {
    id: 'chariot-vs-two-minor-pieces-cannon-off',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'A horse and cannon, cannon one point off',
    verdict: 'win',
    turn: 'red',
    // chariot-vs-two-minor-pieces with the cannon on e10 instead of f10.
    pieces: ['Ke1', 'Ra5', 'kf9', 'ce10', 'nd7'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
    note: 'The drawn fortress one point away from itself. Slide the defending cannon off the file behind its own general and the draw is gone: the database gives Red a forced mate. The cannon was not doing a cannon\u2019s job in the draw, it was standing in the one square where the chariot could never skewer it against the general, and a single sideways step gives that square up.',
  },
  {
    id: 'chariot-cannon-vs-chariot-too-high',
    category: 'chariot',
    attacker: 'A chariot and cannon, no defensive pieces',
    defender: 'A bare chariot one rank too high',
    verdict: 'win',
    turn: 'red',
    // chariot-cannon-vs-chariot with the defending chariot on e6, not e5.
    pieces: ['Kd1', 'Ra5', 'Cc5', 'kf10', 're6'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
    note: 'The defending chariot holds the middle file one rank too high, and that is the whole difference: Red plants the cannon underneath it, defended by the chariot on the same rank, and the database gives Red a forced mate. The drawn version of this position is the entry above; the mate it prevents (\u6d77\u5e95\u635e\u6708) is executed at the BOTTOM of the middle file, which is why the defender has to stay below the attackers rather than merely on the file.',
  },
  {
    id: 'three-soldiers-pulled-back-vs-full-defence',
    category: 'soldier',
    attacker: 'Three soldiers, pulled back one rank',
    defender: 'All four defensive pieces',
    verdict: 'draw',
    turn: 'red',
    // three-soldiers-vs-full-defence with the soldiers on rank 6, not rank 7.
    pieces: ['Ke1', 'Pc6', 'Pe6', 'Pg6', 'ke10', 'ae9', 'af10', 'be8', 'bc10'],
    provenance: 'constructed',
    note: 'The headline result of this corpus, undone by one rank. Three UNADVANCED soldiers beat the full defence; the same three soldiers a rank further back draw. An unadvanced soldier here means one standing on the fourth rank of the enemy half, close enough that the defence cannot both hold the palace and meet them. Pull them back and the win is not merely harder, it is gone: the database says draw. This is the sharpest illustration in the set that these endgames are decided by where the pieces stand and not by what they are.',
  },

  // ── Rows added for the 象棋残局 page (2026-10) ───────────────────────────────
  // Every position is ours: built by hand or drawn from a chessdb.cn sweep over
  // the material class (scripts/xiangqi-endgame-sweep.mjs), quiet (Red has no
  // capture, Black is not in check), Red to move. The grade each one illustrates
  // is zh-Wikipedia's 象棋勝和定式; the result for THIS position is the
  // tablebase's, committed in xiangqi-endgame-hub-checks.ts and asserted by test.
  {
    id: 'high-soldier-vs-bare-general',
    category: 'soldier',
    attacker: 'One unadvanced soldier',
    defender: 'Bare general',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Pd8', 'kf10'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'bottom-soldier-vs-bare-general',
    category: 'insufficient',
    attacker: 'One soldier on the last rank',
    defender: 'Bare general',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke1', 'Pc10', 'kd9'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'high-soldier-vs-advisor',
    category: 'soldier',
    attacker: 'One unadvanced soldier',
    defender: 'One advisor',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Ke2', 'Pe7', 'ke10', 'ae9'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'high-soldier-vs-advisor-tricky',
    category: 'soldier',
    attacker: 'One unadvanced soldier',
    defender: 'One advisor, the winning exception',
    verdict: 'win',
    turn: 'red',
    pieces: ['Kd1', 'Pf8', 'ke10', 'af10'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'high-low-soldiers-vs-two-advisors',
    category: 'soldier',
    attacker: 'A high and a low soldier',
    defender: 'Two advisors',
    verdict: 'win',
    turn: 'red',
    pieces: ['Kd1', 'Pc8', 'Pg9', 'ke10', 'ad10', 'af10'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'two-high-soldiers-vs-cannon',
    category: 'soldier',
    attacker: 'Two unadvanced soldiers',
    defender: 'A cannon beside its general',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Pc7', 'Pg7', 'ke10', 'ce9'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'horse-vs-crossed-soldier',
    category: 'horse',
    attacker: 'A bare horse',
    defender: 'One soldier across the river',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Kf1', 'Na6', 'ke10', 'pd4'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'two-cannons-vs-two-elephants',
    category: 'cannon',
    attacker: 'Two cannons',
    defender: 'Two elephants',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Kd1', 'Cb5', 'Ch5', 'ke10', 'bc10', 'bg10'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'two-cannons-advisor-vs-full-defence',
    category: 'cannon',
    attacker: 'Two cannons and an advisor',
    defender: 'All four defensive pieces',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Ae2', 'Cb5', 'Ch5', ...FULL_DEFENCE],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-vs-full-defence-tricky',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'All four defensive pieces, both elephants on the edge',
    verdict: 'win',
    turn: 'red',
    pieces: ['Kd1', 'Rb6', 'ke10', 'af10', 'ae9', 'ba8', 'bi8'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-vs-horse-two-advisors',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'A horse and two advisors',
    verdict: 'win',
    turn: 'red',
    pieces: ['Kf1', 'Ra5', 'ke10', 'ad10', 'af10', 'nc8'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-vs-cannon-two-advisors',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'A cannon and two advisors',
    verdict: 'draw',
    turn: 'red',
    pieces: ['Kd2', 'Rh1', 'ke10', 'af10', 'ae9', 'cd7'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-vs-cannon-two-advisors-tricky',
    category: 'chariot',
    attacker: 'A bare chariot',
    defender: 'A cannon and two advisors, both advisors at home',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Rh4', 'ke10', 'ad10', 'af10', 'ce8'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-cannon-vs-chariot-center',
    category: 'chariot',
    attacker: 'A chariot and cannon, no defensive pieces',
    defender: 'A bare chariot, Red holding the middle file',
    verdict: 'win',
    turn: 'red',
    pieces: ['Ke1', 'Re5', 'Cc5', 'kf10', 'ra6'],
    provenance: 'constructed',
    source: 'zh-wikipedia',
  },
];
