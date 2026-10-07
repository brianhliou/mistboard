/**
 * Seed the basic-endgame corpus as a PRACTICE study: one chapter per verdict,
 * rooted at the corpus position, with a goal and no solution line.
 *
 * The difference from seed-xiangqi-endgame-study.ts is the whole point of the
 * surface. That seeder writes the engine's winning line into the chapter as a
 * mainline you can click through. This one writes no moves at all — the chapter
 * is a position plus "Checkmate" or "Hold the draw", and the engine plays the
 * defence when a learner opens it. Nothing here has to be authored per exercise,
 * which is why 32 exercises cost one run instead of 32 sittings.
 *
 * Goal choice follows the verdict, and it is NOT symmetrical:
 *   win  -> `mate`. A book win is already winning at move one, so "reach +600"
 *           would be satisfied before the learner touched a piece. The exercise
 *           is to CONVERT, and only a delivered mate proves that.
 *   draw -> `draw`. Unbounded: holding level is the exercise, and it ends when
 *           the learner stops or the evaluation leaves the band.
 *
 * Seeds FIVE studies, one per piece family, each slugged so the /practice
 * catalogue can point at it across re-seeds and renames.
 *
 * Trilingual, from the same dictionaries the reading study uses
 * (xiangqi-endgame-study-i18n.ts). The first cut of this seeder wrote none: the
 * corpus was already translated for `tOceiaI7`, the split into practice studies
 * did not carry the translations across, and 74 strings that had Chinese sitting
 * in the repo shipped in English on a Chinese page for as long as nobody looked.
 * A split of already-translated content inherits its translations or it silently
 * un-translates them.
 *
 * `--update` rewrites the five studies that already exist rather than creating
 * new ones. Use it for anything that lands after the first seed.
 *
 * Local dev (server on 3001), signing itself in with the dev auth code:
 *   npx tsx apps/server/src/seed-xiangqi-practice-study.ts --email you@example.com
 *
 * Production, with the cookie `npm run auth:cookie` writes:
 *   npx tsx apps/server/src/seed-xiangqi-practice-study.ts \
 *     --base https://mistboard.com --visibility public
 *
 * The credential is read from ~/.mistboard-cookie (override with --cookie), never
 * from the command line and never logged. The account must be an ADMIN, because
 * setting a curated slug is an admin write.
 *
 * `--dry-run` needs no credentials and prints the split.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type EndgameCategory,
  type EndgameEntry,
  endgameEntryFen,
  XIANGQI_ENDGAME_CORPUS,
} from '@mistboard/game';
import {
  ENDGAME_STUDY_LANGS,
  localizedChapterName,
  localizedPracticeComment,
  PRACTICE_SET_I18N,
} from './xiangqi-endgame-study-i18n.js';

const DEFAULT_BASE = 'http://127.0.0.1:3001';

/**
 * One study PER PIECE FAMILY rather than one study of 32 chapters.
 *
 * The corpus already carries the split in its `category` field, so this costs a
 * groupBy and nothing else -- and it is what makes the /practice index read as a
 * shelf rather than a single link. lichess divides the same way ("Pawn Endgames",
 * "Rook Endgames"), for the same reason: a card is a sitting, and 32 exercises is
 * not a sitting.
 *
 * `slug` is the catalogue's handle on the study (migration 132). It never changes,
 * which is the point: re-seeding mints new study ids and renaming changes names,
 * and either would silently empty a section of the index.
 */
