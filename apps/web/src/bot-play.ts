import { rememberPveEngine } from './pve-memory.js';

// One-click PvE room creation against a public bot identity. The server
// resolves the per-variant engine from the bot profile (routes/rooms.ts
// resolveBotRoomRequest), so callers only name the bot, the variant, and
// optionally a pace; the tenant time-control gates stay authoritative.

export type BotPlayRequest = {
  botId: string;
  gameSpecId: string;
  timeControl?: { initialMs: number; incrementMs: number };
  preferredColor?: 'random' | 'white' | 'black' | 'red';
};

export async function createBotGame(request: BotPlayRequest): Promise<string> {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'pve',
      botId: request.botId,
      gameSpecId: request.gameSpecId,
      ...(request.timeControl ? { timeControl: request.timeControl } : {}),
      // Omitted, not 'random': a one-click bot start names no side, and the
      // server reads an absent preferredColor as "the human opens". Sending an
      // explicit 'random' would re-arm the coin flip these buttons are meant to
      // avoid, since the setup dialog is not in the loop on this path.
      ...(request.preferredColor ? { preferredColor: request.preferredColor } : {}),
      rated: false,
    }),
  });
  if (!response.ok) throw new Error(`bot_room_create_failed_${response.status}`);
  const data = (await response.json()) as { url?: string };
  if (!data.url) throw new Error('bot_room_create_missing_url');
  return data.url;
}

/** Wire a button (or row) to start a bot game on click: disables while the
 *  room is created, navigates on success, and restores with a brief error
 *  state on failure. `pendingLabel`/`errorLabel` swap the element's text when
 *  provided; elements with richer content can pass `onStateChange` instead. */
export function bindBotPlayControl(
  control: HTMLButtonElement | HTMLAnchorElement,
  request: () => BotPlayRequest,
  opts: {
    pendingLabel?: string;
    errorLabel?: string;
    onStateChange?: (state: 'idle' | 'pending' | 'error') => void;
  } = {},
): void {
  let pending = false;
  const original = control.textContent;
  const setState = (state: 'idle' | 'pending' | 'error'): void => {
    control.classList.toggle('bot-play-pending', state === 'pending');
    control.classList.toggle('bot-play-error', state === 'error');
    if (control instanceof HTMLButtonElement) control.disabled = state === 'pending';
    if (opts.onStateChange) {
      opts.onStateChange(state);
      return;
    }
    if (state === 'pending' && opts.pendingLabel) control.textContent = opts.pendingLabel;
    else if (state === 'error' && opts.errorLabel) control.textContent = opts.errorLabel;
    else if (state === 'idle') control.textContent = original;
  };
  control.addEventListener('click', (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    setState('pending');
    const req = request();
    createBotGame(req).then(
      (url) => {
        // A one-click start skips the setup dialog, so it records the engine
        // itself; otherwise the device never "remembers" the game it just
        // played and the next visit hands out the first-game rung again (#365).
        rememberPveEngine(req.gameSpecId, req.botId);
        window.location.href = url;
      },
      () => {
        pending = false;
        setState('error');
        window.setTimeout(() => {
          if (!pending) setState('idle');
        }, 2_000);
      },
    );
  });
}
