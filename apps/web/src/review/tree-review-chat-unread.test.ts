// The phone game review's unread chat dot (#619 round 3, Brian: "if someone
// types in the chat the user won't see it… show a notification on the
// hamburger and on the chat room button"). The chat polls as before
// (spectator-chat.ts); a poll that brings in a line someone else wrote, while
// the Chat sheet is closed, marks ☰ and the Chat row. Opening the sheet clears
// both. Lines already there at load never reach the event, and the viewer's
// own lines do not count.
import type { XiangqiMove } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachChatUnread } from './review-info-sheet.js';
import { CHAT_LINES_EVENT, type ChatLinesDetail, chatLinesDetail } from './spectator-chat.js';
import { mountXiangqiReview } from './xiangqi-review.js';

const PLAYED: XiangqiMove[] = [
  { from: 'b3', to: 'e3' },
  { from: 'h8', to: 'e8' },
];

function stubMedia(phone: boolean): void {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, 'matches', { value: phone, writable: true });
  vi.spyOn(window, 'matchMedia').mockReturnValue(media);
}

function mount(): { root: HTMLElement; chat: HTMLElement } {
  const root = document.createElement('div');
  document.body.append(root);
  const chat = document.createElement('section');
  chat.className = 'review-spectator-chat';
  const metaCard = document.createElement('section');
  metaCard.className = 'game-meta-card';
  mountXiangqiReview(root, {
    ariaLabel: 'Review',
    title: 'Review',
    summary: '',
    moves: PLAYED,
    metaCard,
    details: chat,
    phoneInfoSheet: true,
    analysis: null,
  });
  return { root, chat };
}

const lines = (chat: HTMLElement, detail: ChatLinesDetail) =>
  chat.dispatchEvent(new CustomEvent(CHAT_LINES_EVENT, { bubbles: true, detail }));
const bar = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('.move-nav-bar.review-controls')!;
const menuButton = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>('.move-nav-bar__menu-button')!;
const chatRow = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('.move-nav-menu__item[data-review-info="chat"]')!;

describe('phone game review unread chat dot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('starts clear: lines there at load are not news', () => {
    stubMedia(true);
    const { root } = mount();
    expect(bar(root).dataset.chatUnread).toBeUndefined();
    expect(menuButton(root).getAttribute('aria-label')).toBe('Menu');
  });

  it("marks ☰ and the Chat row on someone else's line, and opening Chat clears it", () => {
    stubMedia(true);
    const { root, chat } = mount();
    lines(chat, { fromOthers: 1 });
    expect(bar(root).dataset.chatUnread).toBe('');
    expect(menuButton(root).getAttribute('aria-label')).toBe('Menu, new chat message');
    // The Chat row sits inside the marked bar, which the CSS dots.
    expect(bar(root).contains(chatRow(root))).toBe(true);

    menuButton(root).click();
    chatRow(root).click();
    expect(bar(root).dataset.chatUnread).toBeUndefined();
    expect(menuButton(root).getAttribute('aria-label')).toBe('Menu');

    // A line arriving while the sheet is open is read there.
    lines(chat, { fromOthers: 1 });
    expect(bar(root).dataset.chatUnread).toBeUndefined();
  });

  it("ignores the viewer's own lines", () => {
    stubMedia(true);
    const { root, chat } = mount();
    lines(chat, { fromOthers: 0 });
    expect(bar(root).dataset.chatUnread).toBeUndefined();
  });

  it('never marks above 600px, where the chat is on the page', () => {
    stubMedia(false);
    const bar = document.createElement('div');
    bar.innerHTML = '<button class="move-nav-bar__menu-button" aria-label="Menu"></button>';
    const chat = document.createElement('section');
    bar.append(chat);
    const abort = new AbortController();
    attachChatUnread({
      signal: abort.signal,
      chat,
      bar,
      isOpen: () => false,
      media: window.matchMedia('(max-width: 600px)'),
    });
    lines(chat, { fromOthers: 2 });
    expect(bar.dataset.chatUnread).toBeUndefined();
    abort.abort();
  });
});

describe('chatLinesDetail', () => {
  it("counts only other people's lines", () => {
    const incoming = [{ handle: 'me' }, { handle: 'ann' }, { handle: null }];
    expect(chatLinesDetail(incoming, 'me')).toEqual({ fromOthers: 2 });
    expect(chatLinesDetail([{ handle: 'me' }], 'me')).toEqual({ fromOthers: 0 });
    // A signed-out viewer has no lines of their own.
    expect(chatLinesDetail([{ handle: 'me' }], null)).toEqual({ fromOthers: 1 });
  });
});
