import type { Article } from '../types.js';

// Card art for the articles index. Not a board position: this page is about
// titles, so the art is the badge itself, in the same gold the real badge uses
// (#b9832f, see title-badge.css). The lead abbreviation is xiangqi because the
// page is xiangqi-first; the row beneath shows the vocabulary is wider.
const TITLED_PLAYERS_THUMBNAIL = [
  // 320x200 is exactly the card's 16/10 media box. An inline SVG letterboxes by
  // default (preserveAspectRatio meet), so a mismatched viewBox leaves the card
  // background showing as bands; `slice` fills instead of fitting if a caller
  // ever uses a different box. No rounded corners either: the card clips its
  // own, and a radius here notched the fill at the corners.
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" aria-label="A gold XGM title badge above the other accepted titles">',
  // Fill inline rather than via .xq-diagram-bg: that rule is scoped to
  // .xq-article-svg, which this standalone thumbnail is not inside, so the class
  // alone leaves the rect unfilled (it rendered black). The var keeps the card
  // theme-aware and the fallback matches the xiangqi board.
  '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
  '<text x="160" y="100" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" font-size="64" font-weight="700" letter-spacing="2" fill="#b9832f" translate="no">XGM</text>',
  '<text x="160" y="138" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" font-size="17" font-weight="600" letter-spacing="1.5" fill="#b9832f" opacity="0.62" translate="no">XIM \u00b7 XNM \u00b7 GM \u00b7 IM \u00b7 FM</text>',
  '<text x="160" y="166" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" font-size="12" letter-spacing="2.4" fill="#5a4626" opacity="0.72">VERIFIED TITLES</text>',
  '</svg>',
].join('');

// Supply-side recruitment page for verified titled players. Deliberately
// describes only what already ships (badge, coach listing, featurable study,
// video library, streamer directory, guest byline); every line here should stay
// checkable by a skeptical reader in one click. Xiangqi-first on purpose: the
// English-language xiangqi audience is the one thing Mistboard offers that
// nowhere else does, while chess titles are better recruited by name than by
// broadcast.
//
// The streamer line deliberately does NOT link /streamer: the directory is
// empty until someone is seeded into streamers-data.ts, and sending a recruit
// to "no streamers are listed yet" undoes the paragraph above it. Link it once
// there is someone to show.

export const titledPlayersArticle: Article = {
  slug: 'titled-players',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Bring your title to Mistboard',
  seoTitle: 'For titled xiangqi and chess players',
  summary:
    'Verified titled players get a gold badge beside their name, a coaching page students can find, and a front page that will carry their work. Verification takes about two minutes.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-08-27',
  thumbnail: { kind: 'svg', svg: TITLED_PLAYERS_THUMBNAIL },
  audience:
    'Titled xiangqi players (WXF, CXA, national federations) and titled chess players curious about xiangqi.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Verified titled players get a gold badge beside their name, a coaching page students can find, and a front page that will carry their work. Verification takes about two minutes: start at [mistboard.com/verify-title](/verify-title).',
    },
    {
      kind: 'paragraph',
      text: 'Mistboard accepts WXF and CXA titles (XGM, XIM, XNM, XWGM, XWIM) and FIDE titles (GM, IM, FM, CM, WGM, WIM, WFM, WCM). Link your federation profile, give your real name, note the results behind the claim, and an admin reviews it personally.',
    },
  ],
  sections: [
    {
      heading: 'What you get',
      blocks: [
        {
          kind: 'paragraph',
          text: '**The badge.** Gold, beside your name, everywhere you appear: games, profile, ladders, forum, studies. Every player who sees you play sees the title first.',
        },
        {
          kind: 'paragraph',
          text: '**Your own coaching page.** Publish at [/coach](/coach) with your headline, languages, rate, and contact details. Students reach you directly and pay you directly. Mistboard takes nothing: no commission, no processing fees, no cut of your lesson.',
        },
        {
          kind: 'paragraph',
          text: '**The front page.** Write an annotated study and it can lead the homepage under your name. Your analysis is what players come here to read, and there is no queue in front of you.',
        },
        {
          kind: 'paragraph',
          text: '**The video library.** If you make xiangqi videos, [/videos](/videos) will carry them and send viewers your way.',
        },
        {
          kind: 'paragraph',
          text: '**A place in the streamer directory.** Stream here and get listed.',
        },
        {
          kind: 'paragraph',
          text: '**Your own byline.** Send something longer and it gets edited and published under your name, with your title beside it.',
        },
      ],
    },
    {
      heading: 'Why Mistboard',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Mistboard is free and open source, with no ads. Every game, puzzle and lesson is open to everyone. A Patron subscription adds a badge to your profile and nothing else.',
        },
        {
          kind: 'paragraph',
          text: 'That audience has never had a serious English-language home, and it has never had titled players to learn from. You would be among the first, on a site built to put your name in front of them rather than bury it.',
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Verify your title', href: '/verify-title', emphasis: 'primary' },
            { label: 'Ask me something first', href: '/contact', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
