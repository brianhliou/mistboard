// Edits to the site's own studies, straight to the database: rename or describe
// a study, rename, add, replace or delete chapters, and reorder them. Written so
// an agent can maintain the @mistboard seeds without anyone signing in as that
// account. It refuses every study owned by anyone else (SITE_OWNED_HANDLES): a
// person's study is theirs to edit, through the site.
//
//   npm run study:edit -- --plan <plan.json>            # dry run: print the plan
//   npm run study:edit -- --plan <plan.json> --apply    # write it
//   npm run study:edit -- --plan <plan.json> --allow-owner <handle> [--apply]
//   npm run study:edit -- --dump <studyId> [--out f]    # the study as JSON
//
// `--allow-owner` admits exactly one more owner handle for that run, for an edit
// the owner approved (2026-10-07: Brian's own @brianhliou solver-audit study). It
// widens edits only, never `create`, and the dry run names the owner it is under.
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
//       { "op": "study", "name": "…", "description": "…", "visibility": "public",
//         "i18n": { "zh-hans": { "name": "…", "description": "…" }, … } },
//       { "op": "rename", "chapter": "ZmPpVH90", "name": "Game 6", "expect": "Game 5",
//         "i18n": { "zh-Hans": { "name": "第六局" }, "zh-Hant": { "name": "第六局" } } },
//       { "op": "tree", "chapter": "squFZ3GM", "tree": "trees/ch2.json" },
//       { "op": "add", "ref": "g7", "name": "Game 7", "tree": { "version": 1, … } },
//       { "op": "delete", "chapter": "Sg3b9nXw" },
//       { "op": "order", "chapters": ["RPLi9LsH", "ref:g7", …] } ] }
// A `tree` is a SerializedTree, inline or a path relative to the plan file.
// `order` must name every chapter the study has at that point in the plan.
// `add` takes optional chapter `tags` (red, black, result, event, date, …).
// A `rename`'s `i18n` sets the name for each locale it lists, keeping the
// chapter's other locales; `expect` refuses a chapter not named that now.
//
// A plan may make the study instead of naming one: `create` in place of
// `study`, owned by a site handle, with its first chapter; `ops` then run on
// the new study (2026-09-30: the AB-JChess annotated games, made without anyone
// signing in as @mistboard).
//   { "create": { "owner": "mistboard", "name": "…", "description": "…",
//                 "visibility": "public",
//                 "chapter": { "name": "…", "variant": "jieqi", "tree": "…",
//                              "orientation": "red", "tags": { "red": "…" } } },
//     "ops": [ { "op": "add", … } ] }

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isStudyEligibleSpecId } from '@mistboard/game';
import { close, init } from './persistence-db.js';
import { findUserIdByHandle } from './persistence-dms.js';
import {
  addChapter,
  createStudy,
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
import { ensureDealtRoot, isSerializedTree, parseChapterTags } from './routes/studies.js';

export type StudyEditOp =
  | {
      op: 'study';
      name?: string;
      description?: string;
      visibility?: StudyVisibility;
      /** The study's whole translation overlay, replaced (not merged), e.g.
       *  { "zh-hans": { "name": "…", "description": "…" }, "zh-hant": { … } }. */
      i18n?: Record<string, unknown>;
    }
  | {
      op: 'rename';
      chapter: string;
      name: string;
      /** Per-locale names; each replaces that locale's name in the chapter's
       *  overlay, other locales untouched. */
      i18n?: Record<string, { name: string }>;
      /** The name the chapter must have now, so a plan written against one
       *  copy of a study cannot rename the wrong chapter in another. */
      expect?: string;
    }
  | { op: 'tree'; chapter: string; tree: unknown }
  | {
      op: 'add';
      ref?: string;
      name: string;
      tree: unknown;
      orientation?: 'red' | 'black';
      tags?: Record<string, string>;
    }
  | { op: 'delete'; chapter: string }
  | { op: 'order'; chapters: string[] };

export type StudyCreateSpec = {
  owner: string;
  name: string;
  description?: string;
  visibility?: StudyVisibility;
  chapter: {
    name: string;
    variant: string;
    tree: unknown;
    orientation?: 'red' | 'black';
    tags?: Record<string, string>;
  };
};

/** Either `study` (edit that one) or `create` (make it, then run `ops` on it). */
export type StudyEditPlan = { study?: string; create?: StudyCreateSpec; ops: StudyEditOp[] };

/** The accounts whose studies this tool may edit: the site's own. */
export const SITE_OWNED_HANDLES: readonly string[] = ['mistboard'];

/** The owners an edit may touch: the site's own, plus the one handle an
 *  `--allow-owner` names for this run. */
export function editableOwners(allowOwner?: string): readonly string[] {
  if (allowOwner === undefined) return SITE_OWNED_HANDLES;
  const handle = allowOwner.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_-]+$/.test(handle))
    throw new Error(`--allow-owner: bad handle "${allowOwner}"`);
  return SITE_OWNED_HANDLES.includes(handle) ? SITE_OWNED_HANDLES : [...SITE_OWNED_HANDLES, handle];
}

