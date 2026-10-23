import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountStudy } from './study.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.documentElement.classList.remove('study-sheet-open');
  window.history.replaceState({}, '', '/');
});

const withMove = { version: 1, root: { children: [{ uci: 'h3e3', children: [] }] } };
const empty = { version: 1, root: { children: [] } };

function chapter(id: string, name: string, root: unknown, tags?: Record<string, string>) {
  return {
    id,
    name,
    variant: 'xiangqi',
    orientation: 'red',
    root,
    version: 1,
    gamebook: false,
    ...(tags ? { tags } : {}),
  };
}

const CHAPTERS = [
  chapter('c1', 'Opening', withMove, {
    red: 'Zuo Wenjing',
    black: 'Tang Dan',
    result: '1-0',
    event: 'World Championship',
    date: '2022.11.01',
  }),
  chapter('c2', 'Middlegame', withMove, {
    red: 'Wang Linna',
    black: 'Zuo Wenjing',
    result: '1/2-1/2',
    event: 'World Championship',
    date: '2022.11.02',
  }),
  chapter('c3', 'Endgame', empty, {
    red: 'Zuo Wenjing',
    black: 'Chen Xingtong',
    result: '0-1',
    event: 'National League',
    date: '2023.04.10',
  }),
];

async function mountPhoneStudy(chapterId?: string): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/studies/phone1') {
        return jsonResponse({
          study: {
            id: 'phone1',
            name: 'Zuo Wenjing games',
            description: '',
            visibility: 'public',
            isOwner: false,
            likeCount: 0,
            likedByViewer: false,
          },
          chapters: CHAPTERS,
        });
      }
      if (url === '/api/chat/study/phone1') return jsonResponse({ lines: [] });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  const root = document.createElement('div');
  document.body.append(root);
  await mountStudy(root, 'phone1', chapterId);
  return root;
}

const sheet = (): HTMLElement | null => document.querySelector<HTMLElement>('.study-sheet');
const dockButton = (root: HTMLElement, kind: string): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`.study-phone-dock [data-study-phone="${kind}"]`)!;
const chapterName = (root: HTMLElement): string =>
  root.querySelector('.study-phone-bar__chapter')?.textContent ?? '';

