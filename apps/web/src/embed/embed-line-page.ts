// /embed/line/:variant — a move list with no game or study behind it, carried
// in the query string. Same card and the same per-variant boards as a study
// chapter (mountChapterEmbed); the only difference is where the chapter comes
// from. A blog post that has the moves of an engine game, a puzzle line or a
// position from a book can frame it without first making a study to hold it.
//
// The credit link goes to the variant's analysis board rather than to a study
// page, because there is none; the reader can open the same line there.
import { createInitialJungleState, jungleStateToEngineFen } from '@mistboard/game';
import type { StudyChapterPayload } from '../study-chapter-spec.js';
import type { EmbedLineRoute, EmbedLineSpec } from './embed-route.js';
import { mountChapterEmbed } from './embed-study-page.js';

const ANALYSIS_PATH: Record<EmbedLineRoute['variant'], string> = {
  xiangqi: '/analysis/xiangqi',
  'duck-xiangqi': '/analysis/duck-xiangqi',
  'atomic-xiangqi': '/analysis/atomic-xiangqi',
  banqi: '/analysis/banqi',
  jungle: '/analysis/jungle',
  chess: '/rules/chess',
};

/** The chapter shape the study card reads, built from the query string: the
 *  mainline as a chain of single children, the chrome as tags. */
export function lineToChapter(route: EmbedLineRoute, line: EmbedLineSpec): StudyChapterPayload {
  const nodes = [...line.moves]
    .reverse()
    .reduce<{ uci: string; children: unknown[] }[]>((children, uci) => [{ uci, children }], []);
  const tags: Record<string, string> = {};
  if (line.red) tags.red = line.red;
  if (line.black) tags.black = line.black;
  if (line.event) tags.event = line.event;
  if (line.result) tags.result = line.result;
  const rootFen =
    line.fen ??
    (route.variant === 'jungle' ? jungleStateToEngineFen(createInitialJungleState('line')) : null);
  return {
    id: 'line',
    name: line.event ?? 'A line',
    variant: route.variant,
    orientation: 'red',
    tags,
    // A jungle line without a position starts from the setup, like a game; a
    // banqi line has no such default, its deal IS the position, so the card's
    // own "no dealt position" note stands when fen= is missing.
    root: { ...(rootFen ? { rootFen } : {}), root: { children: nodes } },
  } as StudyChapterPayload;
}

export async function mountEmbedLine(
  root: HTMLElement,
  route: EmbedLineRoute,
  line: EmbedLineSpec,
  options: { startPly?: number | null } = {},
): Promise<void> {
  document.body.classList.add('embed-body');
  document.documentElement.dataset.embed = 'line';
  root.className = 'embed-root';
  if (line.moves.length === 0) {
    const p = document.createElement('p');
    p.className = 'embed-note';
    p.textContent = 'No moves to show: add ?moves= to the frame.';
    root.replaceChildren(p);
    return;
  }
  await mountChapterEmbed(
    root,
    { href: ANALYSIS_PATH[route.variant], text: 'mistboard.com' },
    lineToChapter(route, line),
    options,
  );
}
