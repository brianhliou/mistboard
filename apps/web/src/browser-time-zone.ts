// The browser's IANA zone, sent with streak reads so the server counts days on
// the viewer's own calendar (apps/server/src/play-streak.ts). UTC when the
// runtime cannot say.
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
