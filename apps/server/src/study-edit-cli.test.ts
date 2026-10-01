import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { StudyWithChapters } from './persistence-studies.js';
import {
  checkCreate,
  checkPlan,
  mainlinePlies,
  readPlan,
  type StudyCreateSpec,
  type StudyEditPlan,
} from './study-edit-cli.js';

const line = (plies: number) => {
  let node: { uci?: string; children: unknown[] } = { children: [] };
  const root = node;
  for (let i = 0; i < plies; i += 1) {
    const next = { uci: `m${i}`, children: [] as unknown[] };
    node.children.push(next);
    node = next;
  }
  return { version: 1, root };
};

function study(ownerHandle = 'mistboard'): StudyWithChapters {
  const chapter = (id: string, name: string, plies: number) => ({
    id,
    studyId: 's1',
    ordinal: 0,
    name,
    i18n: {},
    variant: 'duck-xiangqi',
    orientation: 'red',
    root: line(plies),
    denorm: {},
    tags: {},
    version: 0,
    gamebook: false,
    practice: false,
    practiceGoal: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  return {
    id: 's1',
    ownerId: 'u1',
    ownerHandle,
    slug: null,
    name: 'Duck games',
    description: '',
    i18n: {},
    visibility: 'public',
    featuredAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    chapters: [chapter('a', 'Game 1', 120), chapter('b', 'Game 2', 210), chapter('c', 'Game 3', 5)],
  } as StudyWithChapters;
}

const plan = (ops: StudyEditPlan['ops']): StudyEditPlan => ({ study: 's1', ops });

test('mainlinePlies follows the first child to the end', () => {
  assert.equal(mainlinePlies(line(0)), 0);
  assert.equal(mainlinePlies(line(7)), 7);
  assert.equal(mainlinePlies(null), 0);
});

test('refuses a study the site does not own, before looking at the ops', () => {
  assert.throws(
    () => checkPlan(study('someone'), plan([{ op: 'rename', chapter: 'a', name: 'x' }])),
    /owned by @someone; this tool edits only studies owned by @mistboard/,
  );
});

test('describes a valid plan in order, tracking chapters it adds and deletes', () => {
  const lines = checkPlan(
    study(),
    plan([
      { op: 'study', name: 'Six games' },
      { op: 'tree', chapter: 'b', tree: line(249) },
      { op: 'rename', chapter: 'c', name: 'Game 6' },
      { op: 'delete', chapter: 'a' },
      { op: 'add', ref: 'n', name: 'Game 7', tree: line(9) },
      { op: 'order', chapters: ['ref:n', 'c', 'b'] },
    ]),
  );
  assert.deepEqual(lines, [
    'study name: "Duck games" -> "Six games"',
    'replace b "Game 2": 210 -> 249 plies',
    'rename c: "Game 3" -> "Game 6"',
    'delete a "Game 1"',
    'add "Game 7" (duck-xiangqi, 9 plies)',
    'order: "Game 7", "Game 6", "Game 2"',
  ]);
});

test('rejects what the apply would fail on', () => {
  const s = study();
  assert.throws(() => checkPlan(s, plan([{ op: 'rename', chapter: 'zz', name: 'x' }])), /zz/);
  assert.throws(
    () => checkPlan(s, plan([{ op: 'tree', chapter: 'a', tree: { root: {} } }])),
    /SerializedTree/,
  );
  assert.throws(
    () =>
      checkPlan(
        s,
        plan([
          { op: 'delete', chapter: 'a' },
          { op: 'rename', chapter: 'a', name: 'x' },
        ]),
      ),
    /chapter a is not in the study/,
  );
  assert.throws(
    () => checkPlan(s, plan([{ op: 'order', chapters: ['a', 'b'] }])),
    /each of a, b, c/,
  );
  assert.throws(
    () =>
      checkPlan(
        s,
        plan([
          { op: 'delete', chapter: 'a' },
          { op: 'delete', chapter: 'b' },
          { op: 'delete', chapter: 'c' },
        ]),
      ),
    /at least one chapter/,
  );
  assert.throws(
    () => checkPlan(s, plan([{ op: 'study', visibility: 'secret' as never }])),
    /secret/,
  );
});

const createSpec = (over: Partial<StudyCreateSpec> = {}): StudyCreateSpec => ({
  owner: 'mistboard',
  name: 'AB-JChess, annotated',
  visibility: 'public',
  chapter: { name: 'The d3 reveal', variant: 'jieqi', tree: line(28) },
  ...over,
});

// The create step must never make a study for a person: only a site handle may
// own what this tool writes, the same boundary the edit ops hold.
test('create refuses an owner that is not a site handle', () => {
  assert.throws(
    () => checkCreate(createSpec({ owner: 'brianhliou' })),
    /owner @brianhliou is not one of @mistboard/,
  );
});

test('create checks the name, the variant and the first chapter before writing', () => {
  assert.throws(() => checkCreate(createSpec({ name: ' ' })), /empty name/);
  assert.throws(
    () =>
      checkCreate(createSpec({ chapter: { name: 'x', variant: 'not-a-variant', tree: line(1) } })),
    /cannot hold a study/,
  );
  assert.throws(
    () => checkCreate(createSpec({ chapter: { name: 'x', variant: 'jieqi', tree: { nope: 1 } } })),
    /not a SerializedTree/,
  );
});

test('a create plan is described, and its ops check against the new study', () => {
  const planned = checkCreate(createSpec());
  assert.deepEqual(planned.lines, [
    'create "AB-JChess, annotated" for @mistboard (public), first chapter "The d3 reveal" (jieqi, 28 plies)',
  ]);
  const lines = checkPlan(planned.study, {
    create: createSpec(),
    ops: [
      { op: 'add', ref: 'g2', name: 'The b9 reveal', tree: line(126), tags: { red: 'Pikafish' } },
      { op: 'order', chapters: ['ref:g2', 'first'] },
    ],
  });
  assert.deepEqual(lines, [
    'add "The b9 reveal" (jieqi, 126 plies)',
    'order: "The b9 reveal", "The d3 reveal"',
  ]);
});

test('readPlan takes exactly one of study or create, and inlines a create tree path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-edit-'));
  writeFileSync(join(dir, 'g1.json'), JSON.stringify(line(4)));
  const write = (name: string, value: unknown) => {
    writeFileSync(join(dir, name), JSON.stringify(value));
    return join(dir, name);
  };
  const plan = readPlan(
    write('ok.json', {
      create: { ...createSpec(), chapter: { name: 'G1', variant: 'jieqi', tree: 'g1.json' } },
      ops: [],
    }),
  );
  assert.equal(mainlinePlies(plan.create?.chapter.tree), 4);
  assert.throws(
    () => readPlan(write('both.json', { study: 's1', create: createSpec(), ops: [] })),
    /exactly one of "study" \(an id\) or "create"/,
  );
  assert.throws(() => readPlan(write('neither.json', { ops: [] })), /exactly one of/);
});
