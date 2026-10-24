import { describe, expect, it, vi } from 'vitest';
import { buildClubSignup, buildClubWashington } from './club-washington-page.js';
import type { Locale } from './i18n/locale.js';

// The page goes on a printed address before any venue has agreed, so it names
// no partner or venue, and it makes no "first / only / nobody else" claims.
const FORBIDDEN = [/emerald/i, /factoria/i, /\bfirst\b/i, /\bonly\b/i, /\bnobody\b/i];

function forbiddenTerms(text: string): string[] {
  return FORBIDDEN.filter((pattern) => pattern.test(text)).map(String);
}

describe('Washington Xiangqi page', () => {
  const page = buildClubWashington('en');
  const text = page.textContent ?? '';

  it('names the club in English and Chinese', () => {
    expect(page.querySelector('h1, h2')?.textContent).toContain('Washington Xiangqi');
    expect(page.querySelector('[lang="zh-Hans"]')?.textContent).toBe('华州象棋');
  });

  it('carries the WeChat placeholder and an email route', () => {
    expect(page.querySelector('.club-qr-pending')).not.toBeNull();
    expect(page.querySelector('a[href="mailto:hello@washingtonxiangqi.org"]')).not.toBeNull();
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

  it.each(['en', 'zh-Hans', 'zh-Hant'] as const)('renders the form in %s', (locale) => {
    const page = buildClubWashington(locale);
    const signup = page.querySelector<HTMLElement>('.club-signup');
    expect(signup?.lang).toBe(locale);
    expect(signup?.querySelector('input[type="email"][name="email"]')).not.toBeNull();
    expect(signup?.querySelector('button[type="submit"]')?.textContent).toBe(BUTTONS[locale]);
    // The honeypot is a text field, not type=hidden, and out of the tab order.
    const honeypot = signup?.querySelector<HTMLInputElement>('input[name="website"]');
    expect(honeypot?.type).toBe('text');
    expect(honeypot?.tabIndex).toBe(-1);
    expect(signup?.querySelector('a[href="mailto:hello@washingtonxiangqi.org"]')).not.toBeNull();
    // It replaced the old line rather than sitting beside it.
    expect(page.textContent).not.toContain('Not on WeChat? Email');
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
