/**
 * Seed (or bring up to date) the "Endgame wins and draws" practice
 * study: the 26 graded positions of the 象棋残局 article, one practice chapter
 * each, in the order packages/game xiangqi-endgame-practice.ts gives.
 *
 * The definition is checked into the repo; this script only writes it. It is
 * idempotent: it finds the study by its curated slug (through /api/practice once
 * the catalogue lists it, else by exact name among the account's own studies)
 * and updates it in place, so a second run changes nothing a learner sees and
 * never mints a second study. Missing chapters are added, existing ones are
 * rewritten, the order is reset, and chapters it does not know are reported but
 * left alone.
 *
 * DRY RUN BY DEFAULT. Nothing is written without `--apply`.
 *
 * Local dev (dev sign-in code; the account must be an admin to set the slug):
 *   npx tsx apps/server/src/seed-xiangqi-endgame-practice.ts \
 *     --base http://127.0.0.1:3071 --email you@example.com [--apply]
 *
 * Production, with the admin cookie `npm run auth:cookie` writes to
 * ~/.mistboard-cookie (read from the file, never from the command line, never
 * logged):
 *   npx tsx apps/server/src/seed-xiangqi-endgame-practice.ts --base https://mistboard.com
 *   npx tsx apps/server/src/seed-xiangqi-endgame-practice.ts --base https://mistboard.com --apply
 */
import { pathToFileURL } from 'node:url';
import {
  type EndgamePracticeChapter,
  XIANGQI_ENDGAME_PRACTICE_SET,
  XIANGQI_ENDGAME_PRACTICE_SLUG,
  xiangqiEndgamePracticeChapters,
} from '@mistboard/game';
import { readCookie, Session } from './seed-xiangqi-practice-study.js';

const DEFAULT_BASE = 'http://127.0.0.1:3001';
const LANGS = ['zh-Hans', 'zh-Hant'] as const;

/** The study's name and description overlay, in the shape migration 115 stores. */
export function endgamePracticeSetI18n(): Record<string, { name: string; description: string }> {
  const set = XIANGQI_ENDGAME_PRACTICE_SET;
  return Object.fromEntries(
    LANGS.map((lang) => [lang, { name: set.name[lang], description: set.description[lang] }]),
  );
}

/** The chapter as POST /api/studies/:id/chapters takes it. Goal and flag are a
 *  separate PATCH (they validate together). */
export function endgamePracticeChapterBody(chapter: EndgamePracticeChapter): {
  name: string;
  i18n: Record<string, { name: string }>;
  variant: 'xiangqi';
  orientation: 'red' | 'black';
  root: unknown;
} {
  return {
    name: chapter.name.en,
    i18n: Object.fromEntries(LANGS.map((lang) => [lang, { name: chapter.name[lang] }])),
    variant: 'xiangqi',
    orientation: chapter.orientation,
    root: {
      version: 1,
      rootFen: chapter.fen,
      // Childless: a practice chapter is a position and a goal, no solution.
      // The brief is the root comment, with its overlay on the comment itself,
      // which is where study-i18n.ts reads per-node translations from.
      root: {
        annotations: {
          comments: [
            {
              text: chapter.brief.en,
              i18n: Object.fromEntries(LANGS.map((lang) => [lang, chapter.brief[lang]])),
            },
          ],
        },
        children: [],
      },
    },
  };
}

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

/** The study's id, or null when it does not exist yet. */
async function findStudy(session: Session, signedIn: boolean): Promise<string | null> {
  const catalogue = await json<{ sections: { cards: { slug: string; studyId: string }[] }[] }>(
    await session.get('/api/practice'),
    'GET /api/practice',
  );
  for (const section of catalogue.sections) {
    const card = section.cards.find((c) => c.slug === XIANGQI_ENDGAME_PRACTICE_SLUG);
    if (card) return card.studyId;
  }
  // Before the release that adds the slug to the catalogue, /api/practice does
  // not resolve it; the owner's own list does. Exact name, since ?q= is a search.
  if (!signedIn) return null;
  const name = XIANGQI_ENDGAME_PRACTICE_SET.name.en;
  const mine = await json<{ studies?: { id: string; name: string }[] }>(
    await session.get(`/api/studies/mine?q=${encodeURIComponent(name)}`),
    'GET /api/studies/mine',
  );
  return mine.studies?.find((study) => study.name === name)?.id ?? null;
}

async function patchOk(session: Session, path: string, body: unknown, what: string) {
  await json<unknown>(await session.patch(path, body), what);
}

