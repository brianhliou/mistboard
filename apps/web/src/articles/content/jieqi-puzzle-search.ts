import { parseJieqiFen, type XiangqiPiece, type XiangqiSquare } from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardSvg,
  xqStaticView,
  xqSvg,
  xqVisionDemoState,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The record of the jieqi puzzle investigation (2026-10-08 to 10-10), killed as
// a track on 10-10. The numbers are from the scan in
// docs-private/research/jieqi-puzzle-yield-2026-10.md, in which a move whose
// search did not finish a full ply is searched again with more nodes. Every board is a line embed: the game's dealt
// position (the FEN's sixth field pins what each face-down tile really was),
// replayed by the kernel on the site's study card. jieqi-puzzle-search.test.ts
// replays each line and checks the claim its caption makes (who is to move,
// what a reveal turned out to be, that a line ends in mate, that a capture was
// available on every turn the caption says), and that the chart and table
// numbers add up to the averages the prose quotes.

/** A line drawn on the embed card: a dealt root and site-square move tokens. */
export type JieqiPuzzleLine = {
  /** Dealt FEN: the jieqi FEN plus the deal, one letter per face-down tile. */
  fen: string;
  moves: string[];
  /** The seat at the bottom of the board: the side the puzzle asks about. */
  orientation: 'red' | 'black';
  red: string;
  black: string;
  event: string;
  /** The move the board is about, when it is not the one played next: drawn
   *  on the opening frame in place of the played move. */
  arrow?: string;
};

const GUEST = 'Guest';
const AB = 'AB-JChess';
const PIKA2 = 'Pikafish level 2';

