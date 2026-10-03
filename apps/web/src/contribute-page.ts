// /contribute: how to help Mistboard, lichess's /help/contribute equivalent.
// Play + feedback, bug reports, code, translations, and support. Renders inside
// the shared /about rail + panel shell.

import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
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

    proseSubheading(t('contribute.translateHeading', {}, locale)),
    proseParagraph([t('contribute.translateBody', {}, locale)]),

    proseSubheading(t('contribute.supportHeading', {}, locale)),
    proseParagraph([
      t('contribute.supportPrefix', {}, locale),
      proseLink(t('contribute.supportLink', {}, locale), '/patron'),
      t('contribute.supportSuffix', {}, locale),
    ]),

    proseParagraph([
      t('contribute.crossLinkPrefix', {}, locale),
      proseLink(t('creators.heading', {}, locale), '/creators'),
      t('contribute.crossLinkSuffix', {}, locale),
    ]),
  );
  return section;
}
