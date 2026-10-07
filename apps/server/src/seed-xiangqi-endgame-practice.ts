/**
 * Bring the five /practice endgame studies (Soldier, Chariot, Horse, Cannon, Not
 * enough to win) in line with packages/game xiangqi-endgame-practice.ts, IN
 * PLACE.
 *
 * The studies are pointed at by curated slug, and every shared link and every
 * learner's solved count is keyed to their ids and chapter ids, so a set that
 * changes is updated, never re-created: chapters it has are matched by name and
 * rewritten only where they differ, chapters it lacks are added, the order is
 * reset, and chapters the definition does not know are reported and left at the
 * end. A set whose slug resolves to no study (a fresh database) is created.
 * Idempotent: a second run reports every chapter unchanged and writes nothing.
 *
 * DRY RUN BY DEFAULT. The plan is read from the public study pages, so a dry run
 * needs no credential. Nothing is written without `--apply`.
 *
 * Local dev (dev sign-in code; the account must be an admin to set a slug):
 *   npx tsx apps/server/src/seed-xiangqi-endgame-practice.ts \
 *     --base http://127.0.0.1:3071 --email you@example.com [--apply]
 *
 * Production, with the admin cookie `npm run auth:cookie` writes to
 * ~/.mistboard-cookie (read from the file, never from the command line, never
 * logged); the cookie must belong to the studies' owner:
 *   npx tsx apps/server/src/seed-xiangqi-endgame-practice.ts --base https://mistboard.com
 *   npx tsx apps/server/src/seed-xiangqi-endgame-practice.ts --base https://mistboard.com --apply
 */
import { pathToFileURL } from 'node:url';
import {
  type EndgamePracticeChapter,
  type EndgamePracticeSet,
  xiangqiEndgamePracticeSets,
} from '@mistboard/game';
import {
  PRACTICE_SETS,
  practiceChapterBody,
  readCookie,
  Session,
} from './seed-xiangqi-practice-study.js';
import { PRACTICE_SET_I18N } from './xiangqi-endgame-study-i18n.js';

const DEFAULT_BASE = 'http://127.0.0.1:3001';

