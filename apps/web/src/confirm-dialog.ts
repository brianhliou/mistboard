export type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmTone?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel?: () => void;
};

export function openConfirmDialog(opts: ConfirmOptions): HTMLDialogElement {
  const existing = document.querySelector<HTMLDialogElement>('dialog[data-confirm-dialog]');
  existing?.close('cancel');
  existing?.remove();

  const dialog = document.createElement('dialog');
  dialog.dataset.confirmDialog = '';
  dialog.className = 'confirm-dialog';

  const title = document.createElement('h2');
  title.className = 'confirm-dialog-title';
  title.textContent = opts.title;

  const body = document.createElement('p');
  body.className = 'confirm-dialog-body';
  body.textContent = opts.body;

  const actions = document.createElement('div');
  actions.className = 'confirm-dialog-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'confirm-dialog-cancel';
  cancel.textContent = opts.cancelLabel ?? 'Cancel';
  cancel.addEventListener('click', () => {
    dialog.close('cancel');
  });

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className =
    opts.confirmTone === 'danger' ? 'confirm-dialog-confirm danger' : 'confirm-dialog-confirm';
  confirm.textContent = opts.confirmLabel;
  confirm.addEventListener('click', () => {
    dialog.close('confirm');
  });

  actions.append(cancel, confirm);
  dialog.append(title, body, actions);

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close('cancel');
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm') opts.onConfirm();
    else opts.onCancel?.();
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
  cancel.focus();
  return dialog;
}
