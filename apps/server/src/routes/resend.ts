import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '../obs.js';
import * as persistence from '../persistence.js';
import {
  type EmailDeliveryEvent,
  ResendWebhookPayloadError,
  verifyResendWebhook,
} from '../resend-webhook.js';
import { type HttpApiContext, requireMethod, writeJson } from './lib.js';

const MAX_BODY_BYTES = 256 * 1024;

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname !== '/api/webhooks/resend') return false;
  if (!requireMethod(request, response, 'POST')) return true;
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    writeJson(response, 503, { error: 'resend_webhook_unconfigured' });
    return true;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        writeJson(response, 413, { error: 'request_body_too_large' });
        return true;
      }
      chunks.push(buffer);
    }
  } catch {
    writeJson(response, 400, { error: 'invalid_body' });
    return true;
  }
  let event: EmailDeliveryEvent | null;
  try {
    event = verifyResendWebhook(Buffer.concat(chunks), request.headers, secret);
  } catch (error) {
    if (error instanceof ResendWebhookPayloadError) {
      logger.warn({
        kind: 'resend_webhook_invalid_payload',
        eventType: error.eventType,
        providerEmailId: error.providerEmailId,
        field: error.field,
      });
      writeJson(response, 200, { received: true });
      return true;
    }
    writeJson(response, 400, { error: 'invalid_webhook' });
    return true;
  }
  // Acknowledge future/irrelevant event types after authentication even when DB
  // is unavailable. Valid known events must be durable before acknowledgement.
  if (event) {
    if (!persistence.isInitialized()) {
      writeJson(response, 503, { error: 'persistence_disabled' });
      return true;
    }
    try {
      const fresh = await persistence.recordEmailDeliveryEvent(event);
      writeJson(response, 200, { received: true, duplicate: !fresh });
    } catch {
      // Do not let database errors carry recipients or provider details to logs.
      writeJson(response, 503, { error: 'email_delivery_persistence_failed' });
    }
  } else {
    writeJson(response, 200, { received: true });
  }
  return true;
}
