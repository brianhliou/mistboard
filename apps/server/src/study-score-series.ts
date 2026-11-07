// Named win-chance series on a study chapter (migration 184), drawn as a graph
// under the board in the study embed. One fixed side's view: every value is that
// side's win chance in [0, 1], index 0 the start position, index n after mainline
// ply n. The AB-JChess vs jqe post sets two (each engine's own reading of one
// game); a chapter can carry up to four.
//
// Written only by study:edit (the `series` op), so this parser is the one gate:
// the CLI checks a plan with it before anything is written, and the reader trusts
// what is stored but still draws nothing when the length disagrees with the tree.

export type ChapterScoreSide = 'red' | 'black';
/** Colour tokens the embed maps to its chart inks: `a` = --eval-compare-a (teal),
 *  `b` = --eval-compare-b (orange). Tokens, not CSS, so a stored row can never
 *  carry markup or a colour the dark theme does not lift. */
export const SCORE_SERIES_COLORS = ['a', 'b', 'c', 'd'] as const;
export type ChapterScoreColor = (typeof SCORE_SERIES_COLORS)[number];

export type ChapterScoreSeriesLine = {
  name: string;
  color: ChapterScoreColor;
  values: number[];
};

export type ChapterScoreSeries = {
  side: ChapterScoreSide;
  series: ChapterScoreSeriesLine[];
};

const MAX_SERIES = 4;
const MAX_NAME = 40;
const MAX_VALUES = 2000;

/**
 * Validate a score-series value. `plies` is the chapter's mainline length; when
 * given, every series must hold exactly plies + 1 values. Throws with a message
 * naming what is wrong; returns a normalised copy (values rounded to 4 places).
 */
export function parseChapterScoreSeries(value: unknown, plies?: number): ChapterScoreSeries {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('series: expected an object with side and series');
  }
  const { side, series } = value as { side?: unknown; series?: unknown };
  if (side !== 'red' && side !== 'black') {
    throw new Error(`series: side must be "red" or "black", got ${JSON.stringify(side)}`);
  }
  if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) {
    throw new Error(`series: expected 1 to ${MAX_SERIES} series`);
  }
  const names = new Set<string>();
  const lines = series.map((raw, i): ChapterScoreSeriesLine => {
    if (!raw || typeof raw !== 'object') throw new Error(`series[${i}]: expected an object`);
    const { name, color, values } = raw as { name?: unknown; color?: unknown; values?: unknown };
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > MAX_NAME) {
      throw new Error(`series[${i}]: name must be 1 to ${MAX_NAME} characters`);
    }
    if (names.has(trimmed)) throw new Error(`series[${i}]: duplicate name "${trimmed}"`);
    names.add(trimmed);
    if (!SCORE_SERIES_COLORS.includes(color as ChapterScoreColor)) {
      throw new Error(
        `series[${i}]: color must be one of ${SCORE_SERIES_COLORS.join(', ')}, got ${JSON.stringify(color)}`,
      );
    }
    if (!Array.isArray(values) || values.length < 2 || values.length > MAX_VALUES) {
      throw new Error(`series[${i}]: values must be an array of 2 to ${MAX_VALUES} numbers`);
    }
    const bad = values.findIndex(
      (v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1,
    );
    if (bad >= 0) {
      throw new Error(
        `series[${i}]: values[${bad}] must be a number in [0, 1], got ${JSON.stringify(values[bad])}`,
      );
    }
    if (plies !== undefined && values.length !== plies + 1) {
      throw new Error(
        `series[${i}] "${trimmed}": ${values.length} values for a ${plies}-ply mainline (needs ${plies + 1})`,
      );
    }
    return {
      name: trimmed,
      color: color as ChapterScoreColor,
      values: (values as number[]).map((v) => Math.round(v * 10000) / 10000),
    };
  });
  const length = lines[0]!.values.length;
  if (lines.some((line) => line.values.length !== length)) {
    throw new Error('series: every series must have the same number of values');
  }
  return { side, series: lines };
}
