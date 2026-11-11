import type { Article, ArticleBlock } from '../types.js';

// Issue #969. zh in article-i18n.ts, drafted from the English signed off 2026-11-08.
export const fogFutureArticle: Article = {
  slug: 'fog-future',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'chess',
  title: 'The Future of Fog Variants on Mistboard',
  cardTitle: 'The Future of Fog',
  summary:
    'The Fog Chess and Fog Xiangqi bots go offline on December 8, 2026. Why they cost too much to run, what stays, and what it would take to bring them back.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-11-17',
  audience: 'Fog Chess and Fog Xiangqi players.',
  thumbnail: {
    kind: 'image',
    src: '/article-thumbs/fog-future.jpg',
    alt: 'The Fog Chess and Fog Xiangqi legacy badges side by side.',
  },
  tldr: [
    'The Fog Chess and Fog Xiangqi bots go offline on December 8, 2026. For now, playing a friend stays. The rules pages and every finished game stay too.',
    'A fog bot has to hold every position the fog could be hiding. In deep games that runs to hundreds of millions of positions, far more memory than its games justify.',
    'Beat Misty while signed in before December 8 and that game\'s legacy badge stays on your profile: one for Fog Chess, one for Fog Xiangqi.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'Since June, Mistboard has run Misty, a bot that plays [Fog Chess](/rules/fog-chess) and [Fog Xiangqi](/rules/fog-xiangqi), the versions of both games where you see only what your own pieces can reach. **On December 8, 2026, both fog bots go offline.**',
    },
    {
      kind: 'paragraph',
      text: 'To play well without seeing the board, Misty tracks every position the fog could be hiding. In long, tangled games that takes far more memory than a server can hold for the few people who play them. For now, games against a friend stay. Both rules pages and every finished game stay too.',
    },
  ],
  sections: [
    {
      heading: 'Timeline',
      blocks: [
        {
          kind: 'timeline',
          items: [
            {
              date: '2026-11-17',
              title: 'This announcement',
              text: 'The Fog Chess and Fog Xiangqi legacy badges go live.',
            },
            {
              date: '2026-12-08',
              title: 'The fog bots go offline',
              text: 'Playing Fog Chess and Fog Xiangqi against Misty ends, along with Fog Chess engine review. Last day to earn a badge.',
            },
            {
              date: 'Later',
              title: 'The games themselves',
              text: 'What happens to Fog Chess and Fog Xiangqi as games. Each decision is added here with its date.',
            },
          ],
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Why the fog bots are expensive',
      blocks: [
        {
          kind: 'paragraph',
          text: "A normal chess engine studies one board, the one in front of it. Misty can't, because she sees only what you see. Instead she keeps a list of *every* position the fog could be hiding, and picks the move that works across all of them.",
        },
        {
          kind: 'list',
          items: [
            '**The list can explode.** Usually it holds a few dozen boards. But each move she can\'t see multiplies it, and in a tangled game it can jump from thousands to millions in a few moves. One game against a person reached 82 million positions; one self-play game reached 346 million.',
            '**Every position takes memory.** To fit on a server, Misty stops at 16 million positions in Fog Chess and 20 million in Fog Xiangqi, and plays from a sample past that. Even capped, one game used 7.7 GB. The 346-million game would have needed more than 150 GB.',
            '**A long list is slow.** With a short list Misty moves in about five seconds; near the cap one move can take close to a minute. Seventeen games since June ended because she ran out of time or dropped out.',
            '**She uses memory even when idle.** The service holds about 1.26 GB with no game running, so Misty is ready the moment one starts.',
          ],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: "Running Misty in your browser instead doesn't work: a deep game needs more memory than a browser tab gets, and her view of the board would sit on your machine. [How Misty plays](/blog/misty) explains the search in full.",
        },
      ],
    },
    {
      heading: 'What memory costs',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Memory chips got much more expensive this year. [TrendForce](https://www.trendforce.com/presscenter/news/20260601-13070.html), which tracks chip prices, reported contract DRAM prices nearly doubling in the first quarter of 2026 as makers moved production toward AI servers, and it [expects](https://www.trendforce.com/presscenter/news/20260930-13258.html) another 10 to 15% rise this quarter, at a slower pace.',
        },
        {
          kind: 'paragraph',
          text: 'Hosts pass that on. One gigabyte held for a month costs:',
        },
        {
          kind: 'list',
          items: [
            "**$10** on Railway, Mistboard's host",
            '**about $4.90** on an AWS memory-optimized server',
            '**about €3** on a Hetzner dedicated server',
          ],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: "At Railway's rate, Misty's idle memory costs about $12.60 a month, room for one capped game about $80, and room for one uncapped deep game about $1,500. Even on Hetzner, the uncapped game would cost more than €400 a month.",
        },
        {
          kind: 'note',
          label: 'Prices as of November 7, 2026',
          text: "List prices from each host's own pricing, converted to a gigabyte held for a month. Railway bills memory on its own; AWS and Hetzner sell it with a server, so their figures divide a server's price by its memory.",
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The Fog legacy badges',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Beat Misty while signed in before **December 8, 2026**, and a legacy badge stays on your profile after the bots are gone:',
        },
        {
          kind: 'list',
          items: [
            '**Fog Chess legacy** for a win at Fog Chess',
            '**Fog Xiangqi legacy** for a win at Fog Xiangqi',
          ],
        } as ArticleBlock,
        {
          kind: 'image-row',
          items: [
            {
              src: '/article-thumbs/fog-chess-legacy-badge.png',
              darkSrc: '/article-thumbs/fog-chess-legacy-badge-dark.png',
              alt: 'The Fog Chess legacy badge: a shield holding a chess king rising from fog. It reads: Beat Misty at Fog Chess before the fog bots retired in December 2026.',
            },
            {
              src: '/article-thumbs/fog-xiangqi-legacy-badge.png',
              darkSrc: '/article-thumbs/fog-xiangqi-legacy-badge-dark.png',
              alt: 'The Fog Xiangqi legacy badge: a shield holding an elephant rising from fog. It reads: Beat Misty at Fog Xiangqi before the fog bots retired in December 2026.',
            },
          ],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: "Beat her at both and you hold both. Wins already on an account count, so juangamer10pro2 and rebirthfox333 have theirs. Guests can't hold badges, so sign in before your next game.",
        },
      ],
    },
    {
      heading: 'A challenge for engine builders',
      blocks: [
        {
          kind: 'paragraph',
          text: "Cheaper servers won't bring the bots back. Obscuro, the superhuman fog-of-war engine from Carnegie Mellon, and Misty, built on its design, both keep every position the fog could be hiding, and that list is what outgrows the machine.",
        },
        {
          kind: 'paragraph',
          text: 'What a fog bot needs is a small memory budget. Engines for ordinary chess and xiangqi play at superhuman strength in well under a gigabyte. A fog engine will likely need more, but not tens of gigabytes. The bar is a Fog Chess bot that:',
        },
        {
          kind: 'list',
          items: [
            'scores at least 50% against Misty over a 100-game match,',
            'averages under 10 seconds a move, with no move over 30, and',
            'stays under 8 GB of memory in its deepest games, and the less the better: every game running at once needs its own.',
          ],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: "How it gets there is up to you. Misty's engine is public [on GitHub](https://github.com/brianhliou/misty) and installs from PyPI as `misty-chess`, so you can start from it or test against it. If you build one, [tell us](/contact). Misty's fog server is being shut down for good, but a bot that clears the bar could bring computer play back to the fog.",
        },
      ],
    },
    {
      heading: 'Thank you',
      blocks: [
        {
          kind: 'table',
          headers: ['', 'Fog Chess', 'Fog Xiangqi'],
          rows: [
            ['First game', 'June 1, 2026', 'June 23, 2026'],
            ['Games', '247', '133'],
            ['Players', '74', '53'],
            ['Wins against Misty', '25', '19'],
          ],
          keyColumn: true,
          wrap: true,
          compact: true,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Counts run to November 8 and include finished games where a person moved. Most were played without an account. Every win that ended with a capture, 42 in all, is collected in two studies you can replay move by move: [Beating Misty at Fog Chess](/study/ObtCiQip) and [Beating Misty at Fog Xiangqi](/study/wpQhOVHS).',
        },
        {
          kind: 'paragraph',
          text: "Mistboard's mission is to bring people together across cultures through Chinese chess and the world's classic strategy games. Every game here needs care to stay worth playing: a bot that plays well, rules that read clearly, reviews that work. Putting that care where people play most means hard calls, and this is one of them.",
        },
        {
          kind: 'paragraph',
          text: '**To everyone who sat down across from Misty in the fog: thank you.** She is here until December 8, if you want one more game.',
        },
        {
          kind: 'cta',
          buttons: [
            {
              label: 'Play Fog Chess against Misty',
              href: '/?play=computer&gameSpecId=dark-chess',
              emphasis: 'primary',
            },
            {
              label: 'Play Fog Xiangqi against Misty',
              href: '/?play=computer&gameSpecId=dark-xiangqi',
              emphasis: 'primary',
            },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
