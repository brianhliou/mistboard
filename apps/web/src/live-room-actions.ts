import type { Color, PlayerView } from '@mistboard/game';
import { t } from './i18n/catalog.js';
import type { LiveRefs } from './live-state.js';
import { liveState } from './live-state.js';
import { correspondenceAwaitingOpponent } from './live-status.js';
import { currentView } from './live-view.js';
import { postGameInviteButton } from './postgame-invite.js';
import { rematchControls } from './rematch-controls.js';
import { isColor, oppositeColor } from './web-utils.js';

type RoomActionRefs = Pick<LiveRefs, 'roomActions'>;
type SendSocket = (payload: unknown) => boolean;

type RoomActionDeps = {
  sendSocket: SendSocket;
};

let playAgainStatus: 'idle' | 'creating' | 'failed' = 'idle';

export type PlayAgainRoomRequestBody = {
  mode: 'pvp' | 'pve';
  variant: string;
  engineId?: string;
  preferredColor?: Color;
  timeControl?: { initialMs: number; incrementMs: number };
};

export function renderRoomActions(refs: RoomActionRefs, deps: RoomActionDeps): void {
  const view = currentView();
  // No standing Back-home action (lichess parity): the site nav is the way out.
  const actions: HTMLElement[] = [];
  if (shouldShowPostGameRoomActions(view)) {
    const seat = liveState.seat;
    if (liveState.roomMode === 'pvp' && isColor(seat)) {
      actions.unshift(rematchControls(seat, oppositeColor(seat), deps.sendSocket));
    } else if (liveState.roomMode === 'pve') {
      actions.unshift(playAgainButton(refs, deps));
    }
    actions.unshift(
      roomAction(t('live.reviewGame'), `/game/${encodeURIComponent(liveState.room)}`, 'primary'),
    );
    // A rematch or another bot game reuses the opponent you already had; this is
    // the only post-game action that produces a new human one.
    const invite = postGameInviteButton(postGameVariant());
    if (invite) actions.push(invite);
    refs.roomActions.replaceChildren(...actions);
    return;
  }
  // Rooms are 'playing' from creation, so the invite window is "second seat
  // unclaimed" (the correspondence rule; live friend rooms share the link from
  // the setup dialog instead).
  const inviteOpen = view?.status.type === 'playing' && correspondenceAwaitingOpponent();
  if (inviteOpen && isColor(liveState.seat)) {
    actions.unshift(copyLinkButton());
  }
  if (liveState.engineRequested)
    actions.push(roomAction(t('live.newDebugRoom'), 'dark-chess', 'engine'));
  refs.roomActions.replaceChildren(...actions);
}

export function shouldShowPostGameRoomActions(view: PlayerView | null): boolean {
  return view?.status.type === 'finished' || liveState.state?.status.type === 'finished';
}

function copyLinkButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'primary';
  btn.textContent = t('live.copyInviteLink');
  btn.addEventListener('click', () => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        btn.textContent = t('live.linkCopied');
        setTimeout(() => {
          btn.textContent = t('live.copyInviteLink');
        }, 2000);
      })
      .catch(() => {});
  });
  return btn;
}

function roomAction(
  label: string,
  href: string,
  toneOrDev?: 'primary' | 'engine',
): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = toneOrDev === 'engine' ? roomUrl('dark-chess', 'engine') : href;
  if (toneOrDev === 'primary') link.className = 'primary';
  link.textContent = label;
  return link;
}

function playAgainButton(refs: RoomActionRefs, deps: RoomActionDeps): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = playAgainStatus === 'failed' ? 'danger' : '';
  button.disabled = playAgainStatus === 'creating';
  button.textContent =
    playAgainStatus === 'creating'
      ? 'Creating'
      : playAgainStatus === 'failed'
        ? 'Try play again'
        : 'Play again';
  button.addEventListener('click', () => {
    void createPlayAgainRoom(refs, deps);
  });
  return button;
}

async function createPlayAgainRoom(refs: RoomActionRefs, deps: RoomActionDeps): Promise<void> {
  const body = buildPlayAgainRoomRequestBody();
  if (!body) return;
  playAgainStatus = 'creating';
  renderRoomActions(refs, deps);
  try {
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`room creation failed: ${response.status}`);
    const data = (await response.json()) as { url?: string };
    if (!data.url) throw new Error('room creation response missing url');
    window.location.assign(data.url);
  } catch (err) {
    console.warn(err);
    playAgainStatus = 'failed';
    renderRoomActions(refs, deps);
  }
}

export function buildPlayAgainRoomRequestBody(): PlayAgainRoomRequestBody | null {
  if (liveState.roomMode !== 'pvp' && liveState.roomMode !== 'pve') return null;
  const preferredColor =
    liveState.roomMode === 'pve' && isColor(liveState.seat)
      ? oppositeColor(liveState.seat)
      : undefined;
  return {
    mode: liveState.roomMode,
    variant:
      currentView()?.variant ??
      liveState.state?.variant ??
      liveState.variantRequested ??
      'dark-chess',
    ...(liveState.roomMode === 'pve' && liveState.pveEngineId
      ? { engineId: liveState.pveEngineId }
      : {}),
    ...(preferredColor ? { preferredColor } : {}),
    // Carry the current game's time control into the rematch. Without this the
    // server falls back to its default clock (3+2), so "play again" on a 1+1
    // game silently started a 3+2 game (room 7bf718fa → b52b5221).
    ...(liveState.timeControl ? { timeControl: liveState.timeControl } : {}),
  };
}

function postGameVariant(): string | undefined {
  return (
    currentView()?.variant ?? liveState.state?.variant ?? liveState.variantRequested ?? undefined
  );
}

function roomUrl(variant: PlayerView['variant'], dev?: 'engine'): string {
  const params = new URLSearchParams({
    reset: '1',
    room: crypto.randomUUID(),
  });
  params.set('variant', variant);
  if (dev) params.set('dev', dev);
  return `/?${params}`;
}