export const JIEQI_PUZZLE_LINES = {
  // jq_6df5bd37 ply 56, Black (a guest) to move. The game ended on this move:
  // the tile was a soldier and Black resigned.
  lotteryDealt: {
    fen: 'x3k3x/9/5R3/4p4/4bnb1p/5N3/8X/2P2A1P1/4C4/4K3X b R0A0C0P0N0B2r0a0c0p1n1b0 0 28 pnBB',
    moves: ['a10a1'],
    orientation: 'black',
    red: AB,
    black: GUEST,
    event: 'Lottery ticket, as dealt',
  },
  // The same position with a chariot dealt to a10 (and the soldier gone in its
  // place): the move Black was hoping for.
  lotteryChariot: {
    fen: 'x3k3x/9/5R3/4p4/4bnb1p/5N3/8X/2P2A1P1/4C4/4K3X b R0A0C0P0N0B2r1a0c0p0n1b0 0 28 rnBB',
    moves: ['a10a1'],
    orientation: 'black',
    red: AB,
    black: GUEST,
    event: 'Lottery ticket, if a10 were the chariot',
  },
  // jq_815d8cfb ply 52, Black (a guest) to move; Red took Black's chariot face
  // down on its second move.
  doubleOrNothing: {
    fen: 'x3k4/4na3/6c2/2R2b3/1P4nB1/8A/4P4/2P1P1A2/9/X3KXX2 b R0A0C1P1N1B0r0a0c0p1n0b0 0 26 pPCN',
    moves: ['a10a1', 'g1i3'],
    orientation: 'black',
    red: AB,
    black: GUEST,
    event: 'Double or nothing, as played',
  },
  // jq_c63fe954 from ply 20 to the capture, Black (a guest) won. The i10 tile
  // can take the i4 tile on each of Black's turns from move 10; Black does it on
  // move 15 (and mates on move 18).
  storedCapture: {
    fen: 'xx1xkxxxx/9/4n2x1/x3x4/1rp6/P3P2r1/8X/4B1P1N/2C6/X1XK1X2X b R1A2C0P1N0B1r0a2c1p4n1b2 0 10 apcppbbpanAPABR',
    moves: [
      'h10g8',
      'f1e2',
      'b6b2',
      'd1e1',
      'b2c2',
      'c1a3',
      'h5h2',
      'e2c4',
      'c2c4',
      'i3g4',
      'i10i4',
    ],
    orientation: 'black',
    red: AB,
    black: GUEST,
    event: 'A stored capture, as played',
    arrow: 'i10i4',
  },
  // jq_6f034d5d ply 13, Red (a guest) to move; Black won.
  whichTile: {
    fen: 'x1xxkxx1x/9/1xp4x1/x1x3x1x/3r5/C2r4P/2X1X1X2/1XP1P1PX1/9/X1XXK1X1X w R2A2C1P1N2B2r0a2c2p4n2b2 12 7 anpcppnpacbbARCPBBARNN',
    moves: ['c1a3', 'd5a5', 'h3h7', 'a5d5', 'd1e2', 'g7g6', 'b3b7', 'a7a6'],
    orientation: 'red',
    red: GUEST,
    black: AB,
    event: 'Which tile, as played',
  },
  // The four positions that pass the xiangqi miner's rules, with AB-JChess's
  // line. A: jq_1c3f8c3f ply 61. B: the same game, ply 123 (the 400k-node
  // line). C: jq_0ee04388 ply 57. D: the same game, ply 92 (a 3M-node search;
  // the scan saw mate in seven).
  survivorA: {
    fen: '3k1x3/4c4/1N2N4/x3B3p/6p2/P5AnP/1A7/4K4/4P4/5X3 w R0A0C1P0N0B0r1a0c0p0n0b1 3 31 rbC',
    moves: ['e3f3', 'h5g3', 'e2e3', 'g3f1', 'f3f2', 'f1h2', 'b4c5', 'h2g4'],
    orientation: 'red',
    red: GUEST,
    black: PIKA2,
    event: 'Engine line',
  },
  // Red played i10-i9 in the game.
  survivorB: {
    fen: '8C/3kA4/6r2/B2N5/9/P4p2P/1A2Pn3/9/3K5/9 w R0A0C0P0N0B0r0a0c0p0n0b0 15 62 -',
    moves: ['i10f10', 'g8f8', 'e9f8', 'f4h5', 'f10f5', 'h5f6', 'e4e5', 'f6h5'],
    orientation: 'red',
    red: GUEST,
    black: PIKA2,
    event: 'Engine line',
  },
  survivorC: {
    fen: '1xax1x1R1/1C2k4/P2Np4/4x4/5r3/2P6/9/9/4P4/3K5 w R0A0C0P0N0B0r1a0c2p1n0b0 7 29 crpc',
    moves: ['h10h9', 'f6f9', 'b9f9', 'e9d9', 'a8b8', 'e7e6'],
    orientation: 'red',
    red: GUEST,
    black: PIKA2,
    event: 'Engine line',
  },
  survivorD: {
    fen: '3P5/4k4/2R6/2P1c4/9/9/9/4r4/9/5K3 b R0A0C0P0N0B0r0a0c0p0n0b0 3 46 -',
    moves: [
      'e7f7',
      'c8c9',
      'e9e8',
      'f1f2',
      'e3e4',
      'c9c8',
      'e8e9',
      'c8e8',
      'e9e8',
      'f2f1',
      'e4f4',
    ],
    orientation: 'black',
    red: GUEST,
    black: PIKA2,
    event: 'Engine line, mate in six',
  },
  // jq_44638fc6 ply 31, Red (the bot) to move: the h1 tile moves as a horse
  // and takes a chariot, whatever the tile is. The bot played e5-i5.
  fairest: {
    fen: '2xxkxb1x/A8/6p2/2Np5/b5a1a/2P1C4/9/4P1r2/A8/1NXXKX1XX w R2A0C1P2N0B0r0a0c2p1n1b0 0 16 pnccCRPRP',
    moves: ['h1g3'],
    orientation: 'red',
    red: PIKA2,
    black: GUEST,
    event: 'A capture that does not depend on the tile',
  },
} satisfies Record<string, JieqiPuzzleLine>;

/** The mover's view of the lottery position as the scan saw it: Black's pool
 *  still counts the chariot and cannon Red had taken face down. */
export const LOTTERY_VIEW_FEN =
  'x3k3x/9/5R3/4p4/4bnb1p/5N3/8X/2P2A1P1/4C4/4K3X b R0A0C0P0N0B2r1a0c1p1n1b0 0 28';

/** The pieces Black had not seen in the lottery position, and where they were.
 *  `move` is Red's move number when it took the piece face down. */
