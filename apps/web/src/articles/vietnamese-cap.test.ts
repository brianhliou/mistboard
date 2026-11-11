import { describe, expect, it } from 'vitest';
import { articles } from '../articles-data.js';

// Vietnamese content is capped, not gated (docs-private/language-policy.md,
// "Vietnamese content cap"): four pages set by Brian on 2026-09-25, raised to
// five on 2026-10-22 when he kept the Lại Lý Huynh page. A sixth page is a
// decision for Brian, not a session: raise the cap there first, then here.
const VIETNAMESE_CAP = [
  'choi-co-tuong-voi-may',
  'co-up',
  'khai-cuoc-co-up',
  'lai-ly-huynh-co-tuong',
  'luat-co-up',
];

describe('Vietnamese content cap', () => {
  it('holds exactly the five pages Brian approved', () => {
    const vietnamese = articles
      .filter((a) => a.sourceLang === 'vi')
      .map((a) => a.slug)
      .sort();
    expect(vietnamese).toEqual(VIETNAMESE_CAP);
  });
});
