import { setRoomInfoHandler } from './game-table.js';
import { t } from './i18n/catalog.js';
import { CHAT_LINES_EVENT } from './review/spectator-chat.js';

// Phone room (600px and under, #576): the game card and the chat leave the page
// for a sheet over the board, opened from the bar's ☰, so the room is one
// screen that never scrolls (Brian, 2026-10-17: "aim for the page not
// scrolling"). Wider screens keep both in the left rail. A chat line that
// arrives while the sheet is closed marks ☰ until the sheet opens.

export const PHONE_ROOM_QUERY = '(max-width: 600px)';

export function attachRoomInfoSheet(
  cluster: HTMLElement,
  metaPanel: HTMLElement,
  anchor: HTMLElement,
  media: Pick<MediaQueryList, 'matches' | 'addEventListener'> = window.matchMedia(PHONE_ROOM_QUERY),
): { open(): void; close(): void } {
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'meta-panel__close';
  closeButton.textContent = t('live.roomInfoClose');
  closeButton.addEventListener('click', () => close());
  metaPanel.prepend(closeButton);

  const isOpen = () => cluster.dataset.roomSheet === 'open';
  function open(): void {
    cluster.dataset.roomSheet = 'open';
    delete cluster.dataset.chatUnread;
  }
  function close(): void {
    delete cluster.dataset.roomSheet;
  }

  function sync(): void {
    if (media.matches) {
      setRoomInfoHandler(anchor, () => (isOpen() ? close() : open()));
    } else {
      setRoomInfoHandler(anchor, null);
      close();
      delete cluster.dataset.chatUnread;
    }
  }
  sync();
  media.addEventListener('change', sync);

  metaPanel.addEventListener(CHAT_LINES_EVENT, () => {
    if (media.matches && !isOpen()) cluster.dataset.chatUnread = '';
  });

  // Escape or a tap anywhere outside the sheet closes it. The ☰ menu row that
  // opened it is outside too, so its own click is let through.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!isOpen() || !cluster.isConnected) return;
    const target = event.target as Node | null;
    const bar = anchor.closest('.game-console')?.querySelector('.move-nav-bar');
    if (target && (metaPanel.contains(target) || bar?.contains(target))) return;
    close();
  });

  return { open, close };
}
