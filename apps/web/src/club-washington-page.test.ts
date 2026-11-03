import { describe, expect, it, vi } from 'vitest';
import { buildClubSignup, buildClubWashington } from './club-washington-page.js';
import type { Locale } from './i18n/locale.js';

// The page goes on a printed address before any venue has agreed, so it names
// no partner or venue, and it makes no "first / only / nobody else" claims.
const FORBIDDEN = [/emerald/i, /factoria/i, /\bfirst\b/i, /\bonly\b/i, /\bnobody\b/i];

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

describe('Washington Xiangqi page', () => {
  const page = buildClubWashington();
  const text = page.textContent ?? '';

  it('names the club in English and Chinese', () => {
    expect(page.querySelector('h1, h2')?.textContent).toContain('Washington Xiangqi');
    expect(page.querySelector('[lang="zh-Hans"]')?.textContent).toBe('华州象棋');
  });

  it('says plainly that nothing is running yet', () => {
    expect(page.querySelector('.club-status')?.textContent).toBe(
      'In-person xiangqi for Greater Seattle. Meetups forming in Bellevue.',
    );
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
