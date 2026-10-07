// /creators: "Work with us", the public offer to titled players and coaches,
// creators and streamers, event organizers, writers and composers, and engine
// authors. Each section leads with what we do for them, and every offer links to
// something live. Renders inside the shared /about rail + panel shell.

import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { buildNav } from './site-shell.js';
import {
  proseHeading,
  proseLink,
  proseParagraph,
  proseSection,
  proseSubheading,
} from './static-page-dom.js';
import { buildStaticPageLayout } from './static-page-shell.js';

export function mountCreators(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'creators-route');
  root.append(buildNav(locale), buildStaticPageLayout('creators', buildCreators(locale), locale));
}

function strong(text: string): HTMLElement {
  const b = document.createElement('strong');
  b.textContent = text;
  return b;
}

function buildCreators(locale: Locale = currentLocale()): HTMLElement {
  const section = proseSection('creators-section');
  section.append(
    proseHeading(t('creators.heading', {}, locale)),
    proseParagraph([t('creators.intro', {}, locale)]),

    proseSubheading(t('creators.playersHeading', {}, locale)),
    proseParagraph([
      t('creators.playersPrefix', {}, locale),
      proseLink(t('creators.playersCoachLink', {}, locale), '/coach'),
      t('creators.playersBody', {}, locale),
      proseLink(t('creators.playersVerifyLink', {}, locale), '/verify-title'),
      t('creators.playersOr', {}, locale),
      proseLink(t('creators.playersLink', {}, locale), '/blog/titled-players'),
      t('creators.playersSuffix', {}, locale),
    ]),

    proseSubheading(t('creators.videoHeading', {}, locale)),
    proseParagraph([
      strong(t('creators.gamesLead', {}, locale)),
      ' ',
      t('creators.gamesPrefix', {}, locale),
      proseLink(t('creators.gamesLink', {}, locale), '/broadcast/xiangqi'),
      t('creators.gamesSuffix', {}, locale),
    ]),
    proseParagraph([
      strong(t('creators.analysisLead', {}, locale)),
      ' ',
      t('creators.analysisPrefix', {}, locale),
      proseLink(t('creators.analysisLink', {}, locale), '/study'),
      t('creators.analysisSuffix', {}, locale),
    ]),
    proseParagraph([
      strong(t('creators.streamLead', {}, locale)),
      ' ',
      t('creators.streamBody', {}, locale),
    ]),
    proseParagraph([t('creators.videoClose', {}, locale)]),

    proseSubheading(t('creators.eventsHeading', {}, locale)),
    proseParagraph([
      t('creators.eventsBody', {}, locale),
      proseLink(t('creators.eventsLink', {}, locale), '/broadcast/xiangqi'),
      t('creators.eventsSuffix', {}, locale),
    ]),

    proseSubheading(t('creators.writersHeading', {}, locale)),
    proseParagraph([t('creators.writersBody', {}, locale)]),

    proseSubheading(t('creators.enginesHeading', {}, locale)),
    proseParagraph([
      t('creators.enginesBody', {}, locale),
      t('creators.enginesChampionsPrefix', {}, locale),
      proseLink(
        t('creators.enginesChampionsLink', {}, locale),
        localizedHref('/champions', locale),
      ),
      t('creators.enginesChampionsSuffix', {}, locale),
    ]),

    proseSubheading(t('creators.contactHeading', {}, locale)),
    proseParagraph([
      t('creators.contactPrefix', {}, locale),
      proseLink(t('creators.contactLink', {}, locale), '/contact'),
      t('creators.contactSuffix', {}, locale),
    ]),

    proseParagraph([
      t('creators.crossLinkPrefix', {}, locale),
      proseLink(t('contribute.heading', {}, locale), '/contribute'),
      t('creators.crossLinkSuffix', {}, locale),
    ]),
  );
  return section;
}
