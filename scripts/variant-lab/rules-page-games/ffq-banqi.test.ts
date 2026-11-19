import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyFFQBanqiMove,
  type BanqiDeal,
  createFFQBanqiStateFromSetup,
  FFQ_BANQI_DAMAGE,
  FFQ_BANQI_FACE_UP_SQUARES,
  ffqBanqiStateToFen,
  getFFQBanqiPlayerView,
  isFFQBanqiLegalMove,
  parseFFQBanqiReplayMove,
  serializedTreeMainline,
  validateFFQBanqiReplayTree,
  winPercent,
} from '@mistboard/game';
import { FFQ_BANQI_ANALYSIS_ENGINE_ID } from '../../../apps/server/src/ffq-banqi-analysis.ts';
import { validateStudyDecisions } from '../../../apps/server/src/study-chapter-decisions.ts';
import { MOVE_NAG, moveGlyphFor, type StudyNode } from '../../study-annotate.ts';
import {
  makeFFQStudy,
  type PublicGame,
  pinnedFFQEngine,
  readFFQGame,
  replayFFQGame,
} from './ffq-banqi.ts';

const read = (kind: string) =>
  JSON.parse(readFileSync(new URL(`plans/ffq-banqi.${kind}.json`, import.meta.url), 'utf8'));
const artifacts = { plan: read('plan'), notes: read('notes'), luck: read('luck') };
const track = replayFFQGame();
const { analysis, ...provenance } = artifacts.notes.evidence;
const { decidedAt: _date, gameId: _game, ...engineProvenance } = artifacts.plan.evidence;
const build = (source = readFFQGame()) =>
  makeFFQStudy(
    replayFFQGame(source),
    analysis,
    artifacts.luck.decisions,
    artifacts.notes.comments,
    engineProvenance,
  );

function assertMasked(value: unknown): void {
  JSON.parse(JSON.stringify(value), (key, v) => {
    assert.ok(!['deal', 'setup', 'seed', 'rootFen'].includes(key), `hidden field ${key}`);
    if (v?.faceDown === true) assert.deepEqual(v, { faceDown: true }, 'covered identity');
    return v;
  });
}

test('supplied 83-ply game reaches its recorded HP result on the kernel', () => {
  assert.equal(track.game.roomId, 'ffq_eve_task_32fb5f81-5ae0-4c28-b813-56c7d38ce96e');
  assert.equal(track.moves.length, 83);
  assert.equal(track.states.length, 84);
  assert.deepEqual(track.states.at(-1)!.status, { type: 'finished', winner: 'red', reason: 'hp' });
  assert.deepEqual(track.states.at(-1)!.hp, { red: 24, black: 0 });
  assert.equal(track.states.at(-1)!.board.filter((p) => p?.faceDown).length, 3);
  assert.equal(track.tokens[12], 'd0d2x:h', 'off-board covered captures are public');
  const bad = readFFQGame();
  bad.game.result = 'black-wins';
  assert.throws(() => replayFFQGame(bad), /kernel result/);
  const incomplete = readFFQGame();
  incomplete.history.truth.pop();
  assert.throws(() => replayFFQGame(incomplete), /incomplete/);
  const counter = readFFQGame();
  counter.history.truth[4]!.view.chaseCounts.red++;
  assert.throws(() => replayFFQGame(counter), /public chaseCounts mismatch/);
});