export const LOTTERY_UNSEEN = [
  { piece: 'Chariot', where: 'Taken face down by Red on its move 17', role: 'r' },
  { piece: 'Cannon', where: 'Taken face down by Red on its move 20', role: 'c' },
  { piece: 'Soldier', where: 'The tile on a10', role: 'p' },
  { piece: 'Horse', where: 'The tile on i10', role: 'n' },
] as const;

/** One reveal scored once per piece the tile could be: the mover's winning
 *  chance (AB-JChess, the scan's first pass) and how many of that piece the
 *  mover had left face down, which is the weight in the average. */
export type TileOutcome = { piece: string; left: number; win: number };

// jq_6df5bd37 ply 56, a10-a1: Black's view, one each of four pieces.
export const LOTTERY_OUTCOMES: TileOutcome[] = [
  { piece: 'Soldier', left: 1, win: 0.05 },
  { piece: 'Horse', left: 1, win: 0.13 },
  { piece: 'Chariot', left: 1, win: 100 },
  { piece: 'Cannon', left: 1, win: 0.15 },
];

// jq_6f034d5d ply 13, c1-a3: Red's ten face-down pieces, R2 A2 C1 P1 N2 B2.
// `reply` and `cp` are Black's best answer after c1-a3 with the tile dealt as
// that piece (AB-JChess, 600k nodes, centipawns for Black).
export const WHICH_TILE_OUTCOMES: Array<TileOutcome & { reply: string; cp: number }> = [
  { piece: 'Chariot', left: 2, win: 43, reply: 'a10-b10', cp: 37 },
  { piece: 'Advisor', left: 2, win: 34, reply: 'd5xa5', cp: 73 },
  { piece: 'Elephant', left: 2, win: 38, reply: 'd5xa5', cp: 56 },
  { piece: 'Horse', left: 2, win: 33, reply: 'd5xa5', cp: 66 },
  { piece: 'Cannon', left: 1, win: 36, reply: 'd5xa5', cp: 60 },
  { piece: 'Soldier', left: 1, win: 32, reply: 'd5xa5', cp: 73 },
];

/** The average the review grades a reveal by: each outcome weighted by how
 *  many of that piece are left. */
export function tileAverage(outcomes: readonly TileOutcome[]): number {
  const total = outcomes.reduce((sum, o) => sum + o.left, 0);
  return outcomes.reduce((sum, o) => sum + o.win * o.left, 0) / total;
}

/** Positions through the xiangqi miner's rules, step by step. */
export const XIANGQI_RULES_FUNNEL = {
  scanned: 2939,
  passed: 15,
  mateInOne: 10,
  singleLegalMove: 1,
  left: 4,
};

// The bars: one row per piece, the mover's winning chance in a right-aligned
// column past the 100% end (clear of the dashed average line), and a tick at
// the weighted average. Two panels share the 0-100 scale so the shapes compare.
export const JIEQI_TILE_OUTCOME_CHART = (): string => {
  const width = 568;
  const labelW = 86;
  const valueW = 44;
  const barMax = width - labelW - valueW - 8;
  const rowH = 22;
  const panels = [
    { title: 'Lottery ticket: a10-a1, Black to move', outcomes: LOTTERY_OUTCOMES },
    { title: 'Which tile: c1-a3, Red to move', outcomes: WHICH_TILE_OUTCOMES },
  ];
  const parts: string[] = [
    `<text x="${width / 2}" y="14" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title">WINNING CHANCE BY WHAT THE TILE TURNS OUT TO BE</text>`,
  ];
  let y = 34;
  for (const panel of panels) {
    parts.push(
      `<text x="0" y="${y + 12}" font-family="system-ui, sans-serif" font-size="12" font-weight="700" class="xq-diagram-title">${panel.title}</text>`,
    );
    y += 20;
    const top = y;
    for (const o of panel.outcomes) {
      const w = Math.max(1, Math.round((o.win / 100) * barMax));
      parts.push(
        `<text x="${labelW - 8}" y="${y + 15}" text-anchor="end" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text">${o.piece}</text>`,
        `<rect x="${labelW}" y="${y + 4}" width="${w}" height="${rowH - 8}" rx="2" fill="rgba(21, 120, 91, 0.75)"/>`,
        `<text x="${width}" y="${y + 15}" text-anchor="end" font-family="system-ui, sans-serif" font-size="11" font-weight="600" class="xq-diagram-title">${Math.round(o.win)}%</text>`,
      );
      y += rowH;
    }
    const avg = tileAverage(panel.outcomes);
    const ax = labelW + Math.round((avg / 100) * barMax);
    parts.push(
      `<line x1="${ax}" y1="${top}" x2="${ax}" y2="${y + 2}" class="xq-diagram-line" stroke-width="1.5" stroke-dasharray="4 3"/>`,
      `<text x="${ax}" y="${y + 15}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text">average ${Math.round(avg)}%</text>`,
    );
    y += 30;
  }
  return xqSvg(width, y, parts.join(''));
};

