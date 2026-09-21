import { JIEQI_PLATFORM_GAME } from '../../jieqi-platform-game.js';
import type { Article, ArticleBlock } from '../types.js';

// Platform page for jieqi, and the source document the Vietnamese co-up page is
// translated from. Written for a player, not an engineer: the replay and the three
// screenshots do the selling, and the copy says what a thing does and stops.
//
// Cut hard on purpose, roughly in half. Every mechanism sentence that survived
// earns its place by answering a question a player would actually ask; the ones
// that explained how the software works were the ones that went.
//
// Facts checked against the code and against prod rather than assumed: three
// casual time controls (registry `timePresetIds`), the lobby lists the bot as
// Pikafish while the analysis panel names the engine PikaJieQi, /analysis has no
// auth gate, jieqi is in STUDY_ELIGIBLE_SPEC_IDS, and /study is a live route
// (/studies is not). Jieqi's spec carries `rated: true` but
// `publicSurface: 'casual'`, so the rating pool exists while games are not
// actually rated: the page promises no ladder.
//
// The opening replay and every figure come from jq_96f40ebb, one 146-ply game the
// engine lost. Keeping them from a single game is deliberate: a reader steps
// through it up top, then meets the same game in the graph and the flip table
// instead of re-orienting each time. Figures are captured from CACHED analysis, so
// a change to JIEQI_ANALYSIS_DEPTH invalidates them (the cache key carries depth)
// and they have to be re-shot. That has already bitten once.

