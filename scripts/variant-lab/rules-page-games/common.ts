// Shared pieces of the rules-page study builders (scripts/variant-lab/rules-page-games/*.ts):
// argument parsing, the analyse.py rows, an engine's win chance, the notes file
// and the plan writer. Each builder replays its game on the site's own kernel,
// writes a jobs file for analyse.py, then turns the rows into a study:edit plan
// through scripts/study-annotate.ts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineSideline, JudgedMove } from '../../study-annotate.ts';

export const PLANS = resolve(dirname(fileURLToPath(import.meta.url)), 'plans');

export function cli(): { mode: string; arg: (k: string, d?: string) => string } {
  const [mode = '', ...argv] = process.argv.slice(2);
  const arg = (k: string, d?: string): string => {
    const i = argv.indexOf(k);
    if (i >= 0) return argv[i + 1]!;
    if (d === undefined) throw new Error(`missing ${k}`);
    return d;
  };
  return { mode, arg };
}

export type Row = {
  id: string;
  best: string;
  pv: string[];
  cp?: number;
  mate?: number;
  wdl?: [number, number, number] | null;
};

export function readRows(path: string): Map<string, Row> {
  return new Map(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row)
      .map((r) => [r.id, r]),
  );
}

/** The side to move's expected score: the engine's own WDL when it prints one,
 *  else a logistic on its centipawns (k per centipawn). */
export function winFor(r: Row, k: number): number {
  if (r.mate != null) return r.mate > 0 ? 1 : 0;
  if (r.wdl) return (r.wdl[0] + r.wdl[1] / 2) / 1000;
  return 1 / (1 + Math.exp(-k * r.cp!));
}

export type Notes = {
  intro: string;
  judged: Record<string, string>;
  comments: Record<string, string>;
  lines: Record<string, string>;
};

export function readNotes(name: string): Notes {
  const path = resolve(PLANS, `${name}.notes.json`);
  if (!existsSync(path)) return { intro: '', judged: {}, comments: {}, lines: {} };
  return JSON.parse(readFileSync(path, 'utf8')) as Notes;
}

export function noted(notes: Notes, sidelines: EngineSideline[]) {
  for (const sl of sidelines) {
    const c = notes.lines[String(sl.ply + 1)];
    if (c) sl.comment = c;
  }
  return {
    comments: Object.fromEntries(Object.entries(notes.comments).map(([p, t]) => [Number(p), t])),
    judgedComment: (m: JudgedMove) => notes.judged[String(m.ply)] ?? '',
    intro: notes.intro,
  };
}

export function writePlan(name: string, file: string, value: unknown): string {
  const path = resolve(PLANS, `${name}.${file}.json`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

export const pct = (x: number): number => Math.round(x * 1000) / 10;

export function report(marks: JudgedMove[], sidelines: EngineSideline[]): void {
  for (const m of marks) {
    console.log(
      `${m.ply}${m.glyph} ${m.mover} ${m.uci} ${pct(m.before)}->${pct(m.after)} best ${m.best}`,
    );
  }
  console.log(`sidelines ${sidelines.map((s) => `${s.ply + 1}:${s.moves.join(' ')}`).join(' | ')}`);
}
