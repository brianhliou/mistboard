import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChallengeDialog } from './challenge-dialog.js';
import { buildHostCard, buildStartForm } from './correspondence.js';
import { renderFirstMoveOwed } from './correspondence-first-move.js';
import { postCorrespondenceSeekFromPlay } from './landing-play.js';
import { buildSeekAcceptAction } from './seek-accept.js';

const failure = { error: 'first_move_owed', roomId: 'xq_owed', opponentName: 'Lee' };
const message = 'Make your first move in your game against Lee before starting another.';

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('first move owed message', () => {
  it.each([
    ['en', '/room/xq_owed', message],
    ['zh-Hans', '/room/xq_owed', '请先在与Lee的对局中走出第一步，再开始另一盘对局。'],
    ['zh-Hant', '/room/xq_owed', '請先在與Lee的對局中走出第一步，再開始另一盤對局。'],
  ] as const)('localizes the message and game link in %s', (locale, href, text) => {
    const status = document.createElement('p');
    expect(renderFirstMoveOwed(status, failure, locale)).toBe(true);
    expect(status.textContent).toBe(text);
    expect(status.querySelector('a')?.getAttribute('href')).toBe(href);
    expect(status.hidden).toBe(false);
    expect(status.textContent).not.toContain('—');
  });

  it('uses the opponent fallback and encodes the room id', () => {
    const status = document.createElement('p');
    renderFirstMoveOwed(status, { ...failure, roomId: 'xq/a?b', opponentName: null }, 'en');
    expect(status.textContent).toContain('your opponent');
    expect(status.querySelector('a')?.getAttribute('href')).toBe('/room/xq%2Fa%3Fb');
  });

  it.each(['start form', 'host', 'challenge dialog', 'homepage', 'seek row'])(
    'shows the linked message on %s',
    async (surface) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(failure), { status: 409 })),
      );
      let root: HTMLElement;
      if (surface === 'challenge dialog') {
        openChallengeDialog({ handle: 'friend' });
        root = document.querySelector<HTMLElement>('dialog[data-challenge-dialog]')!;
        root.querySelector<HTMLButtonElement>('.confirm-dialog-confirm')!.click();
      } else if (surface === 'start form') {
        root = buildStartForm(() => {});
        document.body.append(root);
        root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      } else if (surface === 'host') {
        root = buildHostCard({
          host: { handle: 'host', displayName: 'Host' },
          daysPerMove: 2,
          gameSpecIds: ['xiangqi'],
          limits: { perPlayer: 2, total: 15 },
          signedIn: true,
        });
        document.body.append(root);
        root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      } else if (surface === 'homepage') {
        root = document.createElement('div');
        const button = document.createElement('button');
        const status = document.createElement('p');
        root.append(button, status);
        document.body.append(root);
        await postCorrespondenceSeekFromPlay(button, status, 1, 'xiangqi', false, 'en');
      } else {
        root = document.createElement('div');
        const action = buildSeekAcceptAction({
          seek: { id: 'seek', gameSpecId: 'xiangqi', daysPerMove: 1 },
          className: 'accept',
          surface: 'home-lobby',
          signedIn: true,
        }) as HTMLButtonElement;
        root.append(action);
        document.body.append(root);
        action.click();
      }
      await flush();
      expect(root.textContent).toContain(message);
      expect(root.querySelector('a[href="/room/xq_owed"]')).not.toBeNull();
      expect(root.querySelector<HTMLButtonElement>('button[disabled]')?.textContent).not.toBe(
        'Accept',
      );
    },
  );
});
