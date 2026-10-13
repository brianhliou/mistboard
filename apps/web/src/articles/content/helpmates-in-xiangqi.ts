import {
  applyStandardXiangqiMove,
  type Board,
  parseStandardXiangqiFen,
  type XiangqiGameState,
  type XiangqiSquare,
} from '@mistboard/game';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqArrowLayer,
  xqBoardGrid,
  xqPiecesLayer,
  xqSvg,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// A helpmate: both sides cooperate so that one side is mated in a stated
// number of moves. The article covers one slice of the genre, helpmate in two
// with Black moving first and Red mating on its second move. Folded in from the brianhliou.com draft
// (_drafts/helpmates-in-xiangqi.md). The problems are study 5CdUHFsq
// ("Helpmates in two", 164 chapters on production, the chosen ten first).
// Every count in the prose was re-derived on 2026-10-10 from the problem-lab
// output (out/h2-*.jsonl for the 1,470; out/h2-themed.json less
// out/helpmate-failures.json for the rest), and every embedded line is
// replayed through the kernel in helpmates.test.ts.
const STUDY_ID = '5CdUHFsq';
const STUDY = `/study/${STUDY_ID}`;

// The first ten chapters of the study, in study order. Titles and setups say
// what is on the board and what to look for, never the moves.
const TEN: { id: string; title: string; setup: string }[] = [
  {
    id: 'RMlEpAw1',
    title: 'Helpmate 1: a general and one soldier',
    setup:
      'Red has a general and one soldier against seven black pieces, a chariot and both advisors among them. Find the square where a lone soldier can mate, then ask which black piece has to wall the general in.',
  },
  {
    id: 'ULE6g0Op',
    title: 'Helpmate 2: one horse against twelve',
    setup:
      "Red has a general and a horse already in Black's camp; Black has twelve pieces. Black has 45 legal first moves, and exactly one of them leads to mate.",
  },
  {
    id: 'vujF1lWk',
    title: 'Helpmate 3: one cannon against fifteen',
    setup:
      'A single red cannon against fifteen black pieces. A cannon cannot check without a screen, so look at which black piece can provide one.',
  },
  {
    id: '0Bxs9oaW',
    title: 'Helpmate 4: one chariot against twelve',
    setup:
      "A red chariot against twelve, with Black's back rank already thinned out. The question is which squares beside the black general need filling, and by what.",
  },
  {
    id: 'he06evJZ',
    title: 'Helpmate 5: a horse on the right',
    setup:
      "A general and a horse against twelve again, the horse this time on h8, near a black chariot in the corner. The horse needs both of Red's moves.",
  },
  {
    id: 'KePDB5oH',
    title: 'Helpmate 6: eighteen pieces',
    setup:
      "The fullest board of the ten: three red soldiers deep in Black's half against fourteen black pieces.",
  },
  {
    id: '5rRSCRMV',
    title: 'Helpmate 7: six pieces',
    setup:
      'Six pieces: a general, cannon and soldier for Red, a general, cannon and horse for Black. Look at what the red cannon on e5 needs before it can give check.',
  },
  {
    id: 'Xcd4sVh1',
    title: 'Helpmate 8: six pieces again',
    setup:
      "Black's general is already out of its back rank, with Red's soldier and cannon stacked on the g-file. Red's last move here does two jobs.",
  },
  {
    id: 'Uou3h7ll',
    title: 'Helpmate 9: an open board',
    setup:
      'Black has two chariots, a horse and a cannon on an open board, and 55 legal first moves. Red has one horse.',
  },
  {
    id: 'vLHg3fog',
    title: 'Helpmate 10: one soldier against twelve',
    setup:
      "A general and one soldier against twelve, the soldier already on f8 beside Black's palace. Black's own pieces have to finish the cage.",
  },
];

export const HELPMATE_CHAPTER_IDS: readonly string[] = TEN.map((c) => c.id);

