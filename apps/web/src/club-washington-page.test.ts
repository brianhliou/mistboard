import { describe, expect, it, vi } from 'vitest';
import {
  buildClubSignup,
  buildClubWashington,
  clubWashingtonPrerenderHead,
  mountClubWashington,
  renderClubWashingtonShellForPrerender,
} from './club-washington-page.js';
import type { Locale } from './i18n/locale.js';

// The page goes on a printed address before any venue has agreed, so it names
// no partner or venue, and it makes no "first / only / nobody else" claims.
const FORBIDDEN = [
  /emerald/i,
  /factoria/i,
  /\bfirst\b/i,
  /\bonly\b/i,
  /\bnobody\b/i,
  /首个|首個|唯一|首家|第一家/,
];

// Nothing is running yet (private issue 19, 2026-11-03), so the page must not
// describe a standing group, a chat to join or a recurring game as if it exists.
const ESTABLISHED = [
  /join (the|our) (group|chat)/i,
  /\bwe meet\b/i,
  /\bevery (week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
  /\bgroup chat\b/i,
  /coming soon/i,
];

function forbiddenTerms(text: string): string[] {
  return FORBIDDEN.filter((pattern) => pattern.test(text)).map(String);
}

function establishedClaims(text: string): string[] {
  return ESTABLISHED.filter((pattern) => pattern.test(text)).map(String);
}

const LOCALES = ['en', 'zh-Hans', 'zh-Hant'] as const;
const EXPECTED = {
  en: {
    title: 'Washington Xiangqi: Chinese chess in Greater Seattle',
    h1: 'Washington Xiangqi 华州象棋',
    name: '华州象棋',
    status: 'In-person xiangqi for Greater Seattle. Meetups forming in Bellevue.',
    headings: ['What happens next', 'Organizer', 'Get involved'],
    labels: ['Venues: ', 'Organizers: ', 'Players: '],
    about: 'About Brian',
    rules: 'Learn the rules',
    snippets: [
      'Every level is welcome',
      'Tell us your level',
      'include your WeChat ID',
      'standing weekly game',
      'We are looking for:',
      'Mistboard hosts this page for Washington Xiangqi.',
    ],
  },
  'zh-Hans': {
    title: '华州象棋 Washington Xiangqi：大西雅图地区的象棋',
    h1: 'Washington Xiangqi 华州象棋',
    name: '华州象棋',
    status: '面向大西雅图地区的线下象棋。正在贝尔维尤筹备聚会。',
    headings: ['接下来会怎样', '组织者', '参与其中'],
    labels: ['场地：', '组织者：', '棋友：'],
    about: '关于 Brian',
    rules: '学习规则',
    snippets: [
      '欢迎各种水平的棋友',
      '请告诉我们你的棋艺水平',
      '请在邮件中留下微信号',
      '固定的每周对局',
      '我们正在寻找：',
      '本页面由 Mistboard 为华州象棋提供。',
    ],
  },
  'zh-Hant': {
    title: '華州象棋 Washington Xiangqi：大西雅圖地區的象棋',
    h1: 'Washington Xiangqi 華州象棋',
    name: '華州象棋',
    status: '面向大西雅圖地區的實體象棋。正在貝爾維尤籌備聚會。',
    headings: ['接下來會怎樣', '組織者', '參與其中'],
    labels: ['場地：', '組織者：', '棋友：'],
    about: '關於 Brian',
    rules: '學習規則',
    snippets: [
      '歡迎各種程度的棋友',
      '請告訴我們你的棋藝程度',
      '請在郵件中留下微信號',
      '固定的每週對局',
      '我們正在尋找：',
      '本頁面由 Mistboard 為華州象棋提供。',
    ],
  },
};

describe.each(LOCALES)('Washington Xiangqi page (%s)', (locale) => {
  const page = buildClubWashington(locale);
  const expected = EXPECTED[locale];
  const text = page.textContent ?? '';

  it('names the club in English and Chinese', () => {
    expect(page.querySelector('h1')?.textContent).toBe(expected.h1);
    expect(page.querySelector('.club-name-zh')?.textContent).toBe(expected.name);
    expect(page.lang).toBe(locale);
  });

  it('says plainly that nothing is running yet', () => {
    expect(page.querySelector('.club-status')?.textContent).toBe(expected.status);
  });

  it('renders every section in its own locale without English fallback', () => {
    expect(Array.from(page.querySelectorAll('h2'), (el) => el.textContent)).toEqual(
      expected.headings,
    );
    expect(Array.from(page.querySelectorAll('.club-list strong'), (el) => el.textContent)).toEqual(
      expected.labels,
    );
    expect(page.querySelector('a[href="/about#who"]')?.textContent).toBe(expected.about);
    expect(page.querySelector('a[href$="/learn/xiangqi"]')?.textContent).toBe(expected.rules);
    for (const snippet of expected.snippets) expect(text).toContain(snippet);
    if (locale !== 'en') {
      // Names and the address stay in Latin script; other Latin prose means
      // an English fallback, even in a single paragraph or list item.
      expect(
        text.replace(
          /Washington Xiangqi|Mistboard|Brian H\. Liou|Brian|hello@washingtonxiangqi\.org/g,
          '',
        ),
      ).not.toMatch(/[a-z]/i);
    }
  });

  it('mounts the visitor locale and title', () => {
    const previousPath = window.location.pathname;
    const storage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: () => locale },
    });
    try {
      const routes = new Set([
        '/washington-xiangqi',
        locale === 'en' ? '/washington-xiangqi' : `/${locale.toLowerCase()}/washington-xiangqi`,
      ]);
      for (const route of routes) {
        window.history.replaceState(null, '', route);
        const root = document.createElement('div');
        mountClubWashington(root);
        expect(document.title).toBe(expected.title);
        expect(root.querySelector('.club-section')?.getAttribute('lang')).toBe(locale);
        expect(root.querySelector('h1')?.textContent).toBe(expected.h1);
      }
    } finally {
      window.history.replaceState(null, '', previousPath);
      if (storage) Object.defineProperty(window, 'localStorage', storage);
      else Reflect.deleteProperty(window, 'localStorage');
    }
  });

  it('prerenders localized body and head with reciprocal alternates', () => {
    const head = clubWashingtonPrerenderHead('https://mistboard.com', locale);
    const shell = document.createElement('div');
    shell.innerHTML = renderClubWashingtonShellForPrerender(locale);
    expect(shell.querySelector('.club-section')?.outerHTML).toBe(page.outerHTML);
    expect(head.title).toBe(expected.title);
    expect(head.htmlLang).toBe(locale);
    expect(head.url).toBe(
      `https://mistboard.com${locale === 'en' ? '' : `/${locale.toLowerCase()}`}/washington-xiangqi`,
    );
    const links = document.createElement('div');
    links.innerHTML = head.headLinks;
    expect(links.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(head.url);
    for (const lang of LOCALES) {
      expect(links.querySelector(`link[hreflang="${lang}"]`)?.getAttribute('href')).toBe(
        `https://mistboard.com${lang === 'en' ? '' : `/${lang.toLowerCase()}`}/washington-xiangqi`,
      );
    }
    expect(links.querySelector('link[hreflang="x-default"]')?.getAttribute('href')).toBe(
      'https://mistboard.com/washington-xiangqi',
    );
    expect(forbiddenTerms(`${head.title} ${head.description}`)).toEqual([]);
    expect(`${head.title} ${head.description}`).not.toMatch(/\u2014/);
  });

  it('offers the club address as the way in, with no placeholder QR or dead form', () => {
    const contact = page.querySelector('.club-contact');
    expect(contact?.querySelector('a[href="mailto:hello@washingtonxiangqi.org"]')).not.toBeNull();
    expect(page.querySelector('.club-qr, .club-qr-pending')).toBeNull();
    expect(page.querySelector('form, .club-signup')).toBeNull();
  });

  it('introduces the organizer and links his About entry', () => {
    expect(text).toContain('Brian H. Liou');
    expect(page.querySelector('a[href="/about#who"]')).not.toBeNull();
  });

  it('describes no group, chat or recurring game as already running', () => {
    expect(establishedClaims(text)).toEqual([]);
  });

  it('the running-group guard catches planted claims', () => {
    expect(
      establishedClaims('Join the group: we meet every Saturday. QR coming soon.'),
    ).toHaveLength(4);
  });

  it('uses no em dashes', () => {
    expect(text).not.toMatch(/\u2014/);
  });

  it('announces no event yet', () => {
    expect(text).not.toMatch(/lunar new year|february/i);
  });

  it('names no venue or partner and makes no first or only claims', () => {
    expect(forbiddenTerms(text)).toEqual([]);
  });

  it('the copy guard catches a planted claim and a planted venue', () => {
    expect(forbiddenTerms('The only xiangqi club at Emerald Parents')).toHaveLength(2);
    expect(forbiddenTerms('首个象棋俱乐部，唯一的棋社')).toHaveLength(1);
    expect(forbiddenTerms('首個象棋俱樂部，唯一的棋社')).toHaveLength(1);
  });
});

