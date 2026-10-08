import { parseStandardXiangqiFen } from '@mistboard/game';
import { XQ_CELL, xqBoardSvg, xqPoint } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The longest forced mate in each one-and-two-attacker class against 士象全,
// from tablebases generated with FelicityEgtb. Folded in from the
// brianhliou.com draft of 2026-10-08 (_drafts/longest-forced-mates-xiangqi.md).
// Every line is a chapter of study uXu609QE ("The longest forced mates in
// xiangqi", seeded on production 2026-09-23); the ids live here as one block so
// a reseed changes them in one place (solver-audit.ts learned that the hard way).
const STUDY_ID = 'uXu609QE';
const STUDY = `/study/${STUDY_ID}`;
const CHAPTER = {
  horseSoldier: 'GuhYA0we',
  twoCannons: 'u0z3Pvce',
  chariotGuard: '85yb318c',
  cannonHorse: 'LM1vYAUC',
  chariot: 'rLYsuFtE',
  twoHorses: 'aEdsvwA6',
  twoSoldiers: '4neR0BI5',
} as const;
const chapter = (key: keyof typeof CHAPTER) => `${STUDY}/${CHAPTER[key]}`;
const embed = (key: keyof typeof CHAPTER, ply?: number) =>
  `/embed/study/${STUDY_ID}/${CHAPTER[key]}${ply === undefined ? '' : `?ply=${ply}`}`;

// The horse-and-soldier line is 129 plies. Ply 122 is four red moves from the
// end: the horse takes the last advisor, swings to c10, the red general passes
// with e3-e2, and c10-d8 leaves the bare general on f10 with no legal move.
// Replayed through the kernel from the chapter's stored line (2026-10-08).
const HORSE_SOLDIER_FINISH_PLY = 122;

// The horse-and-soldier record's start, copied from the chapter's stored
// rootFen (GuhYA0we). The card draws it through the kernel's FEN reader, never
// a hand-placed board.
export const HORSE_SOLDIER_RECORD_FEN = '2ba2b1P/9/3k1a3/N8/9/9/9/9/9/4K4 r - - 0 1';

// 16:10 to match the card media box (.articles-index-card-media, 16/10).
const THUMB_ASPECT = 16 / 10;

// Card art: Black's half of the 65-move record's start, where every piece but
// the red general stands.
const LONGEST_MATE_THUMBNAIL = (): string => {
  const parsed = parseStandardXiangqiFen(HORSE_SOLDIER_RECORD_FEN, 'longest-mate-thumb');
  if (!parsed.ok) throw new Error(`longest-mate thumbnail: ${parsed.error}`);
  const boardY = 28; // xqBoardSvg draws the grid 28 below its y, under the title row.
  const pad = XQ_CELL * 0.6;
  const left = xqPoint(0, 10, 'red', 0, boardY).x - pad;
  const right = xqPoint(8, 10, 'red', 0, boardY).x + pad;
  const w = right - left;
  const h = w / THUMB_ASPECT;
  const top = xqPoint(0, 10, 'red', 0, boardY).y - pad;
  const svg = xqBoardSvg({
    state: parsed.state,
    x: 0,
    y: 0,
    label: '',
    perspective: 'red',
  });
  return `<svg class="xq-article-svg" viewBox="${left} ${top} ${w} ${h}" role="img" aria-label="A red horse and soldier against a black general with both advisors and both elephants, the start of a 65-move forced mate" xmlns="http://www.w3.org/2000/svg"><rect class="xq-diagram-bg" x="${left}" y="${top}" width="${w}" height="${h}"/>${svg}</svg>`;
};

