// Edits to the site's own studies, straight to the database: rename or describe
// a study, rename, add, replace or delete chapters, and reorder them. Written so
// an agent can maintain the @mistboard seeds without anyone signing in as that
// account. It refuses every study owned by anyone else (SITE_OWNED_HANDLES): a
// person's study is theirs to edit, through the site.
//
//   npm run study:edit -- --plan <plan.json>            # dry run: print the plan
//   npm run study:edit -- --plan <plan.json> --apply    # write it
//   npm run study:edit -- --dump <studyId> [--out f]    # the study as JSON
//
// Prod runs it under `command railway run -s Postgres -- sh -c
// 'DATABASE_URL="$DATABASE_PUBLIC_URL" npm run -s study:edit -- …'`.
//
// Every write goes through the persistence functions the HTTP routes use, as the
// study's owner, after the checks those routes make (tree shape, dealt root,
// single variant). The whole plan is checked against the live study before the
// first write, so a bad op fails the dry run rather than half an apply.
//
// A plan file:
//   { "study": "uMbk76wd",
//     "ops": [
//       { "op": "study", "name": "…", "description": "…", "visibility": "public" },
//       { "op": "rename", "chapter": "ZmPpVH90", "name": "Game 6" },
//       { "op": "tree", "chapter": "squFZ3GM", "tree": "trees/ch2.json" },
//       { "op": "add", "ref": "g7", "name": "Game 7", "tree": { "version": 1, … } },
//       { "op": "delete", "chapter": "Sg3b9nXw" },
//       { "op": "order", "chapters": ["RPLi9LsH", "ref:g7", …] } ] }
// A `tree` is a SerializedTree, inline or a path relative to the plan file.
// `order` must name every chapter the study has at that point in the plan.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { close, init } from './persistence-db.js';
import {
  addChapter,
  deleteChapter,
  getStudyById,
  isStudyVisibility,
  renameChapter,
  reorderStudyChapters,
  type StudyVisibility,
  type StudyWithChapters,
  updateChapterTree,
  updateStudyMeta,
} from './persistence-studies.js';
import { ensureDealtRoot, isSerializedTree } from './routes/studies.js';

export type StudyEditOp =
  | { op: 'study'; name?: string; description?: string; visibility?: StudyVisibility }
  | { op: 'rename'; chapter: string; name: string }
  | { op: 'tree'; chapter: string; tree: unknown }
  | { op: 'add'; ref?: string; name: string; tree: unknown; orientation?: 'red' | 'black' }
  | { op: 'delete'; chapter: string }
  | { op: 'order'; chapters: string[] };

export type StudyEditPlan = { study: string; ops: StudyEditOp[] };

/** The accounts whose studies this tool may edit: the site's own. */
export const SITE_OWNED_HANDLES: readonly string[] = ['mistboard'];

/** Plies along the first-child line: what the chapter plays when opened. */
export function mainlinePlies(tree: unknown): number {
  let node = (tree as { root?: { children?: unknown[] } } | null)?.root;
  let plies = 0;
  while (node && Array.isArray(node.children) && node.children.length > 0) {
    node = node.children[0] as { children?: unknown[] };
    plies += 1;
  }
  return plies;
}

/** Load a plan file, inlining any `tree` given as a path (relative to the plan). */
export function readPlan(path: string): StudyEditPlan {
  const plan = JSON.parse(readFileSync(path, 'utf8')) as StudyEditPlan;
  if (!plan || typeof plan.study !== 'string' || !Array.isArray(plan.ops)) {
    throw new Error(`${path}: a plan needs "study" (an id) and "ops" (a list)`);
  }
  for (const op of plan.ops) {
    if ((op.op === 'tree' || op.op === 'add') && typeof op.tree === 'string') {
      op.tree = JSON.parse(readFileSync(resolve(dirname(path), op.tree), 'utf8'));
    }
  }
  return plan;
}

