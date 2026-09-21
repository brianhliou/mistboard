import type { Article } from '../types.js';

// Platform page for Pikafish: the page a "皮卡鱼在线 / play pikafish online"
// search lands on. Growth plan §5 lane 0 (2026-09-20). Bing's own keyword tool
// puts 皮卡鱼 at 35K impressions a quarter, 33K of them mainland, and the
// autocomplete tree spells the product out: 在线对弈, 人机对弈, 免费版, 网页版,
// 揭棋界面调用皮卡鱼揭棋引擎. zh-Hans is this page's primary reader; the English
// is the source the dictionaries substitute into (article-i18n.ts).
//
// Four sites already serve "analyze with Pikafish in a browser" (xiangqiai.com,
// ai.pikafish.org, xiangqi.freetools.me, pikafish.com's own web build), so the
// headline is PLAYING it, at a level you choose, and at jieqi, which is rare
// in a browser. Analysis is one section, worded honestly: finished xiangqi
// games are reviewed by Pikafish on the server (xiangqi-analysis.ts,
// pikafish-xiangqi-analysis pool); the live /analysis board runs Fairy-Stockfish
// in the browser; jieqi analysis runs pikafish-jieqi in the browser.
//
// Facts checked against prod on 2026-09-20: /api/bots lists `pikafish`
// (engine pikafish-xiangqi-level-8, xiangqi + jieqi) above eight Fairy-Stockfish
// levels; /bot/pikafish is live and its play button creates the game with no
// setup dialog; /analysis/xiangqi and /analysis/jieqi are in the catalog.
//
// Same text-card thumbnail family as jieqi-platform and the champions card:
// CJK eyebrow, one English mark, a quieter line. The eyebrow is 皮卡鱼 because
// that is the word the reader searched.
const PIKAFISH_THUMBNAIL = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" ',
  'preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" ',
  'aria-label="A card reading Pikafish, play it in your browser">',
  '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
  '<text x="160" y="62" text-anchor="middle" font-family="\'Noto Sans SC\', ',
  '\'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei\', system-ui, sans-serif" ',
  'font-size="26" font-weight="700" letter-spacing="10" fill="#b9832f" ',
  'opacity="0.5">皮卡鱼</text>',
  '<text x="160" y="118" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="40" font-weight="700" fill="#b9832f">PIKAFISH</text>',
  '<text x="160" y="150" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="15" font-weight="600" letter-spacing="1.4" fill="#b9832f" opacity="0.62">',
  'PLAY IT IN YOUR BROWSER</text>',
  '</svg>',
].join('');

