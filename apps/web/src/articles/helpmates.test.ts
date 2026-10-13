import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
  isStandardXiangqiGeneralInCheck,
  parseStandardXiangqiFen,
  type XiangqiGameState,
  type XiangqiSquare,
} from '@mistboard/game';
import { makeSfen, parseSfen } from 'shogiops/sfen';
import { makeUsi, parsePieceName, parseUsi } from 'shogiops/util';
import type { Position } from 'shogiops/variant/position';
import { describe, expect, it } from 'vitest';
import {
  HELPMATE_CHAPTER_IDS,
  HELPMATE_THUMBNAIL,
  helpmatesInXiangqiArticle,
  INTRO_FEN,
  INTRO_LINE,
  introMate,
  type ShogiDiagram,
  SHOGI_LINE,
  SHOGI_START_SFEN,
  shogiMate,
} from './content/helpmates-in-xiangqi.js';
import type { ArticleBlock, EmbedBlock } from './types.js';

// The first ten chapters of prod study 5CdUHFsq, copied mechanically from
// /api/studies/5CdUHFsq on 2026-10-10: id, rootFen, and the stored main line
// (each chapter holds exactly one line). Each was re-proved the same day with
// scripts/problem-lab/verify-helpmates.ts (exactly one cooperative line to mate
// in two counting 困毙, none in one); this test replays them through the
// kernel and checks what the article's setups say about each start.
const STUDY = [
  { id: 'RMlEpAw1', fen: '9/4a4/3k1a2b/6P2/9/4p3c/3r5/9/4K4/9 b - - 0 1', line: ['d8e8', 'g7f7', 'd4d8', 'f7e7'] },
  { id: 'ULE6g0Op', fen: 'r1baka1nr/N4c3/n1c6/4p3p/9/9/9/9/9/4K4 b - - 0 1', line: ['h10g8', 'a9c10', 'g8e9', 'c10d8'] },
  { id: 'vujF1lWk', fen: '1nb1k1bnr/4a3c/r8/p1p1p1p1p/1C1c5/9/9/5K3/9/9 b - - 0 1', line: ['e9d10', 'b6c6', 'i9e9', 'c6c10'] },
  { id: '0Bxs9oaW', fen: 'rn2kab2/9/9/p1p1p1p1p/9/c2R5/9/5K3/5c3/9 b - - 0 1', line: ['a10a9', 'd5b5', 'a9e9', 'b5b10'] },
  { id: 'he06evJZ', fen: '1nbaka2r/9/3c2cN1/p1p1p3p/9/9/9/9/9/4K4 b - - 0 1', line: ['d10e9', 'h8i10', 'd8d10', 'i10g9'] },
  { id: 'KePDB5oH', fen: 'rn2k1b1r/1PP1a1c2/1cP5n/p1p1p1p1p/9/9/9/5K3/9/9 b - - 0 1', line: ['e10d10', 'c9c10', 'd10d9', 'b9c9'] },
  { id: '5rRSCRMV', fen: '4k4/9/2P6/9/9/4C4/1c7/9/3Kn4/9 b - - 0 1', line: ['b4f4', 'c8d8', 'f4f10', 'd8e8'] },
  { id: 'Xcd4sVh1', fen: '9/9/c3k4/6P2/6C1r/9/9/9/9/3K5 b - - 0 1', line: ['e8f8', 'g6f6', 'a8e8', 'g7f7'] },
  { id: 'Uou3h7ll', fen: '2N1k2c1/3n5/9/9/1r7/5r3/9/9/9/3K5 b - - 0 1', line: ['e10d10', 'c10a9', 'h10e10', 'a9c8'] },
  { id: 'vLHg3fog', fen: '1n1aka1nr/9/3cbP3/p3p3p/2p6/9/9/9/9/5K3 b - - 0 1', line: ['d8d9', 'f8f9', 'd9e9', 'f9f10'] },
] as const;

type Chapter = (typeof STUDY)[number];

function start(c: Chapter): XiangqiGameState {
  const parsed = parseStandardXiangqiFen(c.fen, `helpmate-${c.id}`);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.state;
}

