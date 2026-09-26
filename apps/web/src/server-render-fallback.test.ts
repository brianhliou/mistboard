import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureServerRender, SHELL_TITLE } from './server-render-fallback.js';

describe('server render fallback', () => {
  it('puts the prerendered page and its title back after a mount wiped them', () => {
    const root = document.createElement('div');
    root.innerHTML = '<main class="article-page"><h1>Duck Xiangqi Rules</h1></main>';
    document.title = 'Duck Xiangqi Rules · Mistboard';
    const server = captureServerRender(root);
    expect(server.present).toBe(true);

    document.title = 'Articles · Mistboard';
    root.classList.add('articles-route');
    root.replaceChildren();
    root.textContent = 'TypeError: Failed to fetch dynamically imported module';

    server.restore();
    expect(root.querySelector('h1')?.textContent).toBe('Duck Xiangqi Rules');
    expect(root.textContent).not.toContain('TypeError');
    expect(root.className).toBe('');
    expect(document.title).toBe('Duck Xiangqi Rules · Mistboard');
  });

  it('does nothing for the empty shell, so client-only routes keep their error panel', () => {
    const root = document.createElement('div');
    document.title = 'Mistboard';
    const server = captureServerRender(root);
    expect(server.present).toBe(false);
    root.textContent = 'Page failed to load';
    server.restore();
    expect(root.textContent).toBe('Page failed to load');
  });
});

describe('server render title', () => {
  it('keeps the server search title over a mount-set UI title in the same locale', () => {
    const root = document.createElement('div');
    root.innerHTML = '<main><h1>Learn</h1></main>';
    document.documentElement.lang = 'en';
    document.title = 'Learn Chinese Chess (Xiangqi) | Mistboard';
    const server = captureServerRender(root);
    document.title = 'Learn · Mistboard';
    server.keepTitle('en');
    expect(document.title).toBe('Learn Chinese Chess (Xiangqi) | Mistboard');
  });

  it('leaves a localized title alone when the visitor reads in another locale', () => {
    const root = document.createElement('div');
    root.innerHTML = '<main><h1>Learn</h1></main>';
    document.documentElement.lang = 'en';
    document.title = 'Learn Chinese Chess (Xiangqi) | Mistboard';
    const server = captureServerRender(root);
    document.title = '学习 · Mistboard';
    server.keepTitle('zh-Hans');
    expect(document.title).toBe('学习 · Mistboard');
  });
});

describe('server-chosen titles on unprerendered routes', () => {
  it('keeps a server-injected title even with an empty shell', () => {
    const root = document.createElement('div');
    document.documentElement.lang = 'en';
    document.title = 'About Mistboard | Chinese Chess (Xiangqi) in English';
    const server = captureServerRender(root);
    document.title = 'About · Mistboard';
    server.keepTitle('en');
    expect(document.title).toBe('About Mistboard | Chinese Chess (Xiangqi) in English');
  });

  it('lets client routes replace the shell default title', () => {
    const root = document.createElement('div');
    document.documentElement.lang = 'en';
    document.title = SHELL_TITLE;
    const server = captureServerRender(root);
    document.title = 'Red vs Black · Mistboard';
    server.keepTitle('en');
    expect(document.title).toBe('Red vs Black · Mistboard');
  });

  it('matches the shell title in index.html', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
    expect(html).toContain(`<title>${SHELL_TITLE}</title>`);
  });
});