describe('Washington Xiangqi email sign-up', () => {
  const BUTTONS: Record<Locale, string> = { en: 'Sign up', 'zh-Hans': '订阅', 'zh-Hant': '訂閱' };

  // Built but not mounted on the page until activation (#663) ships.
  it.each(['en', 'zh-Hans', 'zh-Hant'] as const)('renders the form in %s', (locale) => {
    const signup = buildClubSignup(locale);
    expect(signup?.lang).toBe(locale);
    expect(signup?.querySelector('input[type="email"][name="email"]')).not.toBeNull();
    expect(signup?.querySelector('button[type="submit"]')?.textContent).toBe(BUTTONS[locale]);
    // The honeypot is a text field, not type=hidden, and out of the tab order.
    const honeypot = signup?.querySelector<HTMLInputElement>('input[name="website"]');
    expect(honeypot?.type).toBe('text');
    expect(honeypot?.tabIndex).toBe(-1);
    expect(signup?.querySelector('a[href="mailto:hello@washingtonxiangqi.org"]')).not.toBeNull();
    expect(signup?.textContent).not.toMatch(/—/);
  });

  function submitWith(locale: Locale, httpStatus: number, honeypotValue = '') {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: httpStatus });
    }) as typeof fetch;
    const el = buildClubSignup(locale, fetchImpl);
    document.body.append(el);
    const input = el.querySelector<HTMLInputElement>('input[name="email"]') as HTMLInputElement;
    const honeypot = el.querySelector<HTMLInputElement>(
      'input[name="website"]',
    ) as HTMLInputElement;
    input.value = 'player@example.com';
    honeypot.value = honeypotValue;
    el.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    const status = el.querySelector('.club-signup-status') as HTMLElement;
    return { calls, status };
  }

  it('posts the address, locale and honeypot to the club endpoint', async () => {
    const { calls, status } = submitWith('zh-Hant', 202);
    await vi.waitFor(() => expect(status.dataset.state).toBe('ok'));
    expect(calls).toEqual([
      {
        url: '/api/club/washington/subscribe',
        body: { email: 'player@example.com', locale: 'zh-Hant', website: '' },
      },
    ]);
    expect(status.textContent).toContain('7 天');
  });

  it('says sign-up is unavailable when the server answers 503', async () => {
    const { status } = submitWith('en', 503);
    await vi.waitFor(() => expect(status.dataset.state).toBe('error'));
    expect(status.textContent).toContain('not available');
    expect(status.textContent).toContain('hello@washingtonxiangqi.org');
  });

  it('refuses an obvious non-address without a request', () => {
    const calls: unknown[] = [];
    const el = buildClubSignup('en', (async () => {
      calls.push(1);
      return new Response('{}');
    }) as typeof fetch);
    (el.querySelector('input[name="email"]') as HTMLInputElement).value = 'not an email';
    el.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(calls).toHaveLength(0);
    expect(el.querySelector('.club-signup-status')?.getAttribute('data-state')).toBe('error');
  });
});