/** The chapter's overlay with each locale's name set from a rename's `i18n`. */
export function renamedI18n(
  current: Record<string, unknown>,
  names: Record<string, { name: string }>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [locale, entry] of Object.entries(names)) {
    const was = current[locale];
    next[locale] = {
      ...(was && typeof was === 'object' && !Array.isArray(was) ? was : {}),
      name: entry.name.trim(),
    };
  }
  return next;
}

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
  const target = (typeof plan?.study === 'string' ? 1 : 0) + (plan?.create ? 1 : 0);
  if (!plan || target !== 1 || !Array.isArray(plan.ops)) {
    throw new Error(
      `${path}: a plan needs exactly one of "study" (an id) or "create", and "ops" (a list)`,
    );
  }
  if (plan.create && typeof plan.create.chapter?.tree === 'string') {
    plan.create.chapter.tree = JSON.parse(
      readFileSync(resolve(dirname(path), plan.create.chapter.tree), 'utf8'),
    );
  }
  for (const op of plan.ops) {
    if ((op.op === 'tree' || op.op === 'add') && typeof op.tree === 'string') {
      op.tree = JSON.parse(readFileSync(resolve(dirname(path), op.tree), 'utf8'));
    }
  }
  return plan;
}

/** A study op's `i18n` replaces the whole overlay, so a typo would wipe every
 *  translation: require an object of locale -> object, and name the locales. */
