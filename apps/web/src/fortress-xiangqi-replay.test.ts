import { isFortressXiangqiDropMove } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { replayFortressXiangqiNotation } from './fortress-xiangqi-replay.js';

// The rules page's sample game, now embedded from study NUVBVjFf (chapter
// qh5eSTC9) rather than written into the article. Kept here as the fixture
// for the article notation the fortress replay widget still reads.
const SAMPLE_GAME =
  'd1b3 c8c6 e1d1 a7a6 f2f3 a6a5 f3f4 a5a4 f1e3 a8a5 f4f5 a5c5 d1f1 c5c3 f5g5 d8f6 e3f5 c6b6 f5d4 d7d6 g5f5 d6d5 d4b5 c3c5 f5f6 c5b5 f6e6 N@f4 E@d1 d5d4 e6d6 b5c5 g2g3 f7f6 d6e6 g8f7 e6f6 f7f6 f1f6 P@c2 d1f3 d4d3 d2d3 f4d3 T@d1 P@c3 P@a5 c5a5 d1c2 c3c2 P@d2 c2d2 f6d6 P@c2 g1f1 a5c5 d6d2 c2d2 P@b5 c5b5 P@a6 b6b3 b2b3 d2c2 a1b2 c2b2 c1b2 P@c2 f3d1 P@f2 b1a1 c2b2 f1f2 d3f2 C@f1 f2d1 P@f6 e8f7 f6f7 f8f7 A@b1 C@e1 P@c1 d1c3 f1f6 b2b1';

describe('Fortress Xiangqi replay notation', () => {
  it('replays the rules page sample game through the Fortress Xiangqi kernel', () => {
    const replay = replayFortressXiangqiNotation(SAMPLE_GAME);

    expect(replay.tokens).toHaveLength(86);
    expect(replay.moves).toHaveLength(86);
    expect(replay.states).toHaveLength(87);
    expect(replay.moves.filter(isFortressXiangqiDropMove)).toHaveLength(17);
    expect(replay.states.at(-1)?.status).toMatchObject({
      type: 'finished',
      winner: 'black',
      reason: 'checkmate',
    });
  });
});
