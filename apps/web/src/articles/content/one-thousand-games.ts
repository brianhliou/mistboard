import type { Article } from '../types.js';

// Card art for the articles index: the number and what it counts, on the
// board colour, the same pattern as the titled-players card. 320x200 is the
// card's 16/10 media box; `slice` and a plain rect for the reasons given there.
const ONE_THOUSAND_GAMES_THUMBNAIL = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" aria-label="1,000 games played">',
  '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
  '<text x="160" y="118" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" font-size="78" font-weight="800" letter-spacing="-2" fill="#2b2118">1,000</text>',
  '<text x="160" y="156" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" font-size="14" font-weight="600" letter-spacing="2.4" fill="#5a4626" opacity="0.8">GAMES PLAYED</text>',
  '</svg>',
].join('');

// The 1,000-games milestone. Numbers are the /api/stats/public read on the
// day the count crossed (the screenshot is taken by the same read), so they
// stay true as written; the live page keeps counting.
export const oneThousandGamesArticle: Article = {
  slug: 'one-thousand-games',
  kind: 'article',
  publisher: 'mistboard',
  title: '1,000 games played',
  seoTitle: 'Mistboard passes 1,000 games',
  summary:
    'Since June 1, people have finished 1,000 games on Mistboard, most of them in September. Thank you for playing.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-30',
  thumbnail: { kind: 'svg', svg: ONE_THOUSAND_GAMES_THUMBNAIL },
  audience: 'Everyone who plays on Mistboard.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Mistboard passed 1,000 finished games this week. A game counts once both sides have moved and it ends, against another person or a bot. Engine matches and our test accounts are left out, and counting started on June 1.',
    },
    {
      kind: 'image-figure',
      src: '/article-thumbs/one-thousand-games-stats.png',
      darkSrc: '/article-thumbs/one-thousand-games-stats-dark.png',
      className: 'article-figure-full',
      alt: 'The Mistboard statistics page: 1,000 games played, games per week climbing from a handful in June to nearly 400 in the week of September 21, jieqi far ahead by variant, and almost every game against a bot.',
      caption: 'The statistics page on the day the count reached 1,000.',
    },
    {
      kind: 'paragraph',
      text: 'June had 12 games. September has had nearly 800, and the week of September 21 alone had 387. The [statistics page](/stats) keeps the running count.',
    },
    {
      kind: 'paragraph',
      text: '[Jieqi](/rules/jieqi), xiangqi with the pieces face down, is 608 of the first 1,000. [Banqi](/rules/banqi) and [xiangqi](/rules/xiangqi) come next with 96 and 82, then Fog Chess, Jungle, Fog Xiangqi, Duck Xiangqi, Flip Jungle and Fortress Xiangqi. Seven of those games were between two people; the rest were against the bots.',
    },
  ],
  sections: [
    {
      heading: 'Thank you',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Thank you to everyone who played a game, reported a bug, or supports the site as a [patron](/patron). We are building the best place to play Chinese chess and original board games, free and [open source](https://github.com/brianhliou/mistboard).',
        },
        {
          kind: 'paragraph',
          text: 'Ideas and questions go on the [forum](/forum), where other players can add to them. Anything private, like a bug with your account or billing trouble, goes through [Contact](/contact). What you tell us decides what comes next.',
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play a game', href: '/', emphasis: 'primary' },
            { label: 'Send feedback', href: '/contact', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