function play(state: XiangqiGameState, uci: string): XiangqiGameState {
  const squares = /^([a-i]\d{1,2})([a-i]\d{1,2})$/.exec(uci);
  if (!squares) throw new Error(`bad move ${uci}`);
  const next = applyStandardXiangqiMove(state, {
    from: squares[1] as XiangqiSquare,
    to: squares[2] as XiangqiSquare,
  });
  if (next === state) throw new Error(`illegal ${uci}`);
  return next;
}

function after(c: Chapter, plies = 4): XiangqiGameState {
  return c.line.slice(0, plies).reduce(play, start(c));
}

function at(n: number): Chapter {
  const c = STUDY[n - 1];
  if (!c) throw new Error(`no chapter ${n}`);
  return c;
}

function roles(state: XiangqiGameState, color: 'red' | 'black'): string[] {
  return Object.values(state.board)
    .filter((p) => p?.color === color)
    .map((p) => p?.role ?? '')
    .sort();
}

function squaresOf(state: XiangqiGameState, color: 'red' | 'black', role: string): string[] {
  return Object.entries(state.board)
    .filter(([, p]) => p?.color === color && p.role === role)
    .map(([sq]) => sq)
    .sort();
}

const rank = (sq: string) => Number(sq.slice(1));

function blocks(): ArticleBlock[] {
  return [
    ...(helpmatesInXiangqiArticle.intro ?? []),
    ...helpmatesInXiangqiArticle.sections.flatMap((s) => s.blocks ?? []),
  ];
}

function embeds(): EmbedBlock[] {
  return blocks().filter((b): b is EmbedBlock => b.kind === 'embed');
}

