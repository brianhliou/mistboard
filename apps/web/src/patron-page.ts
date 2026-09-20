// Patron support page (078). Styled as a warm hero banner with a two-column
// body (intro prose left, support card right). Honest, independent-project
// framing: core play stays free, Patron support buys only cosmetic recognition,
// separate paid products may exist, and support is explicitly NOT tax-deductible
// (Mistboard is not a registered charity). The card reads
// /api/patron/config for live/unavailable state and the current user for the
// "you are a Patron / manage" path.

import type { AuthUser } from './account-nav.js';
import { loadCachedCurrentUser } from './account-nav.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { buildNav } from './site-shell.js';

type PatronTierMode = 'subscription' | 'payment';
type PatronTierConfig = { key: string; mode: PatronTierMode };
type PatronConfigResponse = { configured: boolean; tiers: PatronTierConfig[] };

// The two frequencies the form offers, by Checkout mode: a monthly
// subscription, or a one-time payment. Stripe Checkout decides which payment
// methods each mode can take (cards for subscriptions; cards, Alipay and
// WeChat Pay for one-time), so this page never names a method and carries no
// caveat about one: the frequency is the whole choice.
type Frequency = 'monthly' | 'once';
const FREQUENCY_FOR_MODE: Record<PatronTierMode, Frequency> = {
  subscription: 'monthly',
  payment: 'once',
};

// USD display amounts for each tier key. The server maps the key to a Stripe
// price; the client only ever sends the key, never an amount.
const TIER_AMOUNT: Record<string, string> = {
  monthly_5: '$5',
  monthly_10: '$10',
  monthly_20: '$20',
  monthly_50: '$50',
  once_5: '$5',
  once_10: '$10',
  once_20: '$20',
  once_50: '$50',
};

const DEFAULT_AMOUNT = '10';

// The one locale-aware line. A zh-Hans reader is most likely on the mainland,
// where the wallet in hand is Alipay or WeChat Pay and a card subscription is
// the option that fails; open on the frequency that wallet can pay. Same
// pattern as the piece-set default by locale: one line of data, no copy.
const DEFAULT_FREQUENCY_BY_LOCALE: Partial<Record<Locale, Frequency>> = { 'zh-Hans': 'once' };

// The monthly tiers shown when the live config is unavailable. These mirror the
// Stripe prices; they are display-only and never sent to the checkout endpoint.
const PREVIEW_MONTHLY_TIERS = ['monthly_5', 'monthly_10', 'monthly_20', 'monthly_50'];

// The hero mascot: a Jungle (Dou Shou Qi) animal, reusing the shipped
// dobutsu-minimal piece art (apps/web/public/piece-sets/jungle/dobutsu). The
// elephant is the game's apex piece; framed as a token disc on each side of the
// heading (red + black, the two board colors) it reads as a warm thank-you
// without copying anyone's wings.
const MASCOT_ROLE = 'elephant';

type PatronPageOptions = {
  /** Build-time render: bake the tier card instead of the loading label and skip
   *  the live /api/patron/config + current-user fetches, which resolve to nothing
   *  under happy-dom and would leave a bare ellipsis card in the baked HTML. */
  prerender?: boolean;
};

export function buildPatronPage(
  locale: Locale = currentLocale(),
  options: PatronPageOptions = {},
): HTMLElement {
  const page = document.createElement('div');
  page.className = 'patron-page';
  page.append(buildHero(locale), buildBody(locale, options));
  return page;
}

/** Build-time shell for /patron (prerender-articles.mjs). The page is authored
 *  copy plus four fixed amounts, so the baked DOM is what a reader gets; the SPA
 *  still replaces it on boot with the live-config card. Without this the route
 *  served a bare shell that carried the product only in a meta description: what
 *  the site sells has to be legible without running JavaScript, both for readers
 *  and for anyone (a crawler, a payment processor) checking the page by fetching
 *  it. This is the one page whose whole job is to say what is for sale. */
export function renderPatronShellForPrerender(locale: Locale = 'en'): string {
  return `${buildNav(locale).outerHTML}${buildPatronPage(locale, { prerender: true }).outerHTML}`;
}

function buildHero(locale: Locale): HTMLElement {
  const hero = document.createElement('div');
  hero.className = 'patron-hero';

  const text = document.createElement('div');
  text.className = 'patron-hero-text';
  const title = document.createElement('h1');
  title.className = 'patron-hero-title';
  title.textContent = t('patron.heroTitle', {}, locale);
  const subtitle = document.createElement('p');
  subtitle.className = 'patron-hero-subtitle';
  subtitle.textContent = t('patron.heroSubtitle', {}, locale);
  text.append(title, subtitle);

  hero.append(mascotDisc('red'), text, mascotDisc('black'));
  return hero;
}

