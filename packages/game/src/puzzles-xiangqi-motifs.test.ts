import assert from 'node:assert/strict';
import test from 'node:test';
import { XIANGQI_SPEC_ID } from './game-specs.js';
import type { XiangqiPuzzle } from './puzzles-xiangqi.js';
import { XIANGQI_MOTIF_CORPUS_FIXTURES } from './puzzles-xiangqi-motif-corpus-fixtures.js';
import {
  detectXiangqiPuzzleMotifs,
  XIANGQI_MOTIFS,
  type XiangqiMotifId,
} from './puzzles-xiangqi-motifs.js';
import type { XiangqiMove } from './variants-xiangqi.js';
import { parseStandardXiangqiFen } from './xiangqi-position.js';

// Every fixture is built from the pattern's written definition in
// docs-private/learn-motif-corpus.md, not from the detector, and the expected
// set is asserted exactly: a fixture that trips a second detector is either a
// genuine overlap (recorded below) or a false positive (a bug).

function puzzle(
  fen: string,
  line: string,
  goal: 'checkmate' | 'winning-advantage' = 'checkmate',
): XiangqiPuzzle {
  const parsed = parseStandardXiangqiFen(fen);
  assert.ok(parsed.ok, `fixture FEN must parse: ${fen}`);
  const solution: XiangqiMove[] = line.split(' ').map((token) => {
    const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token);
    assert.ok(m, `bad move token ${token}`);
    return { from: m[1] as XiangqiMove['from'], to: m[2] as XiangqiMove['to'] };
  });
  return {
    id: `motif-fixture-${line.replaceAll(' ', '_')}`,
    variant: XIANGQI_SPEC_ID,
    title: 'fixture',
    initial: parsed.state,
    solution,
    goal: {
      type: goal,
      winner: parsed.state.status.type === 'playing' ? parsed.state.status.turn : 'red',
    },
    themes: [],
  };
}

