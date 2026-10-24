import { describe, expect, it } from 'vitest';
import { buildClubWashington } from './club-washington-page.js';

// The page goes on a printed address before any venue has agreed, so it names
// no partner or venue, and it makes no "first / only / nobody else" claims.
const FORBIDDEN = [/emerald/i, /factoria/i, /\bfirst\b/i, /\bonly\b/i, /\bnobody\b/i];

function forbiddenTerms(text: string): string[] {
  return FORBIDDEN.filter((pattern) => pattern.test(text)).map(String);
}

describe('Washington Xiangqi page', () => {
  const page = buildClubWashington();
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