async function setSlug(session: Session, studyId: string): Promise<void> {
  const response = await session.put(`/api/admin/studies/${studyId}/slug`, {
    slug: XIANGQI_ENDGAME_PRACTICE_SLUG,
  });
  if (!response.ok) {
    throw new Error(
      `slug failed: ${response.status} ${await response.text()} (the account must be an admin)`,
    );
  }
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

async function create(
  session: Session,
  chapters: EndgamePracticeChapter[],
  args: Args,
): Promise<string> {
  const [first, ...rest] = chapters;
  if (!first) throw new Error('no chapters');
  const created = await json<{ study: { id: string }; chapters: { id: string }[] }>(
    await session.post('/api/studies', {
      name: XIANGQI_ENDGAME_PRACTICE_SET.name.en,
      description: XIANGQI_ENDGAME_PRACTICE_SET.description.en,
      i18n: endgamePracticeSetI18n(),
      visibility: args.visibility,
      chapter: endgamePracticeChapterBody(first),
    }),
    'create study',
  );
  const studyId = created.study.id;
  await setSlug(session, studyId);
  const firstId = created.chapters[0]?.id;
  if (!firstId) throw new Error('created study has no chapter');
  await flagPractice(session, studyId, firstId, first);
  for (const chapter of rest) {
    const added = await json<{ chapter: { id: string } }>(
      await session.post(`/api/studies/${studyId}/chapters`, endgamePracticeChapterBody(chapter)),
      `add ${chapter.id}`,
    );
    await flagPractice(session, studyId, added.chapter.id, chapter);
  }
  return studyId;
}

async function update(
  session: Session,
  studyId: string,
  chapters: EndgamePracticeChapter[],
): Promise<void> {
  await patchOk(
    session,
    `/api/studies/${studyId}`,
    {
      name: XIANGQI_ENDGAME_PRACTICE_SET.name.en,
      description: XIANGQI_ENDGAME_PRACTICE_SET.description.en,
      i18n: endgamePracticeSetI18n(),
    },
    'update study',
  );
  await setSlug(session, studyId);

  const detail = await json<{ chapters: { id: string; name: string; version: number }[] }>(
    await session.get(`/api/studies/${studyId}`),
    'read study',
  );
  const byName = new Map(detail.chapters.map((c) => [c.name, c]));
  const order: string[] = [];
  let added = 0;
  for (const chapter of chapters) {
    const body = endgamePracticeChapterBody(chapter);
    const existing = byName.get(body.name);
    let chapterId: string;
    if (existing) {
      const path = `/api/studies/${studyId}/chapters/${existing.id}`;
      await patchOk(
        session,
        path,
        { name: body.name, i18n: body.i18n, root: body.root, baseVersion: existing.version },
        `rewrite ${chapter.id}`,
      );
      await patchOk(session, path, { orientation: body.orientation }, `orient ${chapter.id}`);
      chapterId = existing.id;
    } else {
      const created = await json<{ chapter: { id: string } }>(
        await session.post(`/api/studies/${studyId}/chapters`, body),
        `add ${chapter.id}`,
      );
      chapterId = created.chapter.id;
      added += 1;
    }
    await flagPractice(session, studyId, chapterId, chapter);
    order.push(chapterId);
  }
  // Unknown chapters keep their place at the end: someone added them by hand.
  const known = new Set(order);
  const extras = detail.chapters.filter((c) => !known.has(c.id));
  for (const extra of extras) console.warn(`  left alone (not in the definition): ${extra.name}`);
  await patchOk(
    session,
    `/api/studies/${studyId}/chapters`,
    { chapterIds: [...order, ...extras.map((c) => c.id)] },
    'reorder chapters',
  );
  console.log(`updated ${studyId}: ${chapters.length - added} rewritten, ${added} added`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const chapters = xiangqiEndgamePracticeChapters();

  const session = new Session(args.base);
  let signedIn = false;
  if (args.email) {
    await session.signIn(args.email);
    signedIn = true;
  } else if (args.cookie) {
    session.useCookie(args.cookie);
    signedIn = true;
  }

  const existing = await findStudy(session, signedIn);
  console.log(`${XIANGQI_ENDGAME_PRACTICE_SLUG} on ${args.base}`);
  console.log(
    existing
      ? `  exists as ${existing}: would update in place`
      : signedIn
        ? '  not found: would create'
        : '  not in the catalogue (sign in to also check your own studies)',
  );
  chapters.forEach((chapter, index) => {
    console.log(
      `  ${String(index + 1).padStart(2)}. ${chapter.goal.padEnd(11)} ${chapter.orientation.padEnd(5)} ${chapter.name.en}`,
    );
  });

  if (!args.apply) {
    console.log(`\n${chapters.length} chapters. Dry run: pass --apply to write.`);
    return;
  }
  if (!signedIn) throw new Error('--apply needs --email (dev) or an admin cookie (prod)');

  if (existing) {
    await update(session, existing, chapters);
  } else {
    const id = await create(session, chapters, args);
    console.log(`created ${id} with ${chapters.length} chapters`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