// The intro's example, chapter 12 of the study (hZUesDWz), outside the ten so
// showing its mate spoils none of them: a red general and horse against
// twelve, Black to move. Line copied from the stored chapter; the kernel
// replays it here, and helpmates.test.ts checks it ends in mate.
export const INTRO_FEN = '1nbakabnr/r8/2c6/2p1N3p/9/9/9/9/9/3K5 b - - 0 1';
export const INTRO_LINE: readonly string[] = ['h10g8', 'e7g6', 'g8e9', 'g6f8'];

function introStart(): XiangqiGameState {
  const parsed = parseStandardXiangqiFen(INTRO_FEN, 'helpmate-intro');
  if (!parsed.ok) throw new Error(`helpmate intro: ${parsed.error}`);
  return parsed.state;
}

export function introMate(): XiangqiGameState {
  return INTRO_LINE.reduce((state, uci) => {
    const squares = /^([a-i]\d{1,2})([a-i]\d{1,2})$/.exec(uci);
    if (!squares) throw new Error(`helpmate intro: bad move ${uci}`);
    const next = applyStandardXiangqiMove(state, {
      from: squares[1] as XiangqiSquare,
      to: squares[2] as XiangqiSquare,
    });
    if (next === state) throw new Error(`helpmate intro: illegal ${uci}`);
    return next;
  }, introStart());
}

function wholeBoard(state: XiangqiGameState, label: string, arrows = ''): string {
  return xqSvg(
    XQ_BOARD_W,
    XQ_BOARD_H,
    [xqBoardGrid(0, 0, 'red'), xqPiecesLayer(state, null, 0, 0, 'red'), arrows].join(''),
  ).replace('role="img"', `role="img" aria-label="${label}"`);
}

const INTRO_START_SVG = (): string =>
  wholeBoard(
    introStart(),
    'A red general and horse against twelve black pieces, Black to move and help Red mate in two',
  );

// Card art and the intro's second board: the final position, the red horse's
// last step drawn in, so the card shows what a helpmate ends in.
export const HELPMATE_THUMBNAIL = (): string =>
  wholeBoard(
    introMate(),
    'The final position: a red horse on f8 mates the black general, whose own horse fills e9',
    xqArrowLayer([{ from: 'g6', to: 'f8' }], 0, 0, 'red'),
  );

// A famous chess helpmate for the tradition section: Henry Forsberg, Revista
// Romana de Sah 1935, as given on Wikipedia's Helpmate page (version a).
// Checked 2026-10-10 by exhaustive search with chessops: this line is the only
// helpmate in two, and each of the four twins (a6 holding a rook, bishop,
// knight or pawn instead) also has exactly one, a different one each time.
const FORSBERG_START: Board = {
  a6: { color: 'black', role: 'queen' },
  a3: { color: 'black', role: 'king' },
  b4: { color: 'white', role: 'rook' },
  d3: { color: 'white', role: 'knight' },
  g4: { color: 'white', role: 'king' },
};
const FORSBERG_MATE: Board = {
  b2: { color: 'black', role: 'queen' },
  a3: { color: 'black', role: 'king' },
  a4: { color: 'white', role: 'rook' },
  c5: { color: 'white', role: 'knight' },
  g4: { color: 'white', role: 'king' },
};

// Shogi's cooperative mate, from Japanese Wikipedia's fairy tsume shogi page
// (図1 ばか詰の例): gote king 2b, gote lance 2e, sente dragon 3d, sente with
// nothing in hand and gote holding every other piece. Solution ▲25龍 △13玉
// ▲14香. helpmates.test.ts replays it in shogiops (the lishogi rules kernel)
// and proves it the only cooperative mate in three, with none in one.
export const SHOGI_START_SFEN = '9/7k1/9/6+R2/7l1/9/9/9/9 b r2b4g4s4n3l18p 1';
export const SHOGI_LINE: readonly string[] = ['3d2e', '2b1c', 'L*1d'];

type ShogiColor = 'sente' | 'gote';
type ShogiPiece = { color: ShogiColor; letter: string; promoted: boolean };
export type ShogiDiagram = {
  board: Map<string, ShogiPiece>;
  hands: Record<ShogiColor, Map<string, number>>;
  turn: ShogiColor;
};

