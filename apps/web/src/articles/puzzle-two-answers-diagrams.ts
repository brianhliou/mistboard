// Figures for "The puzzle had two answers": the three things a board stepper
// cannot show. The old gate as a race on a number line, the grader's search
// budget as a tree with a hole where the hard puzzles live, and the lichess
// pair of rules as one picture. Same drawing conventions as the mining
// explainer (Roboto, site colour tokens, 656 wide).

const FONT = 'Roboto, system-ui, sans-serif';
const TEXT = 'var(--site-text, #4d4a47)';
const MUTED = 'var(--site-muted, #79766f)';
const ACCENT = 'var(--site-accent, #2f7d62)';
const BORDER = 'var(--site-border, #d8d5cf)';
const DANGER = 'var(--site-danger, #b4532a)';
const PANEL = 'var(--site-panel-soft, #f3f1ec)';

const label = (x: number, y: number, text: string, opts: { size?: number; fill?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; spacing?: number } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${opts.size ?? 12.5}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? TEXT}" text-anchor="${opts.anchor ?? 'start'}"${opts.spacing ? ` letter-spacing="${opts.spacing}"` : ''}>${text}</text>`;

// ── Figure 2: "strictly faster" is a race, not uniqueness ────────────────────

function raceRow(y: number, title: string, verdict: string, verdictFill: string, bracket: boolean): string {
  const x0 = 120;
  const step = 100;
  const ticks = [1, 2, 3, 4, 5]
    .map((n, i) => {
      const x = x0 + i * step;
      return `<line x1="${x}" y1="${y - 6}" x2="${x}" y2="${y + 6}" stroke="${BORDER}" stroke-width="2"/>${label(x, y + 24, `mate in ${n}`, { size: 11.5, fill: MUTED, anchor: 'middle' })}`;
    })
    .join('');
  const stored = x0 + step;
  const runner = x0 + 2 * step;
  const bracketSvg = bracket
    ? `<path d="M${stored} ${y - 22} L${stored} ${y - 30} L${runner} ${y - 30} L${runner} ${y - 22}" stroke="${ACCENT}" stroke-width="2" fill="none"/>${label((stored + runner) / 2, y - 36, 'faster', { size: 11, fill: ACCENT, anchor: 'middle', weight: 700 })}`
    : `<rect x="${stored - 14}" y="${y - 34}" width="${runner - stored + 28}" height="22" rx="11" fill="none" stroke="${DANGER}" stroke-width="2" stroke-dasharray="4 3"/>${label((stored + runner) / 2, y - 19, 'two mates', { size: 11, fill: DANGER, anchor: 'middle', weight: 700 })}`;
  return `${label(0, y - 66, title, { size: 11.5, fill: MUTED, weight: 700, spacing: 1.2 })}
<line x1="${x0}" y1="${y}" x2="${x0 + 4 * step}" y2="${y}" stroke="${BORDER}" stroke-width="2"/>${ticks}
<circle cx="${stored}" cy="${y}" r="8" fill="${ACCENT}"/>${label(stored, y - 54, 'stored line', { size: 11, anchor: 'middle' })}
<circle cx="${runner}" cy="${y}" r="8" fill="none" stroke="${MUTED}" stroke-width="2.5"/>${label(runner, y - 54, 'runner-up', { size: 11, fill: MUTED, anchor: 'middle' })}
${bracketSvg}
${label(656, y + 4, verdict, { size: 12, fill: verdictFill, weight: 700, anchor: 'end' })}`;
}