const CASES: { motif: XiangqiMotifId; fen: string; line: string; expect: XiangqiMotifId[] }[] = [
  {
    // The general's only free square, e8, faces the red general down an open file.
    motif: 'bai-lian-jiang',
    fen: '9/9/3k5/2P4R1/9/9/9/9/9/4K4 r - - 0 1',
    line: 'h7d7',
    expect: ['bai-lian-jiang'],
  },
  {
    // Cannon checks over the advisor on e9; the defence's own advisor, chariot
    // and horses leave the general and the advisor no square to move to.
    motif: 'men-gong',
    fen: '3akr3/4a4/3n1n3/C8/9/9/9/9/9/3K5 r - - 0 1',
    line: 'a7e7',
    expect: ['men-gong'],
  },
  {
    // Same cage, the check comes from a horse on the trough square.
    motif: 'men-sha',
    fen: '3aka3/4n4/9/3N5/9/9/9/9/9/4K4 r - - 0 1',
    line: 'd7c9',
    expect: ['men-sha', 'wo-cao-ma'],
  },
  {
    // The soldier is offered on e9, the advisor takes it, and the horse that
    // then mates from the trough also blocks the chariot's rank: the advisor
    // now stands on a square nothing attacks, burying its own general.
    motif: 'chen-ya-jun',
    fen: '3akaP2/R2P5/9/3N5/9/9/9/9/9/3K5 r - - 0 1',
    line: 'd9e9 f10e9 d7c9',
    expect: ['chen-ya-jun', 'wo-cao-ma'],
  },
  {
    // Rear cannon checks through the front cannon.
    motif: 'chong-pao',
    fen: '4k4/9/2N3N2/4C4/9/9/C8/9/9/3K5 r - - 0 1',
    line: 'a4e4',
    expect: ['chong-pao'],
  },
  {
    // Horse one square from the general on the file, cannon drops in behind it.
    motif: 'ma-hou-pao',
    fen: '4k4/9/4N4/9/9/C8/9/9/9/3K5 r - - 0 1',
    line: 'a5e5',
    expect: ['ma-hou-pao'],
  },
  {
    // Heaven cannon on the centre file, earth cannon on the back rank, chariot finishes.
    motif: 'tian-di-pao',
    fen: 'C2a5/3k5/7R1/1N7/4P4/9/4C4/9/9/5K3 r - - 0 1',
    line: 'h8d8',
    // The heaven cannon also bolts the general on its rib file, so this is
    // an iron bolt as well; the two patterns overlap by definition.
    expect: ['tian-di-pao', 'tie-men-shuan'],
  },
  {
    // A cannon stares up the empty e-file; the chariot mates on the back rank.
    motif: 'kong-tou-pao',
    fen: '4k4/R8/2N6/9/9/9/4C4/9/9/3K5 r - - 0 1',
    line: 'a9a10',
    expect: ['kong-tou-pao', 'diao-yu-ma'],
  },
  {
    // Cannon holds the centre through the elephant, the general is on the rib
    // file, the chariot bolts it there.
    motif: 'tie-men-shuan',
    fen: '5k3/9/4b2R1/9/9/9/4C4/9/9/3K5 r - - 0 1',
    line: 'h8f8',
    expect: ['tie-men-shuan'],
  },
  {
    motif: 'wo-cao-ma',
    fen: '3aka3/7R1/9/3N5/9/9/9/9/9/3K5 r - - 0 1',
    line: 'd7c9',
    expect: ['wo-cao-ma'],
  },
  {
    motif: 'gua-jiao-ma',
    fen: '3aka3/R8/9/1N7/9/9/9/9/9/3K5 r - - 0 1',
    line: 'b7d8',
    expect: ['gua-jiao-ma'],
  },
  {
    // Horse on d8 freezes the general on f10; the chariot delivers.
    motif: 'ba-jiao-ma',
    fen: '5k3/9/3N3R1/9/9/9/9/9/9/3K5 r - - 0 1',
    line: 'h8f8',
    expect: ['ba-jiao-ma'],
  },
  {
    motif: 'diao-yu-ma',
    fen: '4k4/R8/2N6/9/9/9/9/9/9/3K5 r - - 0 1',
    line: 'a9a10',
    expect: ['diao-yu-ma'],
  },
  {
    motif: 'gao-diao-ma',
    fen: '3k5/R8/9/2N6/9/9/9/9/9/4K4 r - - 0 1',
    line: 'a9a10',
    expect: ['gao-diao-ma'],
  },
  {
    // The horse steps off the e-file and the chariot behind it checks.
    motif: 'ba-huang-ma',
    fen: '2P1k1P2/9/9/9/4N4/9/4R4/9/9/3K5 r - - 0 1',
    line: 'e6d4',
    expect: ['ba-huang-ma'],
  },
  {
    // Two checks on adjacent ranks by two chariots.
    motif: 'shuang-ju-cuo',
    fen: '4k4/R8/4b2R1/9/9/9/9/9/9/3K5 r - - 0 1',
    line: 'a9a10 e10e9 h8h9',
    expect: ['shuang-ju-cuo'],
  },
  {
    // The chariot takes the advisor on the palace centre; the recapture
    // strips the back rank and the horse mates from the trough.
    motif: 'da-dan-chuan-xin',
    fen: '2Pak4/4a4/6N2/3N5/9/4R4/9/9/9/3K5 r - - 0 1',
    line: 'e5e9 d10e9 d7c9',
    expect: ['wo-cao-ma', 'da-dan-chuan-xin'],
  },
  {
    motif: 'xiao-dao-wan-xin',
    fen: '2Pak4/4a4/4P1N2/3N5/9/9/9/9/9/3K5 r - - 0 1',
    line: 'e8e9 d10e9 d7c9',
    expect: ['wo-cao-ma', 'xiao-dao-wan-xin'],
  },
  {
    // The chariot leaves the e-file; the cannon behind it now checks over the soldier.
    motif: 'ju-pao-chou-sha',
    fen: '4k4/9/2N3N2/4P4/9/9/4R4/9/4C4/3K5 r - - 0 1',
    line: 'e4a4',
    expect: ['ju-pao-chou-sha'],
  },
  {
    motif: 'er-gui-pai-men',
    fen: '4k4/R8/2NPP1N2/9/9/9/9/9/9/3K5 r - - 0 1',
    line: 'e8e9',
    expect: ['er-gui-pai-men'],
  },
  {
    // Two soldier checks drive the general from the centre back to its seat.
    motif: 'song-fo-gui-dian',
    fen: '2P3P2/4k4/9/2N1P1N2/9/9/4R4/9/9/3K5 r - - 0 1',
    line: 'e7e8 e9e10 e8e9',
    expect: ['song-fo-gui-dian'],
  },
  {
    motif: 'lao-zu-sou-shan',
    fen: '4k1P2/R8/4N4/9/9/9/9/9/9/3K5 r - - 0 1',
    line: 'g10f10',
    expect: ['lao-zu-sou-shan'],
  },
  {
    // The horse checks from the trough and uncovers the chariot at once.
    motif: 'shuang-zhao-jiang',
    fen: '3aka3/9/4N4/9/9/9/4R4/9/9/3K5 r - - 0 1',
    line: 'e8c9',
    expect: ['wo-cao-ma', 'ba-huang-ma', 'shuang-zhao-jiang'],
  },
];

