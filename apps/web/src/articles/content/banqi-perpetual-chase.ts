import {
  BANQI_CHASE_BACK_AND_FORTH_STEPS,
  BANQI_CHASE_CYCLE_STEPS,
  BANQI_CHASE_HERD_END,
  BANQI_CHASE_HERD_START,
  BANQI_CHASE_THUMBNAIL,
} from '../banqi-chase-diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// How banqi rules a perpetual chase (長捉), and Mistboard's rule. The game
// numbers come from replaying every counted banqi game (127, 2026-07-16 to
// 2026-10-09, all against MistyBanqi) through the kernel; the source quotes
// were re-opened on 2026-10-09. The boards replay real games (or, for the
// four-square cycle, a constructed position) and their test asserts each
// caption's claim. The "rule in full" table mirrors the "Perpetual chase"
// comment in packages/game/src/variants-banqi.ts; change both together.

const HSU_2019 = 'https://homepage.iis.sinica.edu.tw/~tshsu/tcg/2019/hwks/rules.pdf';
const ICGA_2010 = 'https://homes.cs.washington.edu/~armin/ICGA2010.pdf';
const ANQI2 = 'https://play.google.com/store/apps/details?id=com.xidea.ChineseDarkChess2&hl=zh_TW';
const FUNTOWN = 'https://darkchess.funtown.com.tw/rules2.html';
const ZHWIKI_ANQI = 'https://zh.wikipedia.org/zh-tw/%E6%9A%97%E6%A3%8B';
const ZHWIKI_CHANGDA = 'https://zh.wikipedia.org/wiki/%E9%95%B7%E6%89%93_(%E8%B1%A1%E6%A3%8B)';

// The finished games on Mistboard, by room id. DRAW_* are the eight repetition
// draws in date order; HERD is the herding chase in the paired diagram.
const game = (roomId: string) => `/banqi/game/${roomId}`;
const DRAW_0721 = game('bq_15a9801b-7f1b-4618-81ff-33c243adeead');
const DRAW_0723 = game('bq_65458fb8-71d2-4e4c-86ca-823057fc9ac2');
const DRAW_0728 = game('bq_1a550b3b-40b7-4184-86f4-16c479b926df');
const DRAW_0916_A = game('bq_8dbdd7ac-6612-4785-a7d9-73c0a0987e5e');
const DRAW_0916_B = game('bq_f7bc7130-e399-4a00-9609-baee9cad719f');
const DRAW_0916_C = game('bq_391b54b2-eb4f-4a21-9ed0-f934aa4772cd');
const DRAW_0922 = game('bq_374af1fe-bb55-462d-a3d7-54970fd03f64');
const DRAW_1002 = game('bq_879c07b6-b804-4a21-9d46-39febc900b90');
const HERD_0930 = game('bq_795ec889-96d0-48f4-914f-6f1db438441a');

