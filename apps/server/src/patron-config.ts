// Patron program configuration (078). Everything Stripe-related is optional: if
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are unset the whole program is
// "unconfigured" and the routes fail closed (503 patron_unconfigured) so the
// feature can land dark on main and be switched on by setting Railway env, the
// same shape as the VITE_*_ENABLED variant flags.
//
// The tier catalog is the contract shared with the web donate selector: the
// client sends a tier KEY (never an amount), the server maps it to a Stripe
// price id from env. That keeps price selection server-authoritative — a client
// can never name its own amount.

export type PatronTierMode = 'subscription' | 'payment';

export type PatronTier = {
  key: string;
  mode: PatronTierMode;
  // Stripe price id is read from this env var. Prices are created once in the
  // Stripe dashboard; ids live in env, not the DB.
  priceEnvVar: string;
  // How long a one-time payment carries the badge (lichess's rule: one month
  // per $5). null for recurring tiers, whose period comes from Stripe.
  months: number | null;
};

// USD-only v1. Multi-currency / a custom-amount slider are deferred (see
// patron-track.md). The same amount ladder under two frequencies: monthly
// subscriptions and one-time payments. One-time exists because Alipay and
// WeChat Pay, the wallets a mainland Chinese player actually holds, cannot be
// charged in Checkout subscription mode; in payment mode Stripe offers them
// automatically, so the page never has to name a method (patron-track.md,
// 2026-09-20). The former `lifetime` tier never had a price set and is gone.
const AMOUNTS_USD = [5, 10, 20, 50] as const;
const MONTHS_PER_5_USD = 1;

export const PATRON_TIERS: readonly PatronTier[] = [
  ...AMOUNTS_USD.map(
    (amount): PatronTier => ({
      key: `monthly_${amount}`,
      mode: 'subscription',
      priceEnvVar: `STRIPE_PRICE_MONTHLY_${amount}`,
      months: null,
    }),
  ),
  ...AMOUNTS_USD.map(
    (amount): PatronTier => ({
      key: `once_${amount}`,
      mode: 'payment',
      priceEnvVar: `STRIPE_PRICE_ONCE_${amount}`,
      months: (amount / 5) * MONTHS_PER_5_USD,
    }),
  ),
];

// Badge months for a one-time payment when the tier is unknown (a session
// stamped by an older deploy): derive from the amount actually paid, never
// zero for money received.
export function oneTimeMonthsForAmount(amountTotalCents: number | null | undefined): number {
  if (typeof amountTotalCents !== 'number' || !Number.isFinite(amountTotalCents)) return 1;
  return Math.max(1, Math.floor(amountTotalCents / 500) * MONTHS_PER_5_USD);
}

export function findPatronTier(key: string): PatronTier | null {
  return PATRON_TIERS.find((tier) => tier.key === key) ?? null;
}

export type PatronConfig = {
  secretKey: string;
  webhookSecret: string;
  // tier key -> Stripe price id, only for tiers whose price env var is set.
  priceByTier: ReadonlyMap<string, string>;
  // Where Stripe Checkout / Billing Portal redirect back to.
  publicHost: string;
};

export function loadPatronConfig(env: NodeJS.ProcessEnv = process.env): PatronConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey || !webhookSecret) return null;

  const priceByTier = new Map<string, string>();
  for (const tier of PATRON_TIERS) {
    const priceId = env[tier.priceEnvVar]?.trim();
    if (priceId) priceByTier.set(tier.key, priceId);
  }

  return {
    secretKey,
    webhookSecret,
    priceByTier,
    publicHost: env.MISTBOARD_HOST ?? 'https://mistboard.com',
  };
}

// A memoized read for the hot path (route guards). Config is process-env
// derived and stable for the process lifetime.
let cached: PatronConfig | null | undefined;
export function patronConfig(): PatronConfig | null {
  if (cached === undefined) cached = loadPatronConfig();
  return cached;
}

export function isPatronConfigured(): boolean {
  return patronConfig() !== null;
}

// Test seam: reset the memoized config so a test can vary env.
export function resetPatronConfigCache(): void {
  cached = undefined;
}