const SHOGI_RANKS = 'abcdefghi';

export function parseShogiSfen(sfen: string): ShogiDiagram {
  const [placement, turn, hand] = sfen.split(' ');
  const board = new Map<string, ShogiPiece>();
  placement.split('/').forEach((row, r) => {
    let file = 9;
    for (const token of row.match(/\d|\+?[a-zA-Z]/g) ?? []) {
      if (/\d/.test(token)) {
        file -= Number(token);
        continue;
      }
      const letter = token.replace('+', '');
      board.set(`${file}${SHOGI_RANKS[r]}`, {
        color: letter === letter.toUpperCase() ? 'sente' : 'gote',
        letter: letter.toUpperCase(),
        promoted: token.startsWith('+'),
      });
      file -= 1;
    }
  });
  const hands: ShogiDiagram['hands'] = { sente: new Map(), gote: new Map() };
  for (const [, count, letter] of hand.matchAll(/(\d*)([a-zA-Z])/g)) {
    const color = letter === letter.toUpperCase() ? 'sente' : 'gote';
    hands[color].set(letter.toUpperCase(), Number(count || 1));
  }
  return { board, hands, turn: turn === 'b' ? 'sente' : 'gote' };
}

// Moves pieces only; legality is the test's job (shogiops). A capture goes to
// the mover's hand unpromoted, as in shogi.
export function playShogiLine(start: ShogiDiagram, line: readonly string[]): ShogiDiagram {
  const board = new Map(start.board);
  const hands = { sente: new Map(start.hands.sente), gote: new Map(start.hands.gote) };
  let turn = start.turn;
  for (const usi of line) {
    const drop = /^([A-Z])\*(\d[a-i])$/.exec(usi);
    const move = /^(\d[a-i])(\d[a-i])(\+?)$/.exec(usi);
    if (drop) {
      const held = hands[turn].get(drop[1]) ?? 0;
      if (held < 1 || board.has(drop[2])) throw new Error(`shogi: bad drop ${usi}`);
      hands[turn].set(drop[1], held - 1);
      board.set(drop[2], { color: turn, letter: drop[1], promoted: false });
    } else if (move) {
      const piece = board.get(move[1]);
      const taken = board.get(move[2]);
      if (!piece || piece.color !== turn || taken?.color === turn) {
        throw new Error(`shogi: bad move ${usi}`);
      }
      if (taken) hands[turn].set(taken.letter, (hands[turn].get(taken.letter) ?? 0) + 1);
      board.delete(move[1]);
      board.set(move[2], { ...piece, promoted: piece.promoted || move[3] === '+' });
    } else {
      throw new Error(`shogi: bad usi ${usi}`);
    }
    turn = turn === 'sente' ? 'gote' : 'sente';
  }
  return { board, hands, turn };
}

const SG_CELL = 28;
const SG_PAD = 16;
const SG_BAND = 18;
const SG_W = SG_PAD * 2 + 9 * SG_CELL;
const SG_H = SG_W + SG_BAND * 2;

function shogiCenter(square: string): { x: number; y: number } {
  const file = Number(square[0]);
  const rank = SHOGI_RANKS.indexOf(square[1]);
  return {
    x: SG_PAD + (9 - file) * SG_CELL + SG_CELL / 2,
    y: SG_BAND + SG_PAD + rank * SG_CELL + SG_CELL / 2,
  };
}

function shogiHandText(diagram: ShogiDiagram, color: ShogiColor): string {
  const held = [...diagram.hands[color].values()].reduce((a, b) => a + b, 0);
  return held === 0 ? 'nothing' : held >= 30 ? 'every other piece' : `${held} pieces`;
}

