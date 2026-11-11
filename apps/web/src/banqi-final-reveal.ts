import type { BanqiWireView } from './live-banqi.js';

export const BANQI_REVEAL_REQUEST_TIMEOUT_MS = 5_000;

/** Owns only the optional final-board overlay; the live/replay state stays masked. */
export function createBanqiFinalReveal(options: {
  fetch?: typeof fetch;
  changed(): void;
  mounted(): boolean;
}) {
  const request = options.fetch ?? fetch;
  let key = '';
  let room = '';
  let ply = 0;
  let generation = 0;
  let abort: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ready = false;
  let wanted = false;
  let loading = false;
  let failed = false;
  let revealed: BanqiWireView | null = null;
  function reset() {
    generation++;
    abort?.abort();
    abort = null;
    if (timer) clearTimeout(timer);
    timer = null;
    ready = wanted = loading = failed = false;
    revealed = null;
  }
  function current(token: number) {
    return token === generation && options.mounted();
  }
  async function fetchWithDeadline<T>(
    init: RequestInit,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    abort = controller;
    let rejectAbort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error('reveal_request_cancelled'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    const deadline = setTimeout(() => controller.abort(), BANQI_REVEAL_REQUEST_TIMEOUT_MS);
    try {
      return await Promise.race([
        (async () =>
          read(
            await request(`/api/banqi/games/${encodeURIComponent(room)}/reveal`, {
              ...init,
              cache: 'no-store',
              signal: controller.signal,
            }),
          ))(),
        cancelled,
      ]);
    } finally {
      clearTimeout(deadline);
      controller.signal.removeEventListener('abort', rejectAbort);
      if (abort === controller) abort = null;
    }
  }
  async function check(token: number, attempt = 0) {
    try {
      const status = await fetchWithDeadline(
        { method: 'HEAD' },
        async (response) => response.status,
      );
      if (!current(token)) return;
      if (status === 204) {
        ready = true;
        options.changed();
        return;
      }
    } catch {
      if (!current(token)) return;
    }
    // A final WS frame can precede completion of the persistent summary write.
    if (current(token) && attempt < 4)
      timer = setTimeout(
        () => {
          void check(token, attempt + 1);
        },
        500 * (attempt + 1),
      );
  }
  return {
    sync(roomId: string, authoritative: BanqiWireView | null, atEnd: boolean) {
      const next =
        authoritative?.id === roomId && authoritative.status.type === 'finished'
          ? `${roomId}:${authoritative.ply}`
          : '';
      if (next !== key) {
        reset();
        key = next;
        room = roomId;
        ply = authoritative?.ply ?? 0;
        if (next && options.mounted()) void check(generation);
      }
      if (!atEnd && (wanted || failed)) {
        generation++;
        abort?.abort();
        wanted = loading = failed = false;
        revealed = null;
      }
    },
    state() {
      return { visible: !!key, ready, wanted, loading, failed, view: revealed };
    },
    async toggle() {
      if (!ready || !key || !options.mounted()) return;
      if (wanted) {
        generation++;
        abort?.abort();
        wanted = loading = failed = false;
        revealed = null;
        options.changed();
        return;
      }
      wanted = loading = true;
      failed = false;
      const token = ++generation;
      options.changed();
      try {
        const payload = await fetchWithDeadline({}, async (response) => {
          if (!response.ok) throw new Error('reveal_unavailable');
          return response.json();
        });
        if (!current(token) || !wanted) return;
        if (
          payload.roomId !== room ||
          payload.view?.id !== room ||
          payload.view.status?.type !== 'finished' ||
          payload.view.ply !== ply ||
          !Number.isFinite(Date.parse(payload.finalizedAt))
        )
          throw new Error('invalid_reveal');
        revealed = payload.view;
      } catch {
        if (!current(token)) return;
        wanted = false;
        failed = true;
      } finally {
        if (current(token)) {
          loading = false;
          options.changed();
        }
      }
    },
    dispose() {
      reset();
      key = '';
    },
  };
}
