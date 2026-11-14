import { describe, expect, it } from 'vitest';
import { buildChallengeCard, type ChallengeView } from './challenge-accept.js';

// The terms line names the VIEWER's side. The creator picked Red, so their own
// card says Red and the person they invited reads Black (2026-11-13: the
// creator's card printed the invitee's side).
const BASE: ChallengeView = {
  id: 'seek_side',
  gameSpecId: 'xiangqi',
  daysPerMove: 3,
  preferredColor: 'first',
  visibility: 'private',
  challengerName: 'alice',
  isMine: true,
  canAccept: false,
  canDecline: false,
  expired: false,
};

function terms(view: ChallengeView): string {
  return buildChallengeCard(view).querySelector('.challenge-subhead')?.textContent ?? '';
}

describe('challenge card side', () => {
  it("names the creator's own pick on their card", () => {
    expect(terms(BASE)).toContain('you play Red');
    expect(terms({ ...BASE, preferredColor: 'second' })).toContain('you play Black');
  });

  it('names the other side for the invitee', () => {
    const invitee = { ...BASE, isMine: false, canAccept: true };
    expect(terms(invitee)).toContain('you play Black');
    expect(terms({ ...invitee, preferredColor: 'second' })).toContain('you play Red');
  });

  it('says random colors to both when nobody picked', () => {
    expect(terms({ ...BASE, preferredColor: 'random' })).toContain('random colors');
    expect(terms({ ...BASE, preferredColor: 'random', isMine: false })).toContain('random colors');
  });
});
