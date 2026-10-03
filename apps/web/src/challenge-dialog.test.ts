import { CORRESPONDENCE_ELIGIBLE_SPEC_IDS } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChallengeDialog } from './challenge-dialog.js';

describe('openChallengeDialog', () => {
  afterEach(() => {
    for (const d of document.querySelectorAll('dialog[data-challenge-dialog]')) d.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders a directed-challenge modal with variant + day + color selects and the target name', () => {
    openChallengeDialog({ handle: 'alice' });
    const dialog = document.querySelector('dialog[data-challenge-dialog]');
    expect(dialog).not.toBeNull();
    // Variant, days, color — the variant select is hidden when only one spec is eligible but
    // is still in the DOM.
    expect(dialog?.querySelectorAll('select')).toHaveLength(3);
    expect(dialog?.textContent).toContain('alice');
    const variant = dialog?.querySelector<HTMLSelectElement>('select[aria-label="Variant"]');
    expect([...variant!.options].map((option) => option.value)).toEqual([
      ...CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
    ]);
    expect(variant?.value).toBe('xiangqi');
  });

  it('posts a directed challenge addressed by target handle on send', () => {
    // Never resolves: the request body is set synchronously at the fetch call, so we
    // can assert it without triggering the navigation-on-success branch.
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    openChallengeDialog({ handle: 'bob' });
    const dialog = document.querySelector('dialog[data-challenge-dialog]');
    const send = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Send challenge',
    );
    send?.click();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/correspondence/seeks');
    const body = JSON.parse(init.body as string) as {
      targetHandle: string;
      gameSpecId: string;
      daysPerMove: number;
      preferredColor: string;
    };
    expect(body.targetHandle).toBe('bob');
    // The canonical first correspondence variant is the default.
    expect(body.gameSpecId).toBe('xiangqi');
    expect(typeof body.daysPerMove).toBe('number');
    expect(['random', 'first', 'second']).toContain(body.preferredColor);
  });
});
