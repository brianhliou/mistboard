import { currentLocale, type Locale } from './i18n/locale.js';

export const HOME_DESCRIPTION =
  'Bringing people together across cultures through Chinese chess. Play xiangqi, jieqi and banqi online for free, against a bot or a friend, no sign-up.';

// A landing remount must replace the previous page's snippet, including when
// that page removed the shell's tags. Localized homes retain their own copy.
export function updateHomeDescription(locale: Locale = currentLocale()): void {
  if (locale !== 'en') return;
  for (const [attribute, name] of [
    ['name', 'description'],
    ['property', 'og:description'],
  ] as const) {
    let meta = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute(attribute, name);
      document.head.append(meta);
    }
    meta.content = HOME_DESCRIPTION;
  }
}
