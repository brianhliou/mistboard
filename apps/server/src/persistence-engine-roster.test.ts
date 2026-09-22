import { getEngineProfile, listEngineVersionStats, recordGameEnd } from './persistence.js';
import type { GameParticipant } from './persistence-games.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

// /engines and /engine/:id attribute every engine seat to an engine id. Three
// seat shapes exist in the table: 'engine-version' seats (EvE ladders, PvE
// before the bot-identity consolidation), bot seats with an engine_id (live
// PvE since migration 148), and bot seats without one (live PvE between the
// consolidation and 148), attributed by (bot, variant) through the bot
// profile's engine map. Until 2026-09-21 only the first kind was read, and the
// jieqi bot's hundreds of games vs humans showed up nowhere.
definePersistenceTests('engine roster', () => {
  const human: GameParticipant = {
    color: 'red',
    displayName: 'Guest',
    subjectType: 'guest',
    subjectId: null,
    visibility: 'public',
  };

  const endGame = async (
    roomId: string,
    variant: string,
    mode: 'pve' | 'eve',
    result: 'red-wins' | 'black-wins' | 'draw',
    seats: GameParticipant[],
    endedAt: string,
  ) => {
    await recordGameEnd(roomId, {
      variant,
      mode,
      result,
      termination: result === 'draw' ? 'draw' : 'general-captured',
      plyCount: 40,
      startedAt: new Date('2026-09-01T00:00:00Z'),
      endedAt: new Date(endedAt),
      whiteClient: seats[0]?.subjectId ?? 'human-client',
      blackClient: seats[1]?.subjectId ?? 'engine-client',
      whiteName: null,
      blackName: null,
      corpusId: null,
      rated: false,
      visibility: 'public',
      initialMs: 600_000,
      incrementMs: 5_000,
      participants: seats,
    });
  };

  test('attributes bot seats to the engine they ran, by id or by (bot, variant)', async () => {
    // Bot seat that recorded its engine (post-148): the jieqi bot as black, wins.
    await endGame(
      'er-jq-1',
      'jieqi',
      'pve',
      'black-wins',
      [
        human,
        {
          color: 'black',
          displayName: 'Pikafish',
          subjectType: 'bot',
          subjectId: 'pikafish',
          engineId: 'pikafish-jieqi-strongest',
          visibility: 'public',
        },
      ],
      '2026-09-10T00:00:00Z',
    );
    // Bot seat WITHOUT an engine id (pre-148): the same bot on xiangqi, loses.
    // Must land on pikafish-xiangqi-level-8, not on pikafish-jieqi-strongest and
    // not on a 'pikafish' row, and must be marked inferred.
    await endGame(
      'er-xq-1',
      'xiangqi',
      'pve',
      'red-wins',
      [
        human,
        {
          color: 'black',
          displayName: 'Pikafish',
          subjectType: 'bot',
          subjectId: 'pikafish',
          visibility: 'public',
        },
      ],
      '2026-09-11T00:00:00Z',
    );
    // Engine-version seats (an EvE ladder game): both sides attribute as before.
    await endGame(
      'er-eve-1',
      'xiangqi',
      'eve',
      'draw',
      [
        {
          color: 'red',
          displayName: 'Pikafish',
          subjectType: 'engine-version',
          subjectId: 'pikafish-xiangqi-level-8',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'Fairy-Stockfish Level 8',
          subjectType: 'engine-version',
          subjectId: 'fairy-stockfish-xiangqi-level-8',
          visibility: 'public',
        },
      ],
      '2026-09-12T00:00:00Z',
    );

    const roster = await listEngineVersionStats();
    const byId = new Map(roster.map((row) => [row.engineId, row]));
    assert.deepEqual([...byId.keys()].sort(), [
      'fairy-stockfish-xiangqi-level-8',
      'pikafish-jieqi-strongest',
      'pikafish-xiangqi-level-8',
    ]);

    const jieqi = byId.get('pikafish-jieqi-strongest');
    assert.deepEqual(jieqi?.pve, { games: 1, wins: 1, losses: 0, draws: 0 });
    assert.equal(jieqi?.pveInferred, false);
    assert.equal(jieqi?.botName, 'Pikafish');
    assert.deepEqual(jieqi?.variants, ['jieqi']);

    const xiangqi = byId.get('pikafish-xiangqi-level-8');
    assert.deepEqual(xiangqi?.pve, { games: 1, wins: 0, losses: 1, draws: 0 });
    assert.equal(xiangqi?.pveInferred, true);
    assert.deepEqual(xiangqi?.eve, { games: 1, wins: 0, losses: 0, draws: 1 });
    assert.equal(xiangqi?.totalGames, 2);
    assert.equal(xiangqi?.lastPlayedAt, '2026-09-12T00:00:00.000Z');

    const fsf = byId.get('fairy-stockfish-xiangqi-level-8');
    assert.equal(fsf?.botName, 'Fairy-Stockfish Level 8');
    assert.deepEqual(fsf?.eve, { games: 1, wins: 0, losses: 0, draws: 1 });
    assert.equal(fsf?.pve.games, 0);
    assert.equal(fsf?.pveInferred, false);

    // The profile reads the same seats, so it agrees with the roster.
    const profile = await getEngineProfile('pikafish-xiangqi-level-8');
    assert.deepEqual(profile?.pve, { games: 1, wins: 0, losses: 1, draws: 0 });
    assert.deepEqual(profile?.eve, { games: 1, wins: 0, losses: 0, draws: 1 });
    assert.deepEqual(
      profile?.recentPveGames.map((game) => game.roomId),
      ['er-xq-1'],
    );
  });
});
