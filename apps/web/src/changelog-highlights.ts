import { type Announcement, announcements } from './announcements.js';
import { rulesHrefPublicSurfaceEnabled } from './variant-public-surfaces.js';

/**
 * The curated highlights for a changelog month, derived from the same entries
 * a reader can see on /feed. Keep the source fields for a later renderer to
 * localize and link; there is no second editorial list or arbitrary limit.
 *
 * Group by the authored YYYY-MM-DD date, not the viewer's local timezone or
 * the publication timestamp. announcements(now) owns scheduling and the dev
 * preview; this function only selects and orders a month's public entries.
 */
export function changelogHighlights(monthId: string, now: number = Date.now()): Announcement[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthId)) return [];
  return announcements(now)
    .filter(
      (entry) =>
        entry.date.startsWith(`${monthId}-`) &&
        isCalendarDate(entry.date) &&
        rulesHrefPublicSurfaceEnabled(entry.href),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Date.parse normalizes dates such as February 30 into March. A round trip
// rejects those rather than assigning a malformed entry to either month.
function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}
