import { describe, expect, it } from 'vitest';
import { buildStudyThumbnail, type StudyPreviewGrid } from './study-thumbnails.js';

describe('Gomoku study thumbnails', () => {
  const grid = (cells: string): StudyPreviewGrid => ({
    shape: 'gomoku',
    files: 15,
    ranks: 15,
    cells,
  });
  const thumbnail = (value: StudyPreviewGrid) =>
    buildStudyThumbnail('gomoku-study', 'test-thumb', 'lazy', {
      variant: 'gomoku',
      fen: null,
      grid: value,
    });

  it('draws 15x15 intersections, with white and black stones at the stored corners', () => {
    const el = thumbnail(grid(`b${'.'.repeat(13)}r${'.'.repeat(195)}r${'.'.repeat(13)}b`));
    expect(el?.dataset.boardShape).toBe('gomoku');
    expect(el?.style.aspectRatio).toBe('152 / 152');
    expect(el?.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 152 152');
    const path = el?.querySelector('.study-thumbnail__grid')?.getAttribute('d') ?? '';
    expect(path.match(/M/g)).toHaveLength(30);
    expect(path).toContain('M6 6H146');
    expect(path).toContain('M146 6V146');
    const centers = (ink: string) =>
      [...el!.querySelectorAll(`.study-thumbnail__${ink}`)].map((stone) => [
        stone.getAttribute('cx'),
        stone.getAttribute('cy'),
      ]);
    expect(centers('black')).toEqual([
      ['6', '6'],
      ['146', '146'],
    ]);
    expect(centers('white')).toEqual([
      ['146', '6'],
      ['6', '146'],
    ]);
    expect(el?.querySelector('.study-thumbnail__red')).toBeNull();
    expect(el?.querySelector('.study-thumbnail__dark-square')).toBeNull();
  });

  it('draws an empty grid without inventing stones', () => {
    const el = thumbnail(grid('.'.repeat(225)));
    expect(el?.dataset.boardShape).toBe('gomoku');
    expect(el?.querySelectorAll('circle')).toHaveLength(0);
  });

  it('refuses invalid dimensions, incomplete grids and unknown shapes', () => {
    for (const value of [
      { ...grid('.'.repeat(225)), files: 14 },
      grid('.'.repeat(224)),
      { ...grid('.'.repeat(225)), shape: 'future-gomoku' as StudyPreviewGrid['shape'] },
    ]) {
      expect(thumbnail(value)?.classList.contains('study-thumbnail--board') ?? false).toBe(false);
    }
  });
});