function buildBody(locale: Locale, options: PatronPageOptions): HTMLElement {
  const body = document.createElement('div');
  body.className = 'patron-body';

  const intro = document.createElement('div');
  intro.className = 'patron-intro-col';
  intro.append(
    para(t('patron.intro', {}, locale)),
    subheading(t('patron.perkTitle', {}, locale)),
    para(t('patron.perk', {}, locale)),
    subheading(t('patron.transparencyTitle', {}, locale)),
    para(t('patron.transparency', {}, locale)),
    subheading(t('patron.faqTitle', {}, locale)),
    faqRow('patron.faqPerkQuestion', 'patron.faqPerkAnswer', locale),
    faqRow('patron.faqTaxQuestion', 'patron.faqTaxAnswer', locale),
    faqRow('patron.faqCancelQuestion', 'patron.faqCancelAnswer', locale),
    faqRow('patron.faqPayQuestion', 'patron.faqPayAnswer', locale),
    termsLine(locale),
  );

  const donate = document.createElement('div');
  donate.className = 'patron-donate-col';
  const card = document.createElement('div');
  card.className = 'patron-card';
  // The baked card omits the checkout-status note: that line is the one part of
  // the preview that depends on live config, and a build artifact cannot follow
  // STRIPE_PRICE_* being set on Railway. Everything else here is true under
  // every config.
  card.append(
    options.prerender ? buildTierPreview(locale, { statusNote: false }) : para(loadingLabel()),
  );
  const supportLine = document.createElement('p');
  supportLine.className = 'patron-support-line';
  supportLine.textContent = t('patron.supportLine', {}, locale);
  donate.append(card, supportLine);

  body.append(intro, donate);
  if (!options.prerender) void hydrateCard(card, locale);
  return body;
}

async function hydrateCard(card: HTMLElement, locale: Locale): Promise<void> {
  const [config, user] = await Promise.all([
    fetchConfig(),
    loadCachedCurrentUser().catch(() => null),
  ]);

  if (user?.isPatron) {
    card.replaceChildren(
      thankYou(t('patron.alreadyPatron', {}, locale)),
      actionButton(t('patron.manage', {}, locale), () => void startPortal()),
    );
    return;
  }

  if (!config?.configured || config.tiers.length === 0) {
    card.replaceChildren(buildTierPreview(locale));
    return;
  }

  card.replaceChildren(buildDonateForm(config.tiers, user, locale));
}

// Before checkout is switched on, the card still shows what Patron support will
// cost. Anyone reading the page (a prospective patron, or a payment processor
// reviewing what this site sells) can see the four monthly tiers instead of a
// bare "not set up yet". The amounts are display-only: no tier is selectable and
// there is no button, so nothing here can start a charge.
function buildTierPreview(
  locale: Locale,
  options: { statusNote: boolean } = { statusNote: true },
): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'patron-form patron-form-preview';

  const label = document.createElement('p');
  label.className = 'patron-preview-label';
  label.textContent = t('patron.frequencyMonthly', {}, locale);

  const amounts = document.createElement('div');
  amounts.className = 'patron-segment patron-amounts';
  for (const key of PREVIEW_MONTHLY_TIERS) {
    const amount = document.createElement('span');
    amount.className = 'patron-segment-btn patron-amount-btn is-preview';
    amount.textContent = TIER_AMOUNT[key] ?? key;
    amounts.append(amount);
  }

  preview.append(label, amounts);
  if (options.statusNote) preview.append(note(t('patron.unavailable', {}, locale)));
  return preview;
}

// The donation form mirrors lichess: a frequency segment (Monthly / One-time),
// an amount segment for the chosen frequency, and one prominent button whose
// label follows the frequency.
function buildDonateForm(
  tiers: PatronTierConfig[],
  user: AuthUser | null,
  locale: Locale,
): HTMLElement {
  const byFrequency: Record<Frequency, PatronTierConfig[]> = { monthly: [], once: [] };
  for (const tier of tiers) byFrequency[FREQUENCY_FOR_MODE[tier.mode]].push(tier);
  const offered = (['monthly', 'once'] as const).filter((f) => byFrequency[f].length > 0);

  const form = document.createElement('div');
  form.className = 'patron-form';

  // Selection state: the locale's preferred frequency when it is offered,
  // else the first offered one; the default amount when the frequency has it.
  const preferred = DEFAULT_FREQUENCY_BY_LOCALE[locale];
  let frequency: Frequency =
    preferred && offered.includes(preferred) ? preferred : (offered[0] ?? 'monthly');
  let selectedKey = '';

  const freqSegment = document.createElement('div');
  freqSegment.className = 'patron-segment patron-frequency';
  const amountSegment = document.createElement('div');
  amountSegment.className = 'patron-segment patron-amounts';
  const donateBtn = document.createElement('button');
  donateBtn.type = 'button';
  donateBtn.className = 'patron-donate-btn';

  const amountOf = (key: string): string => key.slice(key.indexOf('_') + 1);
  const renderFrequency = (): void => {
    const options = byFrequency[frequency];
    selectedKey =
      options.find((tier) => amountOf(tier.key) === DEFAULT_AMOUNT)?.key ?? options[0]?.key ?? '';
    amountSegment.replaceChildren();
    for (const tier of options) {
      const btn = segmentButton(TIER_AMOUNT[tier.key] ?? tier.key, tier.key === selectedKey);
      btn.classList.add('patron-amount-btn');
      btn.addEventListener('click', () => {
        selectedKey = tier.key;
        selectOne(amountSegment, btn);
      });
      amountSegment.append(btn);
    }
    donateBtn.textContent = t(
      frequency === 'monthly' ? 'patron.donate' : 'patron.donateOnce',
      {},
      locale,
    );
  };

  // Frequency segment (only when both options exist).
  if (offered.length > 1) {
    const labelFor: Record<Frequency, I18nKey> = {
      monthly: 'patron.frequencyMonthly',
      once: 'patron.frequencyOnce',
    };
    for (const option of offered) {
      const btn = segmentButton(t(labelFor[option], {}, locale), option === frequency);
      btn.dataset.frequency = option;
      btn.addEventListener('click', () => {
        frequency = option;
        selectOne(freqSegment, btn);
        renderFrequency();
      });
      freqSegment.append(btn);
    }
    form.append(freqSegment);
  }

  renderFrequency();
  donateBtn.addEventListener('click', () => {
    if (selectedKey) void startCheckout(selectedKey, donateBtn, locale);
  });
  form.append(amountSegment, donateBtn);

  if (!user) form.append(note(t('patron.signInFirst', {}, locale)));
  return form;
}

