// /washington-xiangqi: the page of Washington Xiangqi (华州象棋), an effort
// to start casual in-person xiangqi in Bellevue. Mistboard hosts the page until
// the club has a site of its own; washingtonxiangqi.org and .com forward here.
// The club is not a Mistboard surface, so the page has the site nav but not the
// /about rail, and its copy is English only until the club has a Chinese text of
// its own.
// Rules for the copy (private issue 19, 2026-11-03): say plainly that nothing
// is running yet; no venue or partner is named until they agree; no event,
// group, turnout or helper is described until it exists; no "first" or "only"
// claims. The contact is the club address, which forwards to the organizer.
// The email sign-up form (#629) stays built but unmounted until its activation
// (#663) ships; a page must never offer a form that answers 503.

import './static-page-shell.css';
import './club-washington-page.css';
import { currentLocale, type Locale } from './i18n/locale.js';
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
// Served by apps/server/src/routes/club-signup.ts.
export const CLUB_SIGNUP_ENDPOINT = '/api/club/washington/subscribe';

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

  const status = document.createElement('p');
  status.className = 'club-status';
  status.textContent = 'In-person xiangqi for Greater Seattle. Meetups forming in Bellevue.';

  section.append(
    heading,
    status,
    proseParagraph([
      'Washington Xiangqi is building a regular in-person game of xiangqi, Chinese chess, for players across Greater Seattle, starting on the Eastside in Bellevue. Every level is welcome, from lifelong players to people just learning the moves.',
    ]),
    buildContact(),

    proseSubheading('What happens next'),
    proseParagraph([
      'Everyone who writes in gets the date and place of the opening meetup: a few boards in a public space in Bellevue. Once there is a core of regulars, it becomes a standing weekly game, with someone at the table to teach newcomers.',
    ]),

    proseSubheading('Organizer'),
    proseParagraph([
      'Brian H. Liou builds and runs ',
      proseLink('Mistboard', '/'),
      ', an online home for xiangqi and its variants with live play, lessons for beginners, tournament broadcasts and puzzles from real games. ',
      proseLink('About Brian', '/about#who'),
      '.',
    ]),

    proseSubheading('Get involved'),
    proseParagraph(['We are looking for:']),
    clubList([
      [
        'Venues: ',
        'a cafe, library or community room in Greater Seattle that can host a few boards.',
      ],
      ['Organizers: ', 'people who have run a club, a school chess program or a community event.'],
      [
        'Players: ',
        'anyone who wants a regular game, at any level. New to xiangqi? ',
        proseLink('Learn the rules', '/learn/xiangqi'),
        ' before you come.',
      ],
    ]),
    proseParagraph([
      'Write to ',
      proseLink(CLUB_WASHINGTON_EMAIL, `mailto:${CLUB_WASHINGTON_EMAIL}`),
      '. Mistboard hosts this page for Washington Xiangqi.',
    ]),
  );
  return section;
}

// The one way in while nothing is running: the club address, which forwards to
// the organizer. WeChat users are asked for an ID in the mail; a QR goes on the
// page only once a real image exists.
/** A plain list whose items open with a bold label. */
function clubList(items: Array<[string, ...Array<string | Node>]>): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'club-list';
  for (const [label, ...rest] of items) {
    const item = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = label;
    item.append(strong, ...rest);
    list.append(item);
  }
  return list;
}

function buildContact(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'club-contact';
  const label = document.createElement('p');
  label.className = 'club-contact-label';
  label.textContent = 'To play, learn or help, write to';
  const address = proseLink(CLUB_WASHINGTON_EMAIL, `mailto:${CLUB_WASHINGTON_EMAIL}`);
  address.classList.add('club-contact-address');
  const note = document.createElement('p');
  note.className = 'club-contact-note';
  note.textContent =
    'Tell us your level and where in the area you are. If you prefer WeChat, include your WeChat ID.';
  box.append(label, address, note);
  return box;
}

// The announcement list form, in the visitor's locale (the rest of the page is
// English). Kept beside the page rather than in the shared i18n catalogs: the
// club is not a Mistboard surface, and its words should not ride every
// visitor's locale chunk. No em dashes in any of it.
const SIGNUP_COPY: Record<
  Locale,
  {
    introPrefix: string;
    introSuffix: string;
    label: string;
    button: string;
    note: string;
    sending: string;
    sent: string;
    invalid: string;
    rateLimited: string;
    unavailable: string;
    failed: string;
    network: string;
  }
