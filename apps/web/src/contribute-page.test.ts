import { afterEach, describe, expect, it } from 'vitest';
import { mountContribute } from './contribute-page.js';

describe('/contribute translate section', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  // The zh rules pages link to /contribute#translate, so the heading must carry
  // that id, and the section must say how to start: the email and the credit.
  it('anchors the review role and links the contact email and the thanks page', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountContribute(root);

    const heading = root.querySelector('#translate');
    expect(heading?.tagName).toBe('H2');
    const start = heading?.nextElementSibling?.nextElementSibling;
    expect(start?.querySelector('a[href="mailto:contact@mistboard.com"]')).not.toBeNull();
    expect(start?.querySelector('a[href="/thanks"]')).not.toBeNull();
    expect(root.textContent).not.toContain('open an issue or a pull request');
  });
});
