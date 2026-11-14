import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from '../account-session.js';
import { createAuthRateLimiter } from '../auth-rate-limit.js';
import {
  createAccountBroadcastPushToken,
  listAccountBroadcastPushGrants,
  revokeAccountBroadcastPushToken,
} from '../persistence-xiangqi-broadcast-push.js';
import { allowedWebSocketOrigins } from '../server-policy.js';
import {
  RequestBodyTooLargeError,
  readJsonBody,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

export type AccountBroadcastPushDependencies = {
  currentUser(
    request: IncomingMessage,
  ): Promise<{ id: string; playDisabledAt: Date | null } | null>;
  available(response: ServerResponse): boolean;
  list: typeof listAccountBroadcastPushGrants;
  create: typeof createAccountBroadcastPushToken;
  revoke: typeof revokeAccountBroadcastPushToken;
};

export function createAccountBroadcastPushHandler(deps: AccountBroadcastPushDependencies) {
  const limiter = createAuthRateLimiter(10, 10 * 60 * 1000);
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<boolean> => {
    const base = '/api/account/broadcast-push';
    if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
    response.setHeader('Cache-Control', 'no-store');
    if (!deps.available(response)) return true;
    if (
      !requireMethod(
        request,
        response,
        ...(pathname === base ? ['GET'] : ['GET', 'POST', 'DELETE']),
      )
    )
      return true;
    // Session cookies use the account routes' SameSite=Lax policy. JSON-only
    // creates and non-simple deletes also reject cross-site browser requests.
    if (request.method !== 'GET' && !sameOriginWrite(request)) {
      writeJson(response, 403, { error: 'forbidden_origin' });
      return true;
    }
    const user = await deps.currentUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    try {
      if (pathname === base) {
        writeJson(response, 200, { grants: await deps.list(user.id) });
        return true;
      }
      const parts = pathname.slice(base.length + 1).split('/');
      const tourSlug = parts[0]!;
      const grants = await deps.list(user.id);
      if (!grants.some((g) => g.tourSlug === tourSlug)) {
        writeJson(response, 404, { error: 'not_found' });
        return true;
      }
      if (parts.length === 1 && request.method === 'GET') {
        writeJson(response, 200, { grant: grants.find((g) => g.tourSlug === tourSlug) });
      } else if (parts.length === 1 && request.method === 'POST') {
        if (user.playDisabledAt) {
          writeJson(response, 403, { error: 'play_disabled' });
          return true;
        }
        if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
          writeJson(response, 415, { error: 'json_required' });
          return true;
        }
        if (!limiter.check(user.id)) {
          writeJson(response, 429, { error: 'rate_limited' }, { 'Retry-After': '600' });
          return true;
        }
        const body = await readJsonBody(request);
        if (
          typeof body.label !== 'string' ||
          !body.label.trim() ||
          body.label.trim().length > 100
        ) {
          writeJson(response, 400, { error: 'invalid_label' });
          return true;
        }
        const result = await deps.create(user.id, tourSlug, body.label.trim());
        if (typeof result === 'string')
          writeJson(response, result === 'not_found' ? 404 : 409, { error: result });
        else writeJson(response, 201, result);
      } else if (parts.length === 2 && request.method === 'DELETE') {
        const revoked = await deps.revoke(user.id, tourSlug, parts[1]!);
        writeJson(
          response,
          revoked ? 200 : 404,
          revoked ? { revoked: true } : { error: 'not_found' },
        );
      } else writeJson(response, 404, { error: 'not_found' });
    } catch (error) {
      // Never pass driver errors (which can include hashes) to the API logger.
      writeJson(
        response,
        error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 500,
        { error: error instanceof SyntaxError ? 'invalid_body' : 'request_failed' },
      );
    }
    return true;
  };
}

// The browser computes Sec-Fetch-Site against the page's own origin, so it
// holds behind any proxy that rewrites Host (the Vite dev proxy does). Only a
// browser that omits it falls back to comparing Origin with Host.
function sameOriginWrite(request: IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string') return site === 'same-origin';
  const origin = request.headers.origin;
  return origin === undefined || allowedAccountOrigin(origin, request.headers.host);
}

function allowedAccountOrigin(origin: string, host: string | undefined): boolean {
  if (allowedWebSocketOrigins(host).has(origin)) return true;
  return (
    !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) && origin === `http://${host}`
  );
}

export const tryHandle = createAccountBroadcastPushHandler({
  currentUser: currentAccountUser,
  available: requirePersistence,
  list: listAccountBroadcastPushGrants,
  create: createAccountBroadcastPushToken,
  revoke: revokeAccountBroadcastPushToken,
});
