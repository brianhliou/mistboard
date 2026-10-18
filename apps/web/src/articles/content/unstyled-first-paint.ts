import type { Locale } from '../../i18n/locale.js';
import { textCard } from '../text-card.js';
import type { Article } from '../types.js';

// Card art: the words on the xiangqi palette, like the Pikafish card.
const UNSTYLED_FIRST_PAINT_THUMBNAIL = (locale: Locale): string =>
  textCard(
    {
      palette: 'xiangqi',
      eyebrow: 'ENGINEERING',
      lead: 'UNSTYLED',
      tagline: 'TWO FLASHES, TWO CAUSES',
      ariaLabel: 'A card reading Unstyled, two flashes, two causes',
    },
    locale,
  );

// The rules-page flash (b808d02d, 2026-10-16) and the players-page flash
// (29a685f5, 2026-10-17). Counts come from those commits and from the first
// run of scripts/served-first-paint.mjs against prod on 2026-10-17.
export const unstyledFirstPaintArticle: Article = {
  slug: 'unstyled-first-paint',
  kind: 'article',
  publisher: 'mistboard',
  topic: 'engineering',
  title: 'Two pages that loaded as plain text',
  cardTitle: 'Pages loading as plain text',
  seoTitle: 'Fixing a flash of unstyled content on prerendered pages',
  summary:
    'The rules pages and the players pages both showed as bare text for a moment before snapping into their design. The causes were different, and the check written for the first passed the second.',
  showSummaryOnPage: false,
  status: 'draft',
  thumbnail: { kind: 'svg', svg: UNSTYLED_FIRST_PAINT_THUMBNAIL },
  audience: 'Web developers, and players curious how the site is built.',
  tldr: [
    'The rules pages painted unstyled because their layout CSS came with a script the page loaded later. Each page now links that CSS itself, and a build check fails any page missing a stylesheet its markup needs.',
    'The players pages had another cause: the server writes a plain copy of the page for search engines, and that copy showed until the real page replaced it.',
    'The build check passed the players pages. It only read pages the build writes, and it worked by matching class names, which the copy had none of.',
    'The copy is now hidden until the real page draws, and a second check reads every kind of page on the live site.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'For a moment after you opened a [rules page](/rules), you saw the headings, paragraphs and sidebar links as plain text, with no layout. Then the page snapped into its real design. The [players page](/players) did the same. The two flashes looked alike and had different causes, and the check we wrote after the first one passed the second.',
    },
  ],
  sections: [
    {
      heading: 'The rules pages: the stylesheet came with the script',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Mistboard builds every rules page and blog post ahead of time as a complete HTML file, so readers and search engines get the text without waiting for a script. The site is built with Vite, which splits the CSS for each piece of code out beside that code. The article layout lived with the articles code, and the page loads that code only after it starts.',
        },
        {
          kind: 'paragraph',
          text: 'So the HTML arrived complete but linked only the site-wide stylesheets. The browser painted the text with those, fetched the articles code, and only then got the rules that lay out an article. Every click in the rules sidebar was a full page load, so a reader saw the flash on every page.',
        },
        {
          kind: 'paragraph',
          text: 'The build now links the article stylesheets in each page it writes, in the order Vite would load them. A check runs after it: for each page, it collects the class names in the markup and looks for a rule, in any stylesheet the page does not link, that would match them. A hit fails the build and names the page and the stylesheet. All 188 pages passed. Sidebar clicks also stopped reloading the page; they swap the article in place.',
        },
      ],
    },
    {
      heading: 'The players pages: a copy for search engines',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A day later the players page flashed the same way. The players pages are written by the server on each request, so the build never sees them. For crawlers that run no script, the server puts a plain copy of the content in the page: the 260 players, each with a team, points and a link. The script draws the real page and removes the copy when it starts. Until then the copy was on screen, with none of the page\'s layout.',
        },
        {
          kind: 'paragraph',
          text: 'The build check missed it twice over. It reads the files the build writes, and these pages are assembled later. And when we pointed the same logic at the live pages, it passed them anyway, because it matches class names in the markup against stylesheet rules and the copy had no class names. A page with nothing to match had nothing missing. The [bots page](/bots) and every shared study carried the same kind of copy and flashed the same way.',
        },
      ],
    },
    {
      heading: 'The fix, and a check for both',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The copy stays in the HTML, since crawlers that run no script still need it. The server now wraps it in one element that the site\'s base stylesheet keeps hidden. If the script has not replaced it after four seconds, a CSS animation shows it, so a reader whose script never runs still gets the text. If the page fails to start, the script puts the copy back and shows it at once.',
        },
        {
          kind: 'paragraph',
          text: 'The second check reads the live site: two pages of each kind in the sitemap, plus the pages the sitemap leaves out. It flags a page missing a stylesheet its markup needs, and a page whose content has no class names and no hiding wrapper. Its test feeds it the old players page, which it has to flag. Run against the site before the fix, it flagged 14 pages across the players, team, bots and study pages in all three languages.',
        },
        {
          kind: 'paragraph',
          text: 'The first check missed the players pages because it asked a question they could not answer: whether the classes in a page were styled. A page with no classes gives no answer, and the check read silence as a pass. The second check asks what both flashes had in common, whether any content reaches the screen before its styling does.',
        },
      ],
    },
  ],
};
