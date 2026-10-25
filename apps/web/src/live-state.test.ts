import { describe, expect, it } from 'vitest';
import { alignLoopbackHost } from './live-state.js';

describe('alignLoopbackHost (dev socket URL)', () => {
  it('follows a page on 127.0.0.1 so the session cookie rides the socket', () => {
    expect(alignLoopbackHost('ws://localhost:3021', '127.0.0.1')).toBe('ws://127.0.0.1:3021');
  });

  it('follows a page on localhost the other way', () => {
    expect(alignLoopbackHost('ws://127.0.0.1:3021', 'localhost')).toBe('ws://localhost:3021');
  });

  it('keeps a path and leaves a matching host alone', () => {
    expect(alignLoopbackHost('ws://localhost:3021/ws', '127.0.0.1')).toBe('ws://127.0.0.1:3021/ws');
    expect(alignLoopbackHost('ws://localhost:3021', 'localhost')).toBe('ws://localhost:3021');
  });

  it('never rewrites a non-loopback socket or a page off loopback', () => {
    expect(alignLoopbackHost('wss://ws.mistboard.com', '127.0.0.1')).toBe('wss://ws.mistboard.com');
    expect(alignLoopbackHost('ws://localhost:3021', '192.168.1.20')).toBe('ws://localhost:3021');
  });
});
