// Server-side PostHog capture for events that must not depend on the browser.
//
// signup_completed was web-only and missed every ad-blocked or no-JS signup
// (PostHog saw 3 in the 12 weeks to 2026-08-27 while the database gained 6 in
// 30 days), so the server is now the source of that event and the web no
// longer fires it. The person still merges with the browser's identify() call
// because both use the account id as the distinct id.
//
// Same key and host the web build uses (VITE_POSTHOG_KEY / VITE_POSTHOG_HOST,
// both public; the key is embedded in every page), with MISTBOARD_POSTHOG_KEY
// / MISTBOARD_POSTHOG_HOST as overrides. No SDK: one POST to /capture/ per
// event, fire-and-forget, never throws, no-op without a key (local dev, tests).

import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { clientIpForRateLimit, type RuntimeEnv } from './server-policy.js';

const captureTimeoutMs = 3_000;

// The visitor address PostHog should geolocate a server-sent event to.
// clientIpForRateLimit trusts one proxy hop, which behind Cloudflare is the
// Cloudflare edge, so every signup located to a Cloudflare POP (mainland
// China signups showed as US). Cloudflare puts the visitor in
// cf-connecting-ip; prefer it when it parses as an address. A request sent
// straight to the Railway origin can forge the header, which is acceptable
// for a geo hint and is why this is never used as a rate-limit key.
export function clientIpForAnalytics(
  request: Pick<IncomingMessage, 'headers' | 'socket'>,
  env: RuntimeEnv = process.env,
): string {
  const header = request.headers['cf-connecting-ip'];
  const raw = (Array.isArray(header) ? header[0] : header)?.trim();
  if (raw && isIP(raw) !== 0) return raw;
  return clientIpForRateLimit(request, env);
}

export type ServerAnalyticsConfig = { key: string; host: string };

export function serverAnalyticsConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServerAnalyticsConfig | null {
  const key = env.MISTBOARD_POSTHOG_KEY || env.VITE_POSTHOG_KEY;
  const host = env.MISTBOARD_POSTHOG_HOST || env.VITE_POSTHOG_HOST;
  if (!key || !host) return null;
  return { key, host: host.replace(/\/+$/, '') };
}

export type ServerCapturePayload = {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
};

// `$lib` marks the row as server-sent in PostHog; `$ip` (when given) is what
// ingestion geolocates, since the request never passed through posthog-js.
export function buildServerCapturePayload(input: {
  key: string;
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  ip?: string | null;
  now?: Date;
}): ServerCapturePayload {
  const properties: Record<string, unknown> = {
    $lib: 'mistboard-server',
    ...(input.properties ?? {}),
  };
  if (input.ip) properties.$ip = input.ip;
  return {
    api_key: input.key,
    event: input.event,
    distinct_id: input.distinctId,
    properties,
    timestamp: (input.now ?? new Date()).toISOString(),
  };
}

export type ServerCaptureTransport = (url: string, body: string) => Promise<unknown>;

const defaultTransport: ServerCaptureTransport = async (url, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), captureTimeoutMs);
  timer.unref?.();
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

let transport: ServerCaptureTransport = defaultTransport;

/** Test seam: swap the HTTP transport. Returns the previous one. */
export function setServerCaptureTransport(
  next: ServerCaptureTransport | null,
): ServerCaptureTransport {
  const previous = transport;
  transport = next ?? defaultTransport;
  return previous;
}

/**
 * Queue one event to PostHog. Resolves once the request has been handed off
 * (or skipped); never rejects, so callers can `void` it on a hot path.
 */
export async function captureServerEvent(input: {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  ip?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const config = serverAnalyticsConfig(input.env);
  if (!config) return false;
  const payload = buildServerCapturePayload({
    key: config.key,
    event: input.event,
    distinctId: input.distinctId,
    properties: input.properties,
    ip: input.ip,
  });
  try {
    await transport(`${config.host}/capture/`, JSON.stringify(payload));
    return true;
  } catch {
    // Analytics never fails a request. A dropped signup event costs one row on
    // a dashboard; a thrown error here would cost the user their login.
    return false;
  }
}
