import type { I18nKey } from './i18n/catalog.js';

// The About rail and the phone menu share destinations, labels and order.
// Keep the public information pages before the project pages; the rail renders
// the boundary while the phone menu flattens both groups under Mistboard.
// A long rail is fine: keep existing information and project pages discoverable
// here unless their content is consolidated into another destination.
export const ABOUT_NAV_GROUPS = [
  [
    { key: 'about', label: 'About Mistboard', labelKey: 'about.heading', href: '/about' },
    { key: 'stats', label: 'Statistics', labelKey: 'stats.heading', href: '/stats' },
    { key: 'news', label: 'Mistboard updates', labelKey: 'news.feedHeading', href: '/feed' },
    { key: 'changelog', label: 'Changelog', labelKey: 'changelog.heading', href: '/changelog' },
    { key: 'faq', label: 'FAQ', labelKey: 'faq.heading', href: '/faq' },
    { key: 'contact', label: 'Contact', labelKey: 'contact.heading', href: '/contact' },
    { key: 'lag', label: 'Is Mistboard lagging?', labelKey: 'lag.heading', href: '/lag' },
    {
      key: 'title',
      label: 'Title verification',
      labelKey: 'verifyTitle.heading',
      href: '/verify-title',
    },
    { key: 'patron', label: 'Mistboard Patron', labelKey: 'patron.heading', href: '/patron' },
    { key: 'terms', label: 'Terms of Use', labelKey: 'terms.heading', href: '/terms' },
    { key: 'privacy', label: 'Privacy', labelKey: 'privacy.heading', href: '/privacy' },
  ],
  [
    { key: 'source', label: 'Source code', labelKey: 'source.heading', href: '/source' },
    { key: 'contribute', label: 'Contribute', labelKey: 'contribute.heading', href: '/contribute' },
    { key: 'creators', label: 'Work with us', labelKey: 'creators.heading', href: '/creators' },
    {
      key: 'champions',
      label: 'Engine champions',
      labelKey: 'champions.heading',
      href: '/champions',
    },
    { key: 'developers', label: 'Developers', labelKey: 'developers.heading', href: '/developers' },
    { key: 'data', label: 'Game data', labelKey: 'data.heading', href: '/data' },
    { key: 'apiDocs', label: 'API', labelKey: 'apiDocs.heading', href: '/api-docs' },
    { key: 'thanks', label: 'Thank you', labelKey: 'thanks.heading', href: '/thanks' },
  ],
] as const satisfies ReadonlyArray<
  ReadonlyArray<{ key: string; label: string; labelKey: I18nKey; href: string }>
>;
