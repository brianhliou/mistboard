// Create a room through a server restart instead of failing on it (#478).
//
// While a release drains, the server refuses new rooms with 503
// `server_draining`; then it restarts, and for a few seconds requests fail
// outright. Every create path used to surface the refusal and stop, so a player
// who clicked Play mid-release had to keep clicking: on 2026-09-30 two players
// clicked 27 times over four minutes and left without a game. This keeps the
// request alive instead: once a drain refusal is seen, it retries until the new
// server takes the room, treating the restart gap (network errors, 502-504) as
// part of the same wait, up to a limit.

export const RESTART_RETRY_MS = 4_000;
export const RESTART_WAIT_LIMIT_MS = 10 * 60_000;

export type RoomCreateRetryOptions = {
  /** Called once when the first drain refusal arrives, to tell the player. */
  onRestarting?: () => void;
  /** False stops the wait (the dialog closed, the page moved on). */
  isActive?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

async function isDrainRefusal(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  try {
    const body = (await response.clone().json()) as { error?: string };
    return body.error === 'server_draining';
  } catch {
    return false;
  }
}

/**
 * POST `url` with `init`, waiting out a server restart. Resolves with the first
 * response that is not part of a restart (success or an ordinary failure, left
 * for the caller to read), or with the last response once the wait limit is hit.
 * Throws a network error only when no restart was under way.
 */
export async function postThroughRestart(
  url: string,
  init: RequestInit,
  opts: RoomCreateRetryOptions = {},
): Promise<Response> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const isActive = opts.isActive ?? (() => true);
  let restartingSince: number | null = null;
  let last: Response | null = null;
  for (;;) {
    let response: Response | null = null;
    try {
      response = await fetch(url, init);
    } catch (err) {
      if (restartingSince === null) throw err;
    }
    if (response) {
      last = response;
      const inRestart =
        (await isDrainRefusal(response)) ||
        (restartingSince !== null && response.status >= 502 && response.status <= 504);
      if (!inRestart) return response;
    }
    if (restartingSince === null) {
      restartingSince = now();
      opts.onRestarting?.();
    }
    if (now() - restartingSince >= RESTART_WAIT_LIMIT_MS || !isActive()) {
      if (last) return last;
      throw new Error('server_restart_wait_expired');
    }
    await sleep(RESTART_RETRY_MS);
  }
}