export const PRACTICE_SETS: {
  slug: string;
  categories: EndgameCategory[];
  name: string;
  description: string;
}[] = [
  {
    slug: 'endgames-soldier',
    categories: ['soldier'],
    name: 'Soldier endgames',
    description:
      'What a lone soldier can finish and what it cannot. A soldier never moves backwards, which is why some of these are wins and some are not.',
  },
  {
    slug: 'endgames-chariot',
    categories: ['chariot'],
    name: 'Chariot endgames',
    description:
      'The chariot is the one piece that wins on its own. These are the positions where technique still decides it.',
  },
  {
    slug: 'endgames-horse',
    categories: ['horse'],
    name: 'Horse endgames',
    description:
      'The horse is slow and its leg can be blocked. Converting with one is a question of timing.',
  },
  {
    slug: 'endgames-cannon',
    categories: ['cannon', 'horse-and-cannon'],
    name: 'Cannon endgames',
    description:
      "A cannon needs something to fire over, so a bare board is the defender's friend. Includes the horse-and-cannon pairings.",
  },
  {
    slug: 'endgames-insufficient',
    categories: ['insufficient'],
    name: 'Not enough to win',
    description:
      'Material that cannot force mate however it is arranged. Hold the draw; the point is knowing these are draws.',
  },
];

type Visibility = 'public' | 'unlisted' | 'private';

/**
 * The goal text for an entry, in the grammar parsePracticeGoal accepts.
 *
 * A draw goal is BOUNDED. An unbounded one never completes -- holding level is
 * the whole exercise, so `evaluatePracticeGoal` keeps returning 'ongoing' and
 * waits for a caller to end the run, and no caller does. Seeded unbounded, every
 * hold-the-draw exercise was unwinnable: the learner could defend perfectly and
 * never see it solved.
 *
 * Fifteen of the learner's own moves against an engine trying to break through
 * is a real demonstration for these endgames, and short enough not to become
 * shuffling for its own sake.
 */
export function practiceGoalFor(entry: EndgameEntry): string {
  return entry.verdict === 'win' ? 'mate' : 'draw in 15';
}

/**
 * The row label in the chapter rail.
 *
 * Deliberately NOT "<attacker> beats <defender>". That phrasing did two things
 * wrong at once: it put the ANSWER in the title of an exercise whose whole
 * question is whether the position wins, and it made every row long enough to be
 * truncated in the rail. lichess's rows read "Exploit the pin #3" -- short enough
 * to be read at a glance, and silent about the result.
 *
 * The matchup alone is the useful label; the verdict is the goal, and the goal is
 * stated under the board once the exercise is open.
 */
export function practiceChapterName(entry: EndgameEntry): string {
  return `${entry.attacker} vs ${entry.defender}`;
}

/**
 * Per-locale overrides for one chapter, in the shape study-i18n.ts reads.
 *
 * Built from the same dictionaries the reading study uses, so these five studies
 * and `tOceiaI7` say the same thing in Chinese about the same position. Omitting
 * a locale is the correct degrade: `localizedChapterName` returns null rather
 * than a half-translated name, and the reader gets the English one.
 */
export function practiceChapterI18n(entry: EndgameEntry): Record<string, { name: string }> {
  const out: Record<string, { name: string }> = {};
  for (const lang of ENDGAME_STUDY_LANGS) {
    const name = localizedChapterName(entry, lang);
    if (name) out[lang] = { name };
  }
  return out;
}

function practiceCommentI18n(entry: EndgameEntry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lang of ENDGAME_STUDY_LANGS) {
    const text = localizedPracticeComment(entry, lang);
    if (text) out[lang] = text;
  }
  return out;
}