> = {
  en: {
    introPrefix: 'Not on WeChat? Get announcements from the group by email, or write to ',
    introSuffix: '.',
    label: 'Email',
    button: 'Sign up',
    note: 'We write when there is a game or meetup to announce. Every email has an unsubscribe link.',
    sending: 'Sending...',
    sent: 'Check your inbox for a link to confirm. It works for 7 days.',
    invalid: 'Enter a valid email address.',
    rateLimited: 'Too many sign-ups from here. Try again later.',
    unavailable: `Email sign-up is not available right now. Write to ${CLUB_WASHINGTON_EMAIL} instead.`,
    failed: "Couldn't send the email. Try again in a bit.",
    network: 'Network error. Try again.',
  },
  'zh-Hans': {
    introPrefix: '不用微信？可以用邮箱订阅活动通知，或写信到 ',
    introSuffix: '。',
    label: '邮箱',
    button: '订阅',
    note: '有对局或聚会时我们会发邮件通知，每封邮件都附有退订链接。',
    sending: '发送中...',
    sent: '请查收邮件，点击其中的链接确认订阅。链接 7 天内有效。',
    invalid: '请输入有效的邮箱地址。',
    rateLimited: '提交次数过多，请稍后再试。',
    unavailable: `邮件订阅暂时无法使用，请改为写信到 ${CLUB_WASHINGTON_EMAIL}。`,
    failed: '邮件发送失败，请稍后再试。',
    network: '网络错误。请重试。',
  },
  'zh-Hant': {
    introPrefix: '不用微信？可以用電子郵件訂閱活動通知，或寫信到 ',
    introSuffix: '。',
    label: '信箱',
    button: '訂閱',
    note: '有對局或聚會時我們會寄信通知，每封郵件都附有取消訂閱連結。',
    sending: '送出中...',
    sent: '請查收郵件，點擊其中的連結確認訂閱。連結 7 天內有效。',
    invalid: '請輸入有效的電子郵件地址。',
    rateLimited: '提交次數過多，請稍後再試。',
    unavailable: `郵件訂閱暫時無法使用，請改為寫信到 ${CLUB_WASHINGTON_EMAIL}。`,
    failed: '郵件傳送失敗，請稍後再試。',
    network: '網路錯誤。請重試。',
  },
};

const HTML_LANG: Record<Locale, string> = { en: 'en', 'zh-Hans': 'zh-Hans', 'zh-Hant': 'zh-Hant' };

export function buildClubSignup(
  locale: Locale,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): HTMLElement {
  const copy = SIGNUP_COPY[locale] ?? SIGNUP_COPY.en;
  const wrap = document.createElement('div');
  wrap.className = 'club-signup';
  wrap.lang = HTML_LANG[locale] ?? 'en';

  const intro = proseParagraph([
    copy.introPrefix,
    proseLink(CLUB_WASHINGTON_EMAIL, `mailto:${CLUB_WASHINGTON_EMAIL}`),
    copy.introSuffix,
  ]);

  const form = document.createElement('form');
  form.className = 'club-signup-form';
  form.noValidate = true;

  const row = document.createElement('div');
  row.className = 'club-signup-row';
  const label = document.createElement('label');
  label.className = 'club-signup-label';
  label.htmlFor = 'club-signup-email';
  label.textContent = copy.label;
  const input = document.createElement('input');
  input.type = 'email';
  input.id = 'club-signup-email';
  input.name = 'email';
  input.autocomplete = 'email';
  input.inputMode = 'email';
  input.required = true;
  input.placeholder = 'you@example.com';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'club-signup-submit';
  submit.textContent = copy.button;
  row.append(input, submit);

  // Honeypot: hidden from people, filled in by form bots; the server answers
  // a filled one like a real sign-up and sends nothing. Not type="hidden",
  // which bots skip.
  const honeypot = document.createElement('input');
  honeypot.type = 'text';
  honeypot.name = 'website';
  honeypot.className = 'club-signup-honeypot';
  honeypot.tabIndex = -1;
  honeypot.autocomplete = 'off';
  honeypot.setAttribute('aria-hidden', 'true');

  const status = document.createElement('p');
  status.className = 'club-signup-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const note = document.createElement('p');
  note.className = 'club-signup-note';
  note.textContent = copy.note;

  form.append(label, row, honeypot, status);

  const show = (text: string, state: 'pending' | 'ok' | 'error'): void => {
    status.textContent = text;
    status.dataset.state = state;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) {
      show(copy.invalid, 'error');
      input.focus();
      return;
    }
    submit.disabled = true;
    show(copy.sending, 'pending');
    void (async () => {
      try {
        const response = await fetchImpl(CLUB_SIGNUP_ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, locale, website: honeypot.value }),
        });
        if (response.ok) {
          input.value = '';
          show(copy.sent, 'ok');
        } else if (response.status === 400) {
          show(copy.invalid, 'error');
        } else if (response.status === 429) {
          show(copy.rateLimited, 'error');
        } else if (response.status === 503) {
          show(copy.unavailable, 'error');
        } else {
          show(copy.failed, 'error');
        }
      } catch {
        show(copy.network, 'error');
      } finally {
        submit.disabled = false;
      }
    })();
  });

  wrap.append(intro, form, note);
  return wrap;
}