type Args = {
  base: string;
  email: string | null;
  cookie: string | null;
  apply: boolean;
  visibility: 'public' | 'unlisted' | 'private';
};

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at === -1 ? null : (argv[at + 1] ?? null);
  };
  const email = read('--email');
  return {
    base: read('--base') ?? DEFAULT_BASE,
    email,
    // --email wins: a dev run must not pick up the prod cookie in the default file.
    cookie: email ? null : readCookie(read('--cookie')),
    apply: argv.includes('--apply'),
    visibility: (read('--visibility') ?? 'public') as Args['visibility'],
  };
}

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`${what} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/** JSON with sorted keys, so a stored value and a built one compare by content. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

export type StoredChapter = {
  id: string;
  name: string;
  i18n?: unknown;
  orientation?: string;
  version: number;
  practice?: boolean;
  practiceGoal?: string | null;
  root?: { rootFen?: string; root?: unknown };
};

/** What differs between a stored chapter and the definition, by PATCH. */
export function chapterChanges(
  stored: StoredChapter,
  chapter: EndgamePracticeChapter,
): { content: boolean; orientation: boolean; practice: boolean } {
  const body = practiceChapterBody(chapter);
  return {
    content:
      canon(stored.i18n ?? {}) !== canon(body.i18n ?? {}) ||
      stored.root?.rootFen !== body.root.rootFen ||
      canon(stored.root?.root) !== canon(body.root.root),
    orientation: stored.orientation !== body.orientation,
    practice: stored.practice !== true || stored.practiceGoal !== chapter.goal,
  };
}

function setMeta(slug: string) {
  const meta = PRACTICE_SETS.find((set) => set.slug === slug);
  const i18n = PRACTICE_SET_I18N[slug];
  if (!meta || !i18n) throw new Error(`no name or translation for set ${slug}`);
  return { name: meta.name, description: meta.description, i18n };
}

async function catalogueIds(session: Session): Promise<Map<string, string>> {
  const catalogue = await json<{ sections: { cards: { slug: string; studyId: string }[] }[] }>(
    await session.get('/api/practice'),
    'GET /api/practice',
  );
  return new Map(
    catalogue.sections.flatMap((section) => section.cards.map((c) => [c.slug, c.studyId])),
  );
}

async function patchOk(session: Session, path: string, body: unknown, what: string) {
  await json<unknown>(await session.patch(path, body), what);
}

async function flagPractice(
  session: Session,
  studyId: string,
  chapterId: string,
  chapter: EndgamePracticeChapter,
): Promise<void> {
  await patchOk(
    session,
    `/api/studies/${studyId}/chapters/${chapterId}`,
    { practice: true, practiceGoal: chapter.goal },
    `practice flag ${chapter.id}`,
  );
}

async function create(session: Session, set: EndgamePracticeSet, args: Args): Promise<void> {
  const [first, ...rest] = set.chapters;
  if (!first) throw new Error(`${set.slug} has no chapters`);
  const meta = setMeta(set.slug);
  const created = await json<{ study: { id: string }; chapters: { id: string }[] }>(
    await session.post('/api/studies', {
      name: meta.name,
      description: meta.description,
      i18n: meta.i18n,
      visibility: args.visibility,
      chapter: practiceChapterBody(first),
    }),
    `create ${set.slug}`,
  );
  const studyId = created.study.id;
  const slugged = await session.put(`/api/admin/studies/${studyId}/slug`, { slug: set.slug });
  if (!slugged.ok) {
    throw new Error(
      `slug ${set.slug} failed: ${slugged.status} ${await slugged.text()} (the account must be an admin)`,
    );
  }
  const firstId = created.chapters[0]?.id;
  if (!firstId) throw new Error(`created ${set.slug} has no chapter`);
  await flagPractice(session, studyId, firstId, first);
  for (const chapter of rest) {
    const added = await json<{ chapter: { id: string } }>(
      await session.post(`/api/studies/${studyId}/chapters`, practiceChapterBody(chapter)),
      `add ${chapter.id}`,
    );
    await flagPractice(session, studyId, added.chapter.id, chapter);
  }
  console.log(`  created ${studyId} with ${set.chapters.length} chapters`);
}

/** Plan, print, and (with --apply) write one existing study. */
async function update(
  session: Session,
  set: EndgamePracticeSet,
  studyId: string,
  apply: boolean,
): Promise<number> {
  const detail = await json<{
    study: { name: string; description?: string | null; i18n?: unknown };
    chapters: StoredChapter[];
  }>(await session.get(`/api/studies/${studyId}`), `read ${set.slug}`);
  const meta = setMeta(set.slug);
  let writes = 0;

  const metaChanged =
    detail.study.name !== meta.name ||
    (detail.study.description ?? '') !== meta.description ||
    canon(detail.study.i18n ?? {}) !== canon(meta.i18n);
  if (metaChanged) {
    console.log('  study name/description/i18n: rewrite');
    writes += 1;
    if (apply) await patchOk(session, `/api/studies/${studyId}`, meta, `update ${set.slug}`);
  }

  const byName = new Map<string, StoredChapter>();
  for (const stored of detail.chapters) {
    if (byName.has(stored.name)) {
      throw new Error(`${set.slug} has two chapters named "${stored.name}"; cannot match by name`);
    }
    byName.set(stored.name, stored);
  }

  const order: string[] = [];
  for (const [index, chapter] of set.chapters.entries()) {
    const body = practiceChapterBody(chapter);
    const stored = byName.get(body.name);
    const label = `  ${String(index + 1).padStart(2)}. ${chapter.goal.padEnd(10)} ${body.name}`;
    if (!stored) {
      console.log(`${label}  [add]`);
      writes += 1;
      if (apply) {
        const added = await json<{ chapter: { id: string } }>(
          await session.post(`/api/studies/${studyId}/chapters`, body),
          `add ${chapter.id}`,
        );
        await flagPractice(session, studyId, added.chapter.id, chapter);
        order.push(added.chapter.id);
      }
      continue;
    }
    order.push(stored.id);
    const changes = chapterChanges(stored, chapter);
    const what = Object.entries(changes)
      .filter(([, changed]) => changed)
      .map(([field]) => field);
    console.log(`${label}  [${what.length ? `rewrite ${what.join(', ')}` : 'unchanged'}]`);
    if (!what.length) continue;
    writes += 1;
    if (!apply) continue;
    const path = `/api/studies/${studyId}/chapters/${stored.id}`;
    if (changes.content) {
      await patchOk(
        session,
        path,
        { name: body.name, i18n: body.i18n ?? {}, root: body.root, baseVersion: stored.version },
        `rewrite ${chapter.id}`,
      );
    }
    if (changes.orientation) {
      await patchOk(session, path, { orientation: body.orientation }, `orient ${chapter.id}`);
    }
    if (changes.practice) await flagPractice(session, studyId, stored.id, chapter);
  }

  // Unknown chapters keep their place at the end: someone added them by hand.
  const known = new Set(order);
  const extras = detail.chapters.filter((stored) => !known.has(stored.id));
  for (const extra of extras)
    console.log(`      left alone (not in the definition): ${extra.name}`);
  const desired = apply
    ? [...order, ...extras.map((c) => c.id)]
    : set.chapters.map((c) => practiceChapterBody(c).name);
  const current = apply
    ? detail.chapters.map((c) => c.id)
    : detail.chapters.filter((c) => !extras.includes(c)).map((c) => c.name);
  if (canon(desired) !== canon(current)) {
    console.log('  chapter order: reset');
    writes += 1;
    if (apply) {
      await patchOk(
        session,
        `/api/studies/${studyId}/chapters`,
        { chapterIds: desired },
        `reorder ${set.slug}`,
      );
    }
  }
  return writes;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sets = xiangqiEndgamePracticeSets();

  const session = new Session(args.base);
  if (args.email) await session.signIn(args.email);
  else if (args.cookie) session.useCookie(args.cookie);
  if (args.apply && !args.email && !args.cookie) {
    throw new Error('--apply needs --email (dev) or an admin cookie (prod)');
  }

  const ids = await catalogueIds(session);
  console.log(`${args.apply ? 'APPLY' : 'DRY RUN'} against ${args.base}`);
  let writes = 0;
  for (const set of sets) {
    const studyId = ids.get(set.slug);
    console.log(`\n${set.slug}: ${studyId ?? 'no study'} (${set.chapters.length} chapters)`);
    if (!studyId) {
      console.log('  not in the catalogue: would create');
      writes += 1;
      if (args.apply) await create(session, set, args);
      continue;
    }
    writes += await update(session, set, studyId, args.apply);
  }
  console.log(
    `\n${writes} change${writes === 1 ? '' : 's'} ${args.apply ? 'written' : 'planned'}.` +
      (args.apply ? '' : ' Dry run: pass --apply to write.'),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
