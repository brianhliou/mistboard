// /streamer: the public streamers directory (lichess.org/streamer equivalent).
// Curated, not crowd-sourced: the list lives in streamers-data.ts and a new
// streamer is a code edit, so there is no backend, no channel verification, and
// no live-status polling. The page says who streams xiangqi here, not who is
// live right now.
//
// With no listings, a direct visit invites creators to work with us. The nav
// still waits for the first real streamer before promoting the directory.

import './streamer.css';
import { buildCreatorInvitation } from './creator-invitation.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { prerenderMount } from './prerender-copy.js';
import { buildNav } from './site-shell.js';
import { STREAMERS, type StreamerEntry } from './streamers-data.js';

const PLATFORM_LABELS: Record<StreamerEntry['platform'], string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
};

export function renderStreamerShellForPrerender(locale: Locale): Promise<string> {
  return prerenderMount(locale, mountStreamer);
}

export function mountStreamer(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'streamer-route');

  const shell = document.createElement('main');
  shell.className = 'site-section streamer-shell';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('streamer.heading', {}, locale);

  const intro = document.createElement('p');
  intro.className = 'streamer-intro';
  intro.textContent = t('streamer.intro', {}, locale);

  shell.append(heading, intro);

  if (STREAMERS.length === 0) {
    shell.append(buildCreatorInvitation('streamer', locale));
    const empty = document.createElement('p');
    empty.className = 'streamer-empty';
    empty.textContent = t('streamer.empty', {}, locale);
    shell.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'streamer-list';
    for (const streamer of STREAMERS) list.append(buildStreamerCard(streamer, locale));
    shell.append(list);
    shell.append(buildCreatorInvitation('streamer', locale));
  }

  root.append(buildNav(locale), shell);
}

function buildStreamerCard(streamer: StreamerEntry, locale: Locale): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'streamer-card';

  const channel = document.createElement('a');
  channel.className = 'streamer-card-name';
  channel.href = streamer.url;
  // An external channel link: never same-tab, and never passing referrer or
  // window handle to a third-party host.
  channel.rel = 'nofollow noopener noreferrer';
  channel.target = '_blank';
  channel.textContent = streamer.name;

  const platform = document.createElement('span');
  platform.className = 'streamer-card-platform';
  platform.textContent = PLATFORM_LABELS[streamer.platform];

  const head = document.createElement('p');
  head.className = 'streamer-card-head';
  head.append(channel, platform);

  const blurb = document.createElement('p');
  blurb.className = 'streamer-card-blurb';
  blurb.textContent = streamer.blurb;

  item.append(head, blurb);

  const meta = document.createElement('p');
  meta.className = 'streamer-card-meta';
  meta.append(streamer.language);
  if (streamer.handle) {
    const profile = document.createElement('a');
    profile.className = 'streamer-card-profile';
    profile.href = `/@/${encodeURIComponent(streamer.handle)}`;
    profile.textContent = t('streamer.profileLink', {}, locale);
    meta.append(' · ', profile);
  }
  item.append(meta);

  return item;
}
