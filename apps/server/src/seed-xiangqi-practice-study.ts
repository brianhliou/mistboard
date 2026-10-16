/**
 * The basic-endgame PRACTICE studies: what one chapter looks like, the five
 * sets' names, and the signed-in HTTP session the seeders share. The command
 * that writes them is seed-xiangqi-endgame-practice.ts; which positions each
 * set holds, and in what order, is packages/game xiangqi-endgame-practice.ts.
 *
 * A practice chapter is a position plus a goal and no solution line. The
 * difference from seed-xiangqi-endgame-study.ts is the whole point of the
 * surface: that seeder writes the engine's winning line as a mainline you click
 * through; this one writes no moves at all, and the engine plays the defence
 * when a learner opens the chapter.
 *
 * Goal choice follows the verdict, and it is NOT symmetrical:
 *   win  -> `mate`. A book win is already winning at move one, so "reach +600"
 *           would be satisfied before the learner touched a piece. The exercise
 *           is to CONVERT, and only a delivered mate proves that.
 *   draw -> `draw in 15` (see packages/game XIANGQI_ENDGAME_PRACTICE_DRAW_MOVES).
 *
 * Trilingual, from the same dictionaries the reading study uses
 * (xiangqi-endgame-study-i18n.ts). The first cut of this seeder wrote none: the
 * corpus was already translated for `tOceiaI7`, the split into practice studies
 * did not carry the translations across, and 74 strings that had Chinese sitting
 * in the repo shipped in English on a Chinese page for as long as nobody looked.
 * A split of already-translated content inherits its translations or it silently
 * un-translates them.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { EndgameEntry, EndgamePracticeChapter, EndgamePracticeSetSlug } from '@mistboard/game';
import {
  ENDGAME_STUDY_LANGS,
  localizedChapterName,
  localizedPracticeComment,
} from './xiangqi-endgame-study-i18n.js';

/**
 * One study PER PIECE FAMILY rather than one long study: it is what makes the
 * /practice index read as a shelf rather than a single link. lichess divides the
 * same way ("Pawn Endgames", "Rook Endgames"), for the same reason: a card is a
 * sitting, and 46 exercises is not a sitting.
 *
 * `slug` is the catalogue's handle on the study (migration 132). It never changes,
 * which is the point: re-seeding mints new study ids and renaming changes names,
 * and either would silently empty a section of the index.
 */
export const PRACTICE_SETS: {
  slug: EndgamePracticeSetSlug;
  name: string;
  description: string;
}[] = [
  {
    slug: 'endgames-soldier',
    name: 'Soldier endgames',
    description:
      'What a lone soldier can finish and what it cannot. A soldier never moves backwards, which is why some of these are wins and some are not.',
  },
  {
    slug: 'endgames-chariot',
    name: 'Chariot endgames',
    description:
      'The chariot is the one piece that wins on its own. These are the positions where technique still decides it.',
  },
  {
    slug: 'endgames-horse',
    name: 'Horse endgames',
    description:
      'The horse is slow and its leg can be blocked. Converting with one is a question of timing.',
  },
  {
    slug: 'endgames-cannon',
    name: 'Cannon endgames',
    description:
      "A cannon needs something to fire over, so a bare board is the defender's friend. Includes the horse-and-cannon pairings.",
  },
  {
    slug: 'endgames-insufficient',
    name: 'Not enough to win',
    description:
      'Material that cannot force mate however it is arranged. Hold the draw; the point is knowing these are draws.',
  },
];

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

/**
 * The chapter as POST /api/studies/:id/chapters takes it. The practice flag and
 * goal are a separate PATCH (they validate together).
 *
 * The comment is the chapter's brief: the shelf's own words where the set
 * definition wrote some (with their zh beside them), else the corpus note, else
 * the matchup, translated from the study dictionaries.
 */
export function practiceChapterBody(chapter: EndgamePracticeChapter): {
  name: string;
  i18n?: Record<string, { name: string }>;
  variant: 'xiangqi';
  orientation: 'red' | 'black';
  root: {
    version: 1;
    rootFen: string;
    root: {
      annotations: { comments: { text: string; i18n?: Record<string, string> }[] };
      children: [];
    };
  };
} {
  const { entry } = chapter;
  const i18n = practiceChapterI18n(entry);
  const comment = chapter.brief
    ? {
        text: chapter.brief.en,
        i18n: Object.fromEntries(
          ENDGAME_STUDY_LANGS.map((lang) => [lang, chapter.brief?.[lang] ?? '']),
        ),
      }
    : (() => {
        const commentI18n = practiceCommentI18n(entry);
        return {
          text: entry.note ?? practiceChapterName(entry),
          ...(Object.keys(commentI18n).length > 0 ? { i18n: commentI18n } : {}),
        };
      })();
  return {
    name: practiceChapterName(entry),
    ...(Object.keys(i18n).length > 0 ? { i18n } : {}),
    variant: 'xiangqi',
    // The learner plays the side with something to prove, NOT whoever happens to
    // move first: Red converts a win, Black holds a draw. Orienting to the side
    // to move handed the learner the attacking side of a drawn endgame and told
    // them to hold the draw. The runner plays the other side's reply first.
    orientation: chapter.orientation,
    root: {
      version: 1,
      rootFen: chapter.fen,
      // Deliberately childless: a practice chapter carries no solution. The
      // overlay rides on the comment itself, which is where study-i18n.ts reads
      // per-node comment translations from.
      root: { annotations: { comments: [comment] }, children: [] },
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