describe('helpmates in xiangqi', () => {
  it('embeds the first ten study chapters in order, solutions hidden', () => {
    expect(HELPMATE_CHAPTER_IDS).toEqual(STUDY.map((c) => c.id));
    expect(embeds().map((b) => b.path)).toEqual(
      STUDY.map((c) => `/embed/study/5CdUHFsq/${c.id}`),
    );
    for (const b of embeds()) {
      expect((b as EmbedBlock & { hideSolution?: boolean }).hideSolution).toBe(true);
    }
  });

  it('never names a square the solution moves to, in an embed title or its setup', () => {
    const all = blocks();
    embeds().forEach((embed, i) => {
      const setup = all[all.indexOf(embed) - 1];
      expect(setup?.kind).toBe('paragraph');
      const text = `${embed.title} ${setup?.kind === 'paragraph' ? setup.text : ''}`;
      for (const uci of at(i + 1).line) {
        const to = uci.replace(/^[a-i]\d{1,2}/, '');
        expect(text).not.toMatch(new RegExp(`\\b${to}\\b`));
      }
    });
  });

  it('ends every stored line in checkmate on the fourth ply, Black first', () => {
    for (const c of STUDY) {
      expect(start(c).status).toEqual({ type: 'playing', turn: 'black' });
      for (const plies of [1, 2, 3]) expect(after(c, plies).status.type).toBe('playing');
      const end = after(c);
      expect(end.status).toEqual({ type: 'finished', winner: 'red', reason: 'checkmate' });
      expect(isStandardXiangqiGeneralInCheck(end, 'black')).toBe(true);
    }
  });

  it('matches each setup: material, piece squares and legal first-move counts', () => {
    const s = STUDY.map(start);
    const [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10] = s as [
      XiangqiGameState,
      XiangqiGameState,
      XiangqiGameState,
      XiangqiGameState,
      XiangqiGameState,
      XiangqiGameState,
      XiangqiGameState,
      XiangqiGameState,
      XiangqiGameState,
      XiangqiGameState,
    ];
    // 1: a general and one soldier against seven, a chariot and both advisors among them.
    expect(roles(s1, 'red')).toEqual(['general', 'soldier']);
    expect(roles(s1, 'black')).toHaveLength(7);
    expect(squaresOf(s1, 'black', 'chariot')).toHaveLength(1);
    expect(squaresOf(s1, 'black', 'advisor')).toHaveLength(2);
    // 2: a horse already in Black's camp against twelve; 45 legal first moves.
    expect(roles(s2, 'red')).toEqual(['general', 'horse']);
    expect(roles(s2, 'black')).toHaveLength(12);
    expect(rank(squaresOf(s2, 'red', 'horse')[0] ?? '')).toBeGreaterThanOrEqual(6);
    expect(getStandardXiangqiLegalMoves(s2)).toHaveLength(45);
    // 3: a single cannon against fifteen.
    expect(roles(s3, 'red')).toEqual(['cannon', 'general']);
    expect(roles(s3, 'black')).toHaveLength(15);
    // 4: a chariot against twelve.
    expect(roles(s4, 'red')).toEqual(['chariot', 'general']);
    expect(roles(s4, 'black')).toHaveLength(12);
    // 5: a horse on h8 against twelve, a black chariot in the corner.
    expect(roles(s5, 'red')).toEqual(['general', 'horse']);
    expect(squaresOf(s5, 'red', 'horse')).toEqual(['h8']);
    expect(roles(s5, 'black')).toHaveLength(12);
    expect(s5.board.i10).toEqual({ color: 'black', role: 'chariot' });
    // 6: eighteen pieces, three red soldiers in Black's half against fourteen.
    expect(roles(s6, 'red')).toEqual(['general', 'soldier', 'soldier', 'soldier']);
    expect(squaresOf(s6, 'red', 'soldier').every((sq) => rank(sq) >= 6)).toBe(true);
    expect(roles(s6, 'black')).toHaveLength(14);
    // 7: six pieces; general, cannon (on e5) and soldier against general, cannon and horse.
    expect(roles(s7, 'red')).toEqual(['cannon', 'general', 'soldier']);
    expect(roles(s7, 'black')).toEqual(['cannon', 'general', 'horse']);
    expect(s7.board.e5).toEqual({ color: 'red', role: 'cannon' });
    // 8: six pieces; the black general off its back rank, soldier and cannon on the g-file.
    expect(roles(s8, 'red').length + roles(s8, 'black').length).toBe(6);
    expect(rank(squaresOf(s8, 'black', 'general')[0] ?? '')).toBeLessThan(10);
    expect(squaresOf(s8, 'red', 'soldier')[0]?.[0]).toBe('g');
    expect(squaresOf(s8, 'red', 'cannon')[0]?.[0]).toBe('g');
    // 9: two chariots, a horse and a cannon against one horse; 55 legal first moves.
    expect(roles(s9, 'black')).toEqual(['cannon', 'chariot', 'chariot', 'general', 'horse']);
    expect(roles(s9, 'red')).toEqual(['general', 'horse']);
    expect(getStandardXiangqiLegalMoves(s9)).toHaveLength(55);
    // 10: one soldier, on f8, against twelve.
    expect(roles(s10, 'red')).toEqual(['general', 'soldier']);
    expect(squaresOf(s10, 'red', 'soldier')).toEqual(['f8']);
    expect(roles(s10, 'black')).toHaveLength(12);
  });

  it('3: the cannon mates over a black screen', () => {
    const end = after(at(3));
    expect(end.lastMove).toEqual({ from: 'c6', to: 'c10' });
    expect(end.board.c10).toEqual({ color: 'red', role: 'cannon' });
    expect(end.board.d10?.color).toBe('black');
    expect(end.board.e10).toEqual({ color: 'black', role: 'general' });
  });

  it('7: the facing-generals rule takes d10 from the black general', () => {
    const end = after(at(7));
    expect(end.board.e10).toEqual({ color: 'black', role: 'general' });
    expect(end.board.d2).toEqual({ color: 'red', role: 'general' });
    for (let r = 3; r <= 10; r += 1) expect(end.board[`d${r}` as XiangqiSquare]).toBeUndefined();
  });

  it("8: Red's last move gives two checks", () => {
    const end = after(at(8));
    const { f6: _cannon, ...noCannon } = end.board;
    expect(isStandardXiangqiGeneralInCheck({ ...end, board: noCannon }, 'black')).toBe(true);
    // Swap the red soldier for a black horse: the screen stays, the soldier's
    // own check goes, and the cannon still checks. (A black soldier on f7 is an
    // impossible placement the kernel declines to read.)
    const blackScreen = { ...end.board, f7: { color: 'black' as const, role: 'horse' as const } };
    expect(isStandardXiangqiGeneralInCheck({ ...end, board: blackScreen }, 'black')).toBe(true);
  });

  it('shows chapter 12 in the intro and on the card: its line mates on ply 4', () => {
    const parsed = parseStandardXiangqiFen(INTRO_FEN, 'intro-check');
    if (!parsed.ok) throw new Error(parsed.error);
    const plies = INTRO_LINE.map((_, i) => INTRO_LINE.slice(0, i + 1).reduce(play, parsed.state));
    for (const s of plies.slice(0, 3)) expect(s.status.type).toBe('playing');
    expect(introMate().status).toEqual({ type: 'finished', winner: 'red', reason: 'checkmate' });
    // The captions name the black horse back on e9 and the red horse on f8.
    expect(introMate().board.e9).toEqual({ color: 'black', role: 'horse' });
    expect(introMate().board.f8).toEqual({ color: 'red', role: 'horse' });
    // Outside the ten, so the intro spoils none of the embeds.
    expect(STUDY.map((c): string => c.fen)).not.toContain(INTRO_FEN);
    expect(roles(parsed.state, 'black')).toHaveLength(12);
    const svg = HELPMATE_THUMBNAIL();
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg).toContain('aria-label=');
  });
});

