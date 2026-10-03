import type { Locale } from '../../i18n/locale.js';
import type { Article } from '../types.js';

// Facts from the KataGo seat (#434, be6fc95e) and the match write-up linked
// below: 200 games against MistyJungle at 1,000 visits a move (82-0-118, 0.705,
// study 0t8xpyv6), then 50 at the site's 150 visits (19-0-31, 0.690).
//
// Text card in the Pikafish card's family, set in the page's language: the
// reader's script leads and the other name sits above it, small. The palette is
// the jungle diagrams' green.
const KATAGO_JUNGLE_THUMBNAIL = (locale: Locale): string => {
  const zh = locale === 'zh-Hans' || locale === 'zh-Hant';
  const hanzi = locale === 'zh-Hant' ? '鬥獸棋' : '斗兽棋';
  const above = zh ? 'KATAGO' : hanzi;
  const lead = zh ? hanzi : 'KATAGO';
  const tagline = zh
    ? locale === 'zh-Hant'
      ? '新的最強電腦'
      : '新的最强电脑'
    : 'THE TOP JUNGLE CHESS BOT';
  const hanziFont =
    "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif";
  const latinFont = 'Roboto, system-ui, sans-serif';
  const ink = '#1f6f5b';
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" ',
    'preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" ',
    `aria-label="A card reading ${zh ? hanzi : 'KataGo'}, the top Jungle Chess bot">`,
    '<rect x="0" y="0" width="320" height="200" fill="#dfe8cf"/>',
    `<text x="160" y="62" text-anchor="middle" font-family="${zh ? latinFont : hanziFont}" `,
    `font-size="${zh ? 22 : 26}" font-weight="700" letter-spacing="${zh ? 6 : 10}" fill="${ink}" `,
    `opacity="0.5"${zh ? ' translate="no"' : ''}>${above}</text>`,
    `<text x="160" y="118" text-anchor="middle" font-family="${zh ? hanziFont : latinFont}" `,
    `font-size="${zh ? 46 : 40}" font-weight="700" letter-spacing="${zh ? 8 : 0}" fill="${ink}"`,
    `${zh ? '' : ' translate="no"'}>`,
    `${lead}</text>`,
    `<text x="160" y="150" text-anchor="middle" font-family="${zh ? hanziFont : latinFont}" `,
    `font-size="${zh ? 16 : 15}" font-weight="600" letter-spacing="${zh ? 3 : 1.4}" `,
    `fill="${ink}" opacity="0.62">`,
    `${tagline}</text>`,
    '</svg>',
  ].join('');
};

const KATAGOMO = 'https://github.com/hzyhhzy/KataGomo';

export const katagoJungleArticle: Article = {
  slug: 'katago-jungle',
  kind: 'article',
  publisher: 'mistboard',
  title: 'KataGo, a stronger Jungle Chess bot',
  seoTitle: 'KataGo for Jungle Chess: the self-play engine that beat Misty 82 to 0',
  summary:
    'A Jungle Chess engine that learned by playing itself now sits above Misty. In 200 games against Misty it won 82, lost none and drew 118.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-03',
  thumbnail: { kind: 'svg', svg: KATAGO_JUNGLE_THUMBNAIL },
  audience: 'People who play Jungle Chess against the bot on Mistboard.',
  intro: [
    {
      kind: 'paragraph',
      text: `[Jungle Chess](/rules/jungle) on Mistboard has a new top bot. It is KataGo-AnimalChess, hzyhhzy's [KataGomo](${KATAGOMO}/tree/AnimalChess2025) built on lightvector's [KataGo](https://github.com/lightvector/KataGo), playing with the b10c384 network from Dandelion 4 by Kouza ([lxsgx23](https://github.com/lxsgx23)). We play it here with [hzyhhzy's permission](${KATAGOMO}/issues/12), under the name KataGo.`,
    },
    {
      kind: 'paragraph',
      text: 'KataGo learned Jungle Chess by playing itself, the way AlphaZero learned chess. A neural network proposes moves and judges positions, and a search checks its ideas. No other engine taught it.',
    },
    {
      kind: 'cta',
      layout: 'single-row',
      buttons: [
        { label: 'Play KataGo', href: '/bot/katago', emphasis: 'primary' },
        { label: 'See all bots', href: '/bots', emphasis: 'secondary' },
      ],
    },
  ],
  sections: [
    {
      heading: '82 wins and no losses against Misty',
      blocks: [
        {
          kind: 'paragraph',
          text: "Before putting it on the site, we played it against Misty, our own Jungle Chess bot, in an open challenge of 200 games at 1,000 visits a move. hzyhhzy's engine won 82, lost none and drew 118, a score of 0.705. Every win came from walking into Misty's den, and every draw was a repetition.",
        },
        {
          kind: 'paragraph',
          text: 'All 200 games are in [one study](/study/0t8xpyv6), and the [match write-up](https://brianhliou.com/posts/katago-beats-misty-jungle/) has the details.',
        },
      ],
    },
    {
      heading: 'Misty is still where you start',
      blocks: [
        {
          kind: 'paragraph',
          text: 'KataGo is at the top of the Jungle Chess bot list, above Misty. Misty stays the default and the easier opponent; pick KataGo when you want the stronger game. Game review and analysis for Jungle Chess still run on Misty.',
        },
        {
          kind: 'paragraph',
          text: 'On the site KataGo searches 150 visits a move, which takes about 1.5 to 3.5 seconds. At that setting it scored 19 wins, no losses and 31 draws in 50 games against Misty, 0.690, which cannot be told apart from the 1,000-visit result. The strength is in the network.',
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        {
          kind: 'paragraph',
          text: `KataGomo is open source at [github.com/hzyhhzy/KataGomo](${KATAGOMO}). Thank you, hzyhhzy, for the engine and for letting us use it; lightvector, for KataGo; and Kouza, for the Dandelion 4 network.`,
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play KataGo', href: '/bot/katago', emphasis: 'primary' },
            { label: 'Jungle Chess rules', href: '/rules/jungle', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
