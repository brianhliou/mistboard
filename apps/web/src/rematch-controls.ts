import { t } from './i18n/catalog.js';
import { liveState, noteRematchCancel, type PlayableSeat } from './live-state.js';

type SendSocket = (payload: unknown) => boolean;

// Shared post-game rematch controls for chess (white/black) and Dark Mini
// Xiangqi (red/black). Reads the unified `liveState.rematch`; the only per-game
// input is the two seat colors. Returns a single self-contained block so the
// room-action stack doesn't reshuffle as the rematch state changes — the
// Decline/Accept pair sits side by side in the slot the lone Rematch button held.
export function rematchControls(
  mySeat: PlayableSeat,
  theirSeat: PlayableSeat,
  sendSocket: SendSocket,
): HTMLElement {
  const offers = liveState.rematch.offers;
  return rematchBlock(
    {
      iOffered: Boolean(offers[mySeat]),
      theyOffered: Boolean(offers[theirSeat]),
      declined: Boolean(liveState.rematch.declined),
    },
    sendSocket,
    noteRematchCancel,
  );
}

// The block itself, from the three facts it depends on. Shared with the tenant
// rooms (variant-tenant/tenant-rematch.ts), which keep their own state.
export function rematchBlock(
  state: { iOffered: boolean; theyOffered: boolean; declined: boolean },
  sendSocket: SendSocket,
  onCancel: () => void,
): HTMLElement {
  const { iOffered, theyOffered } = state;
  const block = document.createElement('div');
  block.className = 'room-rematch';

  if (iOffered && theyOffered) {
    block.append(buttonRow(disabledButton(t('live.rematchStarting'))));
    return block;
  }
  if (iOffered) {
    block.append(
      note(t('live.rematchWaiting')),
      buttonRow(
        actionButton(t('live.rematchCancel'), () => {
          onCancel();
          sendSocket({ type: 'rematch:cancel' });
        }),
      ),
    );
    return block;
  }
  if (theyOffered) {
    block.append(
      note(t('live.rematchOffered')),
      buttonRow(
        actionButton(t('live.rematchDecline'), () => sendSocket({ type: 'rematch:decline' })),
        actionButton(
          t('live.rematchAccept'),
          () => sendSocket({ type: 'rematch:offer' }),
          'primary',
        ),
      ),
    );
    return block;
  }
  // Idle — possibly just after the opponent declined our offer.
  if (state.declined) {
    block.append(note(t('live.rematchDeclined')));
  }
  block.append(
    buttonRow(actionButton(t('live.rematch'), () => sendSocket({ type: 'rematch:offer' }))),
  );
  return block;
}

function note(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'room-rematch-note';
  p.textContent = text;
  return p;
}

function buttonRow(...buttons: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'room-rematch-buttons';
  row.append(...buttons);
  return row;
}

function actionButton(label: string, onClick: () => void, variant?: 'primary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  if (variant) button.className = variant;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function disabledButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.disabled = true;
  button.textContent = label;
  return button;
}
