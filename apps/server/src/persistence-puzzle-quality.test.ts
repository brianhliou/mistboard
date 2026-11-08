import { randomUUID } from 'node:crypto';
import { XIANGQI_SPEC_ID } from '@mistboard/game';
import { createUser } from './persistence-accounts.js';
import { getPool } from './persistence-db.js';
import {
  listPuzzleQualityAggregates,
  MIN_HUMAN_SESSION_SECONDS,
  recordPuzzleQualityEvent,
  recordPuzzleQualityVote,
} from './persistence-puzzle-quality.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { getPuzzleStore } from './puzzle-store.js';

// The test fires its events back to back, which is exactly the automation
// signature the aggregate excludes, so a session that stands for a person has
// to be aged past the floor before it finishes.
async function ageView(puzzleId: string, sessionId: string): Promise<void> {
  await getPool().query(
    `UPDATE puzzle_quality_sessions
     SET viewed_at = viewed_at - make_interval(secs => $3)
     WHERE puzzle_id = $1 AND session_id = $2::uuid`,
    [puzzleId, sessionId, MIN_HUMAN_SESSION_SECONDS * 5],
  );
}

async function findAggregate(puzzleId: string) {
  return (await listPuzzleQualityAggregates(getPool(), XIANGQI_SPEC_ID)).find(
    (candidate) => candidate.puzzleId === puzzleId,
  );
}

definePersistenceTests('puzzle quality', () => {
  test('records one privacy-minimal session with an immutable terminal outcome', async () => {
    const puzzle = (await getPuzzleStore()).puzzles.find(
      (candidate) => candidate.variant === XIANGQI_SPEC_ID,
    );
    assert.ok(puzzle);
    const sessionId = randomUUID();
    const input = { puzzleId: puzzle.id, sessionId, variant: puzzle.variant };

    await recordPuzzleQualityEvent({ ...input, event: 'view' });
    await recordPuzzleQualityEvent({ ...input, event: 'view' });
    await ageView(puzzle.id, sessionId);
    await recordPuzzleQualityEvent({ ...input, event: 'wrong' });
    await recordPuzzleQualityEvent({ ...input, event: 'hint' });
    await recordPuzzleQualityEvent({ ...input, event: 'solve' });
    await recordPuzzleQualityEvent({ ...input, event: 'abandon' });
    await recordPuzzleQualityVote({ ...input, vote: 'down' });
    await recordPuzzleQualityVote({ ...input, vote: 'up' });

    const aggregate = await findAggregate(puzzle.id);
    assert.ok(aggregate);
    assert.equal(aggregate.sessions, 1);
    assert.equal(aggregate.starts, 1);
    assert.equal(aggregate.solves, 1);
    assert.equal(aggregate.abandons, 0);
    assert.equal(aggregate.wrongAttempts, 1);
    assert.equal(aggregate.hints, 1);
    assert.equal(aggregate.cleanSolves, 0);
    assert.equal(aggregate.votesUp, 1);
    assert.equal(aggregate.votesDown, 0);
  });

  test('a session keeps the first player identity it learns and never overwrites it', async () => {
    const puzzle = (await getPuzzleStore()).puzzles
      .filter((candidate) => candidate.variant === XIANGQI_SPEC_ID)
      .at(-3);
    assert.ok(puzzle);
    await createUser({
      id: 'puzzle-player-1',
      email: 'puzzle-player-1@example.com',
      emailVerifiedAt: new Date(),
      handle: 'puzzleplayer1',
      displayName: 'Puzzle player',
      now: new Date(),
    });
    const input = { puzzleId: puzzle.id, sessionId: randomUUID(), variant: puzzle.variant };
    const identity = async () =>
      (
        await getPool().query<{ user_id: string | null; device_id: string | null }>(
          `SELECT user_id, device_id FROM puzzle_quality_sessions
           WHERE puzzle_id = $1 AND session_id = $2::uuid`,
          [input.puzzleId, input.sessionId],
        )
      ).rows[0];

    // The first move can land before the view: the row starts with no one.
    await recordPuzzleQualityEvent({ ...input, event: 'start' });
    assert.deepEqual(await identity(), { user_id: null, device_id: null });
    // The view fills the browser.
    await recordPuzzleQualityEvent({
      ...input,
      event: 'view',
      player: { userId: null, deviceId: 'device-first-0001' },
    });
    assert.deepEqual(await identity(), { user_id: null, device_id: 'device-first-0001' });
    // Signing in fills the account; another browser id does not replace the first.
    await recordPuzzleQualityVote({
      ...input,
      vote: 'up',
      player: { userId: 'puzzle-player-1', deviceId: 'device-other-0002' },
    });
    assert.deepEqual(await identity(), {
      user_id: 'puzzle-player-1',
      device_id: 'device-first-0001',
    });
  });

  test('a session that reveals within seconds of first sight counts nothing', async () => {
    const puzzle = (await getPuzzleStore()).puzzles
      .filter((candidate) => candidate.variant === XIANGQI_SPEC_ID)
      .at(-1);
    assert.ok(puzzle);
    const before = await findAggregate(puzzle.id);
    assert.ok(before);

    // The 2026-09-08 shape: a reveal with no prior view, so the row is created
    // and finished in the same statement.
    const instant = { puzzleId: puzzle.id, sessionId: randomUUID(), variant: puzzle.variant };
    await recordPuzzleQualityEvent({ ...instant, event: 'reveal' });
    // An in-progress session has no completion to judge and still counts as a view.
    const open = { puzzleId: puzzle.id, sessionId: randomUUID(), variant: puzzle.variant };
    await recordPuzzleQualityEvent({ ...open, event: 'view' });

    const after = await findAggregate(puzzle.id);
    assert.ok(after);
    assert.equal(after.sessions, before.sessions + 1);
    assert.equal(after.reveals, before.reveals);
    assert.equal(after.inProgress, before.inProgress + 1);
  });

  test('leaving without a move is a bounce, leaving after one is an abandon', async () => {
    const puzzle = (await getPuzzleStore()).puzzles
      .filter((candidate) => candidate.variant === XIANGQI_SPEC_ID)
      .at(-2);
    assert.ok(puzzle);
    const before = await findAggregate(puzzle.id);
    assert.ok(before);

    const bounce = { puzzleId: puzzle.id, sessionId: randomUUID(), variant: puzzle.variant };
    await recordPuzzleQualityEvent({ ...bounce, event: 'view' });
    await ageView(puzzle.id, bounce.sessionId);
    await recordPuzzleQualityEvent({ ...bounce, event: 'abandon' });

    const abandon = { puzzleId: puzzle.id, sessionId: randomUUID(), variant: puzzle.variant };
    await recordPuzzleQualityEvent({ ...abandon, event: 'view' });
    await ageView(puzzle.id, abandon.sessionId);
    await recordPuzzleQualityEvent({ ...abandon, event: 'wrong' });
    await recordPuzzleQualityEvent({ ...abandon, event: 'abandon' });

    const after = await findAggregate(puzzle.id);
    assert.ok(after);
    assert.equal(after.sessions, before.sessions + 2);
    assert.equal(after.starts, before.starts + 1);
    assert.equal(after.bounces, before.bounces + 1);
    assert.equal(after.abandons, before.abandons + 1);
  });
});