/** Check every op against the study as it will stand when that op runs, and
 *  describe it. Throws on the first op that the apply would fail or refuse. */
export function checkPlan(
  study: StudyWithChapters,
  plan: StudyEditPlan,
  siteHandles: readonly string[] = SITE_OWNED_HANDLES,
): string[] {
  if (!study.ownerHandle || !siteHandles.includes(study.ownerHandle)) {
    throw new Error(
      `study ${study.id} is owned by @${study.ownerHandle ?? '?'}; this tool edits only ` +
        `studies owned by ${siteHandles.map((h) => `@${h}`).join(', ')}`,
    );
  }
  const variant = study.chapters[0]?.variant ?? '';
  const names = new Map(study.chapters.map((c) => [c.id, c.name]));
  const order = study.chapters.map((c) => c.id);
  const refs = new Set<string>();
  const lines: string[] = [];
  const known = (id: string, i: number) => {
    if (!names.has(id)) throw new Error(`op ${i + 1}: chapter ${id} is not in the study here`);
    return names.get(id)!;
  };
  const tree = (value: unknown, i: number) => {
    if (!isSerializedTree(value)) throw new Error(`op ${i + 1}: not a SerializedTree`);
    return mainlinePlies(value);
  };
  plan.ops.forEach((op, i) => {
    switch (op.op) {
      case 'study': {
        if (op.visibility !== undefined && !isStudyVisibility(op.visibility)) {
          throw new Error(`op ${i + 1}: visibility "${op.visibility}"`);
        }
        if (op.name !== undefined && !op.name.trim()) throw new Error(`op ${i + 1}: empty name`);
        if (op.name !== undefined) lines.push(`study name: "${study.name}" -> "${op.name}"`);
        if (op.description !== undefined) lines.push(`study description -> "${op.description}"`);
        if (op.visibility !== undefined) {
          lines.push(`study visibility: ${study.visibility} -> ${op.visibility}`);
        }
        return;
      }
      case 'rename': {
        if (!op.name?.trim()) throw new Error(`op ${i + 1}: empty name`);
        lines.push(`rename ${op.chapter}: "${known(op.chapter, i)}" -> "${op.name}"`);
        names.set(op.chapter, op.name);
        return;
      }
      case 'tree': {
        const before = study.chapters.find((c) => c.id === op.chapter);
        const plies = tree(op.tree, i);
        lines.push(
          `replace ${op.chapter} "${known(op.chapter, i)}": ` +
            `${before ? mainlinePlies(before.root) : '?'} -> ${plies} plies`,
        );
        return;
      }
      case 'add': {
        if (!op.name?.trim()) throw new Error(`op ${i + 1}: empty name`);
        if (op.ref !== undefined) {
          if (refs.has(op.ref)) throw new Error(`op ${i + 1}: ref "${op.ref}" used twice`);
          refs.add(op.ref);
        }
        const plies = tree(op.tree, i);
        const id = op.ref === undefined ? `new${i + 1}` : `ref:${op.ref}`;
        names.set(id, op.name);
        order.push(id);
        lines.push(`add "${op.name}" (${variant}, ${plies} plies)`);
        return;
      }
      case 'delete': {
        lines.push(`delete ${op.chapter} "${known(op.chapter, i)}"`);
        if (order.length <= 1) throw new Error(`op ${i + 1}: a study keeps at least one chapter`);
        names.delete(op.chapter);
        order.splice(order.indexOf(op.chapter), 1);
        return;
      }
      case 'order': {
        const want = op.chapters;
        if (
          want.length !== order.length ||
          new Set(want).size !== want.length ||
          want.some((id) => !order.includes(id))
        ) {
          throw new Error(`op ${i + 1}: order must name each of ${order.join(', ')} once`);
        }
        order.splice(0, order.length, ...want);
        lines.push(`order: ${want.map((id) => `"${names.get(id)}"`).join(', ')}`);
        return;
      }
      default:
        throw new Error(`op ${i + 1}: unknown op ${JSON.stringify((op as { op?: unknown }).op)}`);
    }
  });
  return lines;
}

