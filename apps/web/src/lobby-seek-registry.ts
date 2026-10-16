// The lobby seeks this page is waiting in. A waiting seek is a promise to show
// up: the server seats the next matching joiner straight into a room with it.
// So a tab that starts any other game while a seek is open withdraws the seek
// first, or a stranger lands in a room its seeker never enters (prod,
// 2026-10-09: a guest's jieqi seek outlived the bot game the same tab started).

type Withdraw = () => Promise<void>;

const seeks = new Set<Withdraw>();

// Starting a game waits for the DELETEs so the server drops the seek before it
// sees the new room, but never longer than this: a hung request must not hold
// up the game the player asked for.
const WITHDRAW_WAIT_CAP_MS = 1_000;

/** Track an open seek; returns the function that forgets it again. */
export function registerLobbySeek(withdraw: Withdraw): () => void {
  seeks.add(withdraw);
  return () => {
    seeks.delete(withdraw);
  };
}

/** Withdraw every open seek on this page. Null when there is none, so callers
 *  on the common path add no await. */
export function withdrawLobbySeeks(): Promise<void> | null {
  if (seeks.size === 0) return null;
  const pending = [...seeks].map((withdraw) => withdraw());
  seeks.clear();
  return Promise.race([
    Promise.all(pending).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, WITHDRAW_WAIT_CAP_MS)),
  ]);
}

export function openLobbySeekCount(): number {
  return seeks.size;
}
