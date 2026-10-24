// /washington-xiangqi: the page of Washington Xiangqi (华州象棋), a casual
// xiangqi group in Bellevue. Mistboard hosts the page until the club has a site
// of its own; washingtonxiangqi.org and .com forward here. The club is not a
// Mistboard surface, so the page has the site nav but not the /about rail, and
// its copy is English only until the club has a Chinese text of its own.
// Rules for the copy: no venue or partner is named until they agree, and no
// "first" or "only" claims.

import './static-page-shell.css';
import './club-washington-page.css';
import { currentLocale } from './i18n/locale.js';
import { buildNav } from './site-shell.js';
import {
  proseHeading,
  proseLink,
  proseParagraph,
  proseSection,
  proseSubheading,
} from './static-page-dom.js';

export const CLUB_WASHINGTON_PATH = '/washington-xiangqi';
// Forwarded by Cloudflare Email Routing on washingtonxiangqi.org.
export const CLUB_WASHINGTON_EMAIL = 'hello@washingtonxiangqi.org';

export function mountClubWashington(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'club-route');
  const layout = document.createElement('div');
  layout.className = 'club-page-layout';
  const panel = document.createElement('div');
  panel.className = 'club-page-panel';
  panel.append(buildClubWashington());
  layout.append(panel);
  root.append(buildNav(locale), layout);
}

export function buildClubWashington(): HTMLElement {
  const section = proseSection('club-section');
  section.lang = 'en';

  const name = document.createElement('span');
  name.className = 'club-name-zh';
  name.lang = 'zh-Hans';
  name.textContent = '华州象棋';

  const heading = proseHeading('Washington Xiangqi');
  heading.append(' ', name);

  section.append(
    heading,
    proseParagraph([
      'Washington Xiangqi is a casual group for people who play xiangqi, Chinese chess, in Bellevue, WA. Any level is welcome, including people who have never played.',
    ]),

    proseSubheading('What to expect'),
    proseParagraph([
      'Games are free and casual, with no sign-up. Bring a set if you have one. Players speak English, Chinese or both. If you are new, say so and someone will show you how the pieces move.',
    ]),

    proseSubheading('Join the group'),
    proseParagraph([
      'The group talks and plans its games in WeChat. Scan the code to add Brian H. Liou, the organizer, who will invite you in.',
    ]),
    buildQrPlaceholder(),
    proseParagraph([
      'Not on WeChat? Email ',
      proseLink(CLUB_WASHINGTON_EMAIL, `mailto:${CLUB_WASHINGTON_EMAIL}`),
      '.',
    ]),

    proseSubheading('Help out'),
    proseParagraph([
      'Know a cafe, library room or community space in Bellevue that would host a few boards, or want to help run the group? Email ',
      proseLink(CLUB_WASHINGTON_EMAIL, `mailto:${CLUB_WASHINGTON_EMAIL}`),
      '.',
    ]),

    proseSubheading('Between games'),
    proseParagraph([
      'New to xiangqi? ',
      proseLink('Learn the rules', '/learn/xiangqi'),
      '. To keep playing between meetups, ',
      proseLink('play online on Mistboard', '/'),
      ', free and with no account needed. Mistboard hosts this page for the group.',
    ]),
  );
  return section;
}

// The code is the organizer's own WeChat QR, not the group's: a group QR expires
// after 7 days and stops admitting at 200 members. Until the image arrives
// (2026-10-23) the box says so.
function buildQrPlaceholder(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'club-qr club-qr-pending';
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', 'WeChat QR code, coming soon');
  box.textContent = 'WeChat QR code coming soon';
  return box;
}