// ── actions ──────────────────────────────────────────────────────────────────
async function startCheckout(
  tier: string,
  button: HTMLButtonElement,
  locale: Locale,
): Promise<void> {
  button.disabled = true;
  try {
    const resp = await fetch('/api/patron/checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier }),
    });
    if (resp.status === 401) {
      window.location.assign('/account');
      return;
    }
    const data = (await resp.json().catch(() => ({}))) as { url?: string };
    if (resp.ok && data.url) {
      window.location.assign(data.url);
      return;
    }
    showInlineError(button, t('patron.checkoutError', {}, locale));
  } catch {
    showInlineError(button, t('patron.checkoutError', {}, locale));
  } finally {
    button.disabled = false;
  }
}

async function startPortal(): Promise<void> {
  try {
    const resp = await fetch('/api/patron/portal', { method: 'POST', credentials: 'same-origin' });
    const data = (await resp.json().catch(() => ({}))) as { url?: string };
    if (resp.ok && data.url) window.location.assign(data.url);
  } catch {
    // no-op; the button stays available for a retry.
  }
}

async function fetchConfig(): Promise<PatronConfigResponse | null> {
  try {
    const resp = await fetch('/api/patron/config', { credentials: 'same-origin' });
    if (!resp.ok) return null;
    return (await resp.json()) as PatronConfigResponse;
  } catch {
    return null;
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
// A framed Jungle token: cream disc + animal PNG + colored ink ring, matching
// the in-game piece art (jungle-art.ts). `color` picks the red or black side.
function mascotDisc(color: 'red' | 'black'): HTMLElement {
  const disc = document.createElement('div');
  disc.className = `patron-mascot patron-mascot-${color}`;
  disc.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.src = `/piece-sets/jungle/dobutsu/${color}-${MASCOT_ROLE}.png`;
  img.alt = '';
  disc.append(img);
  return disc;
}

function segmentButton(label: string, selected: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'patron-segment-btn';
  if (selected) btn.classList.add('is-selected');
  btn.textContent = label;
  return btn;
}

// Single-select within a segment: clear siblings, mark the clicked one.
function selectOne(segment: HTMLElement, chosen: HTMLElement): void {
  for (const child of Array.from(segment.children)) child.classList.remove('is-selected');
  chosen.classList.add('is-selected');
}

function para(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

function subheading(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'about-subheading';
  h.textContent = text;
  return h;
}

function faqRow(questionKey: I18nKey, answerKey: I18nKey, locale: Locale): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(subheading(t(questionKey, {}, locale)), para(t(answerKey, {}, locale)));
  return frag;
}

// Billing terms live on /terms, not here: a payment processor (and a patron
// deciding whether to subscribe) expects the recurring-charge, cancellation, and
// refund rules in one durable place. This line is the pointer to it.
function termsLine(locale: Locale): HTMLElement {
  const p = document.createElement('p');
  p.className = 'patron-terms-line';
  const link = document.createElement('a');
  link.href = localizedHref('/terms', locale);
  link.textContent = t('patron.termsLink', {}, locale);
  p.append(document.createTextNode(t('patron.termsPrefix', {}, locale)), link);
  p.append(document.createTextNode(t('patron.termsSuffix', {}, locale)));
  return p;
}

function note(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'patron-note';
  el.textContent = text;
  return el;
}

function thankYou(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'patron-thankyou';
  el.textContent = text;
  return el;
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'patron-donate-btn';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function showInlineError(anchor: HTMLElement, message: string): void {
  const existing = anchor.parentElement?.querySelector('.patron-error');
  if (existing) {
    existing.textContent = message;
    return;
  }
  const err = document.createElement('p');
  err.className = 'patron-error';
  err.textContent = message;
  anchor.parentElement?.append(err);
}

function loadingLabel(): string {
  return '…';
}
