// Play streak on the client: the "Play streak: 3 days" line under the
// post-game buttons, for the player who just finished a game. The server does
// the counting (apps/server/src/play-streak.ts); this module asks once per
// room, on the browser's own calendar, and renders only when there is a run
// to show. A zero is never shown: a first game that did not count (aborted,
// one ply) would otherwise read as "you have no streak" the moment it ended.
//
// The finish frame can reach the browser before the games row is written, so a
// read whose last day is not today is retried once after a short pause.

import { t } from './i18n/catalog.js';
import { deviceIdForBrowser } from './live-state.js';

export type PlayStreak = {
  current: number;
  best: number;
  lastPlayedDay: string | null;
  today: string;
};

const RETRY_AFTER_MS = 1500;

// One request per room, shared by every render of the post-game panel so a
// re-render while the fetch is in flight neither refetches nor loses the line.
const streakByRoom = new Map<string, Promise<PlayStreak | null>>();

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function playStreakQuery(): string {
  const params = new URLSearchParams({ tz: browserTimeZone() });
  const device = deviceIdForBrowser();
  if (device) params.set('device', device);
  return params.toString();
}

export async function fetchPlayStreak(): Promise<PlayStreak | null> {
  try {
    const resp = await fetch(`/api/play-streak?${playStreakQuery()}`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { streak?: Partial<PlayStreak> };
    const streak = data.streak;
    if (!streak || typeof streak.current !== 'number' || typeof streak.best !== 'number') {
      return null;
    }
    return {
      current: streak.current,
      best: streak.best,
      lastPlayedDay: typeof streak.lastPlayedDay === 'string' ? streak.lastPlayedDay : null,
      today: typeof streak.today === 'string' ? streak.today : '',
    };
  } catch {
    return null;
  }
}

async function fetchPlayStreakAfterGame(): Promise<PlayStreak | null> {
  const first = await fetchPlayStreak();
  if (!first || first.lastPlayedDay === first.today) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  return (await fetchPlayStreak()) ?? first;
}

export function playStreakDays(count: number): string {
  return count === 1 ? t('live.playStreakDaysOne') : t('live.playStreakDays', { count });
}

export function playStreakLine(streak: PlayStreak): string {
  const days = playStreakDays(streak.current);
  return streak.best > streak.current
    ? t('live.playStreakBest', { days, best: playStreakDays(streak.best) })
    : t('live.playStreak', { days });
}

// An empty note that fills itself in once the room's streak is known. Safe to
// call on every render: the fetch is shared per room, and a note orphaned by a
// re-render is filled harmlessly.
export function postGamePlayStreakNote(roomId: string): HTMLParagraphElement {
  const note = document.createElement('p');
  note.className = 'room-actions-note play-streak';
  note.hidden = true;
  let pending = streakByRoom.get(roomId);
  if (!pending) {
    pending = fetchPlayStreakAfterGame();
    streakByRoom.set(roomId, pending);
  }
  void pending.then((streak) => {
    if (!streak || streak.current < 1) return;
    note.textContent = playStreakLine(streak);
    note.hidden = false;
  });
  return note;
}

// Test seam: forget cached rooms.
export function resetPlayStreakCache(): void {
  streakByRoom.clear();
}
