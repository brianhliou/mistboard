import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  avatar,
  playerPortrait,
  sourcedPhotoFor,
  sourcedPhotosCredit,
} from '../xiangqi-players.js';
import { PLAYER_PROFILES } from './profiles.js';
import { XIANGQIQIPU_CREDIT, XIANGQIQIPU_PHOTOS } from './xiangqiqipu-photos.js';

const PUBLIC_DIR = join(import.meta.dirname, '../../public');

// Whether each slug is a live player is checked against the live roster by
// `node scripts/harvest-player-photos.mjs --check`: no roster lives in the repo.
describe('xiangqiqipu.com player photos', () => {
  it('has one well-formed entry per player, each with its image on disk', () => {
    const slugs = new Set<string>();
    const ids = new Set<number>();
    for (const entry of XIANGQIQIPU_PHOTOS) {
      expect(entry.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(slugs.has(entry.slug), entry.slug).toBe(false);
      expect(ids.has(entry.xiangqiqipuId), entry.slug).toBe(false);
      slugs.add(entry.slug);
      ids.add(entry.xiangqiqipuId);
      expect(entry.name).toMatch(/^\p{Script=Han}{2,4}$/u);
      expect(entry.sourceUrl).toBe(
        `https://www.xiangqiqipu.com/Player/View-${entry.xiangqiqipuId}.html`,
      );
      expect(entry.credit).toBe('永乐象棋棋谱网');
      expect(entry.permission).toBe('2026-10-11');
      expect(entry.photo).toBe(`/player-photos/${entry.slug}.jpg`);
      const file = join(PUBLIC_DIR, entry.photo);
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeLessThan(64 * 1024);
      expect(Math.max(entry.width, entry.height)).toBeLessThanOrEqual(400);
    }
    expect(XIANGQIQIPU_PHOTOS.length).toBeGreaterThan(0);
  });

  it('never shadows an authored photo', () => {
    for (const entry of XIANGQIQIPU_PHOTOS) {
      expect(PLAYER_PROFILES[entry.slug]?.photo, entry.slug).toBeUndefined();
    }
  });

  it('renders every sourced photo with alt text and its credit link under it', () => {
    for (const entry of XIANGQIQIPU_PHOTOS) {
      const figure = playerPortrait({ slug: entry.slug, name: entry.name, nameEn: 'Some Name' });
      const img = figure.querySelector('img');
      expect(img?.getAttribute('src')).toBe(entry.photo);
      expect(img?.alt).toBe(`Portrait of Some Name ${entry.name}`);
      expect(img?.closest('a')).toBeNull();
      const cap = figure.querySelector('figcaption.xqp-photo-credit');
      expect(cap?.previousElementSibling).toBe(img);
      expect(cap?.textContent).toBe(`Photo: ${XIANGQIQIPU_CREDIT}`);
      const link = cap?.querySelector('a');
      expect(link?.getAttribute('href')).toBe(entry.sourceUrl);
      expect(link?.textContent).toBe(XIANGQIQIPU_CREDIT);
      expect(link?.target).toBe('_blank');
      expect(link?.rel).toBe('noopener');
    }
  });

  it('keeps the character tile for a player without a photo', () => {
    const slug = 'no-such-player';
    expect(sourcedPhotoFor(slug)).toBeNull();
    const figure = playerPortrait({ slug, name: '王天一', nameEn: null });
    expect(figure.querySelector('img')).toBeNull();
    expect(figure.querySelector('a')).toBeNull();
    const tile = figure.querySelector('.xqp-avatar-tile');
    expect(tile?.textContent).toBe('王');
  });

  // Portraits that show the player as a child or teen (OUTDATED_PHOTOS in the
  // harvest script, reviewed 2026-10-11): the tile stays, on the page and in rows.
  it('never uses an outdated portrait', () => {
    for (const slug of ['wang-jiarui', 'wang-yuhang', 'wang-zihan', 'xu-wenzhang', 'zuo-wenjing']) {
      expect(sourcedPhotoFor(slug), slug).toBeNull();
      expect(existsSync(join(PUBLIC_DIR, `player-photos/${slug}.jpg`)), slug).toBe(false);
      const figure = playerPortrait({ slug, name: '王天一', nameEn: null });
      expect(figure.querySelector('img'), slug).toBeNull();
    }
  });

  it('shows a sourced photo in a list row, lazily, at the tile size', () => {
    const entry = XIANGQIQIPU_PHOTOS[0];
    if (!entry) throw new Error('no photos');
    const row = avatar({ slug: entry.slug, name: entry.name }, 'row');
    expect(row.tagName).toBe('IMG');
    expect(row.className).toBe('xqp-avatar xqp-avatar-row');
    expect(row.getAttribute('src')).toBe(entry.photo);
    expect((row as HTMLImageElement).loading).toBe('lazy');
    const tile = avatar({ slug: 'no-such-player', name: '王天一' }, 'row');
    expect(tile.className).toBe('xqp-avatar xqp-avatar-row xqp-avatar-tile');
  });

  it('shows a held photo only on its page, never in a list row under the xiangqiqipu credit', () => {
    const held = Object.entries(PLAYER_PROFILES).filter(([, p]) => p.photo);
    expect(held.map(([slug]) => slug)).toEqual(
      expect.arrayContaining(['yin-sheng', 'lai-ly-huynh', 'tony-fung-ga-zen']),
    );
    for (const [slug, profile] of held) {
      const row = avatar({ slug, name: '某' }, 'row');
      expect(row.tagName, slug).not.toBe('IMG');
      expect(row.classList.contains('xqp-avatar-tile'), slug).toBe(true);
      expect(avatar({ slug, name: '某' }, 'page').getAttribute('src'), slug).toBe(profile.photo);
    }
  });

  it('credits the photos in a list once, linked to the site', () => {
    const entry = XIANGQIQIPU_PHOTOS[0];
    if (!entry) throw new Error('no photos');
    expect(sourcedPhotosCredit([{ slug: 'no-such-player' }])).toBeNull();
    const line = sourcedPhotosCredit([{ slug: 'no-such-player' }, { slug: entry.slug }]);
    expect(line?.textContent).toBe(`Photos: ${XIANGQIQIPU_CREDIT}`);
    const link = line?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://www.xiangqiqipu.com/');
    expect(link?.textContent).toBe(XIANGQIQIPU_CREDIT);
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener');
  });

  // His article card matches the photo on his article (Brian, 2026-10-11: the
  // card and the page disagreed); his player page keeps the credited portrait.
  it('gives Cao Yanlei the xiangqiqipu portrait here, his article photo on its card', async () => {
    expect(PLAYER_PROFILES['cao-yanlei']?.photo).toBeUndefined();
    expect(sourcedPhotoFor('cao-yanlei')?.photo).toBe('/player-photos/cao-yanlei.jpg');
    const { caoYanleiArticle } = await import('../articles/content/cao-yanlei.js');
    expect(caoYanleiArticle.thumbnail).toMatchObject({
      kind: 'image',
      src: '/article-thumbs/cao-yanlei-2024-face.jpg',
    });
    const figure = caoYanleiArticle.intro?.find((block) => block.kind === 'image-figure');
    expect(figure).toMatchObject({ src: '/article-thumbs/cao-yanlei-2024.jpg' });
  });
});
