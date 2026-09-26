import { describe, expect, it } from 'vitest';
import { xiangqiMatchFixingArticle } from '../articles/content/xiangqi-match-fixing.js';
import { playerTitleFor } from './player-title.js';
import { isBanned, SANCTIONS, sanctionFor, sanctionSentence } from './sanctions.js';
import { CXA_GRADES, CXA_REVOKED } from './titles.js';

// The article's register: the table whose first header is "Player" and second
// "Penalty". Each row is ["English 中文", penalty, title years].
function articleRegister(): Map<string, string> {
  const blocks = JSON.parse(JSON.stringify(xiangqiMatchFixingArticle)) as unknown;
  const tables: { headers: string[]; rows: string[][] }[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (o.kind === 'table' && Array.isArray(o.headers) && Array.isArray(o.rows)) {
        tables.push(o as unknown as { headers: string[]; rows: string[][] });
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(blocks);
  const register = tables.find((t) => t.headers[0] === 'Player' && t.headers[1] === 'Penalty');
  if (!register) throw new Error('the article has no sanctions table');
  return new Map(
    register.rows.map(([player, penalty]) => [
      (player ?? '').split(' ').at(-1) ?? '',
      penalty ?? '',
    ]),
  );
}

describe('match-fixing sanctions', () => {
  it('matches the article register name for name and penalty for penalty', () => {
    const register = articleRegister();
    expect(register.size).toBe(47);
    expect(Object.fromEntries(register)).toEqual(
      Object.fromEntries(Object.entries(SANCTIONS).map(([name, s]) => [name, s.penalty])),
    );
  });

  it('says only what the ruling says', () => {
    expect(sanctionSentence(sanctionFor('王天一')!)).toBe(
      'Banned for life by the Chinese Xiangqi Association in the 2024 to 2026 match-fixing case.',
    );
    expect(sanctionSentence(sanctionFor('孟辰')!)).toBe(
      'Banned for 6 months by the Chinese Xiangqi Association in the 2024 to 2026 match-fixing case.',
    );
    expect(sanctionSentence(sanctionFor('曹岩磊')!)).toBe(
      'Publicly reprimanded by the Chinese Xiangqi Association in the 2024 to 2026 match-fixing case.',
    );
    expect(isBanned(sanctionFor('王天一'))).toBe(true);
    expect(isBanned(sanctionFor('曹岩磊'))).toBe(false);
    expect(isBanned(sanctionFor('孟繁睿'))).toBe(false);
  });

  it('hides a tag only where a ruling revoked the grade', () => {
    // Life ban, grade revoked.
    expect(playerTitleFor({ name: '王天一' })).toBe(null);
    // Timed bans outside the revoking tiers keep the grade the CXA gave them.
    expect(CXA_REVOKED['李少庚']).toBeUndefined();
    expect(playerTitleFor({ name: '李少庚' })).toBe(CXA_GRADES['李少庚']?.grade ?? null);
    // Every life ban is among the revoked.
    for (const [name, s] of Object.entries(SANCTIONS)) {
      if (s.penalty === 'Life') expect(CXA_REVOKED[name]).toBeDefined();
    }
  });
});
