// Card art for "Puzzles with more than one solution". The article itself is boards and
// tables: two diagrams (the old gate as a race, the grader's search cap as a
// tree) were drawn and cut on 2026-09-11, because both illustrated a sentence
// the prose already carried and read as filler beside a real position.

const ACCENT = 'var(--site-accent, #2f7d62)';
const BORDER = 'var(--site-border, #d8d5cf)';
const DANGER = 'var(--site-danger, #b4532a)';

export const PTA_THUMBNAIL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" width="160" height="120" role="img" aria-label="Two circles on one line, one filled and one hollow">
<line x1="20" y1="60" x2="140" y2="60" stroke="${BORDER}" stroke-width="3"/>
<circle cx="60" cy="60" r="13" fill="${ACCENT}"/>
<circle cx="104" cy="60" r="13" fill="none" stroke="${DANGER}" stroke-width="4"/>
</svg>`;