/** The study-card embed of a line: board, steppers, moves on the right. */
export function jieqiLinePath(line: JieqiPuzzleLine): string {
  const query = new URLSearchParams({
    fen: line.fen.replace(/ /g, '_'),
    moves: line.moves.join(','),
    red: line.red,
    black: line.black,
    event: line.event,
  });
  if (line.orientation === 'black') query.set('orientation', 'black');
  // the move the board is about, drawn as an arrow on the frame it opens on
  query.set('arrows', '1');
  if (line.arrow) query.set('arrow', line.arrow);
  return `/embed/line/jieqi?${query.toString()}`;
}

function lineEmbed(line: JieqiPuzzleLine, title: string, caption: string): ArticleBlock {
  return { kind: 'embed', path: jieqiLinePath(line), title, caption, aspect: [702, 696] };
}

const L = JIEQI_PUZZLE_LINES;
const F = XIANGQI_RULES_FUNNEL;

// Card art: the lottery ticket as dealt, from Black's side, face-down tiles
// drawn as backs and a10-a1 as the arrow. Built from the kernel's parse of the
// same dealt FEN the embed replays, so the card cannot drift from the board.
export const JIEQI_PUZZLE_THUMBNAIL = (): string => {
  const parsed = parseJieqiFen(L.lotteryDealt.fen);
  if (!parsed.ok) throw new Error(`jieqi-puzzle-search thumbnail: ${parsed.error}`);
  const board: Partial<Record<XiangqiSquare, XiangqiPiece>> = {};
  const view: Parameters<typeof xqStaticView>[1] = {};
  for (const [square, piece] of Object.entries(parsed.state.board)) {
    if (!piece) continue;
    const shown = { color: piece.color, role: piece.role };
    board[square as XiangqiSquare] = shown;
    view[square as XiangqiSquare] = { piece: shown, shrouded: piece.faceDown };
  }
  // Drawn like the xiangqi endgames card: the whole board scaled into the
  // 320x200 box, centred, with the board's own rounded background only.
  const scale = 192 / (XQ_BOARD_H + 8);
  const tx = (320 - XQ_BOARD_W * scale) / 2;
  const body = [
    `<rect x="0" y="0" width="${XQ_BOARD_W}" height="${XQ_BOARD_H}" rx="10" class="xq-diagram-bg"/>`,
    xqBoardSvg({
      state: xqVisionDemoState('jieqi-puzzle-thumb', board),
      view: xqStaticView('jieqi-puzzle-thumb-view', view, 'black'),
      x: 0,
      y: 0,
      label: '',
      perspective: 'black',
      shroudedStyle: 'back',
      boardOffset: 0,
      arrows: [{ from: 'a10' as XiangqiSquare, to: 'a1' as XiangqiSquare }],
    }),
  ].join('');
  return `<svg class="xq-article-svg" viewBox="0 0 320 200" role="img" aria-label="Black's face-down tile on a10 running down the file to Red's back rank, a move that wins only if the tile is a chariot" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto"><g transform="translate(${tx.toFixed(1)} 4) scale(${scale.toFixed(4)})">${body}</g></svg>`;
};