// A static 9x9 board: files 9 to 1 left to right, ranks a to i top to bottom,
// sente playing up the board. Pieces are pentagons pointing at the enemy with
// English letters ("+R" a dragon), since the reader is not assumed to read
// the kanji. The last move, a drop, is marked by tinting its square.
function shogiSvg(diagram: ShogiDiagram, label: string, mark?: string): string {
  const left = SG_PAD;
  const top = SG_BAND + SG_PAD;
  const parts: string[] = [
    `<rect x="0" y="${SG_BAND}" width="${SG_W}" height="${SG_W}" rx="8" class="xq-diagram-bg"/>`,
  ];
  if (mark) {
    const c = shogiCenter(mark);
    parts.push(
      `<rect x="${c.x - SG_CELL / 2}" y="${c.y - SG_CELL / 2}" width="${SG_CELL}" height="${SG_CELL}" fill="#15781B" opacity="0.32"/>`,
    );
  }
  for (let i = 0; i <= 9; i += 1) {
    const at = i * SG_CELL;
    parts.push(
      `<line x1="${left}" y1="${top + at}" x2="${left + 9 * SG_CELL}" y2="${top + at}" class="xq-diagram-line" stroke-width="1"/>`,
      `<line x1="${left + at}" y1="${top}" x2="${left + at}" y2="${top + 9 * SG_CELL}" class="xq-diagram-line" stroke-width="1"/>`,
    );
  }
  for (let i = 0; i < 9; i += 1) {
    parts.push(
      `<text x="${left + i * SG_CELL + SG_CELL / 2}" y="${top - 5}" font-family="system-ui, sans-serif" font-size="9" class="xq-diagram-ink" text-anchor="middle">${9 - i}</text>`,
      `<text x="${left + 9 * SG_CELL + 8}" y="${top + i * SG_CELL + SG_CELL / 2 + 3}" font-family="system-ui, sans-serif" font-size="9" class="xq-diagram-ink" text-anchor="middle">${SHOGI_RANKS[i]}</text>`,
    );
  }
  for (const [square, piece] of diagram.board) {
    const { x, y } = shogiCenter(square);
    const flip = piece.color === 'gote' ? ` transform="rotate(180 ${x} ${y})"` : '';
    parts.push(
      `<polygon points="${x},${y - 12} ${x + 8},${y - 8} ${x + 10},${y + 11} ${x - 10},${y + 11} ${x - 8},${y - 8}" fill="#f6e7c1" stroke="#4b3c2a" stroke-width="1"${flip}/>`,
      `<text x="${x}" y="${y + 5}" font-family="system-ui, sans-serif" font-size="${piece.promoted ? 10 : 12}" font-weight="700" fill="${piece.promoted ? '#b3261e' : '#2b2118'}" text-anchor="middle">${piece.promoted ? '+' : ''}${piece.letter}</text>`,
    );
  }
  parts.push(
    `<text x="${SG_W / 2}" y="12" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text" text-anchor="middle">Defender holds ${shogiHandText(diagram, 'gote')}</text>`,
    `<text x="${SG_W / 2}" y="${SG_H - 4}" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text" text-anchor="middle">Attacker holds ${shogiHandText(diagram, 'sente')}</text>`,
  );
  return xqSvg(SG_W, SG_H, parts.join('')).replace('role="img"', `role="img" aria-label="${label}"`);
}

export const shogiStart = (): ShogiDiagram => parseShogiSfen(SHOGI_START_SFEN);
export const shogiMate = (): ShogiDiagram => playShogiLine(shogiStart(), SHOGI_LINE);

const SHOGI_START_SVG = (): string =>
  shogiSvg(
    shogiStart(),
    'A shogi cooperative mate in three: the attacker has a dragon on 3d; the defender has a king on 2b and a lance on 2e',
  );
const SHOGI_MATE_SVG = (): string =>
  shogiSvg(
    shogiMate(),
    'The mate: the defending king on 1c, the dragon on 2e, and the lance dropped on 1d',
    SHOGI_LINE[SHOGI_LINE.length - 1].slice(-2),
  );

