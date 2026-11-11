import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveState } from './live-state.js';
import { actionTitle, boardStatusTone, rejectedInviteHeading } from './live-status.js';
import {
  loadedRoomInvitePreview,
  parseRoomInvitePreview,
  resetRoomInvitePreviews,
  roomInviteHeading,
  roomInvitePreview,
} from './room-invite-preview.js';

// #1058: a signed-out visitor on a correspondence invite link reads who asked,
// the game and the pace instead of "Access rejected".

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetRoomInvitePreviews();
  liveState.connectionState = 'connecting';
  liveState.closeReason = '';
  liveState.room = '';
});

describe('room invite preview', () => {
  it('parses only a complete preview', () => {
    expect(
      parseRoomInvitePreview({ gameSpecId: 'xiangqi', daysPerMove: 3, creatorName: ' Alice ' }),
    ).toEqual({ gameSpecId: 'xiangqi', daysPerMove: 3, creatorName: 'Alice' });
    expect(parseRoomInvitePreview({ gameSpecId: 'xiangqi', daysPerMove: 3 })).toBeNull();
    expect(
      parseRoomInvitePreview({ gameSpecId: 'xiangqi', daysPerMove: 0, creatorName: 'A' }),
    ).toBeNull();
    expect(parseRoomInvitePreview(null)).toBeNull();
  });

  it('heads the page with who invited you, the game and the pace', () => {
    expect(roomInviteHeading({ gameSpecId: 'xiangqi', daysPerMove: 3, creatorName: 'Alice' })).toBe(
      'Alice invited you to Xiangqi, 3 days per move',
    );
    expect(roomInviteHeading({ gameSpecId: 'xiangqi', daysPerMove: 1, creatorName: 'Alice' })).toBe(
      'Alice invited you to Xiangqi, 1 day per move',
    );
  });

  it('fetches the preview once per room and calls back when it lands', async () => {
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({ gameSpecId: 'xiangqi', daysPerMove: 3, creatorName: 'Alice' }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onLoad = vi.fn();
    expect(roomInvitePreview('room-1', onLoad)).toBeNull();
    expect(roomInvitePreview('room-1', onLoad)).toBeNull();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/correspondence/rooms/room-1/invite');
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(loadedRoomInvitePreview('room-1')?.creatorName).toBe('Alice');
  });

  it("keeps today's copy when the server has no preview (404)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    const onLoad = vi.fn();
    roomInvitePreview('room-2', onLoad);
    await settle();
    expect(onLoad).not.toHaveBeenCalled();
    expect(loadedRoomInvitePreview('room-2')).toBeNull();
  });
});

describe('Fog Chess room status for a refused invitee', () => {
  it('reads the invite heading instead of Access rejected once the preview loads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ gameSpecId: 'xiangqi', daysPerMove: 3, creatorName: 'Alice' }),
          ),
      ),
    );
    liveState.room = 'room-3';
    liveState.connectionState = 'rejected';
    liveState.closeReason = 'correspondence requires account';
    expect(actionTitle(null)).toBe('Access rejected');
    roomInvitePreview('room-3');
    await settle();
    expect(rejectedInviteHeading()).toBe('Alice invited you to Xiangqi, 3 days per move');
    expect(actionTitle(null)).toBe('Alice invited you to Xiangqi, 3 days per move');
    expect(boardStatusTone()).toBe('pending');
  });

  it('keeps Access rejected for other refusals', () => {
    liveState.room = 'room-4';
    liveState.connectionState = 'rejected';
    liveState.closeReason = 'room full';
    expect(rejectedInviteHeading()).toBeNull();
  });
});
