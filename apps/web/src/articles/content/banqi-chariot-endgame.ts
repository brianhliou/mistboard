import {
  BANQI_ENDGAME_PARITY_EVEN,
  BANQI_ENDGAME_PARITY_ODD,
  BANQI_ENDGAME_ROOT,
  BANQI_ENDGAME_THUMBNAIL,
} from '../banqi-endgame-diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// A solved banqi ending, chariot and horse against chariot, horse and soldier,
// all face up. Every number comes from the shipped tablebase
// (apps/web/public/tablebase/banqi/v1, built by
// scripts/banqi-tablebase/endgame-table.ts, no draw clock and no repetition
// rule) and is asserted in banqi-endgame-diagrams.test.ts. The "spare move"
// reading is ours, an explanation of the table's moves, not a table fact.
// rebirthfox333's point (40 plies too short for two against three, "90-something
// moves") is from their message to Brian, 2026-10-16
// (docs-private/content/rebirthfox-reply-2026-10-16.md); credited by name with
// Brian's yes, 2026-10-17.
// Research and the literature read: docs-private/research/
// banqi-liangzisan-endgame-2026-10.md. The study is @mistboard's unlisted
// A2yA4Rc2, seeded 2026-10-17 from the same line; its board carries the
// tablebase pane, which is the article's main exhibit (Brian, 2026-10-17:
// "just provide the table base… and then minimal commentary").

const NTU_RULES = 'https://homepage.iis.sinica.edu.tw/~tshsu/tcg/2021/hwks/rules.pdf';
const STUDY = 'A2yA4Rc2';
const STUDY_CHAPTER = '3MnSt1PF';

export const banqiChariotEndgameArticle: Article = {
  slug: 'banqi-chariot-endgame',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'A Solved Banqi Endgame: Chariot and Horse Against Chariot, Horse and Soldier',
  cardTitle: 'A Solved Banqi Endgame',
  seoTitle: 'Banqi Endgame: Chariot and Horse vs Chariot, Horse and Soldier',
  summary:
    'A Mistboard player told us our 40-move draw rule is too short for the endings where three pieces beat two. We solved one: a chariot, horse and soldier beat a chariot and horse in 67 moves, and can’t force a capture in the first 40. The win is in a study, move by move, with the tablebase beside the board.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-30',
  audience: 'Banqi players who reach endgames, and anyone curious how a solved endgame reads.',
  thumbnail: { kind: 'svg', svg: BANQI_ENDGAME_THUMBNAIL },
  readNext: ['banqi', 'banqi-perpetual-chase', 'mistybanqi'],
  tldr: [
    'A player told us our 40-move draw rule is too short for this ending, and the tablebase agrees: red wins in 67 moves with best play, but can’t force a capture in the first 40, so under our rule the game is drawn.',
    'The study plays the win with the tablebase beside the board: every legal move in every position, and whether it wins, draws or loses.',
    'Two chariots alone are decided by whether the steps between them are odd or even, and every other piece is a spare move that flips it. Red has two spare moves to black’s one, and wins by running down black’s.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text:
        'In October rebirthfox333, a [banqi](/rules/banqi) player on Mistboard, told us our draw rule was too short. Mistboard draws a game after 40 moves without a capture or a flip. They pointed to the endings where three pieces beat two, and said the win can take ninety-something moves. If that was true, our rule was turning won games into draws.',
    },
    {
      kind: 'paragraph',
      text:
        'So we solved one of them with a tablebase, a program that works out every position of an ending exactly. Red has a chariot, a horse and a soldier, black has a chariot and a horse, and every piece is face up. A move here is one player’s turn.',
    },
    {
      kind: 'raw-svg',
      svg: BANQI_ENDGAME_ROOT,
      caption: 'Red to move. No position with these pieces gives red a longer win.',
    } as ArticleBlock,
    {
      kind: 'paragraph',
      text: '**The rule is too short. Red wins in 67 moves, but can’t force a capture until move 45.** Our rule draws the game at move 40.',
    },
  ],
  sections: [
    {
      heading: 'The tablebase answers every position',
      blocks: [
        {
          kind: 'embed',
          path: `/embed/study/${STUDY}/${STUDY_CHAPTER}?ply=0&tablebase=1`,
          title: 'Banqi endgame: chariot and horse against chariot, horse and soldier',
          caption: 'Best play for both sides, move by move.',
          aspect: [702, 692],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: `Under the board, the tablebase lists every legal move in the position shown, whether it wins, draws or loses for the side to move (named at the top of the table), and in how many moves. The shaded row is the move the line plays. Hover any row to see its move on the board, or click it to play it and keep going from there. Your moves appear in the move list as a branch under the move you left from, and clicking any of the game’s moves takes you back.`,
        },
      ],
    },
    {
      heading: 'Red wins by running black out of spare moves',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Pieces in banqi move one step along a rank or file, and a piece takes one of equal or lower rank, so two chariots can take each other. Count the steps between them. Every chariot move changes the count by one, and a capture needs a count of one. If it is your move and the count is odd, it is even on every turn your opponent gets, so they can never take you and you can walk toward them. The tablebase agrees for all 992 ways to place two chariots alone.',
        },
        {
          kind: 'svg-row',
          items: [{ svg: BANQI_ENDGAME_PARITY_EVEN }, { svg: BANQI_ENDGAME_PARITY_ODD }],
          caption:
            'Black to move in both. Black loses four steps apart (c2 to f3) and wins three steps apart (c2 to e3).',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'A move by any other piece leaves the count alone and hands the turn over, so it flips who has the odd count. Red has two of these spare moves to black’s one, so red can always answer black’s with one of its own. Red’s plan is to take away black’s spare move, the horse, and that is what takes so long: black’s horse comes off on move 45.',
        },
      ],
    },
    {
      heading: 'A 60-move rule is long enough',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Red needs 45 moves to force a capture, so our 40-move rule draws the game first. A rule set used for computer banqi programs in Taiwan ([PDF](' +
            NTU_RULES +
            ')) allows 60. The longest stretch of the winning line without a capture is 43 moves, so under 60 red can play the win out.',
        },
      ],
    },
    {
      heading: 'The last spare move wins',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'rebirthfox333 was right: our 40-move rule is too short for this ending. Two chariots are decided by the count, and every other piece is a spare move that flips it. Red has two spare moves to black’s one, so red wins. It takes 67 moves because black’s one, the horse, has to be run down first.',
        },
      ],
    },
  ],
};
