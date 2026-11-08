// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { appendCardTitle } from './articles.js';

function render(text: string): HTMLElement {
  const title = document.createElement('strong');
  appendCardTitle(title, text);
  return title;
}

describe('appendCardTitle', () => {
  it('breaks before a trailing Chinese name and keeps it whole', () => {
    const title = render('Zuo Wenjing 左文静');
    expect(title.querySelector('br')).not.toBeNull();
    expect(title.querySelector('.landing-article-card-title-han')?.textContent).toBe('左文静');
    expect(title.textContent).toBe('Zuo Wenjing 左文静');
  });

  it('handles a diacritic romanization', () => {
    expect(render('Lại Lý Huynh 赖理兄').querySelector('br')).not.toBeNull();
  });

  it('leaves plain English and all-Chinese titles as text', () => {
    for (const text of ['A Solved Banqi Endgame', '尹昇', '左文静 的残局']) {
      const title = render(text);
      expect(title.querySelector('br')).toBeNull();
      expect(title.textContent).toBe(text);
    }
  });
});
