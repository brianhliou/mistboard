import { describe, expect, it } from 'vitest';
import { TRANSLATE_ICON_PATH } from './translate-icon.js';
import { buildUiIcon } from './ui-icon.js';

describe('buildUiIcon', () => {
  it('draws Language as the filled 文A mark, not a stroked globe', () => {
    const svg = buildUiIcon('language');
    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('d')).toBe(TRANSLATE_ICON_PATH);
    expect(paths[0]?.getAttribute('fill')).toBe('currentColor');
    expect(paths[0]?.getAttribute('stroke')).toBe('none');
    expect(svg.querySelector('circle')).toBeNull();
  });
});