export const pikafishArticle: Article = {
  slug: 'pikafish',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Pikafish on Mistboard',
  seoTitle: 'Play Pikafish Online: Free Xiangqi Engine, No Download',
  summary:
    'Play Pikafish, the strongest open-source xiangqi engine, in your browser. Free, no account, no download. Choose a level, play it at jieqi, and review your games with it.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-20',
  audience: 'Xiangqi players looking for somewhere to play or analyze with Pikafish.',
  thumbnail: { kind: 'svg', svg: PIKAFISH_THUMBNAIL },
  readNext: ['jieqi-platform', 'skill-vs-luck', 'jieqi-openings'],
  intro: [
    {
      kind: 'paragraph',
      text:
        '[Pikafish](https://github.com/official-pikafish/Pikafish) is the strongest open-source xiangqi engine, built from Stockfish for the Chinese board. Most people run it from a download and a separate interface. Here it runs in the page.',
    },
    {
      kind: 'paragraph',
      text:
        'Play it as it comes or start lower on an eight-level ladder, play it at jieqi, or hand it a finished game to review. Free, no sign-up, nothing to install, and it works on a phone.',
    },
    {
      kind: 'cta',
      buttons: [
        { label: 'Play Pikafish', href: '/bot/pikafish', emphasis: 'primary' },
        {
          label: 'Play Pikafish at jieqi',
          href: '/?play=computer&gameSpecId=jieqi',
          emphasis: 'secondary',
        },
      ],
    },
  ],
  sections: [
    {
      heading: 'Play against Pikafish',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'One click on the [Pikafish page](/bot/pikafish) starts a game. You get a colour, a clock, and Pikafish on the other side, searching three million positions a move. No account needed.',
        },
        {
          kind: 'paragraph',
          text:
            'Three million positions a move is a lot. Below Pikafish sits an eight-level ladder of Fairy-Stockfish bots, level 1 for someone who learned the moves this week, level 8 close to the top. Every level has a measured rating from playing the others, anchored at 1500 to an engine that picks random legal moves.',
        },
        {
          // The one number nobody else publishes: the ladder's measured ratings.
          // From /api/bots on 2026-09-21 (xiangqi, EvE anchor, source
          // random-legal-xiangqi at 1500). Re-read the endpoint when the ladder
          // is re-anchored; the caption carries the date so a stale table is
          // visibly stale rather than silently wrong.
          kind: 'table',
          headers: ['Opponent', 'Rating on the ladder'],
          rows: [
            ['Fairy-Stockfish level 1', '1637'],
            ['Fairy-Stockfish level 4', '1922'],
            ['Fairy-Stockfish level 8', '2304'],
            ['Pikafish', '2334'],
          ],
          caption:
            'Measured September 2026 from engine-versus-engine games on the site. Pikafish at three million positions a move.',
        },
        {
          kind: 'paragraph',
          text:
            'Every level is on the [bots page](/bots). Pick one from the [play menu](/?play=computer&gameSpecId=xiangqi), win a few games there, and move up.',
        },
      ],
    },
    {
      heading: 'Pikafish at jieqi',
      blocks: [
        {
          kind: 'paragraph',
          text:
            '[Jieqi](/rules/jieqi) is xiangqi with every piece face-down. The engine here is PikaJieQi, [our build of Pikafish for the hidden game](https://github.com/brianhliou/pikafish-jieqi-wasm), and it gets the same face-down board you do: a test fails the build if a piece identity ever leaks into what it is sent. [Jieqi on Mistboard](/blog/jieqi-platform) covers the rest.',
        },
      ],
    },
    {
      heading: 'Game review, built for xiangqi and for flip games',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Every finished xiangqi game on the site can be sent for review. Pikafish runs over it on the server, and the move list shows where the evaluation moved, what it preferred instead, and which moves lost the game. The post-game review chess players are used to, for xiangqi.',
        },
        {
          kind: 'paragraph',
          text:
            'For banqi, jieqi and flip jungle the review does something no chess review needs: it prices every flip, so you see what you chose apart from what you drew. [Separating skill from luck](/blog/skill-vs-luck) explains how.',
        },
        {
          kind: 'paragraph',
          text:
            'The [analysis board](/analysis/xiangqi) is for a position you set up yourself. It runs Fairy-Stockfish in your browser, not Pikafish: instant and private, and weaker. Pikafish in the browser is not there yet.',
        },
      ],
    },
    {
      heading: 'Questions',
      blocks: [
        {
          kind: 'faq',
          items: [
            {
              question: 'Can I play Pikafish online?',
              answer:
                'Yes, here, in the browser. One click on the Pikafish page starts a game against it; the play menu offers eight easier levels.',
            },
            {
              question: 'Is it free?',
              answer:
                'Yes. Playing, the ladder, jieqi, game review and the analysis board are all free. An account is optional.',
            },
            {
              question: 'Do I need to download anything?',
              answer:
                'No. The game runs in the page. On a phone, open the site in the browser and play.',
            },
            {
              question: 'How strong is it?',
              answer:
                'The Pikafish bot searches three million positions a move, about four seconds, on the server. That is beyond any human. The ladder above it goes down to a level a beginner can beat.',
            },
            {
              question: 'Does the jieqi engine see my hidden pieces?',
              answer:
                'No. It receives the same face-down board you see, and the deal is known to nobody, not you, not the engine, not your opponent.',
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
            { label: 'Play Pikafish', href: '/bot/pikafish', emphasis: 'primary' },
            {
              label: 'Pick a level',
              href: '/?play=computer&gameSpecId=xiangqi',
              emphasis: 'secondary',
            },
            { label: 'Read the rules', href: '/rules/xiangqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