for (const c of CASES) {
  test(`motif ${c.motif}: definition-derived fixture`, () => {
    const found = detectXiangqiPuzzleMotifs(puzzle(c.fen, c.line));
    assert.deepEqual(found, c.expect);
    assert.ok(found.includes(c.motif));
  });
}

test('every detectable motif has a definition-derived fixture', () => {
  const covered = new Set(CASES.map((c) => c.motif));
  const missing = XIANGQI_MOTIFS.map((m) => m.id).filter((id) => !covered.has(id));
  assert.deepEqual(missing, []);
});

test('a winning-advantage puzzle carries no kill pattern', () => {
  const found = detectXiangqiPuzzleMotifs(
    puzzle('4k4/R8/2N6/9/9/9/9/9/9/3K5 r - - 0 1', 'a9a10', 'winning-advantage'),
  );
  assert.deepEqual(found, []);
});

test('a line that does not end in mate carries no kill pattern', () => {
  const found = detectXiangqiPuzzleMotifs(puzzle('4k4/R8/2N6/9/9/9/9/9/9/3K5 r - - 0 1', 'a9a8'));
  assert.deepEqual(found, []);
});

test('catalogue ids, hanzi and labels are unique', () => {
  for (const key of ['id', 'hanzi', 'label'] as const) {
    const values = XIANGQI_MOTIFS.map((m) => m[key]);
    assert.equal(new Set(values).size, values.length, `${key} must be unique`);
  }
});

// ── Served-corpus positives ──────────────────────────────────────────────────

for (const fixture of XIANGQI_MOTIF_CORPUS_FIXTURES) {
  test(`corpus ${fixture.motif}: ${fixture.id}`, () => {
    const found = detectXiangqiPuzzleMotifs(puzzle(fixture.fen, fixture.line));
    assert.ok(
      found.includes(fixture.motif as XiangqiMotifId),
      `expected ${fixture.motif}, got ${found.join(',') || 'nothing'}`,
    );
    assert.deepEqual(found, fixture.motifs);
  });
}

test('every motif has three served-corpus positives', () => {
  const counts = new Map<string, number>();
  for (const fixture of XIANGQI_MOTIF_CORPUS_FIXTURES) {
    counts.set(fixture.motif, (counts.get(fixture.motif) ?? 0) + 1);
  }
  const thin = XIANGQI_MOTIFS.map((m) => m.id).filter((id) => (counts.get(id) ?? 0) < 3);
  assert.deepEqual(thin, []);
});