test('committed plans reproduce with every position, every chance event, notes and exact pin evidence', () => {
  const regenerated = makeFFQStudy(
    track,
    analysis,
    artifacts.luck.decisions,
    artifacts.notes.comments,
    engineProvenance,
  );
  assert.deepEqual(regenerated, artifacts);
  const { chapter } = artifacts.plan.create;
  assert.deepEqual(serializedTreeMainline(chapter.tree), track.tokens);
  validateFFQBanqiReplayTree(chapter.tree);
  assert.deepEqual(
    validateStudyDecisions('ffq-banqi', chapter.tree, artifacts.luck),
    artifacts.luck,
  );
  assert.equal(analysis.length, 84);
  assert.equal(chapter.scoreSeries.series.length, 1);
  const chart = chapter.scoreSeries.series[0];
  assert.equal(chart.name, 'Level 7 review');
  assert.deepEqual(
    chart.values,
    analysis.map((r: { cp: number; mate: null }, i: number) =>
      i === 83 ? 1 : winPercent(r.cp, r.mate, FFQ_BANQI_ANALYSIS_ENGINE_ID) / 100,
    ),
  );
  assert.equal(artifacts.luck.decisions.length, 25);
  assert.ok(
    artifacts.luck.decisions.some(
      (d: { ply: number; realizedWin: number; playedWin: number }) =>
        track.moves[d.ply - 1]!.from === track.moves[d.ply - 1]!.to &&
        Math.abs(d.realizedWin - d.playedWin) > 5,
    ),
    'the selected game has a score-moving flip',
  );
  assert.equal(provenance.sourcePin, '466057c1b2a1ca0757e9db4da6372dcd55f8bbf0');
  assert.equal(provenance.tag, 'v0.1.0');
  assert.equal(
    provenance.binarySha256,
    '6e6672ad9ec9b3da24af5971637aed36d56b2bdff9256ce3e1ae88fbeafe4ba3',
  );
  assert.ok(
    readFileSync(new URL('../../fetch-release-asset.sh', import.meta.url), 'utf8').includes(
      provenance.releaseSha256,
    ),
  );
  assert.equal(
    createHash('sha256')
      .update(readFileSync(new URL('inputs/ffq-banqi.export.json', import.meta.url)))
      .digest('hex'),
    'a30910905a4129be8e1b7f01ed1df755febb79355df8587a983a9e7fa527098c',
  );
  assert.throws(
    () =>
      makeFFQStudy(
        track,
        analysis.slice(1),
        artifacts.luck.decisions,
        artifacts.notes.comments,
        engineProvenance,
      ),
    /incomplete mainline/,
  );
  assert.throws(
    () =>
      makeFFQStudy(
        track,
        analysis,
        artifacts.luck.decisions.slice(1),
        artifacts.notes.comments,
        engineProvenance,
      ),
    /incomplete chance/,
  );
  assert.throws(
    () => makeFFQStudy(track, analysis, artifacts.luck.decisions, {}, engineProvenance),
    /five to eight/,
  );
  assert.throws(
    () =>
      makeFFQStudy(
        track,
        analysis,
        artifacts.luck.decisions,
        { ...artifacts.notes.comments, '3': 'The black general has appeared.' },
        engineProvenance,
      ),
    /unflipped/,
  );
  let node: StudyNode = chapter.tree.root;
  let branches = 0;
  for (const [i, state] of track.states.slice(0, -1).entries()) {
    const next = node.children[0]!;
    const d = artifacts.luck.decisions.find((d: { ply: number }) => d.ply === i + 1);
    if (d) {
      const glyph = moveGlyphFor(d.bestWin / 100, d.playedWin / 100);
      assert.deepEqual(next.annotations?.glyphs ?? [], glyph ? [MOVE_NAG[glyph]] : []);
    }
    const note = artifacts.notes.comments[String(i + 1)];
    if (note) assert.ok(next.annotations?.comments?.some((c) => c.text.includes(note)));
    for (const side of node.children.slice(1)) {
      const move = parseFFQBanqiReplayMove(side.uci!)!;
      assert.notEqual(move.from, move.to);
      assert.ok(!state.board[move.to]?.faceDown);
      assert.ok(isFFQBanqiLegalMove(state, move));
      assert.deepEqual(side.children, []);
      branches++;
    }
    node = next;
  }
  assert.ok(branches > 0);
  assert.equal(Object.keys(artifacts.notes.comments).length, 7);
});

