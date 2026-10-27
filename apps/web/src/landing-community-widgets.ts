import { t } from './i18n/catalog.js';
import { prependTitleBadge } from './player-titles.js';
import { buildSiteBox } from './site-box.js';
import { fitRowsToBody } from './site-box-fit.js';
import { localizedStudyName } from './study-i18n.js';
import { buildStudyThumbnail, type StudyPreviewBoard } from './study-thumbnails.js';
import { leaderboardVariants } from './variants.js';
import './landing-community-widgets.css';

type PublicStudy = {
  /** Per-locale overrides; resolved against the viewer's locale (study-i18n.ts). */
  i18n?: unknown;
  id: string;
  name: string;
  owner: { handle: string; displayName: string };
  chapterCount: number;
  previewBoard?: StudyPreviewBoard | null;
};

type LeaderboardEntry = {
  handle: string;
  displayName: string;
  title?: string | null;
  eloRating: number;
  provisional: boolean;
};

type Ladder = { variant: string; leaderboard: LeaderboardEntry[] };

export function buildLandingCommunityWidgets(options: { hydrate?: boolean } = {}): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'landing-community-strip';
  strip.append(buildStudyWidget(options), buildLeaderboardWidget(options));
  return strip;
}

// Standalone Top players box for the homepage widget row (the paired
// studies+players strip above stays for any surface that wants both).
export function buildTopPlayersWidget(options: { hydrate?: boolean } = {}): HTMLElement {
  return buildLeaderboardWidget(options);
}

// Five studies (#710, Brian 2026-10-27: nine one-line rows cut every title off;
// four tall rows read as too few and too airy; six two-line rows still cut most
// titles). Each row is a small board of the study's own position beside a title
// of up to three lines at a compact size, with owner and chapter count under
// it. Five such rows fill the ~370px body the box spans at 1440 wide. Six are fetched: the stacked layout's wide, short box
// lays them out two by three (landing-community-widgets.css), and the column
// layout hides the sixth in CSS. fitRowsToBody() (site-box-fit.ts) still drops
// a trailing row that would clip mid-item on any shorter box, adding the fill
// class so the kept rows share the slack and the last one meets the bottom edge.
const landingStudiesFetchCount = 6;
const studiesFillClass = 'landing-community-body--fill';

/** Standalone Top studies box: the homepage band-2 slot (replaced Top players
 *  2026-07-21 — with no rated liquidity yet, curated studies are the stronger
 *  front-door proof; players return when the ladder has depth). */
export function buildTopStudiesWidget(options: { hydrate?: boolean } = {}): HTMLElement {
  return buildStudyWidget(options);
}

function buildStudyWidget(options: { hydrate?: boolean }): HTMLElement {
  const { box, body } = buildSiteBox({ title: t('home.latestStudies'), href: '/study' });
  box.classList.add('landing-study-widget', 'landing-community-widget');
  body.append(statusRow(t('home.loadingStudies')));
  if (options.hydrate !== false) void hydrateStudies(body);
  return box;
}

async function hydrateStudies(body: HTMLElement): Promise<void> {
  try {
    const response = await fetch(`/api/studies/public?limit=${landingStudiesFetchCount}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`public_studies_failed_${response.status}`);
    const { studies } = (await response.json()) as { studies: PublicStudy[] };
    if (studies.length === 0) {
      body.replaceChildren(statusRow(t('home.noPublicStudies')));
      return;
    }
    fitRowsToBody(body, studies.map(studyRow), studiesFillClass);
  } catch {
    body.replaceChildren(statusRow(t('home.studiesUnavailable')));
  }
}

function studyRow(study: PublicStudy): HTMLElement {
  const row = document.createElement('a');
  row.className = 'site-box-row landing-study-row';
  row.href = `/study/${encodeURIComponent(study.id)}`;
  // Every row holds a thumbnail slot, so titles line up down the box even when
  // a study has no derived board and no variant marker (an empty panel of the
  // same shape). No like count (#710): with every study at 0 it read as a
  // verdict, not a signal; bring it back when likes exist.
  const thumbnail =
    buildStudyThumbnail(study.id, 'landing-study-thumbnail', 'lazy', study.previewBoard ?? null) ??
    blankThumbnail();

  const main = document.createElement('span');
  main.className = 'landing-community-main';
  const chapters =
    study.chapterCount === 1
      ? t('study.chapterCountOne')
      : t('study.chapterCount', { count: study.chapterCount });
  // No description line: the authored descriptions are paragraphs for the
  // study page, and their first 45 characters (a URL, a date, the title again)
  // said less than the title (#710, tried 2026-10-27).
  main.append(
    text('landing-community-name landing-study-name', localizedStudyName(study.name, study.i18n)),
    text('landing-community-meta', `${study.owner.displayName} · ${chapters}`),
  );
  row.append(thumbnail, main);
  return row;
}

function blankThumbnail(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'study-thumbnail study-thumbnail--blank landing-study-thumbnail';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function buildLeaderboardWidget(options: { hydrate?: boolean }): HTMLElement {
  const { box, body } = buildSiteBox({ title: 'Top players', href: '/leaderboard' });
  box.classList.add('landing-leaderboard-widget', 'landing-community-widget');
  body.append(statusRow(t('home.loadingRankings')));
  if (options.hydrate !== false) void hydrateLeaderboard(body);
  return box;
}

async function hydrateLeaderboard(body: HTMLElement): Promise<void> {
  try {
    const response = await fetch('/api/leaderboard/summary?limit=1', {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`leaderboard_widget_failed_${response.status}`);
    const { ladders } = (await response.json()) as { ladders: Ladder[] };
    const byVariant = new Map(ladders.map((ladder) => [ladder.variant, ladder.leaderboard[0]]));
    const rows = leaderboardVariants.flatMap((variant) => {
      const leader = byVariant.get(variant.id);
      return leader ? [leaderboardRow(variant.label, leader)] : [];
    });
    body.replaceChildren(...(rows.length > 0 ? rows : [statusRow(t('home.noRatedPlayers'))]));
  } catch {
    body.replaceChildren(statusRow(t('home.rankingsUnavailable')));
  }
}

function leaderboardRow(category: string, leader: LeaderboardEntry): HTMLElement {
  const row = document.createElement('a');
  row.className = 'site-box-row landing-leaderboard-row';
  row.href = `/@/${encodeURIComponent(leader.handle)}`;
  // Built by hand rather than through text(), which sets textContent and would
  // wipe a badge appended before the name.
  const player = document.createElement('span');
  player.className = 'landing-leaderboard-player';
  prependTitleBadge(player, leader.title);
  player.append(leader.displayName);
  row.append(
    text('landing-leaderboard-category', category),
    player,
    text('landing-leaderboard-rating', `${leader.eloRating}${leader.provisional ? '?' : ''}`),
  );
  return row;
}

function statusRow(label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'site-box-row';
  row.append(text('site-box-row-label', label));
  return row;
}

function text(className: string, value: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = value;
  return element;
}