export function practiceChapterBody(entry: EndgameEntry): Record<string, unknown> {
  const i18n = practiceChapterI18n(entry);
  const commentI18n = practiceCommentI18n(entry);
  return {
    name: practiceChapterName(entry),
    ...(Object.keys(i18n).length > 0 ? { i18n } : {}),
    variant: 'xiangqi',
    // The learner plays the side with something to prove, NOT whoever happens to
    // move first. In this corpus the attacker is always Red, so:
    //   win  -> Red, and the exercise is to convert it
    //   draw -> BLACK, and the exercise is to hold it
    // Orienting to `entry.turn` (Red on 31 of 32 entries) handed the learner the
    // attacking side of a drawn endgame and told them to hold the draw -- a side
    // that cannot lose being asked not to lose. An exercise that opens on the
    // other side's move is fine; the runner plays that reply before handing over.
    orientation: entry.verdict === 'win' ? 'red' : 'black',
    root: {
      version: 1,
      rootFen: endgameEntryFen(entry),
      // Deliberately childless: a practice chapter carries no solution, and a
      // mainline here would be dead weight the player never reads.
      root: {
        annotations: {
          // The overlay rides on the comment itself, which is where
          // study-i18n.ts reads per-node comment translations from.
          comments: [
            {
              text: entry.note ?? practiceChapterName(entry),
              ...(Object.keys(commentI18n).length > 0 ? { i18n: commentI18n } : {}),
            },
          ],
        },
        children: [],
      },
    },
  };
}

export class Session {
  private cookie = '';
  constructor(private readonly base: string) {}

  async post(path: string, body: unknown): Promise<Response> {
    const response = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0] ?? this.cookie;
    return response;
  }

  /** Adopt a session established elsewhere (a real browser login), for prod.
   *  Read from the environment and never logged: it is a live credential. */
  useCookie(cookie: string): void {
    this.cookie = cookie;
  }

  async put(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async get(path: string): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}) },
    });
  }

  async patch(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async signIn(email: string): Promise<void> {
    const start = await this.post('/api/auth/email/start', { email });
    if (!start.ok) throw new Error(`auth start failed: ${start.status} ${await start.text()}`);
    const started = (await start.json()) as { loginId?: string; devCode?: string };
    if (!started.loginId || !started.devCode) {
      throw new Error(
        'auth start did not return a dev code. This seeder only works against a dev server.',
      );
    }
    const confirm = await this.post('/api/auth/email/confirm', {
      loginId: started.loginId,
      code: started.devCode,
    });
    if (!confirm.ok) {
      throw new Error(`auth confirm failed: ${confirm.status} ${await confirm.text()}`);
    }
  }
}

/**
 * The session cookie: from a file, or from the environment for a one-off.
 *
 * A path rather than the value, so the credential never appears in a command
 * line. `--cookie` names the file; with no flag the shared default is used only
 * if it exists, which keeps `--dry-run` and `--email` working with no file
 * present.
 */
export function readCookie(path: string | null): string | null {
  const fromEnv = process.env.MISTBOARD_SESSION_COOKIE;
  if (fromEnv) return fromEnv;
  const file = path ?? join(homedir(), '.mistboard-cookie');
  try {
    const cookie = readFileSync(file, 'utf8').trim();
    return cookie || null;
  } catch {
    // Missing is not an error here: dev runs sign in with --email instead.
    if (path) throw new Error(`cannot read cookie file ${file}`);
    return null;
  }
}

function parseArgs(): {
  email: string | null;
  cookie: string | null;
  base: string;
  visibility: Visibility;
  dryRun: boolean;
  update: boolean;
} {
  const argv = process.argv.slice(2);
  const read = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at === -1 ? null : (argv[at + 1] ?? null);
  };
  const visibility = (read('--visibility') ?? 'public') as Visibility;
  return {
    email: read('--email'),
    // Never a VALUE on the command line: that lands in shell history and in any
    // process listing. A PATH is fine, and is how the other study scripts do it
    // (study-name-i18n.mjs, world-title-study.mjs), so `npm run auth:cookie`
    // fills one file that all of them read. The env var still works for a
    // one-off.
    cookie: readCookie(read('--cookie')),
    base: read('--base') ?? DEFAULT_BASE,
    visibility,
    dryRun: argv.includes('--dry-run'),
    update: argv.includes('--update'),
  };
}