describe('phone study chrome', () => {
  it('puts a one-line chapter bar under the nav and a dock after the review', async () => {
    const root = await mountPhoneStudy();
    const bar = root.querySelector('.study-phone-bar');
    expect(bar?.previousElementSibling?.classList.contains('site-nav')).toBe(true);
    // The study title moved to the Info sheet, so the bar is one line.
    expect(bar?.textContent).not.toContain('Zuo Wenjing games');
    expect(chapterName(root)).toBe('Opening');
    expect(root.querySelector('.study-phone__pill')?.textContent).toBe('1 / 3');
    expect(root.lastElementChild?.classList.contains('study-phone-dock')).toBe(true);
    expect(
      [...root.querySelectorAll<HTMLElement>('.study-phone-dock button')].map(
        (b) => b.dataset.studyPhone,
      ),
    ).toEqual(['chapters', 'info', 'back', 'next']);
    expect(dockButton(root, 'back').hidden).toBe(false);
    expect(dockButton(root, 'next').hidden).toBe(false);
  });

  it('opens the chapter sheet from the pill and lists every chapter', async () => {
    const root = await mountPhoneStudy();
    const pill = root.querySelector<HTMLButtonElement>('.study-phone__pill')!;
    pill.click();

    const dialog = sheet();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    expect(document.documentElement.classList.contains('study-sheet-open')).toBe(true);
    expect(dialog?.querySelector('h2')?.textContent).toBe('3 Chapters');
    const links = [...dialog!.querySelectorAll<HTMLAnchorElement>('.study-sheet__link')];
    expect(links.map((link) => link.dataset.chapterId)).toEqual(['c1', 'c2', 'c3']);
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    expect(links[0]?.closest('li')?.classList.contains('is-current')).toBe(true);
    expect(links[1]?.hasAttribute('aria-current')).toBe(false);
    // Event groups and result chips come from the rail's own helpers.
    expect(
      [...dialog!.querySelectorAll('.study-sheet__group')].map((group) => group.textContent),
    ).toHaveLength(2);
    expect(links[0]?.querySelector('.study-game-line__result')).not.toBeNull();
    // Focus moves into the sheet.
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  it('opens the sheet from the Chapters button and closes on Escape, close and overlay', async () => {
    const root = await mountPhoneStudy();
    const button = dockButton(root, 'chapters');
    button.focus();
    button.click();
    expect(sheet()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sheet()).toBeNull();
    expect(document.documentElement.classList.contains('study-sheet-open')).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    button.click();
    sheet()!.querySelector<HTMLButtonElement>('.study-sheet__close')!.click();
    expect(sheet()).toBeNull();

    button.click();
    document.querySelector<HTMLElement>('.study-sheet-overlay')!.click();
    expect(sheet()).toBeNull();
    expect(document.querySelector('.study-sheet-overlay')).toBeNull();
  });

  it('Info borrows the title card, About and description, and puts them back on close', async () => {
    const root = await mountPhoneStudy();
    const card = root.querySelector<HTMLElement>('.review-info-card')!;
    const about = root.querySelector<HTMLElement>('.review-underboard-panel')!;
    const cardHome = card.parentElement;
    const aboutHome = about.parentElement;
    const aboutNext = about.nextSibling;
    const button = dockButton(root, 'info');
    button.click();

    const dialog = document.querySelector<HTMLElement>('.study-info-sheet');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Zuo Wenjing games');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(dialog?.contains(card)).toBe(true);
    expect(dialog?.contains(about)).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.study-info-sheet')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(card.parentElement).toBe(cardHome);
    expect(about.parentElement).toBe(aboutHome);
    expect(about.nextSibling).toBe(aboutNext);
  });

  it('filters the list from the search field', async () => {
    const root = await mountPhoneStudy();
    root.querySelector<HTMLButtonElement>('.study-phone__pill')!.click();
    const dialog = sheet()!;
    dialog.querySelector<HTMLButtonElement>('.study-sheet__search-toggle')!.click();
    const search = dialog.querySelector<HTMLInputElement>('.study-sheet__search')!;
    expect(search.hidden).toBe(false);
    search.value = 'chen';
    search.dispatchEvent(new Event('input'));
    const visible = [...dialog.querySelectorAll<HTMLElement>('.study-sheet__row')].filter(
      (row) => !row.hidden,
    );
    expect(visible.map((row) => row.querySelector('a')?.dataset.chapterId)).toEqual(['c3']);
  });

  it('loads a picked chapter and closes the sheet', async () => {
    const root = await mountPhoneStudy();
    root.querySelector<HTMLButtonElement>('.study-phone__pill')!.click();
    sheet()!.querySelector<HTMLAnchorElement>('[data-chapter-id="c3"]')!.click();
    expect(sheet()).toBeNull();
    await vi.waitFor(() => expect(chapterName(root)).toBe('Endgame'), { timeout: 5000 });
    expect(root.querySelector('.study-phone__pill')?.textContent).toBe('3 / 3');
    expect(window.location.pathname).toContain('c3');
    expect(root.querySelectorAll('.study-phone-bar')).toHaveLength(1);
    expect(root.querySelectorAll('.study-phone-dock')).toHaveLength(1);
  });

  it('turns Next into Next chapter at the end of a chapter and advances', async () => {
    const root = await mountPhoneStudy();
    const next = dockButton(root, 'next');
    const back = dockButton(root, 'back');
    expect(next.textContent).toContain('Next');
    expect(next.textContent).not.toContain('Next chapter');
    expect(back.disabled).toBe(true);

    next.click();
    expect(next.textContent).toContain('Next chapter');
    expect(next.dataset.mode).toBe('chapter');
    expect(back.disabled).toBe(false);

    back.click();
    expect(next.dataset.mode).toBe('move');
    expect(back.disabled).toBe(true);
    next.click();
    expect(next.dataset.mode).toBe('chapter');

    next.click();
    await vi.waitFor(() => expect(chapterName(root)).toBe('Middlegame'), { timeout: 5000 });
    // A fresh chapter opens at its start: Next steps a move again.
    const nextAgain = dockButton(root, 'next');
    await vi.waitFor(() => expect(nextAgain.dataset.mode).toBe('move'), { timeout: 5000 });
  });

  it('disables Next at the end of the last chapter', async () => {
    const root = await mountPhoneStudy('c3');
    expect(chapterName(root)).toBe('Endgame');
    const next = dockButton(root, 'next');
    expect(next.disabled).toBe(true);
    expect(next.textContent).not.toContain('Next chapter');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
