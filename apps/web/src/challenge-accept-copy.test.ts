import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChallengeCard, type ChallengeView } from './challenge-accept.js';

// A browser can refuse a clipboard write (Chrome on Android: "NotAllowedError:
// Write permission denied", PostHog error tracking 2026-10). The copy button
// must not leave an unhandled rejection behind, and must not claim it copied.
const VIEW: ChallengeView = {
  id: 'seek_abc',
  gameSpecId: 'xiangqi',
  daysPerMove: 3,
  preferredColor: 'random',
  visibility: 'private',
  challengerName: 'alice',
  isMine: true,
  canAccept: false,
  canDecline: false,
  expired: false,
};

function stubClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

function copyButton(card: HTMLElement): HTMLButtonElement {
  const button = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Copy link');
  if (!button) throw new Error('no copy button');
  return button;
}

describe('challenge link copy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says copied once the write succeeds', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const card = buildChallengeCard(VIEW);
    const button = copyButton(card);
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe('Copied'));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/challenge/seek_abc`);
  });

  it('selects the link for a manual copy when the browser refuses the write', async () => {
    let settled = false;
    const writeText = vi.fn(() =>
      Promise.reject(new DOMException('Write permission denied', 'NotAllowedError')).finally(() => {
        settled = true;
      }),
    );
    stubClipboard(writeText);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const card = buildChallengeCard(VIEW);
      document.body.append(card);
      const input = card.querySelector<HTMLInputElement>('.challenge-share-link')!;
      const button = copyButton(card);
      button.click();
      await vi.waitFor(() => expect(settled).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(button.textContent).toBe('Copy link');
      expect(document.activeElement).toBe(input);
      card.remove();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

// A directed challenge tells its creator whether the target was emailed (#1057),
// never why not; a plain link challenge has no target and says nothing.
describe('challenge target status', () => {
  it('says who was emailed, by handle, linked to their profile', () => {
    const card = buildChallengeCard({
      ...VIEW,
      targetName: 'Bob',
      targetHandle: 'bob',
      targetEmailed: true,
    });
    const line = card.querySelector('.challenge-target-status');
    expect(line?.textContent).toBe('We emailed @bob');
    expect(line?.querySelector('a')?.getAttribute('href')).toContain('bob');
  });

  it('asks the creator to send the link when the target gets no email', () => {
    const card = buildChallengeCard({
      ...VIEW,
      targetName: 'Bob',
      targetHandle: 'bob',
      targetEmailed: false,
    });
    expect(card.querySelector('.challenge-target-status')?.textContent).toBe('Send them this link');
    expect(card.querySelector('.challenge-share-link')).not.toBeNull();
  });

  it('a link challenge with no target shows no status line', () => {
    const card = buildChallengeCard(VIEW);
    expect(card.querySelector('.challenge-target-status')).toBeNull();
  });
});
