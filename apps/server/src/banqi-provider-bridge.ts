import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { BanqiTurnProvider } from './banqi-provider.js';
import {
  BANQI_PROVIDER_MAX_BYTES,
  BanqiProviderError,
  parseBanqiProviderRequest,
  parseBanqiProviderResponse,
} from './banqi-provider-protocol.js';

function authenticated(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Reference wrapper for an operator-owned process. The CLI binds loopback;
 * any production network listener requires its own TLS and deployment review. */
export function createBanqiProviderBridge(provider: BanqiTurnProvider, token: string): Server {
  if (!token || /[\r\n]/.test(token)) throw new BanqiProviderError('invalid-request');
  const server = createServer(async (request, response) => {
    const write = (status: number, body: unknown): void => {
      if (response.destroyed) return;
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'POST' || request.url !== '/turn') {
      write(404, { error: 'not-found' });
      return;
    }
    if (!authenticated(request.headers.authorization, token)) {
      write(401, { error: 'unauthorized' });
      return;
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
      write(415, { error: 'invalid-request' });
      return;
    }
    const controller = new AbortController();
    const onClose = (): void => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', onClose);
    response.once('close', onClose);
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > BANQI_PROVIDER_MAX_BYTES) throw new BanqiProviderError('oversized');
        chunks.push(Buffer.from(chunk));
      }
      let value: unknown;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new BanqiProviderError('invalid-request');
      }
      const turn = parseBanqiProviderRequest(value);
      const result = parseBanqiProviderResponse(await provider.turn(turn, controller.signal), turn);
      write(200, result);
    } catch (error) {
      const code = error instanceof BanqiProviderError ? error.code : 'transport';
      write(
        code === 'oversized'
          ? 413
          : code === 'invalid-request'
            ? 400
            : code === 'deadline'
              ? 504
              : 502,
        { error: code },
      );
    } finally {
      request.off('aborted', onClose);
      response.off('close', onClose);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  return server;
}
