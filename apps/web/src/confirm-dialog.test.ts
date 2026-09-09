import { beforeEach, describe, expect, it } from 'vitest';
import { openConfirmDialog } from './confirm-dialog.js';

// `onConfirm` is what sends resign and abort to the server, and it runs from the
// dialog's `close` event rather than from the button's own handler. That
// indirection is the reason this file exists: a click that closes the dialog
// without setting `returnValue`, or a `close` listener that stops firing, would
// leave every confirmed game action silently unsent with the button, the dialog
// and the dismissal all still looking correct.
describe('openConfirmDialog', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    // happy-dom implements <dialog> without the top layer; showModal/close are
    // what the real dialog uses, so stub only what is missing.
    const proto = window.HTMLDialogElement?.prototype as
      | (HTMLDialogElement & { showModal?: () => void })
      | undefined;
    if (proto && typeof proto.showModal !== 'function') {
      proto.showModal = function showModal(this: HTMLDialogElement) {
        this.open = true;
      };
    }
  });

  function open(onConfirm: () => void): HTMLDialogElement {
    openConfirmDialog({
      title: 'Resign this game?',
      body: 'Your opponent wins. This cannot be undone.',
      confirmLabel: 'Resign',
      confirmTone: 'danger',
      onConfirm,
    });
    const dialog = document.querySelector<HTMLDialogElement>('dialog[data-confirm-dialog]');
    if (!dialog) throw new Error('dialog was not mounted');
    return dialog;
  }

  it('runs onConfirm when the confirm button is clicked', () => {
    let confirmed = 0;
    const dialog = open(() => {
      confirmed += 1;
    });
    dialog.querySelector<HTMLButtonElement>('.confirm-dialog-confirm')?.click();
    expect(confirmed).toBe(1);
    expect(document.querySelector('dialog[data-confirm-dialog]')).toBeNull();
  });

  it('does NOT run onConfirm when cancelled', () => {
    let confirmed = 0;
    const dialog = open(() => {
      confirmed += 1;
    });
    dialog.querySelector<HTMLButtonElement>('.confirm-dialog-cancel')?.click();
    expect(confirmed).toBe(0);
    expect(document.querySelector('dialog[data-confirm-dialog]')).toBeNull();
  });

  // Opening a second dialog drops the first. The replaced dialog must not fire
  // its own onConfirm on the way out, or dismissing one prompt would perform the
  // action another prompt was asking about.
  it('replaces an open dialog without confirming it', () => {
    let first = 0;
    let second = 0;
    open(() => {
      first += 1;
    });
    const replacement = open(() => {
      second += 1;
    });
    expect(document.querySelectorAll('dialog[data-confirm-dialog]')).toHaveLength(1);
    replacement.querySelector<HTMLButtonElement>('.confirm-dialog-confirm')?.click();
    expect(first).toBe(0);
    expect(second).toBe(1);
  });
});
