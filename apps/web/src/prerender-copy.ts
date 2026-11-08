import { LOCALE_META, LOCALE_STORAGE_KEY, type Locale } from './i18n/locale.js';

// Crawler markup replaces the empty shell without adding a first-paint UI.
// The client mount replaces this wrapper; app-base.css reveals it after 4s
// only when scripts do not run, or immediately on startup restoration.
export function prerenderCopy(...nodes: HTMLElement[]): string {
  const copy = document.createElement('div');
  copy.className = 'crawler-copy';
  copy.append(...nodes);
  return copy.outerHTML;
}

// Existing mounts and their helpers resolve locale from the URL/storage.
// Scope both to this render so callers cannot accidentally bake English into zh.
export async function prerenderMount(
  locale: Locale,
  mount: (root: HTMLElement) => void | Promise<void>,
): Promise<string> {
  const url = window.location.href;
  const title = document.title;
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  const path = window.location.pathname.replace(/^\/zh-han[st](?=\/|$)/, '');
  try {
    window.history.replaceState(null, '', `${LOCALE_META[locale].pathPrefix}${path || '/'}`);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    const root = document.createElement('div');
    await mount(root);
    return prerenderCopy(root);
  } finally {
    window.history.replaceState(null, '', url);
    document.title = title;
    if (stored === null) window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    else window.localStorage.setItem(LOCALE_STORAGE_KEY, stored);
  }
}
