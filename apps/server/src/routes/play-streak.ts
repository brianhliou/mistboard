import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from '../account-session.js';
import * as persistence from '../persistence.js';
import { requireMethod, requirePersistence, writeJson } from './lib.js';

// GET /api/play-streak?tz=<IANA zone>&device=<browser device id>
//
// The caller's own play streak (play-streak.ts): the signed-in account's when
// there is a session, else the guest device's. The device id is the same one
// the browser sends on every live connect (live-state.ts: deviceIdForBrowser),
// which is how a guest's finished games carry an identity at all. Nobody else's
// streak is reachable here; a profile page reads its owner's from the profile
// payload.
//
// Public, but a streak is a count of the caller's own days, so there is
// nothing here a caller could not already see on their own profile.
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9:_-]{8,80}$/;

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (pathname !== '/api/play-streak') return false;
  if (!requireMethod(request, response, 'GET')) return true;
  if (!requirePersistence(response)) return true;

  const viewer = await currentAccountUser(request);
  const device = parsedUrl.searchParams.get('device');
  const subject = viewer
    ? { type: 'user' as const, id: viewer.id }
    : device && DEVICE_ID_PATTERN.test(device)
      ? { type: 'guest' as const, id: device }
      : null;
  if (!subject) {
    writeJson(response, 400, { error: 'no_subject' });
    return true;
  }

  const streak = await persistence.getPlayStreak(subject, {
    timeZone: parsedUrl.searchParams.get('tz'),
  });
  writeJson(response, 200, { streak });
  return true;
}