function studyI18nLocales(i18n: unknown, i: number): string[] {
  if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) {
    throw new Error(`op ${i + 1}: i18n must be an object of locale -> { name, description }`);
  }
  const locales = Object.keys(i18n);
  if (locales.length === 0) throw new Error(`op ${i + 1}: empty i18n would drop every translation`);
  for (const locale of locales) {
    const value = (i18n as Record<string, unknown>)[locale];
    if (!/^[a-z]{2}(-[A-Za-z]+)?$/.test(locale) || !value || typeof value !== 'object') {
      throw new Error(`op ${i + 1}: i18n.${locale} must be a locale holding an object`);
    }
  }
  return locales;
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
        if (op.i18n !== undefined) {
          const locales = studyI18nLocales(op.i18n, i);
          lines.push(`study i18n replaced: ${locales.join(', ')}`);
        }
        return;
      }
      case 'rename': {
        if (!op.name?.trim()) throw new Error(`op ${i + 1}: empty name`);
        const current = known(op.chapter, i);
        if (op.expect !== undefined && current !== op.expect) {
          throw new Error(`op ${i + 1}: ${op.chapter} is "${current}", not "${op.expect}"`);
        }
        if (op.i18n !== undefined && (typeof op.i18n !== 'object' || Array.isArray(op.i18n))) {
          throw new Error(`op ${i + 1}: i18n must be an object of locale -> { name }`);
        }
        for (const [locale, entry] of Object.entries(op.i18n ?? {})) {
          if (!/^[a-z]{2}(-[A-Za-z]+)?$/.test(locale)) {
            throw new Error(`op ${i + 1}: i18n locale "${locale}"`);
          }
          if (typeof entry?.name !== 'string' || !entry.name.trim()) {
            throw new Error(`op ${i + 1}: empty ${locale} name`);
          }
        }
        const locales = Object.entries(op.i18n ?? {})
          .map(([locale, entry]) => ` ${locale} "${entry.name}"`)
          .join('');
        lines.push(`rename ${op.chapter}: "${current}" -> "${op.name}"${locales}`);
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

/** Check a `create` and describe it. Returns the study as it will stand right
 *  after creation, so the plan's `ops` can be checked against it too. Refuses
 *  any owner outside the site handles: this never makes a person's study. */
export function checkCreate(
  spec: StudyCreateSpec,
  siteHandles: readonly string[] = SITE_OWNED_HANDLES,
): { lines: string[]; study: StudyWithChapters } {
  if (!siteHandles.includes(spec.owner)) {
    throw new Error(
      `create: owner @${spec.owner} is not one of ${siteHandles.map((h) => `@${h}`).join(', ')}`,
    );
  }
  if (!spec.name?.trim()) throw new Error('create: empty name');
  if (spec.visibility !== undefined && !isStudyVisibility(spec.visibility)) {
    throw new Error(`create: visibility "${spec.visibility}"`);
  }
  const chapter = spec.chapter;
  if (!chapter?.name?.trim()) throw new Error('create: the first chapter needs a name');
  if (!isStudyEligibleSpecId(chapter.variant)) {
    throw new Error(`create: variant "${chapter.variant}" cannot hold a study`);
  }
  if (!isSerializedTree(chapter.tree))
    throw new Error('create: first chapter is not a SerializedTree');
  const visibility = spec.visibility ?? 'private';
  const plies = mainlinePlies(chapter.tree);
  const study = {
    id: '(new)',
    ownerId: '(new)',
    ownerHandle: spec.owner,
    name: spec.name.trim(),
    visibility,
    chapters: [
      { id: 'first', name: chapter.name.trim(), variant: chapter.variant, root: chapter.tree },
    ],
  } as unknown as StudyWithChapters;
  return {
    lines: [
      `create "${study.name}" for @${spec.owner} (${visibility}), first chapter ` +
        `"${chapter.name.trim()}" (${chapter.variant}, ${plies} plies)`,
    ],
    study,
  };
}

/** Make the study a checked `create` describes, as its site owner. */
export async function applyCreate(
  spec: StudyCreateSpec,
  siteHandles: readonly string[] = SITE_OWNED_HANDLES,
): Promise<StudyWithChapters> {
  checkCreate(spec, siteHandles);
  const ownerId = await findUserIdByHandle(spec.owner);
  if (!ownerId) throw new Error(`create: no account @${spec.owner}`);
  const { chapter } = spec;
  const created = await createStudy({
    ownerId,
    name: spec.name.trim(),
    description: spec.description ?? '',
    visibility: spec.visibility ?? 'private',
    chapter: {
      name: chapter.name.trim(),
      variant: chapter.variant,
      orientation: chapter.orientation === 'black' ? 'black' : 'red',
      root: ensureDealtRoot(chapter.variant, chapter.tree),
      tags: parseChapterTags(chapter.tags),
    },
  });
  if (!created) throw new Error('create: persistence is not initialized');
  return created;
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
            ...(op.i18n === undefined ? {} : { i18n: op.i18n }),
          }),
        );
        break;
      case 'rename': {
        const chapter = study.chapters.find((c) => c.id === op.chapter);
        const i18n = op.i18n === undefined ? undefined : renamedI18n(chapter?.i18n ?? {}, op.i18n);
        must(op.chapter, await renameChapter(op.chapter, owner, op.name.trim(), i18n));
        break;
      }
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
            ...(op.tags === undefined ? {} : { tags: parseChapterTags(op.tags) }),
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
      'allow-owner': { type: 'string' },
    },
  });
  const allowOwner = values['allow-owner'];
  const owners = editableOwners(allowOwner);
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
    if (plan.create) {
      if (allowOwner !== undefined)
        throw new Error('--allow-owner edits a study; it never creates one');
      const planned = checkCreate(plan.create);
      for (const line of planned.lines) console.log(`- ${line}`);
      for (const line of checkPlan(planned.study, plan)) console.log(`- ${line}`);
      if (!values.apply) {
        console.log('dry run: nothing written (pass --apply)');
        return;
      }
      const created = await applyCreate(plan.create);
      console.log(`created ${created.id}`);
      await applyPlan(created, plan);
      const after = await getStudyById(created.id);
      console.log(`applied. now:\n${after ? describeStudy(after) : '(study gone)'}`);
      return;
    }
    const study = await getStudyById(plan.study!);
    if (!study) throw new Error(`study ${plan.study} not found`);
    console.log(describeStudy(study));
    const handle = study.ownerHandle ?? '';
    if (!SITE_OWNED_HANDLES.includes(handle) && owners.includes(handle)) {
      console.log(
        `owner override: editing @${study.ownerHandle}'s study (--allow-owner ${allowOwner})`,
      );
    }
    for (const line of checkPlan(study, plan, owners)) console.log(`- ${line}`);
    if (!values.apply) {
      console.log('dry run: nothing written (pass --apply)');
      return;
    }
    await applyPlan(study, plan, owners);
    const after = await getStudyById(plan.study!);
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
