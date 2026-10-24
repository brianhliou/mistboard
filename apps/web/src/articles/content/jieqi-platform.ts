import type { Locale } from '../../i18n/locale.js';
import { textCard } from '../text-card.js';
import { JIEQI_GRADE_EXAMPLES, JIEQI_LUCK_EXAMPLES } from './jieqi-platform-marks.js';
import type { Article } from '../types.js';

// The platform introduction is also the structural source for /blog/co-up.
// Keep its translated dictionaries in sync. Game screenshots use the same public game;
// separate close-ups illustrate the badge palette. Fresh analysis is computed from its public deal, never old caches
// that predate the hidden-information boundary.

// Text card (text-card.ts) with one departure: the disc row, the only element
// that says what jieqi IS. Four cards of pure type in one index read as one card,
// and a face-down disc is this game's whole premise. Discs use the board
// renderer's own shrouded fills (#a95f4a red, #2f7d62 black) so the card and the
// boards inside the article agree.
//
// Not a board: the openings article next to it in the index already shows the
// jieqi start position, and two boards of face-down discs side by side are one
// card twice.
const JIEQI_DISC_ROW = [0, 1, 2, 3, 4, 5, 6]
  .map((i) => {
    const red = i % 2 === 0;
    return [
      `<circle cx="${64 + i * 32}" cy="172" r="12" `,
      `fill="${red ? '#a95f4a' : '#2f7d62'}" `,
      `stroke="${red ? '#553025' : '#174536'}" stroke-width="2"/>`,
    ].join('');
  })
  .join('');

const JIEQI_PLATFORM_THUMBNAIL = (locale?: Locale): string =>
  textCard(
    {
      palette: 'xiangqi',
      eyebrow: 'XIANGQI',
      lead: 'JIEQI',
      tagline: 'HIDDEN PIECES, OPEN BOARD',
      art: JIEQI_DISC_ROW,
      ariaLabel: 'A Jieqi card with a row of face-down pieces',
    },
    locale,
  );

