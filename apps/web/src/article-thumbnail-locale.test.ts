import { describe, expect, it } from 'vitest';
import { pikafishArticle } from './articles/content/pikafish.js';
import { renderArticleThumbnail } from './articles.js';
import type { Locale } from './i18n/locale.js';

// A thumbnail thunk is handed the locale of the page the card sits on, so art
// that carries words can set them in the reader's language rather than baking
// one language into every index.
describe('locale-aware article thumbnails', () => {
  const render = (locale: Locale): string => {
    const thumb = pikafishArticle.thumbnail;
    if (thumb?.kind !== 'svg' || typeof thumb.svg !== 'function') {
      throw new Error('the Pikafish thumbnail is expected to be a render thunk');
    }
    return thumb.svg(locale);
  };

  it("leads with the reader's script and keeps the other name above it", () => {
    expect(render('en')).toMatch(/font-size="40"[^>]*>\s*PIKAFISH/);
    expect(render('zh-Hans')).toMatch(/font-size="46"[^>]*>\s*皮卡鱼/);
    expect(render('zh-Hant')).toMatch(/font-size="46"[^>]*>\s*皮卡魚/);
    for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as Locale[]) {
      expect(render(locale)).toContain('PIKAFISH');
    }
  });

  it('sets the tagline and the traditional-script name per locale', () => {
    expect(render('en')).toContain('PLAY IT IN YOUR BROWSER');
    expect(render('zh-Hans')).toContain('在浏览器里直接对弈');
    expect(render('zh-Hant')).toContain('在瀏覽器裡直接對弈');
    expect(render('zh-Hant')).not.toContain('皮卡鱼');
  });

  it('renders the card the locale asks for, not the ambient one', () => {
    const hant = renderArticleThumbnail(
      pikafishArticle.thumbnail as { kind: 'svg'; svg: (locale: Locale) => string },
      'zh-Hant',
    );

    expect(hant.textContent).toContain('皮卡魚');
    expect(hant.textContent).not.toContain('PLAY IT IN YOUR BROWSER');
  });
});
