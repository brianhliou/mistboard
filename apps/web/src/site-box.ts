// Shared widget shell for homepage/rail boxes, mirroring lichess's lobby__box
// grammar: a header row (title plus an optional "More »" link) over a content
// body. Widgets (news feed, activity stats, spotlights) build their rows and
// append them to `body`.
import { t } from './i18n/catalog.js';
import './site-box.css';
import './hover-grammar.css';

export type SiteBoxOptions = {
  title: string;
  // When set, the whole header row becomes a link and shows the more-label.
  href?: string;
  moreLabel?: string;
  className?: string;
};

export type SiteBox = {
  box: HTMLElement;
  body: HTMLElement;
};

export function buildSiteBox(options: SiteBoxOptions): SiteBox {
  const box = document.createElement('section');
  box.className = options.className ? `site-box ${options.className}` : 'site-box';

  const title = document.createElement('h2');
  title.className = 'site-box-title';
  title.textContent = options.title;

  if (options.href) {
    const top = document.createElement('a');
    top.className = 'site-box-top hover-link-host';
    top.href = options.href;
    const more = document.createElement('span');
    more.className = 'site-box-more hover-link-text';
    more.textContent = options.moreLabel ?? t('site.more');
    top.append(title, more);
    box.append(top);
  } else {
    const top = document.createElement('div');
    top.className = 'site-box-top';
    top.append(title);
    box.append(top);
  }

  const body = document.createElement('div');
  body.className = 'site-box-body';
  box.append(body);

  return { box, body };
}
