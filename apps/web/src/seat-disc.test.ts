import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seatDiscClass, seatDiscEl } from './seat-disc.js';

const css = readFileSync('src/seat-disc.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function declaration(selector: string, property: string): string | undefined {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return undefined;
  const body = css.slice(start, css.indexOf('}', start));
  return new RegExp(`${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim();
}

describe('seat disc', () => {
  it('builds the class from the ink, with the host class first', () => {
    expect(seatDiscClass('red')).toBe('seat-disc seat-disc--red');
    expect(seatDiscClass('black', 'review-seat__disc')).toBe(
      'review-seat__disc seat-disc seat-disc--black',
    );
    const disc = seatDiscEl(null, 'watch-player-disc');
    expect(disc.className).toBe('watch-player-disc seat-disc seat-disc--unbound');
    expect(disc.getAttribute('aria-hidden')).toBe('true');
  });

  // Every ink a surface can hand the disc needs a rule, or the disc renders the
  // base fill and silently says nothing about who is who. White is the base.
  it('styles every ink, and the pre-flip ring', () => {
    for (const ink of ['red', 'black', 'blue']) {
      expect(declaration(`.seat-disc--${ink}`, '--seat-disc-fill'), ink).toBeTruthy();
    }
    expect(declaration('.seat-disc', '--seat-disc-fill')).toContain('--ink-white');
    expect(declaration('.seat-disc--unbound', 'border-style')).toBe('dashed');
  });

  // A piece colour is not a theme colour. The text tokens invert on the dark
  // theme: bound to one, the black seat drew a near-white disc (meta card, review
  // strips and article replays each shipped that once).
  it('never fills a disc with a theme text token', () => {
    for (const selector of [
      '.seat-disc',
      '.seat-disc--red',
      '.seat-disc--black',
      '.seat-disc--blue',
    ]) {
      const fill = declaration(selector, '--seat-disc-fill') ?? '';
      expect(fill, selector).not.toMatch(/--site-(text|heading)/);
    }
    expect(declaration('.seat-disc--red', '--seat-disc-fill')).not.toBe(
      declaration('.seat-disc--black', '--seat-disc-fill'),
    );
  });

  // The size default sits in the var() fallback, so a host class on the same
  // element sets --seat-disc-size without a specificity tie decided by bundle order.
  it('leaves --seat-disc-size for the host to declare', () => {
    expect(declaration('.seat-disc', '--seat-disc-size')).toBeUndefined();
    expect(declaration('.seat-disc', 'width')).toBe('var(--seat-disc-size, 12px)');
  });

  // Thirteen surfaces each kept their own disc colours, with four reds and five
  // blacks between them. A host class may size and place its disc; colour is
  // seat-disc.css's alone.
  it('is the only stylesheet that colours a seat disc', () => {
    const hosts = [
      'watch-player-disc',
      'embed-seat-disc',
      'review-seat__disc',
      'game-meta-card__disc',
      'retro-box__disc',
      'analysis-summary__dot',
      'xqb-card-seat-disc',
      'xq-replay-seat-dot',
      'xqp-colour-dot',
      'study-game-row__dot',
      'puzzle-source-disc',
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.css') && !path.endsWith('seat-disc.css')) {
          const text = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
          for (const block of text.split('}')) {
            const [selector = '', body = ''] = block.split('{');
            if (!hosts.some((host) => selector.includes(host))) continue;
            if (/(^|[\s;])(background|border-color|box-shadow)\s*:/.test(body)) {
              offenders.push(`${path}: ${selector.trim()}`);
            }
          }
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