export const PTA_RACE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 656 262" width="656" height="262" role="img" aria-label="The old mate rule compared the stored mate's length with the runner-up's and passed the faster one; the new rule rejects the position when any second mate exists">
${raceRow(104, 'OLD RULE: STRICTLY FASTER', 'passes', ACCENT, true)}
${raceRow(226, 'NEW RULE: NO OTHER MATE', 'rejected', DANGER, false)}
</svg>`;

// ── Figure 3: the grader's three-move search, and its cap ────────────────────

function depthTree(patched: boolean, gone: boolean): string {
  const rows = [1, 2, 3, 4];
  const rowY = (d: number) => 60 + (d - 1) * 52;
  const nodes = rows
    .map((d) => {
      const y = rowY(d);
      const lit = d <= 3 && !gone;
      const fill = lit ? ACCENT : 'none';
      const stroke = lit ? ACCENT : BORDER;
      const count = 2 ** (d - 1);
      const spread = Math.min(count, 8);
      const circles = Array.from({ length: spread }, (_, i) => {
        const x = 328 + (i - (spread - 1) / 2) * 44;
        return `<circle cx="${x}" cy="${y}" r="7" fill="${fill}" stroke="${stroke}" stroke-width="2"${gone ? ' opacity="0.35"' : ''}/>`;
      }).join('');
      const tag = d <= 3 ? `${d === 1 ? 'your move' : `${d} moves deep`}` : '4 moves deep';
      const note = d <= 3 ? (d === 3 ? '~50 ms' : '') : 'seconds';
      return `${circles}${label(60, y + 4, tag, { size: 12, fill: lit ? TEXT : MUTED })}${label(596, y + 4, note, { size: 11.5, fill: d === 4 ? DANGER : MUTED, anchor: 'end', weight: d === 4 ? 700 : 400 })}`;
    })
    .join('');
  const capY = rowY(3) + 26;
  const cap = `<line x1="40" y1="${capY}" x2="616" y2="${capY}" stroke="${DANGER}" stroke-width="2" stroke-dasharray="6 4"/>${label(616, capY - 6, 'search stops here', { size: 11, fill: DANGER, anchor: 'end', weight: 700 })}`;
  const trapX = 328 + 3.5 * 44;
  const trap = `<g${gone ? ' opacity="0.35"' : ''}><circle cx="${trapX}" cy="${rowY(4)}" r="10" fill="none" stroke="${DANGER}" stroke-width="2.5"/>${label(trapX, rowY(4) + 26, 'a real mate in 4, marked wrong', { size: 11.5, fill: DANGER, anchor: 'end' })}</g>`;
  const patch = patched
    ? `<rect x="196" y="${rowY(4) + 36}" width="264" height="26" rx="13" fill="${PANEL}" stroke="${BORDER}"/>${label(328, rowY(4) + 53, '“Find the fastest mate.”', { size: 12, anchor: 'middle' })}${label(328, rowY(4) + 72, 'the prompt grew a special case for the hole', { size: 11, fill: MUTED, anchor: 'middle' })}`
    : '';
  const cross = gone
    ? `<line x1="120" y1="40" x2="560" y2="${rowY(4) + 30}" stroke="${DANGER}" stroke-width="4" stroke-linecap="round"/><line x1="560" y1="40" x2="120" y2="${rowY(4) + 30}" stroke="${DANGER}" stroke-width="4" stroke-linecap="round"/>${label(328, rowY(4) + 66, 'removed 2026-09-11: the generator no longer publishes the position', { size: 11.5, fill: TEXT, anchor: 'middle', weight: 700 })}`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 656 300" width="656" height="300" role="img" aria-label="The grader searched three moves deep for an alternative mate; a mate in four sat past the cap and was still marked wrong">
${label(0, 16, 'THE GRADER’S RESCUE SEARCH, ON THE REQUEST PATH', { size: 11.5, fill: MUTED, weight: 700, spacing: 1.2 })}
${nodes}${cap}${trap}${patch}${cross}
</svg>`;
}

export const PTA_SEARCH_STEPS: { svg: string; narrative: string }[] = [
  {
    svg: depthTree(false, false),
    narrative:
      'When a move was not the stored one, the server looked for a forced mate: three moves deep, about fifty milliseconds. A mate in four sat past the line and was still marked wrong.',
  },
  {
    svg: depthTree(true, false),
    narrative:
      'The hole got a label rather than a fix: longer mate puzzles asked for “the fastest mate”, which is what the grader could check there.',
  },
  {
    svg: depthTree(false, true),
    narrative:
      'Both are gone. The miner refuses positions with a second mate, so there is nothing for the grader to search for.',
  },
];

// ── Figure 4: lichess's two rules as one picture ─────────────────────────────

function ruleBox(x: number, title: string, lines: string[], accent: boolean): string {
  const body = lines.map((line, i) => label(x + 18, 78 + i * 20, line, { size: 12.5 })).join('');
  return `<rect x="${x}" y="34" width="288" height="${60 + lines.length * 20}" rx="10" fill="${PANEL}" stroke="${accent ? ACCENT : BORDER}" stroke-width="${accent ? 2 : 1.5}"/>${label(x + 18, 58, title, { size: 11.5, fill: accent ? ACCENT : MUTED, weight: 700, spacing: 1.2 })}${body}`;
}

export const PTA_TWO_RULES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 656 220" width="656" height="220" role="img" aria-label="Two rules that fit together: the generator refuses any mate position with a second mating move, and the grader accepts the stored line plus any move that mates at once">
${ruleBox(0, 'AT MINE TIME', ['A mate puzzle is kept only if', 'no other move mates, at any', 'length. One exception: a', 'mate in one, whatever else', 'mates in one too.'], true)}
${ruleBox(368, 'AT PLAY TIME', ['The stored line solves it.', 'Any move that mates right', 'now also solves it.', 'Nothing else does, and', 'nothing is searched.'], true)}
<path d="M292 100 L360 100" stroke="${TEXT}" stroke-width="2" fill="none" marker-end="url(#pta-arrow)"/>
<defs><marker id="pta-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${TEXT}"/></marker></defs>
${label(328, 88, 'nothing left', { size: 11, fill: MUTED, anchor: 'middle' })}
${label(328, 122, 'to search for', { size: 11, fill: MUTED, anchor: 'middle' })}
${label(0, 206, 'Everything the grader would need to search for, the generator already refused to publish.', { size: 12, fill: MUTED })}
</svg>`;

// ── Card art for the index ───────────────────────────────────────────────────

export const PTA_THUMBNAIL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" width="160" height="120" role="img" aria-label="Two circles on one line, one filled and one hollow">
<line x1="20" y1="60" x2="140" y2="60" stroke="${BORDER}" stroke-width="3"/>
<circle cx="60" cy="60" r="13" fill="${ACCENT}"/>
<circle cx="104" cy="60" r="13" fill="none" stroke="${DANGER}" stroke-width="4"/>
</svg>`;
