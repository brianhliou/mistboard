import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyLinkButton } from './live-room-actions.js';
import { createShareButton } from './replay-meta.js';
import { tagShareUrl } from './share-link-tags.js';

// Every control that hands out a mistboard.com page link tags it with the
// share campaign (#1223), so a visit from a pasted link reads as a share in
// analytics instead of a direct visit. The controls' own test files pin the
// challenge, review and broadcast links; this file pins the helper, the game
// and invite buttons, and the census of every copy and share call.

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'];

function expectShareTagged(url: string, campaign: string): URL {
  const parsed = new URL(url);
  expect(parsed.searchParams.get('utm_source')).toBe('share');
  expect(parsed.searchParams.get('utm_medium')).toBe('referral');
  expect(parsed.searchParams.get('utm_campaign')).toBe(campaign);
  return parsed;
}

describe('tagShareUrl', () => {
  it('adds the three share params and keeps the path, other params and hash', () => {
    const tagged = tagShareUrl('https://mistboard.com/game/abc?ply=12&lang=zh-hans#moves', 'game');
    const parsed = expectShareTagged(tagged, 'game');
    expect(parsed.pathname).toBe('/game/abc');
    expect(parsed.searchParams.get('ply')).toBe('12');
    expect(parsed.searchParams.get('lang')).toBe('zh-hans');
    expect(parsed.hash).toBe('#moves');
  });

  it('adds nothing beyond the three utm params', () => {
    const before = new URL('https://mistboard.com/challenge/seek_abc');
    const after = new URL(tagShareUrl(before.href, 'challenge'));
    const added = [...after.searchParams.keys()].filter((key) => !before.searchParams.has(key));
    expect(added.sort()).toEqual([...UTM_KEYS].sort());
    // The challenge id is the invite itself; it reaches the page unchanged.
    expect(after.pathname).toBe('/challenge/seek_abc');
  });

  it('leaves a link that already names a source alone', () => {
    const campaignLink =
      'https://mistboard.com/?utm_source=reddit&utm_medium=social&utm_campaign=x';
    expect(tagShareUrl(campaignLink, 'game')).toBe(campaignLink);
  });

  it('tags a link on the page origin, as in local dev', () => {
    expectShareTagged(
      tagShareUrl(`${window.location.origin}/broadcast/xiangqi/t`, 'broadcast'),
      'broadcast',
    );
  });

  it('leaves a link to another site alone', () => {
    expect(tagShareUrl('https://example.com/page?a=1', 'review')).toBe(
      'https://example.com/page?a=1',
    );
  });
});

describe('share and copy controls hand out tagged links', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  let previousUrl = '';

  beforeEach(() => {
    previousUrl = window.location.href;
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    window.history.replaceState(null, '', previousUrl);
  });

  it('game: the replay Share button copies the tagged game link', async () => {
    window.history.replaceState(null, '', '/game/room-1?ply=7');
    createShareButton().click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const parsed = expectShareTagged(writeText.mock.calls[0]![0], 'game');
    expect(parsed.pathname).toBe('/game/room-1');
    expect(parsed.searchParams.get('ply')).toBe('7');
  });

  it('invite: the room Copy invite link button copies the tagged room link', async () => {
    window.history.replaceState(null, '', '/room/abc123?variant=jieqi');
    copyLinkButton().click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const parsed = expectShareTagged(writeText.mock.calls[0]![0], 'invite');
    expect(parsed.pathname).toBe('/room/abc123');
    expect(parsed.searchParams.get('variant')).toBe('jieqi');
  });
});

// Census of every clipboard write and native share call in the client. A new
// copy control fails here until it is tagged or listed as text with a reason;
// removing the tag from a listed control fails here too.
const COPY_CALL = /\.writeText\(|navigator\.share\(/g;
const TAG_CALL = /tagShareUrl\(/g;
const CENSUS: Record<string, { calls: number; tagged: number; why: string }> = {
  'challenge-accept.ts': { calls: 2, tagged: 1, why: 'challenge link, tagged once at the field' },
  'correspondence.ts': { calls: 1, tagged: 1, why: 'own link challenge Copy link' },
  'live-room-actions.ts': { calls: 1, tagged: 1, why: 'room invite link' },
  'replay-meta.ts': { calls: 1, tagged: 1, why: 'replay Share (game)' },
  'review/underboard-tabs.ts': {
    calls: 2,
    tagged: 1,
    why: 'Share row tagged; FEN, Moves and Embed rows are text',
  },
  'variant-tenant/room-chrome.ts': { calls: 1, tagged: 1, why: 'variant room invite link' },
  'xiangqi-broadcast.ts': {
    calls: 2,
    tagged: 1,
    why: 'Share (share sheet, else the clipboard) tagged; embed code is a row in the review Share tab',
  },
  'account-broadcast-push.ts': { calls: 1, tagged: 0, why: 'a push token, not a link' },
  'data-page.ts': { calls: 1, tagged: 0, why: 'hashes and dataset text' },
  'developers-page.ts': { calls: 1, tagged: 0, why: 'code snippets' },
  'editor/editor-page.ts': { calls: 1, tagged: 0, why: 'a FEN' },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('copy and share call census', () => {
  it('every copy or share call is tagged or listed as text', () => {
    // The web suite runs from apps/web (other tests read 'src/...' the same way).
    const srcDir = resolve('src');
    const found: Record<string, { calls: number; tagged: number }> = {};
    for (const path of sourceFiles(srcDir)) {
      const source = readFileSync(path, 'utf8');
      const calls = source.match(COPY_CALL)?.length ?? 0;
      if (calls === 0) continue;
      found[relative(srcDir, path)] = { calls, tagged: source.match(TAG_CALL)?.length ?? 0 };
    }
    const expected = Object.fromEntries(
      Object.entries(CENSUS).map(([file, { calls, tagged }]) => [file, { calls, tagged }]),
    );
    expect(found).toEqual(expected);
  });
});
