import { describe, expect, it } from 'vitest';
import { gameSpecIdForRoomBootstrap } from './live-room-bootstrap.js';
import { roomIdFromPath } from './room-url.js';

describe('live room bootstrap', () => {
  it('extracts direct room ids from /room/:id paths', () => {
    expect(roomIdFromPath('/room/dxq_abc%20123')).toBe('dxq_abc 123');
    expect(roomIdFromPath('/room/')).toBe('dev-room');
    expect(roomIdFromPath('/play/dxq_abc')).toBeNull();
  });

  it('routes chess-shell tenant prefixes and leaves self-contained clients alone', () => {
    // Retired tenants (Mini Xiangqi, DMX) are no longer registered, so their
    // old room-id prefixes resolve to nothing rather than to a spec.
    expect(gameSpecIdForRoomBootstrap('mxq_abc', null)).toBeNull();
    // With no tenant claiming the prefix, the legacy variant string decides.
    expect(gameSpecIdForRoomBootstrap('dmxq_abc', 'dark-chess')).toBe('dark-chess');
    // Dark-chess correspondence rooms ride the chess shell too.
    expect(gameSpecIdForRoomBootstrap('dchx_abc', null)).toBe('dark-chess');
    // Dark Xiangqi has its own client (routed before the shell boots), so
    // the shell never claims its rooms.
    expect(gameSpecIdForRoomBootstrap('dxq_abc', null)).toBeNull();
    expect(gameSpecIdForRoomBootstrap('room-abc', 'dark-xiangqi')).toBe('dark-xiangqi');
    expect(gameSpecIdForRoomBootstrap('room-abc', 'not-a-spec')).toBeNull();
  });
});
