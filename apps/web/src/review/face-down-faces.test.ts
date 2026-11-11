import {
  createInitialThreeKingdomsBanqiState,
  STANDARD_BANQI_DEAL,
  STANDARD_JIEQI_DEAL,
  STANDARD_JUNGLE_FLIP_DEAL,
} from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import { mountBanqiReview } from './banqi-review.js';
import { makeBanqiTreeAdapter } from './banqi-tree-adapter.js';
import { faceDownIdentities, withFaceDownFaces } from './face-down-faces.js';
import { mountJieqiReview } from './jieqi-review.js';
import { mountJungleFlipReview } from './jungle-flip-review.js';
import {
  mountThreeKingdomsBanqiReview,
  threeKingdomsBanqiShareFen,
} from './three-kingdoms-banqi-review.js';

// #824: a finished flip game's review shows what the still-face-down pieces
// were, as a ghost face on hover (mouse or pen) and from the menu's Reveal
// identities. The as-played view stays masked: the ghost is an overlay, so a
// flip is still the legal self-move on a face-down tile, and a mount that does
// not opt in (a study, the analysis board) draws no ghost at all.

afterEach(() => {
  document.body.replaceChildren();
});

const base = { ariaLabel: 'test', title: 'Review', summary: 'test', moves: [], analysis: null };

type Mount = (root: HTMLElement, showFaceDown: boolean) => void;

const tkStart = createInitialThreeKingdomsBanqiState('tk-test', 7);

const MOUNTS: [string, Mount, number][] = [
  [
    'banqi',
    (root, showFaceDown) =>
      mountBanqiReview(
        root,
        'room-banqi',
        { deal: STANDARD_BANQI_DEAL, rules: {} },
        { ...base, showFaceDown },
      ),
    32,
  ],
  [
    'three kingdoms banqi',
    (root, showFaceDown) =>
      mountThreeKingdomsBanqiReview(root, {
        ...base,
        showFaceDown,
        root: { truth: tkStart, fen: threeKingdomsBanqiShareFen(tkStart) },
      }),
    Object.values(tkStart.board).filter((p) => p?.faceDown).length,
  ],
  [
    'flip jungle',
    (root, showFaceDown) =>
      mountJungleFlipReview(root, 'room-jgf', STANDARD_JUNGLE_FLIP_DEAL, { ...base, showFaceDown }),
    16,
  ],
  [
    'jieqi',
    (root, showFaceDown) =>
      mountJieqiReview(root, 'room-jq', STANDARD_JIEQI_DEAL, { ...base, showFaceDown }),
    30,
  ],
];

function mount(fn: Mount, showFaceDown: boolean): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  fn(root, showFaceDown);
  return root;
}

function menuItem(root: HTMLElement, label: string): HTMLButtonElement | null {
  root.querySelector<HTMLButtonElement>('.move-nav-bar__menu-button')?.click();
  for (const button of root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')) {
    if (button.querySelector('.move-nav-menu__item-label')?.textContent === label) return button;
  }
  return null;
}

function pointer(target: Element, type: string, pointerType: string): void {
  const event = new PointerEvent(type, { bubbles: true, pointerType });
  target.dispatchEvent(event);
}

describe.each(MOUNTS)('%s review face-down faces', (_name, fn, faceDownCount) => {
  it('draws a hidden ghost face on every face-down tile of a finished game', () => {
    const root = mount(fn, true);
    expect(root.querySelectorAll('.facedown-face').length).toBe(faceDownCount);
    expect(root.querySelectorAll('.facedown-revealed').length).toBe(0);
    expect(root.querySelectorAll('.facedown-peeking').length).toBe(0);
  });

  it('turns every ghost up from the menu and back down again', () => {
    const root = mount(fn, true);
    menuItem(root, 'Reveal identities')?.click();
    // Jieqi's toggle swaps in the dealt board, so its tiles stop being
    // face-down; the others keep the masked board and lift the ghosts.
    const revealed = root.querySelectorAll('.facedown-revealed').length;
    const ghosts = root.querySelectorAll('.facedown-face').length;
    expect(revealed === faceDownCount || ghosts === 0).toBe(true);
    if (ghosts === 0) expect(root.innerHTML).not.toContain('hidden piece');

    const hide = menuItem(root, 'Hide identities');
    expect(hide).not.toBeNull();
    hide?.click();
    expect(root.querySelectorAll('.facedown-revealed').length).toBe(0);
    expect(root.querySelectorAll('.facedown-face').length).toBe(faceDownCount);
  });

  it('peeks the tile under a mouse, and never on touch', () => {
    const root = mount(fn, true);
    const slot = root.querySelector('.facedown-face')?.closest('[data-piece-square]');
    const square = slot?.getAttribute('data-piece-square');
    expect(square).toBeTruthy();
    const hit = root.querySelector(`[data-square="${square}"]`);
    expect(hit).not.toBeNull();

    pointer(hit as Element, 'pointermove', 'touch');
    expect(root.querySelectorAll('.facedown-peeking').length).toBe(0);

    pointer(hit as Element, 'pointermove', 'mouse');
    const peeking = root.querySelectorAll('.facedown-peeking');
    expect(peeking.length).toBe(1);
    expect(peeking[0]?.getAttribute('data-piece-square')).toBe(square);
  });

  it('draws nothing and offers no reveal when the mount does not opt in', () => {
    const root = mount(fn, false);
    expect(root.querySelectorAll('.facedown-face').length).toBe(0);
  });
});

describe('withFaceDownFaces', () => {
  it('leaves the masked board untouched so a flip stays the legal move', () => {
    const adapter = makeBanqiTreeAdapter('room', { deal: STANDARD_BANQI_DEAL, rules: {} });
    const wrapped = withFaceDownFaces(adapter, () => false);
    const truth = adapter.initialTruth();
    const plain = adapter.project(truth);
    const faced = wrapped.project(truth);
    expect(faced.length).toBe(plain.length);
    faced.forEach((pv, i) => {
      expect(pv.view.board).toEqual(plain[i]?.view.board);
      // The identities ride beside the board, never inside it.
      expect(JSON.stringify(pv.view.board)).not.toContain('"role"');
      expect(Object.keys(pv.view.faceDownFaces?.identities ?? {}).length).toBe(32);
    });
  });

  it('skips a jieqi piece whose identity was never determined', () => {
    const ids = faceDownIdentities({
      a0: { color: 'red', role: 'chariot', faceDown: true },
      b0: { color: 'red', role: 'horse', faceDown: true, unknown: true },
      e0: { color: 'red', role: 'general', faceDown: false },
    });
    expect(ids).toEqual({ a0: { color: 'red', role: 'chariot' } });
  });
});