export const banqiPerpetualChaseArticle: Article = {
  slug: 'banqi-perpetual-chase',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'The Perpetual Chase Rule in Banqi',
  cardTitle: 'Perpetual Chase in Banqi',
  seoTitle: 'Perpetual Chase Rule in Banqi (Chinese Dark Chess)',
  summary:
    'In banqi a chased piece often has one safe square, so a chase can go back and forth until the position repeats, and under plain threefold repetition the chaser alone decides the draw. Tournament rules allow it and apps cap the chase at 7 or 10 moves. Mistboard forbids the chase move that would repeat a position a third time, and leaves chases that go somewhere alone.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-12',
  audience:
    'Banqi players, and anyone who runs a banqi site, app, club or tournament and has to rule on perpetual chases.',
  thumbnail: { kind: 'svg', svg: BANQI_CHASE_THUMBNAIL },
  readNext: ['banqi', 'banqi-statistics', 'mistybanqi'],
  tldr: [
    'In a perpetual chase one piece attacks another move after move. In banqi the runner often has one safe square, so the two go back and forth until the position repeats.',
    'The runner can’t stay put without being taken, so under plain threefold repetition the chaser alone decides whether the game is drawn.',
    'Mistboard forbids the chase move that would make a position appear for the third time. A chase that drives its target onto new squares never repeats, and the rule leaves it alone.',
    'Tournament rules draw on repetition, and apps cap a chase at 7 or 10 moves, which comes after the repetition in every chase draw we have seen.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text:
        'A perpetual chase is one piece attacking another move after move while the other keeps running. In [banqi](/rules/banqi), Chinese dark chess, the runner often has a single safe square, so the two pieces go back and forth until the position repeats. Whether that should be a draw, and who gets to decide, is a question banqi rule sets answer in different ways.',
    },
  ],
  sections: [
    {
      heading: 'Why banqi needs a chase rule',
      blocks: [
        {
          kind: 'paragraph',
          text:
            `In chess a threefold repetition needs both players to keep repeating, and either of them can play something else. In banqi the chased piece can’t stay put without being taken, so it runs. With one safe square it shuttles back and forth as the chaser does, and the third repetition comes when the chaser wants it. In [the game below](${DRAW_0916_C}) the player was far ahead and the bot had lost its general, so the draw saved the bot.`,
        },
        {
          kind: 'raw-svg-stepper',
          gameSpecId: 'banqi',
          steps: BANQI_CHASE_BACK_AND_FORTH_STEPS,
          caption: 'Back and forth on two squares, from a game on Mistboard, 16 September 2026.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'A repeating chase can also go round a square of four. The chased piece runs round the corner, the chaser follows one step behind, and the board comes back every eight plies.',
        },
        {
          kind: 'raw-svg-stepper',
          gameSpecId: 'banqi',
          steps: BANQI_CHASE_CYCLE_STEPS,
          caption:
            'Round a square of four, in a constructed position. Every time the chariot runs it has one safe square.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Herding chases are fine',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Some chases drive the target somewhere. Every move puts the target on a square it hasn’t stood on, so no position comes round again, and the chase ends when the target runs out of room or into another piece.',
        },
        {
          kind: 'svg-row',
          items: [{ svg: BANQI_CHASE_HERD_START }, { svg: BANQI_CHASE_HERD_END }],
          caption:
            'From a game on Mistboard, 30 September 2026. The player’s general chased the bot’s advisor five times, from b2 to f3, where the player’s other advisor took it.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: `Winning a piece this way, as in [that game](${HERD_0930}), is ordinary good play. A chase rule has to stop the repeating chase and leave this one alone.`,
        },
      ],
    },
    {
      heading: 'What other rules say',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Four rule sets and a reference work, as read in October 2026.',
        },
        {
          kind: 'table',
          wrap: true,
          headers: ['Source', 'Perpetual chase', 'No-progress draw'],
          rows: [
            [
              `[TCGA computer banqi rules, Hsu (2019)](${HSU_2019})`,
              'No chase rule. A position repeated three times draws.',
              '60 plies',
            ],
            [
              `[Chen, Shen and Hsu, ICGA Journal (2010)](${ICGA_2010})`,
              'No chase rule. Repeated positions draw.',
              '40 plies',
            ],
            [
              `[Chinese Dark Chess 2 app (Google Play)](${ANQI2})`,
              'No chasing the same piece more than 7 times in a row.',
              '40 plies',
            ],
            [
              `[FunTown app](${FUNTOWN})`,
              'No chasing the same piece 10 times in a row.',
              '50 plies',
            ],
            [
              `[Chinese Wikipedia, banqi](${ZHWIKI_ANQI})`,
              'Not mentioned.',
              '50 moves with no flip or capture',
            ],
            [
              'Mistboard',
              'A chase move may not make a position appear for the third time.',
              '40 plies',
            ],
          ],
          highlightRows: [5],
        },
        {
          kind: 'paragraph',
          text: `A rule that makes the chaser lose comes from [xiangqi](/rules/xiangqi), where every piece is face up. Under the Asian rules for that game, chasing one piece without end is a forbidden move, and a side that keeps playing one must change it or lose, as [Chinese Wikipedia sets out](${ZHWIKI_CHANGDA}). None of the banqi sources above makes the chaser lose.`,
        },
      ],
    },
    {
      heading: 'Mistboard’s rule',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Mistboard keeps threefold repetition and the 40-ply no-progress draw, and adds one rule: **a chase move may not make a position appear for the third time.** The chaser has to play something else, unless it has no other legal move. A repetition that comes from anything other than a chase still draws.',
        },
        {
          kind: 'sub-heading',
          text: 'Why not a move count',
        },
        {
          kind: 'paragraph',
          text:
            'The apps count instead: once a piece has chased the same piece 7 times in a row, or 10, it must stop. The trouble is that the repetition comes first. In the two-square game above, the position came round a third time on the bot’s fourth chase move. A 7-move cap would still have allowed three more, so with threefold repetition in force the game is drawn exactly as before. In all eight repetition draws on Mistboard, the third repetition came between the third and sixth chase move, before either cap.',
        },
        {
          kind: 'paragraph',
          text:
            'A count also treats a herding chase the same way, and stops it at the same number whether or not the target is about to run out of room. Players don’t agree on the number either. A Taiwanese player who wrote to us about one of these draws called a perpetual chase a clear foul and the count an open question: 7 is too few, he said, and a friend of his plays to 12.',
        },
        {
          kind: 'sub-heading',
          text: 'Why not make the chaser lose',
        },
        {
          kind: 'paragraph',
          text:
            'Making the chaser lose, as xiangqi does, needs someone to judge what counts as a chase, and no banqi source uses it. Repetition needs no number and no judge. It stops a repeating chase at the repeat and leaves a chase that goes somewhere alone.',
        },
      ],
    },
    {
      heading: 'The rule in full',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'For anyone implementing it. The rule reads only what both players can see, so it works online or across a table.',
        },
        {
          kind: 'table',
          wrap: true,
          keyColumn: true,
          headers: ['Term', 'Meaning'],
          rows: [
            [
              'Chase move',
              'A move with no flip or capture, after which the moved piece could capture the enemy piece that moved just before it. Cannon jumps count; whether the target is protected doesn’t matter.',
            ],
            ['Flee', 'A move by the piece the previous move chased.'],
            [
              'Position',
              'Where each face-up piece stands, which squares hold face-down tiles, and whose move it is. Counts start over after every flip or capture.',
            ],
            ['Forbidden', 'A chase move that would make a position appear for the third time.'],
            [
              'Repetition draw',
              'A position reached by any move other than a chase or a flee draws on its third appearance.',
            ],
            ['Only move', 'If every legal move is a forbidden chase, they all stay legal.'],
            [
              'Mutual chase',
              'A flee that also attacks the chaser is an ordinary move. Only two cannons on one line can do this.',
            ],
            ['No-progress draw', 'Unchanged: 40 plies with no flip or capture, chase moves included.'],
            ['Not covered', 'A chaser switching between two targets. We will extend the rule if it comes up.'],
          ],
        },
      ],
    },
    {
      heading: 'Before the rule',
      blocks: [
        {
          kind: 'paragraph',
          text: `Until October 2026 Mistboard drew every threefold repetition. In 127 games people played against [MistyBanqi](/blog/mistybanqi), our bot, from July to early October, eight ended in a repetition draw, and the bot was the chaser in every one ([21 July](${DRAW_0721}), [23 July](${DRAW_0723}), [28 July](${DRAW_0728}), 16 September [three](${DRAW_0916_A}) [times](${DRAW_0916_B}) [over](${DRAW_0916_C}), [22 September](${DRAW_0922}), [2 October](${DRAW_1002})). Replayed under the current rule, none of the eight is a draw, and no move a person played in any of the 127 games would have been forbidden.`,
        },
      ],
    },
    {
      heading: 'Common questions',
      blocks: [
        {
          kind: 'faq',
          items: [
            {
              question: 'Is a perpetual chase a draw in banqi?',
              answer:
                'It depends on the rule set. Tournament rules for computer banqi draw any position repeated three times, so a chase that repeats is a draw. On Mistboard it never is: the chase move that would bring a position round a third time is forbidden, and the chaser has to play something else.',
            },
            {
              question: 'How many times can you chase a piece in banqi?',
              answer:
                'Two popular apps set a cap: Chinese Dark Chess 2 at 7 chases of the same piece in a row, FunTown at 10. Mistboard has no count. A chase can run as long as it reaches new positions; only the move that would repeat a position a third time is forbidden.',
            },
            {
              question: 'What counts as a chase in banqi?',
              answer:
                'On Mistboard, a move with no flip or capture after which the moved piece could capture the enemy piece that moved just before it. Cannon jumps count, and it doesn’t matter whether the target is protected.',
            },
            {
              question: 'Does the chaser lose in banqi?',
              answer:
                'Not in any banqi rule set we found, and not on Mistboard. Losing for a perpetual chase comes from xiangqi, where someone has to judge what counts as a chase. On Mistboard the repeating move is simply not allowed.',
            },
          ],
        } as ArticleBlock,
      ],
    },
    {
      heading: 'How a chase ends',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'On Mistboard a chase can run as long as it is getting somewhere, and a good one wins a piece. What it can’t do is go round in a circle until the game is drawn: the move that would bring a position back a third time is off the table, so the chaser has to try something else, and the game goes on.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Play Banqi', href: '/?play=computer&gameSpecId=banqi', emphasis: 'primary' },
            { label: 'Banqi rules', href: '/rules/banqi', emphasis: 'secondary' },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
