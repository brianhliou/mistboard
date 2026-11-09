export type ArticleAnalysisRecord = { iccs: string; startFen?: string; analysisNodes?: number };
export function articleAnalysisKey(record: ArticleAnalysisRecord): string;