// The shogi example, proved in shogiops (the lishogi rules kernel), so the
// diagrams and the prose's claims are checked against real shogi rules.
function shogiPosition(sfen: string): Position {
  return parseSfen('standard', sfen, false).unwrap();
}

function shogiMoves(pos: Position): string[] {
  const ctx = pos.ctx();
  const out: string[] = [];
  for (const [from, dests] of pos.allMoveDests(ctx)) {
    for (const to of dests) {
      for (const promotion of [false, true]) {
        const md = { from, to, promotion };
        if (pos.isLegal(md, ctx)) out.push(makeUsi(md));
      }
    }
  }
  for (const [name, dests] of pos.allDropDests(ctx)) {
    for (const to of dests) {
      const md = { role: parsePieceName(name).role, to };
      if (pos.isLegal(md, ctx)) out.push(makeUsi(md));
    }
  }
  return out;
}

function shogiPlay(pos: Position, usi: string): Position {
  const md = parseUsi(usi);
  if (!md || !pos.isLegal(md)) throw new Error(`illegal ${usi}`);
  const next = pos.clone();
  next.play(md);
  return next;
}

const isMate = (pos: Position): boolean => pos.outcome()?.result === 'checkmate';

// Every line of `plies` moves, both sides cooperating, that ends in mate.
function cooperativeMates(pos: Position, plies: number): string[] {
  if (plies === 0) return isMate(pos) ? [''] : [];
  if (pos.isEnd()) return [];
  return shogiMoves(pos).flatMap((usi) =>
    cooperativeMates(shogiPlay(pos, usi), plies - 1).map((rest) => `${usi} ${rest}`.trim()),
  );
}

function diagramBoardSfen(diagram: ShogiDiagram): string {
  const rows: string[] = [];
  for (const rank of 'abcdefghi') {
    let row = '';
    let empty = 0;
    for (let file = 9; file >= 1; file -= 1) {
      const piece = diagram.board.get(`${file}${rank}`);
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) row += String(empty);
      empty = 0;
      const letter = piece.color === 'sente' ? piece.letter : piece.letter.toLowerCase();
      row += `${piece.promoted ? '+' : ''}${letter}`;
    }
    rows.push(empty ? row + String(empty) : row);
  }
  return rows.join('/');
}

describe('helpmates article: the shogi cooperative mate', () => {
  const start = shogiPosition(SHOGI_START_SFEN);

  it('plays legally to checkmate, and the drawn mate is the kernel\'s', () => {
    const end = SHOGI_LINE.reduce(shogiPlay, start);
    expect(isMate(end)).toBe(true);
    expect(diagramBoardSfen(shogiMate())).toBe(makeSfen(end).split(' ')[0]);
    expect(shogiMate().hands.sente.get('L')).toBe(0);
  });

  it('is the only cooperative mate in three, with none in one', () => {
    expect(cooperativeMates(start, 1)).toEqual([]);
    expect(cooperativeMates(start, 3)).toEqual([SHOGI_LINE.join(' ')]);
  });

  it('a lance dropped farther from the king fails: the defender interposes', () => {
    const afterTwo = SHOGI_LINE.slice(0, 2).reduce(shogiPlay, start);
    for (const to of ['1e', '1f', '1g', '1h', '1i']) {
      const pos = shogiPlay(afterTwo, `L*${to}`);
      expect(pos.isCheck()).toBe(true);
      expect(isMate(pos)).toBe(false);
    }
  });
});
