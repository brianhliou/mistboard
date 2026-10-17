import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  formatHeldLines,
  HELD_WARN_MS,
  heldSummary,
  postFailureDrainAction,
} from './lib/release-drain.mjs';

const PUSHED = 'd58620fd0d76b45d667fe6235da591f4b49a6bf3';
const OLD = '4f480534aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('no committed drain: nothing to undo', () => {
  assert.equal(postFailureDrainAction({ drainCommitted: false, pushCompleted: false }), 'none');
  assert.equal(postFailureDrainAction({ drainCommitted: false, pushCompleted: true }), 'none');
});

test('a drain committed before a push that never happened is cancelled', () => {
  assert.equal(
    postFailureDrainAction({ drainCommitted: true, pushCompleted: false }),
    'cancel-before-push',
  );
});

// 2026-10-16 21:46Z: pushed, then the hosted CI wait failed; the old cleanup
// skipped any pushed release and the banner stayed up until the window lapsed.
test('a drain committed before a push whose deploy never landed is cancelled', () => {
  assert.equal(
    postFailureDrainAction({
      drainCommitted: true,
      pushCompleted: true,
      productionRevision: OLD,
      expectedRevision: PUSHED,
    }),
    'cancel-after-push',
  );
  // Prod unreadable: cancel. A committed drain only shows the banner; rooms
  // pause and resume on shutdown whether or not a drain is up.
  assert.equal(
    postFailureDrainAction({
      drainCommitted: true,
      pushCompleted: true,
      productionRevision: null,
      expectedRevision: PUSHED,
    }),
    'cancel-after-push',
  );
});

test('a release that failed after prod already serves its revision leaves it be', () => {
  assert.equal(
    postFailureDrainAction({
      drainCommitted: true,
      pushCompleted: true,
      productionRevision: PUSHED,
      expectedRevision: PUSHED.slice(0, 8),
    }),
    'none-deployed',
  );
});

test('the hold is the server commit wait, else the drain stage time, else zero', () => {
  assert.deepEqual(
    heldSummary({ drainStageMs: 241_268, commitWaitMs: 239_000, refusedCreates: 3 }),
    {
      heldMs: 239_000,
      refusedCreates: 3,
    },
  );
  assert.deepEqual(heldSummary({ drainStageMs: 31_006 }), { heldMs: 31_006, refusedCreates: null });
  assert.deepEqual(heldSummary({}), { heldMs: 0, refusedCreates: null });
});

test('the held line warns only past the threshold', () => {
  assert.deepEqual(formatHeldLines({ heldMs: 31_006, refusedCreates: null }), [
    'new games held 0.5 min, ? refused',
  ]);
  const long = formatHeldLines({ heldMs: HELD_WARN_MS + 1, refusedCreates: 4 });
  assert.equal(long[0], 'new games held 5.0 min, 4 refused');
  assert.match(long[1], /^WARN: new games were held over 5 min/);
  assert.equal(formatHeldLines({ heldMs: HELD_WARN_MS, refusedCreates: 0 }).length, 1);
});

test('release-prod runs the drain cleanup and the held line on its failure path', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-prod.mjs');
  const source = readFileSync(file, 'utf8');
  const failure = source.slice(source.indexOf('\n} catch (error) {\n'));
  assert.match(
    failure.slice(0, 200),
    /await cancelDrainAfterFailure\(\);\n\s+reportDrainHold\(\);/,
  );
  assert.doesNotMatch(source, /pushCompleted\) return;/);
});