/**
 * Bring the ALREADY-SEEDED studies in line with the dictionaries, in place.
 *
 * This exists because seeding is create-only and these five studies are pointed
 * at by curated slug: a re-seed mints new ids, and the /practice cards, every
 * link anyone has shared, and every learner's solved-count are all keyed to the
 * old ones. So a translation that lands after the first seed can only reach prod
 * as an update.
 *
 * Slugs resolve through `/api/practice` rather than a by-slug study read, which
 * does not exist: the catalogue endpoint is the only public place a slug becomes
 * a study id, and it is anonymous, so this half needs no credential to plan.
 * Chapters are matched by their English base name, which is generated from the
 * corpus and unique within a set (asserted below rather than assumed).
 */
async function updateSets(
  session: Session,
  sets: { slug: string; name: string; description: string; entries: EndgameEntry[] }[],
): Promise<void> {
  const catalogue = await session.get('/api/practice');
  if (!catalogue.ok) {
    throw new Error(`GET /api/practice failed: ${catalogue.status} ${await catalogue.text()}`);
  }
  const { sections } = (await catalogue.json()) as {
    sections: { cards: { slug: string; studyId: string }[] }[];
  };
  const idBySlug = new Map(
    sections.flatMap((section) => section.cards.map((card) => [card.slug, card.studyId])),
  );

  for (const set of sets) {
    const studyId = idBySlug.get(set.slug);
    if (!studyId) {
      throw new Error(`slug ${set.slug} resolves to no study; seed it before updating`);
    }
    const i18n = PRACTICE_SET_I18N[set.slug];
    if (!i18n) throw new Error(`no PRACTICE_SET_I18N entry for ${set.slug}`);

    const patched = await session.patch(`/api/studies/${studyId}`, { i18n });
    if (!patched.ok) {
      throw new Error(
        `patch study ${set.slug} failed: ${patched.status} ${await patched.text()} ` +
          '(the cookie must belong to the study OWNER)',
      );
    }

    const detail = await session.get(`/api/studies/${studyId}`);
    if (!detail.ok) {
      throw new Error(`read ${set.slug} failed: ${detail.status} ${await detail.text()}`);
    }
    const { chapters } = (await detail.json()) as {
      chapters: { id: string; name: string; version: number; root: unknown }[];
    };
    const byName = new Map<string, (typeof chapters)[number]>();
    for (const chapter of chapters) {
      if (byName.has(chapter.name)) {
        throw new Error(
          `${set.slug} has two chapters named "${chapter.name}"; cannot match by name`,
        );
      }
      byName.set(chapter.name, chapter);
    }

    let touched = 0;
    for (const entry of set.entries) {
      const chapter = byName.get(practiceChapterName(entry));
      if (!chapter) {
        throw new Error(`${set.slug}: no chapter named "${practiceChapterName(entry)}"`);
      }
      const body = practiceChapterBody(entry) as {
        i18n?: Record<string, { name: string }>;
        root: unknown;
      };
      // Name and tree go in one PATCH: the route takes `root` together with
      // `name`/`i18n`, and the comment overlay lives INSIDE the tree, so a
      // chapter-metadata-only patch would leave the comment in English.
      const response = await session.patch(`/api/studies/${studyId}/chapters/${chapter.id}`, {
        ...(body.i18n ? { i18n: body.i18n } : {}),
        root: body.root,
        baseVersion: chapter.version,
      });
      if (!response.ok) {
        throw new Error(
          `patch ${set.slug}/${entry.id} failed: ${response.status} ${await response.text()}`,
        );
      }
      touched += 1;
    }
    console.log(`${set.slug}: ${studyId} updated (${touched} chapters)`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  const setsWithEntries = PRACTICE_SETS.map((set) => ({
    ...set,
    entries: XIANGQI_ENDGAME_CORPUS.filter((entry) => set.categories.includes(entry.category)),
  }));

  // Every corpus entry must land in exactly one set. A category added to the
  // corpus and not to SETS would otherwise vanish from the index silently, which
  // is the failure a curated shelf hides best and suffers most.
  const placed = new Set(setsWithEntries.flatMap((set) => set.entries.map((e) => e.id)));
  const orphans = XIANGQI_ENDGAME_CORPUS.filter((entry) => !placed.has(entry.id));
  if (orphans.length > 0) {
    throw new Error(
      `these corpus entries belong to no set (add their category to SETS): ${orphans
        .map((entry) => `${entry.id} [${entry.category}]`)
        .join(', ')}`,
    );
  }

  if (args.dryRun) {
    for (const set of setsWithEntries) {
      console.log(`${set.slug.padEnd(24)} ${String(set.entries.length).padStart(2)} exercises`);
      for (const entry of set.entries) {
        console.log(`    ${entry.id.padEnd(38)} ${practiceGoalFor(entry)}`);
      }
    }
    console.log(`\n${setsWithEntries.length} studies, ${placed.size} exercises (dry run)`);
    return;
  }

  const session = new Session(args.base);
  // --email wins: a dev run against localhost must not pick up the prod cookie
  // that happens to be sitting in the default file.
  if (args.email) await session.signIn(args.email);
  else if (args.cookie) session.useCookie(args.cookie);
  else throw new Error('pass --email (dev) or set MISTBOARD_SESSION_COOKIE (prod), or --dry-run');

  if (args.update) {
    await updateSets(session, setsWithEntries);
    console.log(`\n${setsWithEntries.length} practice studies updated in place.`);
    return;
  }

  for (const set of setsWithEntries) {
    const first = set.entries[0];
    if (!first) throw new Error(`set ${set.slug} has no entries`);

    const created = await session.post('/api/studies', {
      name: set.name,
      description: set.description,
      i18n: PRACTICE_SET_I18N[set.slug],
      visibility: args.visibility,
      chapter: practiceChapterBody(first),
    });
    if (!created.ok) {
      throw new Error(`create ${set.slug} failed: ${created.status} ${await created.text()}`);
    }
    // `chapters` is a SIBLING of `study` in the create response, not nested.
    const { study, chapters } = (await created.json()) as {
      study: { id: string };
      chapters: { id: string }[];
    };

    const slugged = await session.put(`/api/admin/studies/${study.id}/slug`, { slug: set.slug });
    if (!slugged.ok) {
      throw new Error(
        `slug ${set.slug} failed: ${slugged.status} ${await slugged.text()} ` +
          '(the account must be an admin; the slug is what /practice points at)',
      );
    }

    const firstChapterId = chapters[0]?.id;
    if (!firstChapterId) throw new Error(`created ${set.slug} has no chapter`);
    await flagPractice(session, study.id, firstChapterId, first);

    for (const entry of set.entries.slice(1)) {
      const response = await session.post(
        `/api/studies/${study.id}/chapters`,
        practiceChapterBody(entry),
      );
      if (!response.ok) {
        throw new Error(
          `add chapter ${entry.id} failed: ${response.status} ${await response.text()}`,
        );
      }
      const { chapter } = (await response.json()) as { chapter: { id: string } };
      await flagPractice(session, study.id, chapter.id, entry);
    }

    console.log(`${set.slug}: ${study.id} (${set.entries.length} exercises)`);
  }

  console.log(`\n${setsWithEntries.length} practice studies seeded. /practice will list them.`);
}

/** Practice mode is a separate PATCH: the flag and its goal validate together. */
async function flagPractice(
  session: Session,
  studyId: string,
  chapterId: string,
  entry: EndgameEntry,
): Promise<void> {
  const response = await session.patch(`/api/studies/${studyId}/chapters/${chapterId}`, {
    practice: true,
    practiceGoal: practiceGoalFor(entry),
  });
  if (!response.ok) {
    throw new Error(
      `practice flag failed for ${entry.id}: ${response.status} ${await response.text()}`,
    );
  }
}

// Guarded so the sets and the chapter builder can be imported by a test. Without
// it, importing this module to check what it EMITS runs the seeder instead --
// which is why the translations it did not emit went unnoticed.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
