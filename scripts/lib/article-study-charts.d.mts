export type StudyEmbed = {
  slug: string;
  lang: string;
  path: string;
  studyId: string | null;
  chapterId: string | null;
  ply: number | null;
};

export type ServedArticleVersion = { slug: string; lang: string; article: unknown };

export function parseStudyEmbedPath(
  path: string,
): { studyId: string; chapterId: string | null; ply: number | null } | null;
export function collectStudyEmbeds(versions: readonly ServedArticleVersion[]): StudyEmbed[];
export function mainlinePlies(root: unknown): number;
export function startsFromOpening(root: unknown): boolean;
export const MIN_UNTAGGED_GAME_PLIES: number;
export function isGameChapter(chapter: unknown): boolean;
export const DECISION_VARIANTS: ReadonlySet<string>;
export const FAILING_VERDICTS: ReadonlySet<string>;
export type StudyChartAllowlistEntry = { studyId: string; chapterId: string; reason: string };
export const STUDY_CHART_ALLOWLIST: readonly StudyChartAllowlistEntry[];
export type StudyChartVerdict = StudyEmbed & {
  verdict:
    | 'ok'
    | 'position'
    | 'allowlisted'
    | 'no-chart'
    | 'bad-series'
    | 'no-decisions'
    | 'unreadable';
  why?: string;
  chapterName?: string;
  variant?: string;
};
export function judgeStudyCharts(
  embeds: readonly StudyEmbed[],
  studies: Readonly<Record<string, unknown>>,
  allowlist?: readonly { studyId: string; chapterId: string; reason: string }[],
): StudyChartVerdict[];
