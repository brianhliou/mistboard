import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthUser, setAccountNavUser } from './account-nav.js';
import { buildPatronPage, renderPatronShellForPrerender } from './patron-page.js';

// The card hydrates asynchronously off /api/patron/config and the cached user.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('patron card when checkout is not configured', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/patron/config')) {
          return new Response(JSON.stringify({ configured: false, tiers: [] }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('{}', { status: 401 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  // The page has to state what Patron support costs even while checkout is off:
  // it is the only public description of what this site sells.
  it('shows the four monthly amounts', async () => {
    const page = buildPatronPage('en');
    document.body.append(page);
    await settle();

    const amounts = [...page.querySelectorAll<HTMLElement>('.patron-amount-btn')].map(
      (el) => el.textContent,
    );
    expect(amounts).toEqual(['$5', '$10', '$20', '$50']);
  });

  it('offers no way to start a charge', async () => {
    const page = buildPatronPage('en');
    document.body.append(page);
    await settle();

    expect(page.querySelector('.patron-donate-btn')).toBeNull();
    expect(page.querySelectorAll('.patron-preview-label')).toHaveLength(1);
    expect(page.querySelector('.patron-note')?.textContent).toContain('not open yet');
  });

  // The billing rules live on /terms; the surface that takes the money has to
  // point at them, in whatever locale the reader is on.
  it('links out to the billing terms', async () => {
    const page = buildPatronPage('en');
    document.body.append(page);
    await settle();

    const link = page.querySelector<HTMLAnchorElement>('.patron-terms-line a');
    expect(link?.getAttribute('href')).toBe('/terms');
    expect(page.querySelector('.patron-terms-line')?.textContent).toContain('refunds');
  });

  // localizedHref only prefixes /rules and /blog, so the href stays bare; the
  // label still has to be readable to a zh reader.
  it('links out to the billing terms in the reader locale', async () => {
    const page = buildPatronPage('zh-Hant');
    document.body.append(page);
    await settle();

    const link = page.querySelector<HTMLAnchorElement>('.patron-terms-line a');
    expect(link?.getAttribute('href')).toBe('/terms');
    expect(link?.textContent).toBe('使用條款');
  });
});

// Checkout open with both frequencies. The form is the whole choice: a
// frequency, an amount, one button. Which payment methods each frequency can
// take is Stripe Checkout's knowledge, never this page's, so the card names
// no method and carries no caveat (docs-private/patron-track.md, 2026-09-20).
describe('patron card with monthly and one-time tiers configured', () => {
  const tiers = [
    ...['monthly_5', 'monthly_10', 'monthly_20', 'monthly_50'].map((key) => ({
      key,
      mode: 'subscription',
    })),
    ...['once_5', 'once_10', 'once_20', 'once_50'].map((key) => ({ key, mode: 'payment' })),
  ];
  const checkoutCalls: string[] = [];

  beforeEach(() => {
    checkoutCalls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/patron/config')) {
          return new Response(JSON.stringify({ configured: true, tiers }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/api/patron/checkout')) {
          checkoutCalls.push(String(init?.body));
          return new Response('{}', { status: 401 });
        }
        return new Response('{}', { status: 401 });
      }),
    );
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const frequencyButtons = (page: HTMLElement) => [
    ...page.querySelectorAll<HTMLButtonElement>('.patron-frequency .patron-segment-btn'),
  ];
  const amounts = (page: HTMLElement) =>
    [...page.querySelectorAll<HTMLElement>('.patron-amount-btn')].map((el) => el.textContent);
  const selectedFrequency = (page: HTMLElement) =>
    page.querySelector<HTMLButtonElement>('.patron-frequency .is-selected')?.dataset.frequency;

  it('offers Monthly and One-time with the same amount ladder', async () => {
    const page = buildPatronPage('en');
    document.body.append(page);
    await settle();

    expect(frequencyButtons(page).map((b) => b.textContent)).toEqual(['Monthly', 'One-time']);
    expect(selectedFrequency(page)).toBe('monthly');
    expect(amounts(page)).toEqual(['$5', '$10', '$20', '$50']);
    expect(page.querySelector('.patron-donate-btn')?.textContent).toBe('Subscribe');

    frequencyButtons(page)[1]?.click();
    expect(selectedFrequency(page)).toBe('once');
    expect(amounts(page)).toEqual(['$5', '$10', '$20', '$50']);
    expect(page.querySelector('.patron-donate-btn')?.textContent).toBe('Pay once');
  });

  it('sends the tier key for the chosen frequency and amount, never an amount', async () => {
    const page = buildPatronPage('en');
    document.body.append(page);
    await settle();

    frequencyButtons(page)[1]?.click();
    page.querySelectorAll<HTMLButtonElement>('.patron-amount-btn')[2]?.click();
    page.querySelector<HTMLButtonElement>('.patron-donate-btn')?.click();
    await settle();

    expect(checkoutCalls).toEqual([JSON.stringify({ tier: 'once_20' })]);
  });

  it('opens on One-time for a zh-Hans reader, by data rather than by copy', async () => {
    const page = buildPatronPage('zh-Hans');
    document.body.append(page);
    await settle();

    expect(selectedFrequency(page)).toBe('once');
    expect(page.querySelector('.patron-donate-btn')?.textContent).toBe('单次付款');

    const hant = buildPatronPage('zh-Hant');
    document.body.append(hant);
    await settle();
    expect(selectedFrequency(hant)).toBe('monthly');
  });

  it('names no payment method and carries no caveat in the card', async () => {
    for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as const) {
      const page = buildPatronPage(locale);
      document.body.append(page);
      await settle();

      const card = page.querySelector('.patron-card')?.textContent ?? '';
      expect(card).not.toMatch(/alipay|wechat|支付宝|支付寶|微信|card|银行卡|信用卡|note/i);
      expect(card).not.toMatch(/cannot|can't|not available|不能|无法|無法/);
      document.body.innerHTML = '';
    }
  });

  it('shows only the amount segment when a single frequency is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ configured: true, tiers: tiers.filter((t) => t.mode === 'payment') }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const page = buildPatronPage('en');
    document.body.append(page);
    await settle();

    expect(page.querySelector('.patron-frequency')).toBeNull();
    expect(amounts(page)).toEqual(['$5', '$10', '$20', '$50']);
    expect(page.querySelector('.patron-donate-btn')?.textContent).toBe('Pay once');
  });
});

// A signed-in patron. What the badge rests on decides the card: a subscriber
// gets the portal; a one-time patron gets the end date and keeps the form,
// since there is nothing to manage and they may want to extend or subscribe.
describe('patron card for a current patron', () => {
  const tiers = [
    { key: 'monthly_10', mode: 'subscription' },
    { key: 'once_10', mode: 'payment' },
  ];
  const stub = (status: { subscription: boolean; until: string | null }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
        if (url.includes('/api/patron/config')) return json({ configured: true, tiers });
        if (url.includes('/api/patron/status')) return json({ active: true, ...status });
        return new Response('{}', { status: 401 });
      }),
    );
    setAccountNavUser({ id: 'u1', handle: 'p', isPatron: true } as unknown as AuthUser);
  };

  afterEach(() => {
    setAccountNavUser(null);
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('offers the billing portal to a subscriber', async () => {
    stub({ subscription: true, until: null });
    const page = buildPatronPage('en');
    document.body.append(page);
    await settle();
    await settle();

    const card = page.querySelector('.patron-card');
    expect(card?.querySelector('.patron-thankyou')?.textContent).toBe(
      'You are a Patron. Thank you.',
    );
    expect(card?.querySelector('.patron-donate-btn')?.textContent).toBe('Manage your subscription');
    expect(card?.querySelector('.patron-form')).toBeNull();
  });

  it('tells a one-time patron how long the badge runs and keeps the form', async () => {
    stub({ subscription: false, until: '2026-10-20T22:08:40.000Z' });
    const page = buildPatronPage('en');
    document.body.append(page);
    await settle();
    await settle();

    const card = page.querySelector('.patron-card');
    expect(card?.querySelector('.patron-thankyou')?.textContent).toBe(
      'You are a Patron until October 20, 2026. Thank you.',
    );
    expect(card?.textContent).not.toContain('Manage your subscription');
    expect(card?.querySelector('.patron-form')).not.toBeNull();
    expect(card?.querySelector('.patron-donate-btn')?.textContent).toBe('Subscribe');
  });
});