test('missing engine or source pin fails closed; notes match observed outcomes and displayed coordinates', () => {
  assert.throws(
    () => pinnedFFQEngine('/missing/ffq-banqi-engine', '/missing/engine-source'),
    /source pin unavailable/,
  );
  // CI need not have the sibling engine checkout. Either missing prerequisite
  // must stop the build, without falling back to an installed binary.
  assert.throws(
    () => pinnedFFQEngine('/missing/ffq-banqi-engine'),
    /source pin unavailable|engine unavailable/,
  );
  const comments = artifacts.notes.comments;
  assert.deepEqual(comments, {
    '3': "A good flip for Red: a red horse, right beside Black's cannon. Next turn it can take the cannon.",
    '13': "Red's cannon jumps a screen and captures a face-down piece. It turns out to be a black horse, 5 HP off Black's total.",
    '17': "An unlucky flip. Red turns up a black cannon, which now aims at Red's chariot.",
    '33': "Red's general captures an advisor, worth twice a chariot. Black drops to 26 HP against Red's 48.",
    '47': 'Red uncovers its own advisor. A flip costs no HP, but every red piece revealed is one more piece Red can use.',
    '81': "Black is down to 2 HP, and Red's flip turns up a black soldier right next to a red one.",
    '83': 'The red soldier takes it and Black runs out of HP. Red wins with 24 HP left. The three pieces still face down stay hidden.',
  });
  const tokens = {
    3: '@b2:H',
    13: 'd0d2x:h',
    17: '@d6:c',
    33: 'b6b5',
    47: '@a5:A',
    81: '@c0:s',
    83: 'a0b0',
  };
  for (const [p, note] of Object.entries(comments)) {
    const ply = Number(p);
    assert.doesNotMatch(String(note), /%|public.pool|Level 7/);
    assert.equal(track.tokens[ply - 1], tokens[ply as keyof typeof tokens]);
    const row = analysis.find((r: { ply: number }) => r.ply === ply);
    assert.ok(row && (Number.isFinite(row.cp) || Number.isFinite(row.mate)));
  }
  for (const ply of [3, 13, 17, 47, 81]) {
    const d = artifacts.luck.decisions.find((d: { ply: number }) => d.ply === ply);
    assert.ok(d && Number.isFinite(d.playedWin) && Number.isFinite(d.realizedWin));
    if (ply === 17) assert.ok(d.realizedWin < d.playedWin);
    else assert.ok(d.realizedWin > d.playedWin);
    if (ply !== 13) assert.deepEqual(track.states[ply]!.hp, track.states[ply - 1]!.hp);
  }
  const square = (index: number) => `${'abcdefgh'[Math.floor(index / 4)]}${(index % 4) + 1}`;
  assert.deepEqual(
    [3, 13, 17, 33, 47, 81, 83].map((ply) => square(track.moves[ply - 1]!.to)),
    ['c2', 'c4', 'g4', 'f2', 'f1', 'a3', 'a2'],
  );
  const at = (ply: number, square: number) => track.states[ply]!.board[square];
  assert.deepEqual(at(3, 9), { faceDown: false, color: 'red', role: 'horse' });
  assert.deepEqual(at(3, 13), { faceDown: false, color: 'black', role: 'cannon' });
  assert.ok(isFFQBanqiLegalMove(track.states[4]!, { from: 9, to: 13 }));
  assert.equal(square(track.moves[12]!.from), 'a4');
  assert.equal(track.states[12]!.hp.black - track.states[13]!.hp.black, 5);
  assert.equal(track.states[13]!.captures.at(-1)!.role, 'horse');
  assert.deepEqual(at(17, 27), { faceDown: false, color: 'black', role: 'cannon' });
  assert.deepEqual(at(17, 25), { faceDown: false, color: 'red', role: 'chariot' });
  assert.ok(isFFQBanqiLegalMove(track.states[17]!, { from: 27, to: 25 }));
  assert.deepEqual(at(32, track.moves[32]!.from), {
    faceDown: false,
    color: 'red',
    role: 'general',
  });
  assert.equal(FFQ_BANQI_DAMAGE.advisor, 2 * FFQ_BANQI_DAMAGE.chariot);
  assert.equal(track.states[33]!.captures.at(-1)!.role, 'advisor');
  assert.deepEqual(track.states[33]!.hp, { red: 48, black: 26 });
  assert.deepEqual(at(47, 20), { faceDown: false, color: 'red', role: 'advisor' });
  assert.equal(track.states[80]!.hp.black, 2);
  assert.deepEqual(at(81, 2), { faceDown: false, color: 'black', role: 'soldier' });
  assert.deepEqual(at(81, 1), { faceDown: false, color: 'red', role: 'soldier' });
  assert.equal(track.states[83]!.captures.at(-1)!.role, 'soldier');
  assert.deepEqual(track.states[83]!.hp, { red: 24, black: 0 });
  assert.equal(track.states[83]!.board.filter((p) => p?.faceDown).length, 3);
});

