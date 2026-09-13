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
  likeCount: number;
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

// More than the box can show. On the homepage the box spans the blog + video
// rows (bands 3-4), so its height comes from the band, not from its rows: the
// row count is measured, not configured. fitRowsToBody() (site-box-fit.ts)
// drops trailing rows that would clip mid-item and adds the fill class when
// the rest should grow to meet the bottom edge. The API's own default is 5,
// which left a third of the box empty once the rows took their intended
// height (2026-08-27).
const landingStudiesFetchLimit = 12;
const studiesFillClass = 'landing-community-body--fill';

/** Standalone Top studies box: the homepage band-2 slot (replaced Top players
 *  2026-07-21 — with no rated liquidity yet, curated studies are the stronger
 *  front-door proof; players return when the ladder has depth). */
export function buildTopStudiesWidget(options: { hydrate?: boolean } = {}): HTMLElement {
  return buildStudyWidget(options);
}

function buildStudyWidget(options: { hydrate?: boolean }): HTMLElement {
  const { box, body } = buildSiteBox({ title: 'Top studies', href: '/study' });
  box.classList.add('landing-study-widget', 'landing-community-widget');
  body.append(statusRow(t('home.loadingStudies')));
  if (options.hydrate !== false) void hydrateStudies(body);
  return box;
}

async function hydrateStudies(body: HTMLElement): Promise<void> {
  try {
    const response = await fetch(`/api/studies/public?limit=${landingStudiesFetchLimit}`, {
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
  const thumbnail = buildStudyThumbnail(
    study.id,
    'landing-study-thumbnail',
    'lazy',
    study.previewBoard ?? null,
  );

  const main = document.createElement('span');
  main.className = 'landing-community-main';
  const chapters =
    study.chapterCount === 1
      ? t('study.chapterCountOne')
      : t('study.chapterCount', { count: study.chapterCount });
  main.append(
    text('landing-community-name', localizedStudyName(study.name, study.i18n)),
    text('landing-community-meta', `${study.owner.displayName} · ${chapters}`),
  );
  const likes = text('landing-study-likes', `♥ ${study.likeCount}`);
  likes.title =
    study.likeCount === 1
      ? t('study.likeCountOne')
      : t('study.likeCount', { count: study.likeCount });
  row.append(...(thumbnail ? [thumbnail] : []), main, likes);
  return row;
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
