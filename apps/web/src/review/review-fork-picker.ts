import { t } from '../i18n/catalog.js';
import type { TreePath } from './game-tree.js';
import './review-fork-picker.css';

/** Phone continuations for short boards. Only existing tree labels and paths
 * enter this view; it never projects a deal or invents alternative moves. */
export function createReviewForkPicker(onChoose: (path: TreePath) => void) {
  const el = document.createElement('section');
  el.className = 'review-fork-picker';
  el.hidden = true;

  return {
    el,
    update(options: readonly { label: string; path: TreePath }[]): void {
      el.hidden = options.length < 2;
      el.replaceChildren();
      if (el.hidden) return;
      el.setAttribute('aria-label', t('review.chooseLine'));
      const title = document.createElement('div');
      title.className = 'review-fork-picker__title';
      title.textContent = t('review.chooseLine');
      const moves = document.createElement('div');
      moves.className = 'review-fork-picker__moves';
      options.forEach((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'review-fork-picker__move';
        const label = document.createElement('span');
        label.textContent = option.label;
        button.append(label);
        if (index === 0) {
          const tag = document.createElement('span');
          tag.className = 'review-fork-picker__tag';
          tag.textContent = t('review.mainLine');
          button.append(tag);
        }
        button.addEventListener('click', () => onChoose(option.path));
        moves.append(button);
      });
      el.append(title, moves);
    },
  };
}