export const jieqiPuzzleSearchArticle: Article = {
  slug: 'jieqi-puzzle-search',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Looking for jieqi puzzles',
  seoTitle: 'Looking for jieqi puzzles: what 50 games turned up',
  summary:
    'We searched 2,939 positions from 50 jieqi games for puzzles. 58 had one clearly best move and 15 of those turned on a hidden piece. None of the 15 passed the rules our xiangqi puzzles go through, and we stopped looking.',
  showSummaryOnPage: false,
  thumbnail: { kind: 'svg', svg: JIEQI_PUZZLE_THUMBNAIL },
  status: 'published',
  publishedAt: '2026-10-11',
  boardFamily: 'xiangqi',
  audience:
    'Jieqi players, and people who build puzzles or engines for games with hidden pieces.',
  readNext: ['how-puzzle-mining-works', 'ab-jchess', 'pikafish-reveal-bug'],
  tldr: [
    'We scored 2,939 positions from 50 jieqi games. 58 had one clearly best move, and 15 of those turned on a face-down piece.',
    'Four positions passed the rules our xiangqi puzzles go through, and none turns on a hidden piece. The hidden-piece answers were bets or moves the tile hardly touched.',
    'Skill shows in timing: a tile on its starting square moves as its home piece, so a capture it threatens can usually wait.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'In [jieqi](/rules/jieqi), every piece except the generals starts face down, and a piece shows what it is when it first moves. A xiangqi puzzle asks for a forced line, and in jieqi a forced line rarely gets past the first piece that turns over, because nobody knows yet what it will be.',
    },
    {
      kind: 'paragraph',
      text: 'In October we asked a different question. If a jieqi puzzle is a decision under uncertainty, the way a poker hand is, does the game produce them? We have stopped looking, and the last section says what would make us start again.',
    },
  ],
  sections: [
    {
      heading: 'How we looked',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We took the 50 most recent finished jieqi games on the site with 20 plies or more, 2,939 positions in all. All 50 were played on 8 October by guests against a bot: 34 against [AB-JChess](/blog/ab-jchess), 13 against Pikafish at level 2 and 3 against full-strength Pikafish.',
        },
        {
          kind: 'paragraph',
          text: "AB-JChess scored the candidate moves in every position. A move that turns a piece over was scored once for each piece it could be, and the scores were averaged, weighted by how many of each piece the side to move had not yet seen. The site's jieqi game review grades a reveal the same way, from only what the player could know.",
        },
        {
          kind: 'paragraph',
          text: 'A position counted when the best move beat the second best by at least 15 points of winning chance, both at our standard depth and at four times that, with every move searched to at least one full ply.',
        },
      ],
    },
    {
      heading: 'What turned up',
      blocks: [
        {
          kind: 'paragraph',
          text: '58 positions passed, from 24 of the 50 games. 43 of them are ordinary tactics with a quiet move as the answer, and 15 of those never touch a face-down piece in the first five plies of the line. They are xiangqi puzzles that happen to come from jieqi games.',
        },
        {
          kind: 'paragraph',
          text: 'The other 15 turn on a hidden piece, and they come in two kinds. Of the 58, 25 had a person to move, and the person found the answer 19 times.',
        },
        { kind: 'sub-heading', text: 'The lottery ticket' },
        {
          kind: 'paragraph',
          text: 'The side to move is lost on every quiet move, and one tile could save it. We found five, all from lost positions, and the right answer usually loses.',
        },
        lineEmbed(
          L.lotteryDealt,
          'Lottery ticket: Black to move, the game as dealt',
          'Black to move. Black has two tiles left, and from where Black sits each could be a soldier, horse, chariot or cannon. The a10 tile moves as a chariot on its first move, whatever it is, so a10-a1 lands on the back rank. If it turns out to be a chariot it is mate; anything else and it is lost. That is one chance in four, 25%, against 2% for the next best move. Black played it and turned over a soldier.',
        ),
        {
          kind: 'paragraph',
          text: "One chance in four was right for what Black could see, and the ticket was blank all the same. A piece taken face down leaves the board without being shown to its owner, so Black's count of unseen pieces still included two that were already gone.",
        },
        {
          kind: 'table',
          headers: ['Black piece not yet seen', 'Where it really was'],
          rows: LOTTERY_UNSEEN.map((row) => [row.piece, row.where]),
          keyColumn: true,
          wrap: true,
          caption:
            'Four pieces for two tiles, so each tile was a chariot one time in four from where Black sat. The chariot had left the board 11 moves earlier.',
        },
        lineEmbed(
          L.lotteryChariot,
          'Lottery ticket: the same position if a10 were the chariot',
          'The same move with a chariot dealt to a10: mate. This is the deal Black was playing for, and it was not possible in this game.',
        ),
        lineEmbed(
          L.doubleOrNothing,
          'Double or nothing: Black to move, the game as played',
          "Black to move. a10-a1, taking Red's face-down piece, and a10-b10 turn over the same tile, a soldier or a chariot at even odds from where Black sat. If it is the chariot, a10-a1 wins 95 to 98% of the time whatever it captured, and a10-b10 48%. On average that is 49.2% against 24.1%. Black found it, and turned over a soldier: Red had taken Black's chariot face down on its second move.",
        ),
        { kind: 'sub-heading', text: 'A stored move' },
        {
          kind: 'paragraph',
          text: "A capture that wins whatever the tile turns out to be can wait: in the game below it stayed available for six turns. It works because a face-down tile moves as the piece whose starting square it stands on, so its first move, capture included, does not depend on the deal.",
        },
        {
          kind: 'paragraph',
          text: 'In 46 of the 2,939 positions a face-down tile could make a capture that won whatever the tile turned out to be. They came from 22 such captures, and the same capture was often there turn after turn; one stayed on the board for eight of its owner\'s turns. Nine were played. Holding one was usually free: in all but two of the 46 positions another move came within 15 points of it, and those two are one capture on consecutive turns, shown further down.',
        },
        lineEmbed(
          L.storedCapture,
          'A stored capture: Black waits five turns, then takes',
          "Black to move. The i10 tile can run down the file as a chariot and take Red's i4 tile on this turn and each of the next five. Black plays elsewhere, the capture stays, and its score rises from 85% to 97%. Black takes on move 15; the tile is an elephant.",
        ),
        { kind: 'sub-heading', text: 'Which tile' },
        {
          kind: 'paragraph',
          text: 'The question is which face-down piece to move, and the right one works whatever it turns out to be. We found ten.',
        },
        {
          kind: 'paragraph',
          text: "In the example below Black threatens d5xd1 check, with mate on the next move. Four of Red's 38 moves stop it. c1-a3 is the best of them, and it works by getting out of the way: the a1 tile moves as a chariot, so with c1 empty it can take back on d1. The tile on c1 can be any of six pieces, and c1-a3 stops the mate for every one.",
        },
        lineEmbed(
          L.whichTile,
          'Which tile: Red to move, the game as played',
          "Red to move. c1-a3 stops the mate but leaves the a5 cannon hanging, and Black took it at once. The tile was an advisor. Only a chariot on a3 would have guarded a5.",
        ),
        {
          kind: 'table',
          headers: ['c1 turns out to be', 'Left face down', "Black's best reply", "Red's winning chance"],
          rows: WHICH_TILE_OUTCOMES.map((o) => [o.piece, String(o.left), o.reply, `${o.win}%`]),
          keyColumn: true,
          compact: true,
          caption:
            'After c1-a3, by what the tile turns out to be. Black takes the cannon unless the tile is a chariot, and is better in every case. c1-a3 is the best move in the position and still loses most of the time: 36% on average, against 13% for the next best.',
        },
      ],
    },
    {
      heading: 'Held to the xiangqi puzzle rules',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Our [xiangqi puzzles](/blog/how-puzzle-mining-works) come from a miner with stricter rules. The opponent has just blundered, giving up 25 or more points of winning chance. The game was not already decided before that. After the right move the solver is winning, and after the second best move it is not.',
        },
        {
          kind: 'table',
          headers: ['Step', 'Positions left'],
          rows: [
            ['Scanned', F.scanned.toLocaleString('en-US')],
            ["Passed the xiangqi miner's rules", String(F.passed)],
            ['Mates in one dropped, as the miner does', String(F.passed - F.mateInOne)],
            ['Positions with a single legal move dropped', String(F.left)],
          ],
          keyColumn: true,
          highlightRows: [3],
          caption: 'The same 2,939 positions through the rules our xiangqi puzzles pass.',
        },
        {
          kind: 'paragraph',
          text: 'A person was to move in three of the four and missed all three; the bot was to move in the fourth. None turns on a hidden piece. Every lottery ticket and every which-tile position failed, because the side to move was not winning or the opponent had not blundered.',
        },
        lineEmbed(
          L.survivorA,
          'Red to move: the first of four',
          "Red to move. e3-f3 and the engine's line after it. The interest is mostly jieqi's: Red's revealed elephant and advisors stand outside the zones they could never leave in xiangqi.",
        ),
        lineEmbed(
          L.survivorB,
          'Red to move: the second of four',
          "Red to move. i10-f10 and the engine's line, in which Black loses the chariot two moves later. No face-down piece is left on the board. Red played i10-i9 instead.",
        ),
        lineEmbed(
          L.survivorC,
          'Red to move: the third of four',
          "Red to move. h10-h9 and the engine's line. It is ordinary xiangqi: a tile turns over only on the line's last move.",
        ),
        lineEmbed(
          L.survivorD,
          'Black to move: the fourth of four',
          'Black to move. e7-f7 and mate in six, with no face-down piece left on the board. The bot played e3-c3 instead.',
        ),
      ],
    },
    {
      heading: 'Why we stopped',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The chart shows the problem. A lottery ticket is all or nothing: right because one deal in four wins outright, and usually lost. A which-tile answer scores about the same for every piece, because it meets the threat on the board and the tile hardly matters. A fair puzzle needs a single line that works, and a decision about a hidden piece rarely has one.',
        },
        {
          kind: 'raw-svg',
          svg: JIEQI_TILE_OUTCOME_CHART,
          caption:
            'The mover\'s winning chance after the answer, once for each piece the tile could be, from the two examples above. The dashed line is the average the review grades by.',
        },
        {
          kind: 'paragraph',
          text: 'We tried two ways round it. The first was to grade as if the face-down pieces were known, using the real deal. That gave 16 positions through the xiangqi rules: the same 15, plus one reveal that wins only because the tile was a cannon (100% for a cannon, 59 to 73% for anything else). A puzzle whose answer depends on what the solver cannot see is not one we would publish.',
        },
        {
          kind: 'paragraph',
          text: 'The second was to look for reveals that win whatever comes up: the best move turns a tile over, every piece it could be scores 81% or more, and the next best move 60% or less. There were none in the 2,939 positions.',
        },
        {
          kind: 'paragraph',
          text: 'The nearest thing to a fair jieqi puzzle we found is a stored capture, where the capture is certain and only the piece after it is luck.',
        },
        lineEmbed(
          L.fairest,
          'A capture that does not depend on the tile: Red to move',
          "Red to move. The h1 tile moves as a horse and takes Black's chariot on g3, and it does that whatever the tile is. Red's winning chance is 93 to 95% for each of the three pieces it could be, against 78% for the next best move. The bot, Pikafish at level 2, missed it two turns running. The tile was a chariot. It is the only capture of the 22 that beat the next best move by 15 points.",
        ),
      ],
    },
    {
      heading: 'Limits',
      blocks: [
        {
          kind: 'table',
          headers: ['Limit', 'What it could change'],
          rows: [
            ['One engine, AB-JChess, set every answer', 'A second engine could disagree'],
            ['Only its top five to eight moves were scored', 'An unscored move could narrow a gap'],
            ['50 games from one day, guests against a bot', 'Other games could turn up other positions'],
            ['The bot was to move in half the positions', 'Half of what we found no person faced'],
          ],
          wrap: true,
        },
      ],
    },
    {
      heading: 'What the 50 games say',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Jieqi does not produce puzzles the way xiangqi does. Four positions in 50 games passed our xiangqi rules, none of them about a hidden piece, and the hidden-piece answers were bets or moves the tile hardly touched.',
        },
        {
          kind: 'paragraph',
          text: "Skill shows in timing more than in guessing. A tile on its starting square moves as its home piece, so a capture it threatens is a move in reserve: play something else while it is safe, and take it before it can be blocked. When a tile must turn over, pick the one that holds whatever it is, and remember that your count of what it could be includes pieces your opponent took face down.",
        },
        {
          kind: 'paragraph',
          text: 'We would look again for puzzles about that timing, with an answer that holds for every deal, in thousands of games where a person was to move, checked by a second engine. Until then, the hidden pieces in jieqi are something to play, not something to solve.',
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play jieqi', href: '/bots', emphasis: 'primary' },
            { label: 'Jieqi rules', href: '/rules/jieqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