// Text card in the family TITLED_PLAYERS_THUMBNAIL started and CHAMPIONS carried
// on: CJK eyebrow, one English mark, a quieter line under it. Same geometry,
// palette and type colours on purpose.
//
// The mark is English for the reason recorded on the champions card: the reader
// is a chess player who does not read hanzi, and at 158px in the index row a
// second line falls to about 8px, so the one legible thing must be a word they
// can decode. 揭棋 rides above as an eyebrow, saying "Chinese" without needing
// to be read.
//
// The disc row is the departure, and it earns its place: it is the only element
// that says what jieqi IS. Four cards of pure type in one index read as one
// card, and a face-down disc is this game's whole premise. Discs use the board
// renderer's own shrouded fills (#a95f4a red, #2f7d62 black) rather than
// approximations, so the card and the boards inside the article agree.
//
// Not a board: the openings article next to it in the index already shows the
// jieqi start position, and two boards of face-down discs side by side are one
// card twice.
const JIEQI_PLATFORM_THUMBNAIL = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" ',
  'preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" ',
  'aria-label="A card reading Jieqi, every piece face down, over a row of face-down pieces">',
  '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
  '<text x="160" y="52" text-anchor="middle" font-family="\'Noto Sans SC\', ',
  '\'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei\', system-ui, sans-serif" ',
  'font-size="26" font-weight="700" letter-spacing="10" fill="#b9832f" ',
  'opacity="0.5">\u63ed\u68cb</text>',
  '<text x="160" y="108" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="40" font-weight="700" fill="#b9832f">JIEQI</text>',
  '<text x="160" y="138" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="15" font-weight="600" letter-spacing="1.4" fill="#b9832f" opacity="0.62">',
  'EVERY PIECE FACE DOWN</text>',
  ...[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const red = i % 2 === 0;
    return [
      `<circle cx="${64 + i * 32}" cy="172" r="12" `,
      `fill="${red ? '#a95f4a' : '#2f7d62'}" `,
      `stroke="${red ? '#6f342c' : '#174536'}" stroke-width="2"/>`,
    ].join('');
  }),
  '</svg>',
].join('');

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
  audience: 'Jieqi players looking for somewhere to play and review their games.',
  thumbnail: { kind: 'svg', svg: JIEQI_PLATFORM_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text:
        'Jieqi is [xiangqi](/rules/xiangqi) with every piece face-down. A piece moves as whatever normally starts on its square, then flips and keeps that identity for the rest of the game. You begin without knowing what anything is, including your own pieces. The [rules page](/rules/jieqi) has the details.',
    },
    {
      kind: 'paragraph',
      text:
        'It is a young game, out of Hong Kong and Guangdong, and it has spread over the last couple of decades mostly among Chinese and Vietnamese players. For what to actually open with, see [what strong players believe about the opening](/blog/jieqi-openings).',
    },
    {
      // A reader who arrived from a "play jieqi" search wants a board, not an
      // argument. Everything below still earns its place for whoever scrolls; it
      // should not be the toll they pay to reach a button.
      kind: 'cta',
      buttons: [
        { label: 'Play the engine', href: '/?play=computer&gameSpecId=jieqi', emphasis: 'primary' },
        { label: 'Play a friend', href: '/?play=friend&gameSpecId=jieqi', emphasis: 'secondary' },
      ],
    },
    {
      kind: 'jieqi-replay',
      spec: {
        red: JIEQI_PLATFORM_GAME.red,
        black: JIEQI_PLATFORM_GAME.black,
        event: JIEQI_PLATFORM_GAME.event,
        outcome: JIEQI_PLATFORM_GAME.outcome,
        resultText: JIEQI_PLATFORM_GAME.result,
        deal: JIEQI_PLATFORM_GAME.deal,
        moves: JIEQI_PLATFORM_GAME.moves,
        perspective: 'black',
      },
      caption:
        'Plain discs are still face-down. Each one turns over the first time it moves and is stuck with whatever it turns out to be.',
    } as ArticleBlock,
    {
      kind: 'paragraph',
      text:
        'That is [a real game on this site](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf), not a demo, and every screenshot below comes from it.',
    },
    {
      kind: 'paragraph',
      text:
        'Play the engine at 1+1, 3+2 or 5+5, or send a friend a link. Free, no sign-up, nothing to install.',
    },
  ],
  sections: [
    {
      heading: 'Review your games',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Ask for analysis on a finished game and the review separates what you chose from what you drew, which is the part a chess site has no reason to do. You also get the usual: a graph of the whole game, an accuracy score for each player, and every inaccuracy, mistake and blunder marked with the move that was better. It runs on our servers and takes a few minutes.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/jieqi-accuracy-summary.png',
          alt: 'A game summary: the advantage graph swinging back and forth across the game, beside accuracy cards reading Pikafish 86 percent with thirteen inaccuracies, two mistakes and one blunder, and Guest 91 percent with six inaccuracies, two mistakes and one blunder.',
          caption: 'The game above, graded.',
        } as ArticleBlock,
        { kind: 'sub-heading', text: 'It tells you how lucky each flip was' },
        {
          kind: 'paragraph',
          text:
            'Half your moves turn a piece over, and you never know what you are turning over. So the engine works out what each piece that tile could have been would have been worth, and compares it to what you actually got. The gap is your luck on that flip.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/jieqi-reveal-candidates.png',
          className: 'article-figure--tall',
          alt: 'A jieqi review move list. Move 19 is a flip carrying a dice badge reading minus 21 percent, above four ranked candidate moves at 52, 39, 34 and 29 percent with the played move marked second. Move 21 carries plus 43 percent, move 21 for black plus 6 percent, and move 22 minus 10 percent.',
          caption:
            'Move 19 played the 39% move when 52% was there, so it is marked. Move 21 played the best one and still got a +43% gift from the flip.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'The percentage on each move is what it was worth before you flipped, averaged over every piece that tile could have been. The dice is what the flip actually gave you on top of that. So a move can be the best choice available and still come with a large plus or minus beside it: the first number is your decision, the second is the draw.',
        },
        {
          kind: 'paragraph',
          text:
            'When your move is the top one, you chose well. Moves are only marked as mistakes when a better one was on the list.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'Your accuracy is then built from the choices alone, so a lucky flip cannot flatter it and an unlucky one cannot spoil it.',
        },
        { kind: 'sub-heading', text: 'And it runs in your browser' },
        {
          kind: 'paragraph',
          text:
            'The analysis board runs the same engine on your own machine, drawing its best moves on the board as you try a line. Nothing is queued, nothing is sent anywhere, and it needs no account. [The engine is open source](https://github.com/brianhliou/pikafish-jieqi-wasm), so if a number here looks wrong you can go and read the code that produced it.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/jieqi-local-engine.png',
          alt: 'The analysis board with the local engine switched on: PikaJieQi at depth 18 and 335,000 nodes per second, three candidate lines each with an evaluation, and arrows for each drawn on the jieqi board.',
          caption: 'Running in a browser tab.',
        } as ArticleBlock,
        {
          kind: 'cta',
          buttons: [
            { label: 'Open the analysis board', href: '/analysis/jieqi', emphasis: 'primary' },
          ],
        },
      ],
    },
    {
      heading: 'The engine',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'PikaJieQi is a fork of [Pikafish](https://github.com/official-pikafish/Pikafish), the open-source xiangqi engine, on its jieqi branch. Classical alpha-beta search with a hand-written evaluation and no neural network. What makes it a jieqi engine rather than a xiangqi one is that it treats every face-down piece as a chance node, scoring a move as the average over each piece that tile could still be. It only ever sees the face-down board, and a test fails the build if a hidden identity ever leaks into what it is sent.',
        },
        {
          kind: 'paragraph',
          text:
            'It is beatable, and the game at the top of this page is one it lost. You can watch it play itself in [these engine games](/study/wd6c7qvG). Almost all of modern Pikafish\'s strength lives in its neural network and jieqi has no good one: we trained a net and it never came out stronger than the hand-written evaluation, so this is an open problem rather than a chore nobody got round to. If you train nets, or know jieqi well enough to say where its judgement goes wrong, that is the help we would most like; the terms of the open challenge, and the prebuilt engine to beat, are at [brianhliou.com/challenges](https://brianhliou.com/challenges/).',
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
          headers: ['', 'On Mistboard'],
          rows: [
            ['Play the engine or a friend', 'Free, no account'],
            ['Full-game analysis', 'Every finished game'],
            ['Luck measured separately', 'Every flip priced'],
            ['Engine in your browser', 'No queue, no account'],
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
                'Xiangqi with every piece except the general face-down. A piece moves as whatever normally starts on its square, then turns over and keeps that identity. It is called cờ úp in Vietnamese and 揭棋 in Chinese.',
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
                'Reasonably, not brilliantly. Ours is beatable by a strong human, mainly because jieqi has no good neural network yet: we trained one and it never came out stronger than the hand-written evaluation.',
            },
            {
              question: 'Can the engine see my hidden pieces?',
              answer:
                'No. It gets the same face-down board you do and is never told the deal. A test fails the build if an identity ever leaks into what it is sent.',
            },
            {
              question: 'Is the shuffle fair?',
              answer:
                'The deal is random, made on the server, and told to nobody: not you, not your opponent, not the engine.',
            },
            {
              question: 'Where can I play jieqi online for free?',
              answer:
                'Here, against the engine or a friend. No account, nothing to install, and you can review the game with engine analysis afterwards.',
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
              href: '/?play=computer&gameSpecId=jieqi',
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
