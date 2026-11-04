import dns from 'node:dns/promises';

type MailResolver = {
  resolveMx(domain: string): Promise<readonly { exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<readonly string[]>;
  resolve6(domain: string): Promise<readonly string[]>;
};

const defaultResolver: MailResolver = {
  resolveMx: (domain) => dns.resolveMx(domain),
  resolve4: (domain) => dns.resolve4(domain),
  resolve6: (domain) => dns.resolve6(domain),
};

// Only authoritative absence is a rejection. SERVFAIL, refusal and timeouts
// are uncertainty, so they must not keep a player from requesting a code.
async function recordsOrEmpty<T>(lookup: () => Promise<readonly T[]>): Promise<readonly T[]> {
  try {
    return await lookup();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENODATA' || code === 'ENOTFOUND') return [];
    throw error;
  }
}

async function hasMailRoute(domain: string, resolver: MailResolver): Promise<boolean> {
  const mx = await recordsOrEmpty(() => resolver.resolveMx(domain));
  if (mx.some(({ exchange }) => exchange !== '' && exchange !== '.')) return true;
  // A null MX opts out of receiving mail, even with A/AAAA records.
  if (mx.length > 0) return false;
  // RFC 5321 implicit MX: an address record suffices only when MX is absent.
  const addresses = await Promise.allSettled([
    recordsOrEmpty(() => resolver.resolve4(domain)),
    recordsOrEmpty(() => resolver.resolve6(domain)),
  ]);
  if (addresses.some((result) => result.status === 'fulfilled' && result.value.length > 0)) {
    return true;
  }
  const uncertain = addresses.find((result) => result.status === 'rejected');
  if (uncertain?.status === 'rejected') throw uncertain.reason;
  return false;
}

export function createEmailDomainCheck({
  resolver = defaultResolver,
  timeoutMs = 1_500,
  ttlMs = 5 * 60_000,
  maxEntries = 1_000,
  now = Date.now,
}: {
  resolver?: MailResolver;
  timeoutMs?: number;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
} = {}): (domain: string) => Promise<boolean> {
  const cache = new Map<string, { expiresAt: number; result: Promise<boolean> }>();
  return (rawDomain) => {
    const domain = rawDomain.toLowerCase();
    const cached = cache.get(domain);
    if (cached && cached.expiresAt > now()) return cached.result;
    const entry = { expiresAt: now() + ttlMs, result: Promise.resolve(true) };
    entry.result = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          hasMailRoute(domain, resolver),
          // This timer completes an awaited request, rather than background work.
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('mail DNS timeout')), timeoutMs);
          }),
        ]);
      } catch {
        // Retry uncertainty next time instead of caching a DNS outage.
        if (cache.get(domain) === entry) cache.delete(domain);
        return true;
      } finally {
        clearTimeout(timer);
      }
    })();
    cache.delete(domain);
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(domain, entry);
    return entry.result;
  };
}

export const emailDomainAcceptsMail = createEmailDomainCheck();
