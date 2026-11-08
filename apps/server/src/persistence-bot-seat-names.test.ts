import { getGameSummary, recordGameEnd } from './persistence.js';
import type { GameParticipant } from './persistence-games.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

// Finished bot seats were stored with the bare bot name ("Pikafish") while the
// live room showed the rung ("Pikafish Level 8"). Every finished-game surface
// (review, /api/watch, profile and bot game lists, exports) reads participants
// through attachGameParticipants, which recovers the rung from the stored
// engine_id, so past games read right without a backfill.
definePersistenceTests('bot seat names', () => {
  const human: GameParticipant = {
    color: 'red',
    displayName: 'Guest',
    subjectType: 'guest',
    subjectId: null,
    visibility: 'public',
  };

  const endGame = async (roomId: string, variant: string, bot: GameParticipant) => {
    await recordGameEnd(roomId, {
      variant,
      mode: 'pve',
      result: 'black-wins',
      termination: 'resignation',
      plyCount: 40,
      startedAt: new Date('2026-10-20T00:00:00Z'),
      endedAt: new Date('2026-10-20T00:20:00Z'),
      whiteClient: 'human-client',
      blackClient: bot.engineId ?? 'engine-client',
      whiteName: null,
      blackName: null,
      corpusId: null,
      rated: false,
      visibility: 'public',
      initialMs: 600_000,
      incrementMs: 5_000,
      participants: [human, bot],
    });
  };

  const storedPikafish = (engineId: string | null): GameParticipant => ({
    color: 'black',
    displayName: 'Pikafish',
    subjectType: 'bot',
    subjectId: 'pikafish',
    ...(engineId ? { engineId } : {}),
    visibility: 'public',
  });

  test('a past jieqi seat reads its rung; a xiangqi seat reads plain "Pikafish"', async () => {
    await endGame('bsn-jq-1', 'jieqi', storedPikafish('pikafish-jieqi-strongest'));
    await endGame('bsn-xq-1', 'xiangqi', storedPikafish('pikafish-xiangqi-level-8'));
    await endGame('bsn-xq-old', 'xiangqi', storedPikafish(null));

    for (const [roomId, label] of [
      ['bsn-jq-1', 'Pikafish Level 8'],
      ['bsn-xq-1', 'Pikafish'],
    ]) {
      const game = await getGameSummary(roomId);
      const black = game?.participants.find((p) => p.color === 'black');
      assert.equal(black?.displayName, label, roomId);
      // The engine id stays server-side.
      assert.equal(black && 'engineId' in black, false, roomId);
      const red = game?.participants.find((p) => p.color === 'red');
      assert.equal(red?.displayName, 'Guest', roomId);
    }

    // A seat written before migration 148 recorded no engine: its stored name stands.
    const old = await getGameSummary('bsn-xq-old');
    assert.equal(old?.participants.find((p) => p.color === 'black')?.displayName, 'Pikafish');
  });
});