function must<T extends { ok: boolean }>(label: string, result: T): T {
  if (!result.ok) throw new Error(`${label}: ${(result as { error?: string }).error}`);
  return result;
}

/** Run a checked plan as the study's owner. */
export async function applyPlan(
  study: StudyWithChapters,
  plan: StudyEditPlan,
  siteHandles: readonly string[] = SITE_OWNED_HANDLES,
): Promise<void> {
  checkPlan(study, plan, siteHandles);
  const owner = study.ownerId;
  const variant = study.chapters[0]?.variant ?? '';
  const refIds = new Map<string, string>();
  const idOf = (id: string) => (id.startsWith('ref:') ? refIds.get(id.slice(4))! : id);
  for (const op of plan.ops) {
    switch (op.op) {
      case 'study':
        must(
          'study',
          await updateStudyMeta(study.id, owner, {
            ...(op.name === undefined ? {} : { name: op.name.trim() }),
            ...(op.description === undefined ? {} : { description: op.description }),
            ...(op.visibility === undefined ? {} : { visibility: op.visibility }),
          }),
        );
        break;
      case 'rename':
        must(op.chapter, await renameChapter(op.chapter, owner, op.name.trim()));
        break;
      case 'tree':
        must(
          op.chapter,
          await updateChapterTree(op.chapter, owner, { root: ensureDealtRoot(variant, op.tree) }),
        );
        break;
      case 'add': {
        const added = must(
          `add ${op.name}`,
          await addChapter(study.id, owner, {
            name: op.name.trim(),
            variant,
            orientation: op.orientation === 'black' ? 'black' : 'red',
            root: ensureDealtRoot(variant, op.tree),
          }),
        );
        if (added.ok && op.ref !== undefined) refIds.set(op.ref, added.chapter.id);
        if (added.ok) console.log(`added ${added.chapter.id} "${added.chapter.name}"`);
        break;
      }
      case 'delete':
        must(op.chapter, await deleteChapter(op.chapter, owner));
        break;
      case 'order':
        must('order', await reorderStudyChapters(study.id, owner, op.chapters.map(idOf)));
        break;
    }
  }
}

function describeStudy(study: StudyWithChapters): string {
  return [
    `${study.id} "${study.name}" by @${study.ownerHandle ?? '?'} (${study.visibility})`,
    ...study.chapters.map(
      (c, i) => `  ${i + 1}. ${c.id} "${c.name}" ${mainlinePlies(c.root)} plies`,
    ),
  ].join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'string' },
      dump: { type: 'string' },
      out: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  const url = process.env.DATABASE_URL;
  if (!url || (!values.plan && !values.dump)) {
    console.error(
      'usage: DATABASE_URL=… study-edit --plan <file> [--apply] | --dump <id> [--out f]',
    );
    process.exit(2);
  }
  init(url, { maxPoolConnections: 2 });
  try {
    if (values.dump) {
      const study = await getStudyById(values.dump);
      if (!study) throw new Error(`study ${values.dump} not found`);
      const json = `${JSON.stringify(study, null, 2)}\n`;
      if (values.out) writeFileSync(values.out, json);
      console.log(values.out ? describeStudy(study) : json);
      return;
    }
    const plan = readPlan(values.plan!);
    const study = await getStudyById(plan.study);
    if (!study) throw new Error(`study ${plan.study} not found`);
    console.log(describeStudy(study));
    for (const line of checkPlan(study, plan)) console.log(`- ${line}`);
    if (!values.apply) {
      console.log('dry run: nothing written (pass --apply)');
      return;
    }
    await applyPlan(study, plan);
    const after = await getStudyById(plan.study);
    console.log(`applied. now:\n${after ? describeStudy(after) : '(study gone)'}`);
  } finally {
    await close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
