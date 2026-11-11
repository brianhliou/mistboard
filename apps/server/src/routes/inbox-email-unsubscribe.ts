import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DM_EMAIL_UNSUBSCRIBE_PATH,
  dmEmailUnsubscribeSecret,
  verifyDmEmailUnsubscribeToken,
} from '../inbox-email-unsubscribe.js';
import * as persistence from '../persistence.js';
import { requireMethod } from './lib.js';

type Deps = {
  env?: Record<string, string | undefined>;
  isInitialized?: () => boolean;
  updatePreference?: (
    userId: string,
    key: 'inboxEmail',
    value: false,
    at: Date,
  ) => Promise<{ id: string } | null>;
};

function page(response: ServerResponse, status: number, text: string, token?: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex',
    'x-content-type-options': 'nosniff',
    'content-security-policy':
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
  // Only a verified base64url token reaches this form. No account data or
  // request text is interpolated into the page.
  const form = token
    ? `<form method="post" action="${DM_EMAIL_UNSUBSCRIBE_PATH}?t=${token}"><button type="submit">Stop direct-message emails</button></form>`
    : '';
  response.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Direct-message emails | Mistboard</title><body><main><h1>Direct-message emails</h1><p>${text}</p>${form}</main></body></html>`,
  );
}

export function createInboxEmailUnsubscribeRoute(deps: Deps = {}) {
  const env = deps.env ?? process.env;
  const isInitialized = deps.isInitialized ?? persistence.isInitialized;
  const updatePreference = deps.updatePreference ?? persistence.updateUserAccountPreference;
  return {
    async tryHandle(
      _ctx: unknown,
      request: IncomingMessage,
      response: ServerResponse,
      pathname: string,
      parsedUrl: URL,
    ): Promise<boolean> {
      if (pathname !== DM_EMAIL_UNSUBSCRIBE_PATH) return false;
      if (!requireMethod(request, response, 'GET', 'POST')) return true;
      const secret = dmEmailUnsubscribeSecret(env);
      if (!secret) {
        page(
          response,
          503,
          'Email preferences are temporarily unavailable. Please try again later.',
        );
        return true;
      }
      const tokens = parsedUrl.searchParams.getAll('t');
      const token = tokens.length === 1 ? tokens[0] : null;
      const userId = verifyDmEmailUnsubscribeToken(token ?? null, secret);
      if (!userId) {
        page(
          response,
          400,
          'This unsubscribe link is invalid. You can change email preferences in your account settings.',
        );
        return true;
      }
      if (request.method === 'GET') {
        // Link scanners may GET; confirmation never changes preferences.
        page(
          response,
          200,
          'Turn off email notifications for direct messages? Other notifications will stay the same.',
          token!,
        );
        return true;
      }
      if (!isInitialized()) {
        page(
          response,
          503,
          'Email preferences are temporarily unavailable. Please try again later.',
        );
        return true;
      }
      // RFC 8058 senders POST without cookies or a session, using the signed
      // URL as authorization. Accept form/multipart bodies without parsing them.
      // A single-key update preserves every other preference. Unknown ids do
      // not create an account; repeated requests keep the preference disabled.
      const updated = await updatePreference(userId, 'inboxEmail', false, new Date());
      if (!updated) {
        page(
          response,
          400,
          'This unsubscribe link is invalid. You can change email preferences in your account settings.',
        );
        return true;
      }
      page(
        response,
        200,
        'Direct-message emails are turned off. You can turn them on again in your account settings.',
      );
      return true;
    },
  };
}

export const tryHandle = createInboxEmailUnsubscribeRoute().tryHandle;