// Reconstruct one compatible SECRET deal solely inside the test. Publicly
// observed identities fix 29 tiles; the three remaining tiles may permute.
function compatibleDeal(): BanqiDeal {
  const deal: BanqiDeal = Array(32);
  FFQ_BANQI_FACE_UP_SQUARES.forEach((sq, i) => {
    deal[sq] = track.initialRevealed[i]!;
  });
  for (const token of track.tokens) {
    const m = parseFFQBanqiReplayMove(token)!;
    if (m.revealed) deal[m.from] = m.revealed;
    if (m.capturedHidden) deal[m.to] = m.capturedHidden;
  }
  const pool = getFFQBanqiPlayerView(track.states.at(-1)!, 'observer').pool;
  const rest = (['red', 'black'] as const).flatMap((color) =>
    Object.entries(pool[color]).flatMap(([role, count]) =>
      Array.from({ length: count }, () => ({ color, role }) as BanqiDeal[number]),
    ),
  );
  for (let i = 0; i < 32; i++) if (!deal[i]) deal[i] = rest.pop()!;
  assert.equal(rest.length, 0);
  return deal;
}
function sourceFromDeal(deal: BanqiDeal): PublicGame {
  const source = readFFQGame();
  let state = createFFQBanqiStateFromSetup(source.game.roomId, { deal });
  const frame = () => ({
    ply: state.ply,
    fen: ffqBanqiStateToFen(state),
    view: getFFQBanqiPlayerView(state, 'observer'),
  });
  source.history.truth = [frame()];
  for (const move of track.moves) {
    state = applyFFQBanqiMove(state, move);
    source.history.truth.push(frame());
  }
  return source;
}
test('every output and chapter payload is invariant under covered-deal swaps; a planted leak fails', () => {
  assertMasked(readFFQGame());
  const deal = compatibleDeal();
  const remaining = track.states.at(-1)!.board.flatMap((p, i) => (p?.faceDown ? [i] : []));
  const payload = (source: PublicGame) => {
    const output = build(source);
    return {
      ...output,
      chapter: output.plan.create.chapter,
      embed: {
        study: { id: 'local' },
        chapters: [
          {
            ...output.plan.create.chapter,
            root: output.plan.create.chapter.tree,
            id: 'chapter',
            hasDecisions: true,
          },
        ],
      },
      requests: source.history.truth.map((f) => f.fen),
    };
  };
  const original = payload(sourceFromDeal(deal));
  assertMasked({
    ...original,
    views: track.states.map((s) => getFFQBanqiPlayerView(s, 'observer')),
  });
  for (const [i, a] of remaining.entries())
    for (const b of remaining.slice(i + 1)) {
      const swapped = structuredClone(deal);
      [swapped[a], swapped[b]] = [swapped[b]!, swapped[a]!];
      assert.equal(JSON.stringify(payload(sourceFromDeal(swapped))), JSON.stringify(original));
    }
  // Probe every stored output, then the chapter and whole embed response.
  for (const field of ['plan', 'notes', 'luck', 'chapter', 'embed'] as const) {
    const leaked = structuredClone(original);
    Object.assign(leaked[field], { board: [{ faceDown: true, ...deal[remaining[0]!] }] });
    assert.throws(() => assertMasked(leaked), /covered identity/);
  }
  const identityLeak = structuredClone(original.plan.create.chapter.tree);
  identityLeak.initialRevealed.push(deal[remaining[0]!]!);
  assert.throws(() => validateFFQBanqiReplayTree(identityLeak));
});
