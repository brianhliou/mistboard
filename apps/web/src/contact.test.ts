import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContact, contactAboutPath } from './contact.js';

describe('contact page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('localizes the Traditional Chinese anonymous form chrome and validation', () => {
    const view = buildContact(null, false, 'zh-Hant');
    document.body.append(view.el);

    expect(view.el.querySelector('.site-section-heading')?.textContent).toBe('聯絡');
    expect(view.el.querySelector('.contact-intro')?.textContent).toBe(
      '這是直接聯絡 Mistboard 營運者的私人管道。Bug、壞掉的對局、帳號或付費問題，以及任何不想公開發布的內容。想收到回覆的話，可以留下信箱。',
    );
    const forumLink = view.el.querySelector<HTMLAnchorElement>('.contact-forum-note a');
    expect(forumLink?.getAttribute('href')).toBe('/forum');
    expect(forumLink?.textContent).toBe('論壇');
    expect(view.el.querySelector('.contact-forum-note')?.textContent).toBe(
      '提問、想法，以及其他玩家也能參與討論的話題，請發到論壇。',
    );
    expect(view.el.querySelector('textarea')?.placeholder).toBe('你想說什麼？');
    expect(view.el.querySelector('label.contact-field span')?.textContent).toBe('訊息');
    expect(view.el.querySelector('input[name="email"]')?.previousElementSibling?.textContent).toBe(
      '信箱（選填）',
    );
    expect(view.el.querySelector<HTMLAnchorElement>('.contact-signin-prompt a')?.textContent).toBe(
      '登入',
    );
    expect(view.el.querySelector('.contact-submit')?.textContent).toBe('送出');

    submitContactForm();

    expect(view.el.querySelector('.contact-status')?.textContent).toBe('請輸入訊息。');
  });

  it('localizes successful submit status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: true })),
    );
    const view = buildContact(null, false, 'zh-Hant');
    document.body.append(view.el);

    const message = view.el.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
    if (!message) throw new Error('missing message field');
    message.value = 'hello';

    submitContactForm();
    await flushDom();

    expect(view.el.querySelector('.contact-status')?.textContent).toBe('謝謝，訊息已收到。');
  });

  it('sends a same-site ?about= path with the message and shows it above the form', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ ok: true }),
    );
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/contact');
    const view = buildContact(null, false, 'en', '?about=%2Fplayers%2Fyin-sheng');
    document.body.append(view.el);

    expect(view.el.querySelector('.contact-about')?.textContent).toBe('About: /players/yin-sheng');
    await sendMessage(view.el);

    expect(sentPath(fetchMock)).toBe('/contact?about=/players/yin-sheng');
    window.history.replaceState(null, '', '/');
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['absolute URL', 'https://x'],
    ['scheme', 'javascript:alert(1)'],
    ['backslash host', '/\\evil.com'],
    ['overlong', `/${'a'.repeat(200)}`],
  ])('drops a %s ?about= and sends only the page path', async (_label, about) => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ ok: true }),
    );
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/contact');
    const view = buildContact(null, false, 'en', `?about=${encodeURIComponent(about)}`);
    document.body.append(view.el);

    expect(view.el.querySelector('.contact-about')).toBeNull();
    await sendMessage(view.el);

    expect(sentPath(fetchMock)).toBe('/contact');
    window.history.replaceState(null, '', '/');
  });

  it('takes an about path of exactly 200 characters, and none without the parameter', () => {
    const longest = `/${'a'.repeat(199)}`;
    expect(contactAboutPath(`?about=${encodeURIComponent(longest)}`)).toBe(longest);
    expect(contactAboutPath('')).toBeNull();
    expect(contactAboutPath('?about=')).toBeNull();
  });
});

async function sendMessage(root: HTMLElement): Promise<void> {
  const message = root.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
  if (!message) throw new Error('missing message field');
  message.value = 'please take my photo down';
  submitContactForm();
  await flushDom();
}

function sentPath(fetchMock: { mock: { calls: Array<[string, RequestInit?]> } }): unknown {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)).path;
}

function submitContactForm(): void {
  const form = document.querySelector<HTMLFormElement>('form.contact-form');
  if (!form) throw new Error('missing contact form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

async function flushDom(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
