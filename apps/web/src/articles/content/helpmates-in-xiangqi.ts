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
  status: 'published',
  publishedAt: '2026-10-15',
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
      text: 'The genre is old in Western chess, where the usual form, written h#n, has Black move first and White mate on its nth move. That is a convention, not a limit: a helpmate can run to any length, and either side can move first or be mated. The classical xiangqi manuals never asked for one, so we asked whether it works on this board, starting with one narrow slice: helpmate in two, Black first, Red mates. Can a search compose sound ones, and are any of them worth solving?',
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
          text: "Western composition went the other way: it kept the board and changed the goal. Max Lange published the first helpmate in 1854, with White moving first and more than one solution; Sam Loyd's of 1860 was the first with Black to move, and A. Barbe's of 1861 the first with a single solution ([the genre's history](https://en.wikipedia.org/wiki/Helpmate)). Selfmates, series movers and the rest came the same way. The helpmate is now the largest single section of the FIDE Album, the official anthology of the best problems: 2,539 of the 9,218 entries for 2010 to 2012 ([FIDE](https://www.fide.com/images/stories/NEWS_2017/FIDE_News/FIDE_Album_2010-2012_sample_pages.pdf)). Shogi took it up too: the cooperative mate is one of the most popular forms of its mating problems.",
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
          text: 'A cooperative goal does not appear in the classical xiangqi manuals, and our search of modern Chinese sources found none, though that search was limited. Changing the goal is the one thing these problems bring to the board. If you know of earlier xiangqi helpmates, [tell us](/contact).',
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
