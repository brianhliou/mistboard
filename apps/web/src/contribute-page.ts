// /contribute: how to help Mistboard, lichess's /help/contribute equivalent.
// Play + feedback, bug reports, code, zh page reviews, and support. Renders inside
// the shared /about rail + panel shell.

import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { buildNav, GITHUB_URL } from './site-shell.js';
import {
  proseExternalLink,
  proseHeading,
  proseLink,
  proseParagraph,
  proseSection,
  proseSubheading,
} from './static-page-dom.js';
import { buildStaticPageLayout } from './static-page-shell.js';

export function mountContribute(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'contribute-route');
  root.append(
    buildNav(locale),
    buildStaticPageLayout('contribute', buildContribute(locale), locale),
  );
  scrollToTranslateAnchor(root);
}

// The page is built after load, so the browser's own fragment scroll finds
// nothing for #translate (seen on a phone-height viewport); scroll it
// explicitly, like /changelog's month hash.
function scrollToTranslateAnchor(root: HTMLElement): void {
  if (globalThis.location?.hash !== `#${CONTRIBUTE_TRANSLATE_ANCHOR}`) return;
  const target = root.querySelector<HTMLElement>(`#${CONTRIBUTE_TRANSLATE_ANCHOR}`);
  if (!target) return;
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
}

function buildContribute(locale: Locale = currentLocale()): HTMLElement {
  const section = proseSection('contribute-section');
  section.append(
    proseHeading(t('contribute.heading', {}, locale)),
    proseParagraph([t('contribute.intro', {}, locale)]),

    proseSubheading(t('contribute.playHeading', {}, locale)),
    proseParagraph([t('contribute.playBody', {}, locale)]),

    proseSubheading(t('contribute.reportHeading', {}, locale)),
    proseParagraph([
      t('contribute.reportPrefix', {}, locale),
      proseExternalLink('GitHub', `${GITHUB_URL}/issues`),
      t('contribute.reportMiddle', {}, locale),
      proseLink(t('contact.heading', {}, locale), '/contact'),
      t('contribute.reportSuffix', {}, locale),
    ]),

    proseSubheading(t('contribute.codeHeading', {}, locale)),
    proseParagraph([
      t('contribute.codePrefix', {}, locale),
      proseExternalLink('GitHub', GITHUB_URL),
      t('contribute.codeSuffix', {}, locale),
    ]),

    translateHeading(locale),
    proseParagraph([t('contribute.translateBody', {}, locale)]),
    proseParagraph([
      t('contribute.translateStartPrefix', {}, locale),
      proseLink(CONTACT_EMAIL, `mailto:${CONTACT_EMAIL}`),
      t('contribute.translateStartMiddle', {}, locale),
      proseLink(t('contribute.translateThanksLink', {}, locale), '/thanks'),
      t('contribute.translateStartSuffix', {}, locale),
    ]),

    proseSubheading(t('contribute.supportHeading', {}, locale)),
    proseParagraph([
      t('contribute.supportPrefix', {}, locale),
      proseLink(t('contribute.supportLink', {}, locale), '/patron'),
      t('contribute.supportSuffix', {}, locale),
    ]),

    proseParagraph([
      t('contribute.crossLinkPrefix', {}, locale),
      proseLink(t('creators.heading', {}, locale), '/creators'),
      t('contribute.crossLinkOr', {}, locale),
      proseLink(t('champions.heading', {}, locale), localizedHref('/champions', locale)),
      t('contribute.crossLinkSuffix', {}, locale),
    ]),
  );
  return section;
}

const CONTACT_EMAIL = 'contact@mistboard.com';

// Anchored so the zh rules pages' "see a translation problem?" line can land
// the reader on this section rather than the top of the page (articles.ts
// links to `/contribute#translate`; keep the two in step).
const CONTRIBUTE_TRANSLATE_ANCHOR = 'translate';

function translateHeading(locale: Locale): HTMLElement {
  const heading = proseSubheading(t('contribute.translateHeading', {}, locale));
  heading.id = CONTRIBUTE_TRANSLATE_ANCHOR;
  return heading;
}