// The baked /patron frame. `dist/patron.html` is served as-is by
// servePrerenderedPage, so whatever this returns IS the page a crawler, a
// no-JS reader, or a payment processor fetching the URL gets. It shipped as an
// empty shell until 2026-09-04, which meant the route that names the product
// and its price described neither outside of a meta tag.
describe('prerendered patron shell', () => {
  it('states the price without running the app', () => {
    const html = renderPatronShellForPrerender('en');

    for (const amount of ['$5', '$10', '$20', '$50']) {
      expect(html).toContain(amount);
    }
  });

  it('states what a subscription is and is not', () => {
    const html = renderPatronShellForPrerender('en');

    // What is sold, and the two claims a reviewer of a "restricted business"
    // asks about: it buys a cosmetic badge, and it is not a charitable gift.
    expect(html).toContain('optional monthly subscription');
    expect(html).toContain('heart badge');
    expect(html).toContain('not tax-deductible');
    // Cancellation and refunds, plus the pointer to the full billing terms.
    expect(html).toContain('/terms');
  });

  // The status note is the one line in the preview card that tracks live
  // config. A build artifact cannot follow STRIPE_PRICE_* being set on Railway,
  // so baking it would leave the page claiming checkout is off after it is on.
  it('omits the checkout-status note, which only the live card can know', () => {
    expect(renderPatronShellForPrerender('en')).not.toContain('not open yet');
  });

  it('bakes real content rather than the loading placeholder', () => {
    const html = renderPatronShellForPrerender('en');

    expect(html).toContain('patron-form-preview');
    expect(html).not.toContain('<p>\u2026</p>');
  });
});
