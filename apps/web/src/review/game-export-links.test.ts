import { EMBED_DEFAULT_HEIGHT, EMBED_DEFAULT_WIDTH } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { gameExportShareExtra } from './game-export-links.js';

function rows(variant: string, roomId: string) {
  const { shareExtra } = gameExportShareExtra(variant, roomId, 'https://mistboard.com');
  const host = document.createElement('div');
  host.append(...shareExtra);
  const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('.review-share__download'));
  return {
    host,
    links: links.map((link) => [
      link.textContent,
      link.getAttribute('href'),
      link.getAttribute('download'),
    ]),
    embed: host.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '',
  };
}

describe('the finished game share rows', () => {
  it('downloads each export format, then the board image', () => {
    expect(rows('xiangqi', 'xq_abc').links).toEqual([
      ['PGN', '/api/games/xq_abc/export.pgn', 'mistboard-xq_abc.pgn'],
      ['JSON', '/api/games/xq_abc/export.json', 'mistboard-xq_abc.json'],
      ['Image', '/og/game/xq_abc.png', 'mistboard-xq_abc.png'],
    ]);
    // A JSON-only variant still gets its image.
    expect(rows('jieqi', 'jq_1').links.map(([text]) => text)).toEqual(['JSON', 'Image']);
  });

  it('offers the embed iframe for the game, at the site default frame size', () => {
    const { embed, host } = rows('dark-chess', 'room-9');
    expect(embed).toBe(
      `<iframe src="https://mistboard.com/embed/game/room-9" width="${EMBED_DEFAULT_WIDTH}" ` +
        `height="${EMBED_DEFAULT_HEIGHT}" style="max-width:100%;border:0" frameborder="0" ` +
        'loading="lazy" title="Fog Chess · Mistboard"></iframe>',
    );
    const labels = Array.from(
      host.querySelectorAll('.review-share__label'),
      (el) => el.textContent,
    );
    expect(labels).toEqual(['Download', 'Embed']);
  });

  it('escapes a room id into the paths it builds', () => {
    const { links, embed } = rows('xiangqi', 'a b');
    expect(links[0]?.[1]).toBe('/api/games/a%20b/export.pgn');
    expect(embed).toContain('/embed/game/a%20b"');
  });
});