export const jieqiPlatformArticle: Article = {
  slug: 'jieqi-platform',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Jieqi on Mistboard',
  seoTitle: 'Play Jieqi Online, with Engine Analysis',
  summary:
    'Play jieqi against the engine or a friend, free and without an account, then review the game with analysis that separates your choices from your luck.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-03',
  updatedAt: '2026-10-19',
  updateNote:
    'Rewritten as a guide to playing and reviewing jieqi here.',
  tldr: [
    'Play Level 1 or invite a friend, with no account needed for casual games.',
    'Full-game analysis grades your moves and measures reveal luck separately.',
    'Sign in to request full-game analysis, then try different moves from your own game.',
  ],
  audience: 'Jieqi players looking for somewhere to play and review their games.',
  thumbnail: { kind: 'svg', svg: JIEQI_PLATFORM_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Play jieqi against a computer or a friend, then review the game to see where your decisions helped and where the flips went your way.',
    },
    {
      kind: 'cta',
      buttons: [
        { label: 'Play the engine', href: '/?play=computer&gameSpecId=jieqi&engineId=pikafish-jieqi-level-1', emphasis: 'primary' },
        { label: 'Play a friend', href: '/?play=friend&gameSpecId=jieqi', emphasis: 'secondary' },
      ],
    },
    {
      kind: 'paragraph',
      text: 'Start with Level 1 and choose your pace in setup. To play a friend, create a room, click **Copy invite**, and send them the link. Casual games need no account.',
    },
    {
      kind: 'embed',
      path: '/embed/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf?ply=0&pov=black',
      title: 'Jieqi: a guest beats Pikafish in 73 moves',
      aspect: [702, 696],
      caption: 'Step through a real game. Plain discs are still face-down; a piece reveals its identity the first time it moves.',
    },
    {
      kind: 'paragraph',
      text: 'Open [the full review](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf) to play through alternative moves. New to jieqi? Read the [rules](/rules/jieqi), or explore [how strong players approach the opening](/blog/jieqi-openings).',
    },
  ],
  sections: [
    {
      heading: 'Review your games',
      blocks: [
        {
          kind: 'paragraph',
          text: 'This brings Lichess-style engine review to a game with hidden pieces and luck. We adapt [Lichess’s accuracy and move-grading methods](https://lichess.org/page/accuracy) to jieqi, measuring the quality of your decisions separately from what each reveal gave you.',
        },
        { kind: 'sub-heading', text: '1. Finish a game and open Review game' },
        {
          kind: 'paragraph',
          text: 'When a game ends, click **Review game** below the move list. You can step through the whole game, revisit a position, and try a different continuation.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/jieqi-review-finish.png',
          darkSrc: '/article-thumbs/jieqi-review-finish-dark.png',
          alt: 'The finished Jieqi game with the Review game button below the result.',
          caption: 'The game above has ended. Review game opens its replay and analysis page.',
        },
        { kind: 'sub-heading', text: '2. Request computer analysis' },
        {
          kind: 'paragraph',
          text: 'Open the **Computer analysis** tab, then click **Request computer analysis**. Sign in to request a new analysis; anyone can read one that is already available. It may take a few minutes to finish.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/jieqi-review-request.png',
          darkSrc: '/article-thumbs/jieqi-review-request-dark.png',
          alt: 'The Jieqi review page with its Computer analysis tab and Request computer analysis button.',
          caption: 'Request analysis once to get a graph, accuracy scores, and move annotations.',
        },
        { kind: 'sub-heading', text: '3. Find the moves to learn from' },
        {
          kind: 'paragraph',
          text: 'The graph shows how the game changed. Each player gets an accuracy score, and inaccuracies, mistakes, and blunders are marked in the move list. Select a marked move to see the better move the engine recommends.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/jieqi-review-analysis.png',
          darkSrc: '/article-thumbs/jieqi-review-analysis-dark.png',
          alt: 'The analysed Jieqi game, showing the advantage graph, player accuracy, and marked moves.',
          caption: 'One game, graded move by move. Click the graph or move list to revisit a turning point.',
        },
        { kind: 'sub-heading', text: 'Good decisions and lucky flips are different' },
        {
          kind: 'paragraph',
          text: 'A move can be a good choice and still reveal an unlucky piece. The move-quality glyph grades your choice before the reveal. The die badge shows how much better or worse the revealed piece was than the pieces you could have drawn.',
        },
        JIEQI_GRADE_EXAMPLES,
        {
          kind: 'paragraph',
          text: 'Violet dice mean an unlucky reveal, grey means close to the expected outcome, and teal means lucky. More pips and a deeper colour mean a bigger swing.',
        },
        JIEQI_LUCK_EXAMPLES,
        {
          kind: 'image-figure',
          src: '/article-thumbs/jieqi-review-marks.png',
          darkSrc: '/article-thumbs/jieqi-review-marks-dark.png',
          alt: 'A Jieqi position with a move-quality glyph and a reveal-luck die badge beside the moved piece, plus advice for a better move.',
          caption: 'The glyph judges the decision; the die describes the reveal. Both appear by the piece and in the move list.',
        },
        {
          kind: 'paragraph',
          text: 'When a different move was significantly better, the review shows that best move as advice. You can turn on alternatives to explore more candidates. Your accuracy measures the choices alone, so a lucky flip cannot flatter it and an unlucky one cannot spoil it.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/jieqi-review-mobile.png',
          darkSrc: '/article-thumbs/jieqi-review-mobile-dark.png',
          className: 'article-figure--tall',
          alt: 'The same Jieqi review on a phone, with move-quality and reveal-luck annotations.',
          caption: 'The same decision and luck marks on a phone.',
        },
        { kind: 'sub-heading', text: 'Try a different line from your game' },
        {
          kind: 'paragraph',
          text: 'Return to a position in your review and play a different move on the board. Your variation appears alongside the original game. Switch on the browser engine to compare continuations from that position, with no server queue. You are exploring the game you just played, with its actual reveals.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/jieqi-review-variation.png',
          darkSrc: '/article-thumbs/jieqi-review-variation-dark.png',
          alt: 'A variation from the finished Jieqi game, with the browser engine enabled in its review.',
          caption: 'Try an alternative from your own game and compare it with the original continuation.',
        },
      ],
    },
    {
      heading: 'The engine',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Pikafish has eight levels. The seven easier levels limit its search and let it choose weaker moves; Level 8 uses the full search budget. We measure the steps by playing the bots against one another and against a random-move baseline. [How we built the ladder](/blog/jieqi-bot-wins) explains the levels.',
        },
        {
          kind: 'paragraph',
          text: '[AB-JChess](/bot/ab-jchess) earned its place above Pikafish by winning their 400-game match, 248 to 136. [Read about that champion](/blog/ab-jchess), or see the [current bots and ratings](/bots) for the latest challengers. Every bot plays from the information its side is allowed to see; it is never given the hidden deal.',
        },
      ],
    },
    {
      // A summary belongs after the substance and before the objections: the
      // reader has seen the claims made and is about to ask what is missing.
      // Under 'Start playing' it sat between the reader and the buttons.
      heading: 'What you get',
      blocks: [
        {
          // Deliberately no competitor named. The claims are about what this site
          // does; a table asserting what someone else lacks would need checking
          // every time they ship, and would be wrong before anyone noticed.
          kind: 'table',
          wrap: true,
          headers: ['', 'On Mistboard'],
          rows: [
            ['Play the engine or a friend', 'Free, no account'],
            ['Full-game analysis', 'Sign in to request; available to all to read'],
            ['Luck measured separately', 'Every flip priced'],
            ['Explore your own games', 'Browser engine, no queue'],
            ['Studies with your own deals', 'Yes'],
            ['Open-source engine', 'Yes'],
            ['Rated ladder', 'Open, signed in'],
          ],
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
              question: 'What is jieqi?',
              answer:
                'Xiangqi with every piece except the general face-down. A piece moves as whatever normally starts on its square, then turns over and keeps that identity. It is also known as cờ úp in Vietnamese.',
            },
            {
              question: 'How is jieqi different from xiangqi?',
              answer:
                'Same board, same pieces, same moves, same goal. You just do not know which piece is which, so about half your moves flip one over and find out.',
            },
            {
              question: 'Is jieqi just luck?',
              answer:
                'The flips are random; what you do with them is not. Your accuracy score is built only from your choices, so a good draw cannot flatter it and a bad one cannot spoil it.',
            },
            {
              question: 'Can a computer play jieqi well?',
              answer:
                'Yes. Mistboard offers a range of bot strengths, from beginner levels to strong engines. Start with Level 1, then choose a harder opponent as you improve.',
            },
            {
              question: 'Can the engine see my hidden pieces?',
              answer:
                'No. It receives only the information its side is allowed to see. It is never told the hidden deal.',
            },
            {
              question: 'Is the shuffle fair?',
              answer:
                'The deal is random, made on the server, and told to nobody: not you, not your opponent, not the engine.',
            },
            {
              question: 'Where can I play jieqi online for free?',
              answer:
                'Here, against the engine or a friend. Casual games need no account and nothing to install. You can replay finished games freely; sign in to request full-game engine analysis.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Start playing',
      blocks: [
        {
          kind: 'cta',
          buttons: [
            {
              label: 'Play the engine',
              href: '/?play=computer&gameSpecId=jieqi&engineId=pikafish-jieqi-level-1',
              emphasis: 'primary',
            },
            { label: 'Play a friend', href: '/?play=friend&gameSpecId=jieqi', emphasis: 'secondary' },
            { label: 'Read the rules', href: '/rules/jieqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