// Kept narrow (under 60 columns) with comments on their own lines, so the
// block fits the article column on desktop and wraps cleanly on a phone.
const PIPELINE = `for each diagram the position maker deals:
    # every placement, or random armies from a profile
    if the diagram is illegal: discard
    lines = every Black, Red, Black, Red line that mates
    if len(lines) != 1: discard   # sound: exactly one
    keep (diagram, lines[0])      # 1,470 kept

# final picture: the mater and its square, the
# general's square, what covers each escape
group the kept problems by their final picture
keep one per group                # 186

re-prove each one, counting a general with no legal
move as mated, and requiring no mate in one
                                  # 164 stand`;

export const helpmatesInXiangqiArticle: Article = {
  slug: 'helpmates-in-xiangqi',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Helpmates in Xiangqi',
  seoTitle: 'Helpmates in Xiangqi (Chinese Chess): 164 Two-Move Problems',
  summary:
    'In a helpmate both sides cooperate so Red can mate. A search found 164 helpmates in two for xiangqi; try the best ten, solutions hidden until you ask.',
  showSummaryOnPage: false,
  thumbnail: { kind: 'svg', svg: HELPMATE_THUMBNAIL },
  status: 'draft',
  publishedAt: '2026-10-20',
  audience:
    'Xiangqi players who like problems, and chess problemists who want to see their genres on a xiangqi board.',
  readNext: ['solver-audit', 'longest-forced-mates-xiangqi'],
  tldr: [
    'A helpmate turns a problem inside out: both sides cooperate so that one side is mated in a stated number of moves. We searched one slice of it in xiangqi, helpmate in two with Black first and Red mating: 1,470 sound, 186 distinct, 164 after a re-proof.',
    "Xiangqi's own rules shape the genre. A general with no legal move has lost, which cost us 22 problems, and the cannon can mate over a screen Black supplies, as 19 of the 164 do.",
    "The good ones look impossible. In one, Red has a general and a horse against twelve black pieces, and of Black's 45 legal first moves exactly one leads to mate.",
  ],
  intro: [
    {
      kind: 'svg-row',
      items: [
        {
          svg: INTRO_START_SVG,
          caption: 'Black to move. Red has a general and a horse; Black has twelve pieces.',
        },
        {
          svg: HELPMATE_THUMBNAIL,
          caption:
            "Two moves each later, mate. Black's horse went out and came back to e9, walling in its own general, and Red's horse reached f8.",
        },
      ],
    },
    {
      kind: 'paragraph',
      text: 'In an ordinary [xiangqi](/rules/xiangqi) (Chinese chess) problem the two sides are enemies: Red plays, Black defends as well as it can, and Red wins anyway. A helpmate drops the fight. Both sides cooperate so that one of them is mated in a stated number of moves. The claim is not that the losing side cannot stop it; it is that out of everything both sides could play, this is the only line that works.',
    },
    {
      kind: 'paragraph',
      text: 'The genre is old in Western chess, where the usual form, written h#n, has Black move first and White mate on its nth move. That is a convention, not a limit: a helpmate can run to any length, and either side can move first or be mated. The classical xiangqi manuals ask for a win or a draw against the best defence, never for cooperation, so we asked whether a helpmate works on this board, starting with one narrow slice: helpmate in two, Black first, Red mates. Can a search compose sound ones, and are any of them worth solving?',
    },
  ],
  sections: [
    {
      heading: 'Where this sits in the tradition',
      blocks: [
        {
          kind: 'paragraph',
          text: "Xiangqi problem composition is the older tradition. The earliest known problem, Two Dragons Leave the Sea, is in a Southern Song encyclopedia dated to 1266. The classical manuals followed: a Ming collection of 550 problems in 1570, The Secret in the Orange in 1632, then the Qing collections, one of which (1801) holds the famous street problems such as Seven Stars Gathering ([a history of the manuals](https://www.xiangqi.com/articles/a-short-introduction-to-the-xiangqi-manuals-up-till-the-ming-dynasty)).",
        },
        {
          kind: 'paragraph',
          text: 'What runs through all of them is a fixed goal. Each problem names its result, a win or a draw, and the solver plays the losing side as well as it can be played. The Ming problems are nearly all wins; the Qing ones are mostly draws. The tradition grew by varying the position, generation after generation, rather than by varying what the solver is asked to do.',
        },
        {
          kind: 'paragraph',
          text: "Western composition went the other way: it kept the board and changed the goal. Max Lange published the first helpmate in 1854, with White moving first and more than one solution; Sam Loyd's of 1860 was the first with Black to move, and A. Barbe's of 1861 the first with a single solution ([the genre's history](https://en.wikipedia.org/wiki/Helpmate)). Selfmates, series movers and the rest came the same way. The helpmate is now the largest single section of the FIDE Album, the official anthology of the best problems: 2,539 of the 9,218 entries for 2010 to 2012 ([FIDE](https://www.fide.com/images/stories/NEWS_2017/FIDE_News/FIDE_Album_2010-2012_sample_pages.pdf)).",
        },
        {
          kind: 'live-boards',
          spec: {
            layout: 'pair',
            boards: [
              { board: FORSBERG_START, orientation: 'white', label: 'Black to move, helpmate in 2' },
              {
                board: FORSBERG_MATE,
                orientation: 'white',
                label: 'The mate',
                arrows: [{ orig: 'b4', dest: 'a4' }],
              },
            ],
          },
          caption:
            "Henry Forsberg, 1935. The solution is 1. Qf6 Nc5 2. Qb2 Ra4 mate: the black queen walks to b2 to block its own king's last square, and the white rook mates. The problem is famous for its twins: put a rook, bishop, knight or pawn on a6 instead of the queen and each has its own single solution, five mates from one diagram.",
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: "Shogi took the idea from chess too. Its problemists call it bakazume, the cooperative mate: both sides work together to mate the defending king in the fewest moves, and, as in shogi's ordinary mating problems, the attacker moves first (in chess the mated side usually does), normally has no king on the board, and the defender holds every piece not in play. Fairy shogi problems with this goal were being published by the 1960s; in 1970 Kato Tetsu published one 163 moves long, and in 1971 the magazine Tsume Shogi Paradise began a regular series of them ([Japanese Wikipedia](https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A7%E3%82%A2%E3%83%AA%E3%83%BC%E8%A9%B0%E5%B0%86%E6%A3%8B)).",
        },
        {
          kind: 'svg-row',
          items: [
            {
              svg: SHOGI_START_SVG,
              caption:
                'Cooperative mate in three, attacker first. The attacker, playing up the board, has a dragon (+R, a promoted rook: it moves as a rook or one square diagonally). The defender has a king (K) and a lance (L: any distance straight ahead).',
            },
            {
              svg: SHOGI_MATE_SVG,
              caption:
                'The dragon takes the lance on 2e with check, the king steps to 1c, and the attacker drops the captured lance on 1d. The dragon guards 1d and the whole 2-file, and the lance sees through the king to 1b.',
            },
          ],
        },
        {
          kind: 'paragraph',
          text: "The example on Japanese Wikipedia's page shows what the cooperative goal changes. Dropping the lance farther from the king on the 1-file looks just as good, but then the defender, who holds every spare piece, can drop one in between. An ordinary shogi problem discounts an interposition that is simply captured; a cooperative one counts it, so only 1d mates in three. Our search of the position agrees: it is the only cooperative mate in three, and there is none in one.",
        },
        {
          kind: 'paragraph',
          text: 'We have not found a xiangqi helpmate older than ours. Web searches in Chinese for the names chess problemists give the helpmate turned up chess problems and ordinary xiangqi mating patterns, never a cooperative xiangqi problem, and the classical manuals all ask for a win or a draw. If you know of an earlier one, [tell us](/contact).',
        },
      ],
    },
    {
      heading: 'Composing them',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The generator is simple and the solver does the work. A position maker deals diagrams, either every placement of a few pieces or random armies from a profile that fixes how much material each side gets. The solver walks every cooperative line of two moves a side, Black first, and keeps a diagram only if exactly one line mates. The profiles that gave Black an army and Red one or two pieces produced most of what is worth looking at.',
        },
        {
          kind: 'code',
          language: 'text',
          text: PIPELINE,
          caption: 'The pipeline, in outline.',
        },
      ],
    },
    {
      heading: 'Results',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The search found 1,470 sound helpmates. Most were the same mate reached from a different setup, often a spectator piece one square over, so we grouped them by the final picture. That left **186 distinct mates**. The re-proof then removed 22, for a reason covered below, and **164 stand**.',
        },
        {
          kind: 'paragraph',
          text: 'Of the 164, 39 are pure mates, where no square around the mated general is covered twice, and 19 are model mates: pure, with every red piece on the board doing work.',
        },
        {
          kind: 'table',
          headers: ['Mate delivered by', 'Problems'],
          rows: [
            ['Soldier', '58'],
            ['Chariot', '50'],
            ['Horse', '28'],
            ['Cannon', '28'],
          ],
          caption: 'The 164 problems that stand, by the red piece that gives the final check.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The best ten',
      blocks: [
        {
          kind: 'paragraph',
          text: `Ten problems, one idea each. All 164 are in [the study](${STUDY}), these ten first and the rest in ranked order. Every one is the slice we searched: Black, Red, Black, Red, and Red's second move mates.`,
        },
        ...TEN.flatMap((c): ArticleBlock[] => [
          { kind: 'paragraph', text: c.setup },
          {
            kind: 'embed',
            path: `/embed/study/${STUDY_ID}/${c.id}`,
            title: c.title,
            aspect: [702, 700],
            hideSolution: true,
          } as ArticleBlock,
        ]),
      ],
    },
    {
      heading: 'What we learned',
      blocks: [
        {
          kind: 'paragraph',
          text: "**Xiangqi decides what counts as sound.** A general with no legal move has lost, so a helpmate can also end with the losing side not in check and simply nothing to play. Our composer tested only for checkmates. Re-proved under the real rule, 22 of the 186 had other lines it could not see, from 3 to 64 of them, and two could be mated in one. A soundness test ported from chess brings chess's idea of a finished game with it.",
        },
        {
          kind: 'paragraph',
          text: '**The cannon is the theme chess cannot have.** It checks by jumping exactly one piece, and in a helpmate the mated side is cooperating, so Black can supply the screen. Nineteen of the 164 mate over a black screen. The facing-generals rule adds another: the red general can take squares from its own palace, as in the seventh problem.',
        },
        {
          kind: 'paragraph',
          text: '**A pipeline count measures patience, not problems.** 1,470 became 186 once we grouped by the final picture. Without that step the corpus would have been mostly the same mates.',
        },
      ],
    },
    {
      heading: 'What is left to find',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We searched one corner of the genre, and the rest is open. **Longer helpmates** first. Our search found almost no sound helpmates in three: a third move gives both sides many more ways to reach the same mate, so a generator has to aim at unique lines rather than deal and filter. How long can a sound xiangqi helpmate be: ten moves, twenty, a hundred? And can a search prove that a long one is the shortest of its kind, or that its line is the only one?',
        },
        {
          kind: 'paragraph',
          text: '**More impossible-looking ones**: the weakest red force against the most black, a lone soldier mating a full army. And **the other shapes of the genre**: Red moving first, and Red as the side that is mated. We have not searched either. If you find one, or a longer or stranger one than ours, we would love to see it: put it in [the forum](/forum), or write it up on your own blog and tell us where.',
        },
        {
          kind: 'paragraph',
          text: "What the slice already shows is that xiangqi does take helpmates, and they are not chess problems on a different board. The rules that make xiangqi what it is, the loss without a legal move, the cannon's screen, the facing generals, decide which problems are sound and how the best of them mate. A good one looks impossible because Red has almost nothing. It works because Black's army is the material the mate is built from: the walls, the screen, the squares filled in around its own general. That is the hope behind this work: to carry the genres Western composers invented onto the xiangqi board, find what is beautiful in them here, and in time find a helpmate good enough to make a xiangqi player stop and set it up for a friend.",
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Solve all 164', href: STUDY, emphasis: 'primary' },
            {
              label: 'The longest forced mates',
              href: '/blog/longest-forced-mates-xiangqi',
              emphasis: 'secondary',
            },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