export const longestForcedMatesXiangqiArticle: Article = {
  slug: 'longest-forced-mates-xiangqi',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'The Longest Forced Mates in Xiangqi',
  cardTitle: 'The Longest Forced Mates',
  summary:
    'A horse and a soldier beat a general with both advisors and both elephants, and the slowest win in that endgame takes 65 moves. Seven records from xiangqi endgame tablebases, with the lines, and five of them end with the loser having no legal move.',
  showSummaryOnPage: false,
  thumbnail: { kind: 'svg', svg: LONGEST_MATE_THUMBNAIL },
  status: 'published',
  publishedAt: '2026-10-09',
  audience:
    'Xiangqi players who study endgames, and chess players who know the tablebase records and want the xiangqi ones.',
  readNext: ['xiangqi-endgames', 'solver-audit'],
  tldr: [
    'We generated xiangqi endgame tablebases for every one-and-two-attacker class against the full defence and pulled out the deepest position in each. The longest is a horse and a soldier: 65 moves of best play by both sides.',
    'Five of the seven records end with the losing general having no legal move. That is 困毙, and in xiangqi it loses, so a longest-mate line can finish without a check on the board.',
    "The lines survive the rules a real game runs under. No position repeats, and the longest stretch without a capture is 27 moves, inside the 60-move limit. Chess's 549-move tablebase record is drawn by its own 50-move rule; these are not.",
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'A tablebase holds every legal position of one material class together with its exact distance to mate under best play. Once you have the table, the longest mate in the class is a fact about the class: no engine opinion, no sampling, no search that might have missed something. Chess has had these numbers for decades, and its records are famous enough to have their own genre of video.',
    },
    {
      kind: 'paragraph',
      text: 'Xiangqi has the numbers too, and almost nobody knows it. 象棋云库 ([chessdb.cn](https://www.chessdb.cn/), the Chinese chess cloud database) publishes a maximum-DTM table for 8,705 material classes, linked from its homepage and written only in Chinese; the deepest entry there is 马马士 against 马卒象象 at 759 plies, a forced win 380 moves long. The 116-move record against 士象全 has been in the literature since Wu, Liu and Hsu reported it at Computers and Games in 2004. What none of them publish is the game. The table gives you a FEN and an integer and stops, and the 2004 paper gives a move count. Neither shows the moves in between.',
    },
    {
      kind: 'paragraph',
      text: "So this page is the lines. We generated the tables ourselves with Nguyen Pham's [FelicityEgtb](https://github.com/nguyenpham/FelicityEgtb); that is also the only way to check a published number against anything.",
    },
  ],
  sections: [
    {
      heading: 'The records',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every class below is the attacker against 士象全: a general with both advisors and both elephants, which is the standard full defence. Mate counts are moves, not plies, and both sides play perfectly: the winner mates as fast as the position allows, the loser holds out as long as it can.',
        },
        {
          kind: 'table',
          headers: ['Attacker', 'Longest win', 'Ends in'],
          rows: [
            ['Horse and soldier (马兵)', `[mate in 65](${chapter('horseSoldier')})`, '困毙'],
            ['Two cannons (双炮)', `[mate in 52](${chapter('twoCannons')})`, '困毙'],
            [
              'Chariot with its own full guard, against the same (车仕相全)',
              `[mate in 43](${chapter('chariotGuard')})`,
              'checkmate',
            ],
            ['Cannon and horse (炮马)', `[mate in 36](${chapter('cannonHorse')})`, '困毙'],
            ['Chariot alone (单车)', `[mate in 32](${chapter('chariot')})`, 'checkmate'],
            ['Two horses (双马)', `[mate in 31](${chapter('twoHorses')})`, '困毙'],
            ['Two soldiers (双兵)', `[mate in 22](${chapter('twoSoldiers')})`, '困毙'],
          ],
          wrap: true,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'A lone horse, a lone cannon and a lone soldier cannot win against the full defence at all. That is old knowledge, and the tables have it as a flat draw.',
        },
        {
          kind: 'paragraph',
          text: `Each line is a [chapter in a study](${STUDY}). The chapters have no sidelines and nothing is missing: every other move by the loser reaches a position closer to mate, and every other move by the winner either throws the win away or takes longer. That is what makes the line the longest one.`,
        },
        {
          kind: 'embed',
          path: embed('horseSoldier'),
          title: 'A horse and a soldier against the full guard: mate in 65',
          caption:
            'The longest of the seven, step by step. The other six are the next chapters of the same study.',
          aspect: [702, 700],
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Five of the seven end without a check',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In chess, a stalemated king is a draw, so every longest-mate line ends in checkmate. Xiangqi scores it the other way: a side with no legal move loses. The position is called 困毙, and the loser is usually not in check at all when it happens. By the end of these lines the defence has lost its advisors and elephants, and the general stands alone in the palace with nothing it can legally play.',
        },
        {
          kind: 'paragraph',
          text: 'That is the shape of five of these seven records, including the two longest. Sixty-five moves of manoeuvring, and the finish is a quiet move that takes the last point away.',
        },
        {
          kind: 'embed',
          path: embed('horseSoldier', HORSE_SOLDIER_FINISH_PLY),
          title: 'The last four moves of the mate in 65',
          caption:
            "Four moves from the end. The horse takes the last advisor and swings round to c10 while the black general shuffles between f9 and f10, the red general steps back a square to pass the move, and the horse's quiet move to d8 covers f9 and e10. Black is not in check and has no legal move.",
          aspect: [702, 700],
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The rules the table does not know',
      blocks: [
        {
          kind: 'paragraph',
          text: "A tablebase knows legal positions and moves and nothing else. It has never heard of the repetition law or 自然限着, the rule that draws a game after 60 moves with no capture, so a table's headline number can be a line that could never be played out. That is what happened to chess's famous one: the 549-move mate in the 7-piece tables is drawn by the 50-move rule long before it lands.",
        },
        {
          kind: 'paragraph',
          text: 'These seven are not. We replayed each line against both rules: no position repeats in any of them, and the longest capture-free stretch is 27 moves, in 双炮 and in 车仕相全, well inside the 60-move limit.',
        },
      ],
    },
    {
      heading: 'Checking against the published table',
      blocks: [
        {
          kind: 'paragraph',
          text: "象棋云库's table gives the deepest position in each class with Red to move; ours takes the deepest whoever is to move. Where those are the same question the two agree exactly: two soldiers 43 plies, cannon and soldier 131, horse and soldier 129, cannon and horse 71.",
        },
        {
          kind: 'paragraph',
          text: "A maximum is not automatically a record, though. Cannon and soldier's 131 plies is the deepest number in the whole 士象全 group, but 象棋云库's own API, asked about that position, returns exactly one winning move, a cannon capture of an elephant, with every other move drawn and the position after it scoring 130. It is a capture followed by a 130-ply mate against a defence missing an elephant, which is why cannon and soldier is not in the table above.",
        },
      ],
    },
    {
      heading: 'What is missing',
      blocks: [
        {
          kind: 'paragraph',
          text: "Every class here has one side with nothing but a general and its guard. The interesting case is two attackers against a defence that also keeps material, 车马 against 车士象全 and its neighbours, where neither side is obliged to capture anything. That is where the 60-move rule would actually bite, and where a record might turn out to be unplayable in the way chess's is. It is also about 9 billion indices, which wants a machine with considerably more memory than a laptop.",
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Play through all seven', href: STUDY, emphasis: 'primary' },
            { label: 'The basic endgames', href: '/blog/xiangqi-endgames', emphasis: 'secondary' },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
