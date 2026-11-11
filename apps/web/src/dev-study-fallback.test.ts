// The dev proxy's public-study fallback may touch one request shape only: an
// anonymous GET of a whole study, retried when the local server has none.
import { describe, expect, it } from 'vitest';
import {
  localStudyMissing,
  PUBLIC_STUDY_REQUEST_HEADERS,
  publicStudiesEnabled,
  publicStudyFallbackUrl,
} from './dev-study-fallback.js';

describe('publicStudyFallbackUrl', () => {
  it('maps a study read to the public site, dropping the query', () => {
    expect(publicStudyFallbackUrl('GET', '/api/studies/5CdUHFsq')).toBe(
      'https://mistboard.com/api/studies/5CdUHFsq',
    );
    expect(publicStudyFallbackUrl(undefined, '/api/studies/5CdUHFsq?x=1')).toBe(
      'https://mistboard.com/api/studies/5CdUHFsq',
    );
    expect(publicStudyFallbackUrl('get', '/api/studies/a-b_c/', 'http://localhost:9/')).toBe(
      'http://localhost:9/api/studies/a-b_c',
    );
  });

  it('leaves writes, sub-routes and every other path local', () => {
    expect(publicStudyFallbackUrl('POST', '/api/studies/5CdUHFsq')).toBeNull();
    expect(publicStudyFallbackUrl('DELETE', '/api/studies/5CdUHFsq')).toBeNull();
    for (const url of [
      '/api/studies',
      '/api/studies/5CdUHFsq/chapters',
      '/api/studies/5CdUHFsq/like',
      '/api/studies/../accounts/me',
      '/api/studies/a%2Fb',
      '/api/games/abc',
      '/api/studies?owner=me',
    ]) {
      expect(publicStudyFallbackUrl('GET', url), url).toBeNull();
    }
  });
});

describe('fallback conditions', () => {
  it('retries only when the local server has no such study', () => {
    expect(localStudyMissing(404)).toBe(true);
    // The in-memory pair answers every study read 503 persistence_disabled.
    expect(localStudyMissing(503)).toBe(true);
    for (const status of [200, 304, 401, 403, 500]) expect(localStudyMissing(status)).toBe(false);
  });

  it('is on unless switched off', () => {
    expect(publicStudiesEnabled({})).toBe(true);
    expect(publicStudiesEnabled({ MISTBOARD_DEV_PUBLIC_STUDIES: '1' })).toBe(true);
    expect(publicStudiesEnabled({ MISTBOARD_DEV_PUBLIC_STUDIES: '0' })).toBe(false);
  });

  it('sends nothing that identifies the local session', () => {
    const names = Object.keys(PUBLIC_STUDY_REQUEST_HEADERS).map((h) => h.toLowerCase());
    expect(names.sort()).toEqual(['accept', 'user-agent']);
  });
});
